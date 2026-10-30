import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { connect, disconnect, inspect, type IntegrationTarget } from "../src/index";
import { hookGroups } from "../src/codex";
import { capture, commit, withDirectoryLock } from "../src/files";
import { bootstrap, editInstructions } from "../src/default";
import { json, toml } from "../src/documents";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(host: "codex" | "opencode" = "codex", support = true) {
  const parent = join(import.meta.dir, "../../../tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "integration-"));
  roots.push(root);
  const executable = join(root, host);
  await writeFile(
    executable,
    `#!/bin/sh\nif [ "$1" = --version ]; then printf '%s\\n' '${host === "codex" ? "codex-cli 0.164.0" : "opencode v2.0.32"}'; else printf '%s\\n' '${support ? "hooks stable true" : "other stable true"}'; fi\n`,
  );
  await chmod(executable, 0o755);
  const target: IntegrationTarget = {
    environment: { harness: host, configDirectory: join(root, "home"), executable },
    scope: { kind: "project", directory: root },
  };
  return { root, target };
}
test("Codex installs both hooks once and removes only its definitions", async () => {
  const { root, target } = await fixture();
  const file = join(root, ".codex/hooks.json");
  await mkdir(join(root, ".codex"));
  await writeFile(
    file,
    '{\n"description":"retain this","hooks":{"Stop":[{"hooks":[{"type":"command","command":"custom"}]}]}}\n',
  );
  const result = await connect({ target });
  expect(result.outcome).toBe("applied");
  expect(result.mechanism).toBe("codex-hooks");
  const text = await readFile(file, "utf8");
  expect(JSON.parse(text).description).toBe("retain this");
  expect(result.inspection?.entries[0]?.status).toBe("current");
  expect((await connect({ target })).outcome).toBe("unchanged");
  expect(await readFile(file, "utf8")).toBe(text);
  expect((await disconnect({ target })).outcome).toBe("applied");
  expect(json(await readFile(file, "utf8"), file).hooks).toMatchObject({
    Stop: [{ hooks: [{ type: "command", command: "custom" }] }],
  });
  expect((await disconnect({ target })).outcome).toBe("unchanged");
});
test("explicit targets cannot add a parallel entry", async () => {
  const { root, target } = await fixture();
  await connect({ target });
  const result = await connect({
    target,
    entry: { mechanism: "codex-hooks", file: join(root, ".codex/config.toml") },
  });
  expect(result.outcome).toBe("blocked");
  expect(await Bun.file(join(root, ".codex/config.toml")).exists()).toBe(false);
});
test("historical guidance can be removed explicitly alongside a native entry", async () => {
  const { root, target } = await fixture();
  await connect({ target });
  const file = join(root, "OLD.md");
  await writeFile(file, bootstrap);
  expect(
    (
      await disconnect({
        target,
        entry: { mechanism: "default", file },
        acknowledgeFileImpact: true,
      })
    ).outcome,
  ).toBe("applied");
  expect(await readFile(file, "utf8")).toBe("");
  expect((await inspect(target)).entries[0]?.mechanism).toBe("codex-hooks");
});
test("broken plugin metadata preserves its reference and permits offline disconnect", async () => {
  const { target } = await fixture("opencode");
  await connect({ target });
  const entry = (await inspect(target)).entries[0]!;
  await writeFile(join(entry.artifact!, "../package.json"), "{broken");
  await rm(target.environment.executable!);
  const inspection = await inspect(target);
  expect(inspection.entries).toHaveLength(1);
  expect(inspection.entries[0]?.status).toBe("modified");
  expect(inspection.diagnostics.some((d) => d.code === "INVALID_HOST_CONFIG")).toBe(true);
  expect((await disconnect({ target })).outcome).toBe("applied");
  expect((await inspect(target)).entries).toHaveLength(0);
});
test("known legacy plugin tuples require migration while unrelated tuples are retained", async () => {
  const { root, target } = await fixture("opencode");
  const file = join(root, "opencode.jsonc");
  const known = JSON.stringify({ plugin: [["./plugins/skill-cli-v2", { enabled: true }]] });
  await writeFile(file, known);
  expect((await connect({ target })).outcome).toBe("blocked");
  expect(await readFile(file, "utf8")).toBe(known);
  await writeFile(file, JSON.stringify({ plugin: [["unrelated-plugin", { enabled: true }]] }));
  expect((await connect({ target })).outcome).toBe("applied");
  expect(JSON.parse(await readFile(file, "utf8")).plugin).toEqual([
    ["unrelated-plugin", { enabled: true }],
  ]);
});
test("Codex rejects JSONC hook files without rewriting them", async () => {
  const { root, target } = await fixture();
  await mkdir(join(root, ".codex"));
  const file = join(root, ".codex/hooks.json");
  for (const text of ['{// comment\n"hooks":{}}', '{"hooks":{},}']) {
    await writeFile(file, text);
    expect((await connect({ target })).outcome).toBe("blocked");
    expect((await inspect(target)).diagnostics.some((d) => d.code === "INVALID_HOST_CONFIG")).toBe(
      true,
    );
    expect(await readFile(file, "utf8")).toBe(text);
  }
});
test("project fallback list overrides home fallback list", async () => {
  const { root, target } = await fixture("codex", false);
  await mkdir(join(root, "home"));
  await mkdir(join(root, ".codex"));
  await writeFile(join(root, "home/config.toml"), 'project_doc_fallback_filenames = ["TEAM.md"]\n');
  await writeFile(
    join(root, ".codex/config.toml"),
    'project_doc_fallback_filenames = ["PROJECT.md"]\n',
  );
  await writeFile(join(root, "TEAM.md"), "Home guidance\n");
  await writeFile(join(root, "PROJECT.md"), "Project guidance\n");
  expect((await connect({ target })).file).toBe(join(root, "PROJECT.md"));
  expect(await readFile(join(root, "TEAM.md"), "utf8")).toBe("Home guidance\n");
});
test("OpenCode inspection includes package metadata in status and revision", async () => {
  const { target } = await fixture("opencode");
  await connect({ target });
  const before = await inspect(target);
  const artifact = before.entries[0]!.artifact!;
  const metadata = join(artifact, "../package.json");
  await writeFile(
    metadata,
    '{"name":"@skctl/opencode-adapter","type":"module","exports":"./other.js"}',
  );
  const modified = await inspect(target);
  expect(modified.entries[0]?.status).toBe("modified");
  expect(modified.revision).not.toBe(before.revision);
  await rm(metadata);
  expect((await inspect(target)).entries[0]?.status).toBe("missing-artifact");
});
test("owned native maintenance tolerates an unreadable auxiliary instruction file", async () => {
  const { root, target } = await fixture();
  await connect({ target });
  await symlink(join(root, "unreadable"), join(root, "AGENTS.md"));
  const result = await connect({ target });
  expect(result.outcome).toBe("unchanged");
  expect(result.inspection?.diagnostics.some((d) => d.code === "UNSUPPORTED_FILE")).toBe(true);
});
test("unrelated legacy OpenCode plugin syntax does not block skctl", async () => {
  const { root, target } = await fixture("opencode");
  const file = join(root, "opencode.jsonc");
  await writeFile(file, '{"plugin":["unrelated-plugin"]}');
  expect((await connect({ target })).outcome).toBe("applied");
  expect(JSON.parse(await readFile(file, "utf8")).plugin).toEqual(["unrelated-plugin"]);
});
test("lock cleanup failure preserves a committed receipt", async () => {
  const { root } = await fixture();
  const lock = join(root, ".skctl-integration.lock");
  try {
    const result = await withDirectoryLock(root, async () => {
      await chmod(lock, 0o500);
      return { outcome: "applied", diagnostics: [] };
    });
    expect(result.outcome).toBe("applied");
    expect(result.diagnostics).toMatchObject([{ code: "LOCK_CLEANUP_FAILED" }]);
  } finally {
    await chmod(lock, 0o700);
  }
});
test("Codex uses inline TOML without adding a parallel hook source", async () => {
  const { root, target } = await fixture();
  const file = join(root, ".codex/config.toml");
  await mkdir(join(root, ".codex"));
  const original =
    '# user config\nmodel = "custom"\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "custom"\n';
  await writeFile(file, original);
  expect((await connect({ target })).outcome).toBe("applied");
  const installed = toml(await readFile(file, "utf8"), file).value;
  expect(installed.model).toBe("custom");
  expect((await disconnect({ target })).outcome).toBe("applied");
  const removed = toml(await readFile(file, "utf8"), file).value;
  expect(removed).toEqual(toml(original, file).value);
});
test("changed definitions and stale inspection cannot be overwritten", async () => {
  const { root, target } = await fixture();
  const before = await inspect(target);
  await mkdir(join(root, ".codex"), { recursive: true });
  const file = join(root, ".codex/hooks.json");
  await writeFile(
    file,
    JSON.stringify({
      hooks: { SessionStart: [{ ...hookGroups.SessionStart, matcher: "startup" }] },
    }),
  );
  expect((await connect({ target, expected: before.revision })).diagnostics[0]?.code).toBe(
    "REVISION_CONFLICT",
  );
  expect((await disconnect({ target })).diagnostics[0]?.code).toBe("ENTRY_MODIFIED");
});
test("default follows override drift and removes the original explicit block", async () => {
  const { root, target } = await fixture("codex", false);
  expect((await connect({ target })).mechanism).toBe("default");
  await writeFile(join(root, "AGENTS.override.md"), "Other instructions\n");
  expect((await connect({ target })).diagnostics[0]?.code).toBe("RELOCATION_REQUIRED");
  const result = await disconnect({
    target,
    entry: { mechanism: "default", file: join(root, "AGENTS.md") },
    acknowledgeFileImpact: true,
  });
  expect(result.outcome).toBe("applied");
  expect(await readFile(join(root, "AGENTS.override.md"), "utf8")).toBe("Other instructions\n");
});
test("default markers in examples are not owned and unclosed code blocks reject appending", () => {
  const example = "```md\n" + bootstrap + "```\n";
  const installed = editInstructions(example, false);
  expect(editInstructions(installed, true).trimEnd()).toBe(example.trimEnd());
  expect(() => editInstructions("```md\nexample\n", false)).toThrow("unclosed Markdown");
});
test("atomic file update refuses changed evidence and preserves original bytes", async () => {
  const { root } = await fixture();
  const file = join(root, "instructions.md");
  await writeFile(file, "original");
  const before = await capture(file);
  await writeFile(file, "human edit");
  await expect(commit(before, "replacement", [before])).rejects.toMatchObject({
    code: "REVISION_CONFLICT",
  });
  expect(await readFile(file, "utf8")).toBe("human edit");
});
test("OpenCode publishes the V2 artifact before linking and only removes its reference", async () => {
  const { root, target } = await fixture("opencode");
  const file = join(root, "opencode.jsonc");
  await writeFile(file, '{"plugins":["unrelated-plugin"],"model":"keep"}\n');
  const result = await connect({ target });
  expect(result.outcome).toBe("applied");
  expect(result.mechanism).toBe("opencode-v2");
  const reference = (json(await readFile(file, "utf8"), file).plugins as string[])[1]!;
  expect(reference.startsWith("./") || reference.startsWith("../")).toBe(true);
  expect(await readFile(join(root, reference, "index.js"), "utf8")).toContain(
    "skctl.managed-catalog",
  );
  expect((await connect({ target })).outcome).toBe("unchanged");
  expect((await disconnect({ target })).outcome).toBe("applied");
  expect(json(await readFile(file, "utf8"), file)).toEqual({
    plugins: ["unrelated-plugin"],
    model: "keep",
  });
});
test("default updates preserve CRLF and blank lines outside the block", () => {
  const prefix = "# User guidance\r\n\r\n";
  const text = prefix + bootstrap.replaceAll("\n", "\r\n") + "\r\n# After\r\n";
  expect(editInstructions(text, false)).toBe(text);
  expect(editInstructions(text, true)).toBe(prefix + "\r\n# After\r\n");
});
test("Codex 0.118.0 uses guidance while unknown versions leave entry files untouched", async () => {
  const { root, target } = await fixture();
  await writeFile(
    target.environment.executable!,
    '#!/bin/sh\nif [ "$1" = --version ]; then echo "codex-cli 0.118.0"; else echo "codex_hooks under development false"; fi\n',
  );
  expect((await connect({ target })).mechanism).toBe("default");
  await disconnect({ target, acknowledgeFileImpact: true });
  for (const version of ["0.163.0", "0.165.0", "0.164.0-alpha.1", "unknown"]) {
    await writeFile(
      target.environment.executable!,
      `#!/bin/sh\nif [ "$1" = --version ]; then echo "codex-cli ${version}"; else echo "hooks stable true"; fi\n`,
    );
    const result = await connect({ target });
    expect(result.outcome).toBe("blocked");
    expect(result.diagnostics[0]?.code).toBe("HOST_CAPABILITY_UNKNOWN");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("");
    expect(await Bun.file(join(root, ".codex/hooks.json")).exists()).toBe(false);
  }
});
test("unsupported existing hooks report migration and remain removable without switching mechanism", async () => {
  const { root, target } = await fixture();
  await connect({ target });
  const file = join(root, ".codex/hooks.json");
  const before = await readFile(file, "utf8");
  await writeFile(
    target.environment.executable!,
    '#!/bin/sh\nif [ "$1" = --version ]; then echo "codex-cli 0.118.0"; else echo "codex_hooks under development true"; fi\n',
  );
  expect(
    (await inspect(target)).diagnostics.some((d) => d.code === "CODEX_ADAPTER_INCOMPATIBLE"),
  ).toBe(true);
  expect((await connect({ target })).diagnostics[0]?.code).toBe("CODEX_ADAPTER_INCOMPATIBLE");
  expect(await readFile(file, "utf8")).toBe(before);
  expect(await Bun.file(join(root, "AGENTS.md")).exists()).toBe(false);
  expect((await disconnect({ target })).outcome).toBe("applied");
  expect((await connect({ target })).mechanism).toBe("default");
});
test("Codex ignores trust-state tables and empty hook lists when selecting a source", async () => {
  const { root, target } = await fixture();
  const directory = join(root, ".codex");
  await connect({ target });
  await disconnect({ target });
  await writeFile(
    join(directory, "config.toml"),
    '[hooks.state."user-hook"]\ntrusted_hash = "sha256:keep"\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "true"\n',
  );
  const result = await connect({ target });
  expect(result.outcome).toBe("applied");
  expect(result.file).toBe(join(directory, "config.toml"));
  await disconnect({ target });
  await writeFile(
    join(directory, "config.toml"),
    '[hooks.state."user-hook"]\ntrusted_hash = "sha256:keep"\n',
  );
  const jsonResult = await connect({ target });
  expect(jsonResult.file).toBe(join(directory, "hooks.json"));
  expect(jsonResult.inspection?.diagnostics.some((d) => d.code === "MULTIPLE_HOOK_SOURCES")).toBe(
    false,
  );
});
test("Codex upgrades owned legacy hooks to deliver full context and preserves unrelated hooks", async () => {
  const { root, target } = await fixture();
  await mkdir(join(root, ".codex"));
  const file = join(root, ".codex/hooks.json");
  const legacyHandler = {
    type: "command",
    command: "skctl agent browse",
    timeout: 30,
    statusMessage: "skctl: loading Skill catalog",
  };
  await writeFile(
    file,
    JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: "^(startup|resume|clear|compact|fork)$", hooks: [legacyHandler] },
        ],
        SubagentStart: [{ hooks: [legacyHandler] }],
        Stop: [{ hooks: [{ type: "command", command: "true" }] }],
      },
    }),
  );
  expect((await inspect(target)).entries[0]?.status).toBe("outdated");
  expect((await connect({ target })).outcome).toBe("applied");
  const installed = JSON.parse(await readFile(file, "utf8"));
  expect(installed.hooks.SessionStart[0].hooks[0].additionalContextLimit).toBe(0);
  expect(installed.hooks.SubagentStart[0].hooks[0].additionalContextLimit).toBe(0);
  expect(installed.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "true" }] }]);
  expect((await connect({ target })).outcome).toBe("unchanged");
});
