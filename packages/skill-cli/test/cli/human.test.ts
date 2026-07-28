import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHumanCommand } from "../../src/cli/human";
import type { SkillCliCore } from "../../src/core/api";

function core(calls: unknown[]): SkillCliCore {
  return {
    workspace: { get: async () => ({ value: {} as never, diagnostics: [] }) },
    configuration: {
      change: async (change) => {
        calls.push(change);
        return { value: { changed: true } as never, diagnostics: [] };
      },
      previewAddToCollection: async () => ({ value: {} as never, diagnostics: [] }),
      previewMembershipRemoval: async () => ({ value: {} as never, diagnostics: [] }),
      previewImport: async () => ({ value: {} as never, diagnostics: [] }),
      previewReference: async () => ({ value: {} as never, diagnostics: [] }),
      previewLinkChange: async () => ({ value: {} as never, diagnostics: [] }),
      previewCollectionUse: async () => ({ value: {} as never, diagnostics: [] }),
      previewCollectionRemoval: async () => ({ value: {} as never, diagnostics: [] }),
    },
    management: {
      previewSourceRemoval: async () => ({ value: {} as never, diagnostics: [] }),
      removeSource: async () => ({ value: undefined, diagnostics: [] }),
      previewUninstall: async () => ({ value: {} as never, diagnostics: [] }),
      previewRebind: async () => ({ value: {} as never, diagnostics: [] }),
      previewAdoptConfig: async () => ({ value: {} as never, diagnostics: [] }),
      previewForgetConfig: async () => ({ value: {} as never, diagnostics: [] }),
      previewRemoveConfig: async () => ({ value: {} as never, diagnostics: [] }),
      adoptConfig: async () => ({ value: undefined, diagnostics: [] }),
      observeConfig: async (request) => ({
        value: {
          id: request.id,
          kind: "git",
          exactRevision: "a".repeat(40),
          contributions: { sources: [], collections: [] },
        },
        diagnostics: [],
      }),
      removeConfig: async (request) => {
        calls.push(["removeConfig", request]);
        return { value: undefined, diagnostics: [] };
      },
      forgetConfig: async (request) => {
        calls.push(["forgetConfig", request]);
        return { value: undefined, diagnostics: [] };
      },
      gc: async () => {
        calls.push(["gc"]);
        return { value: undefined, diagnostics: [] };
      },
      discover: async (request) => {
        calls.push(["discover", request]);
        return {
          value: {
            source: request.source,
            kind: "git",
            exactRevision: "a".repeat(40),
            candidates: [{ path: "review", name: "review", description: "Review" }],
          },
          diagnostics: [],
        };
      },
      install: async (request) => {
        calls.push(["install", request]);
        return { value: [], diagnostics: [] };
      },
      uninstall: async (request) => {
        calls.push(["uninstall", request]);
        return { value: undefined, diagnostics: [] };
      },
      rebind: async (request) => {
        calls.push(["rebind", request]);
        return { value: undefined, diagnostics: [] };
      },
      checkUpdate: async (request) => {
        calls.push(["check", request]);
        return {
          value: {
            source: request.source,
            kind: "git",
            exactRevision: "a".repeat(40),
            changed: [{ path: "changed", name: "changed", description: "Changed" }],
            added: [{ path: "added", name: "added", description: "Added" }],
            removed: [{ path: "removed", name: "removed", description: "Removed" }],
            unchanged: [{ path: "unchanged", name: "unchanged", description: "Unchanged" }],
          },
          diagnostics: [],
        };
      },
      update: async (request) => {
        calls.push(["update", request]);
        return { value: undefined, diagnostics: [] };
      },
    },
    catalog: {
      list: async () => ({ value: {} as never, diagnostics: [] }),
      search: async () => ({ value: {} as never, diagnostics: [] }),
    },
    content: {
      loadInstalled: async () => ({ value: {} as never, diagnostics: [] }),
      listInstalledResources: async () => ({ value: [], diagnostics: [] }),
      readInstalled: async () => ({ value: {} as never, diagnostics: [] }),
      load: async (request) => {
        calls.push(["load", request]);
        return { value: {} as never, diagnostics: [] };
      },
      listResources: async () => ({ value: [], diagnostics: [] }),
      read: async () => ({ value: {} as never, diagnostics: [] }),
      download: async () => ({ value: {} as never, diagnostics: [] }),
      run: async (request) => {
        calls.push(["run", request]);
        return { value: {} as never, diagnostics: [] };
      },
    },
  };
}

test("CLI-001/PROJ-023 maps finalized source and management commands through Core", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["source", "register", "local", "local", "./skills"],
    ["source", "register", "git", "git", "https://example.test/a.git", "--ref", "main"],
    ["source", "register", "github", "github", "https://github.com/a/b", "--ref", "main"],
    ["source", "discover", "local"],
    ["install", "local", "review"],
    ["update", "check", "local"],
    ["update", "apply", "local", "review", "--remove", "old"],
    ["rebind", "old", "review", "new", "--path", "renamed"],
    ["uninstall", "local", "review"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(0);
  expect(calls).toEqual([
    {
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    },
    {
      type: "source.register",
      level: "project",
      id: "git",
      binding: { kind: "git", origin: "https://example.test/a.git", root: "", ref: "main" },
    },
    {
      type: "source.register",
      level: "project",
      id: "github",
      binding: { kind: "github", origin: "https://github.com/a/b", root: "", ref: "main" },
    },
    ["discover", { source: "local" }],
    ["install", { source: "local", paths: ["review"], exactRevision: undefined }],
    ["check", { source: "local" }],
    ["update", { source: "local", paths: ["review"], remove: ["old"], exactRevision: undefined }],
    ["rebind", { source: "old", path: "review", owner: "new", ownerPath: "renamed" }],
    ["uninstall", { source: "local", paths: ["review"] }],
  ]);
});

test("CLI-001 maps collection, use, managed, and content commands without legacy aliases", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["collection", "member", "add", "engineering", "review", "local", "review"],
    ["collection", "member", "remove", "engineering", "review"],
    ["collection", "import", "source", "target"],
    ["collection", "reference", "add", "engineering", "docs", "other", "Documentation"],
    ["collection", "link", "add", "engineering", "other"],
    ["use", "set", "engineering"],
    ["managed", "set"],
    ["content", "load", "engineering:review"],
    ["content", "run", "engineering:review", "--", "true"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(0);
  expect(calls).toContainEqual({
    type: "collection.member.remove",
    level: "project",
    collection: "engineering",
    name: "review",
  });
  expect(calls).toContainEqual({
    type: "collection.reference.set",
    level: "project",
    collection: "engineering",
    name: "docs",
    target: "other",
    description: "Documentation",
  });
  expect(calls).toContainEqual({
    type: "collection.link.set",
    level: "project",
    collection: "engineering",
    target: "other",
    linked: true,
  });
  expect(calls).toContainEqual({ type: "use.set", level: "project", collections: ["engineering"] });
  expect(calls).toContainEqual({ type: "agent.managed.set", level: "project", managed: true });
  expect(calls).toContainEqual(["load", { selector: "engineering:review" }]);
  expect(calls).toContainEqual(["run", { selector: "engineering:review", argv: ["true"] }]);
  expect(await runHumanCommand(["profile", "set", "x"], options)).toBe(2);
});

test("MGMT-031 maps Config Source removal only through management", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  expect(await runHumanCommand(["config-source", "remove", "module"], options)).toBe(0);
  expect(calls).toEqual([["removeConfig", { id: "module" }]]);
  expect(calls).not.toContainEqual(expect.objectContaining({ type: "config-source.remove" }));
});

test("MGMT-001 and MGMT-027 reject unknown Config levels before any Core call", async () => {
  let created = 0;
  const options = {
    cwd: "/tmp",
    createCore: () => {
      created += 1;
      return core([]);
    },
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["source", "register", "local", "local", "./skills", "--level", "user"],
    ["managed", "unset", "--level", "user"],
  ])
    expect(await runHumanCommand(argv, options)).toBe(2);
  expect(created).toBe(0);
});

test("MGMT-001 real human Source registration writes only exact Global Project and Local targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-human-source-levels-"));
  const xdg = join(root, "xdg");
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    process.env.XDG_CONFIG_HOME = xdg;
    await mkdir(xdg);
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    for (const [level, id] of [
      ["global", "global"],
      ["project", "project"],
      ["local", "local"],
    ] as const)
      expect(
        await runHumanCommand(["source", "register", "local", id, `./${id}`, "--level", level], {
          cwd: root,
          stdout: { write() {} },
          stderr: { write() {} },
        }),
      ).toBe(0);
    expect(
      JSON.parse(await readFile(join(xdg, "skill-cli", "config.jsonc"), "utf8")).sources,
    ).toEqual({ global: { kind: "local", path: "./global", root: "" } });
    expect(JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).sources).toEqual({
      project: { kind: "local", path: "./project", root: "" },
    });
    expect(JSON.parse(await readFile(join(root, "skill-cli.local.jsonc"), "utf8")).sources).toEqual(
      {
        local: { kind: "local", path: "./local", root: "" },
      },
    );
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-006/007/023 human observations emit deterministic exact-revision lines and equivalent JSON", async () => {
  const calls: unknown[] = [];
  const run = async (argv: string[]) => {
    const output: string[] = [];
    expect(
      await runHumanCommand(argv, {
        cwd: "/tmp",
        createCore: () => core(calls),
        stdout: { write: (value) => output.push(String(value)) },
        stderr: { write() {} },
      }),
    ).toBe(0);
    return output.join("");
  };
  expect(await run(["source", "discover", "remote"])).toBe(
    `${[
      `revision ${"a".repeat(40)}`,
      "source remote",
      "kind git",
      "candidate review\treview\tReview",
    ].join("\n")}\n`,
  );
  expect(JSON.parse(await run(["source", "discover", "remote", "--json"]))).toMatchObject({
    source: "remote",
    exactRevision: "a".repeat(40),
    candidates: [{ path: "review" }],
  });
  expect(await run(["update", "check", "remote"])).toContain(
    "changed changed\tchanged\tChanged\nadded added\tadded\tAdded",
  );
  expect(await run(["config-source", "observe", "remote"])).toStartWith(
    `revision ${"a".repeat(40)}\nconfig-source remote\n`,
  );
});

test("MGMT-034 rejects malformed exact revisions before any apply Core call", async () => {
  const calls: unknown[] = [];
  const options = {
    cwd: "/tmp",
    createCore: () => core(calls),
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["install", "remote", "review", "--revision", "main"],
    ["update", "apply", "remote", "review", "--revision", "abc"],
    ["config-source", "adopt", "remote", "--revision", "f".repeat(39)],
  ])
    expect(await runHumanCommand(argv, options)).toBe(2);
  expect(calls).toEqual([]);
});
