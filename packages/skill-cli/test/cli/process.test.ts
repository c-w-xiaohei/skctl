import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI-002 process agent list writes exactly one managed v1 envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-process-"));
  const state = join(root, "state");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { c: { members: { review: { source: "source", path: "review" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    const setup = Bun.spawn({
      cmd: [
        process.execPath,
        "--eval",
        `import { StateCoordinator } from ${JSON.stringify(join(import.meta.dir, "../../src/core/internal/state.ts"))}; await new StateCoordinator(${JSON.stringify(state)}).installLocal("source", "review", ${JSON.stringify(skill)});`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await setup.exited).toBe(0);
    const command = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, "../../src/main.ts"),
        "agent",
        "list",
        "--json",
        "--protocol",
        "1",
      ],
      cwd: root,
      env: { ...process.env, SKILL_CLI_STATE_DIR: state, SKILL_CLI_AGENT_VERSION: "1.18.4" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await command.exited).toBe(0);
    expect(await new Response(command.stderr).text()).toBe("");
    expect(JSON.parse(await new Response(command.stdout).text())).toMatchObject({
      protocolVersion: 1,
      ok: true,
      operation: "list",
      result: { mode: "managed", entries: [{ selector: "c:review", loadingOwner: "skill-cli" }] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI-002 process agent list rejects an inapplicable output option as a v1 error", async () => {
  const command = Bun.spawn({
    cmd: [
      process.execPath,
      join(import.meta.dir, "../../src/main.ts"),
      "agent",
      "list",
      "--json",
      "--protocol",
      "1",
      "--output",
      "/tmp/out",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await command.exited).toBe(1);
  const envelope = JSON.parse(await new Response(command.stdout).text());
  expect(envelope).toMatchObject({
    protocolVersion: 1,
    type: "error",
    operation: "list",
    error: { code: "INVALID_ARGUMENT" },
  });
  expect(envelope.ok).toBeUndefined();
  expect(await new Response(command.stderr).text()).toContain("INVALID_ARGUMENT");
});
