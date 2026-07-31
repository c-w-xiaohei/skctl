import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI-002 process agent browse writes clean root catalog JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-process-"));
  const state = join(root, "state");
  const configHome = join(root, "config");
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
      }),
    );
    await mkdir(join(configHome, "skill-cli"), { recursive: true });
    await writeFile(
      join(configHome, "skill-cli", "config.jsonc"),
      JSON.stringify({ agents: { opencode: "managed" } }),
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
      cmd: [process.execPath, join(import.meta.dir, "../../src/main.ts"), "agent", "browse"],
      cwd: root,
      env: {
        ...process.env,
        SKILL_CLI_STATE_DIR: state,
        XDG_CONFIG_HOME: configHome,
        SKILL_CLI_AGENT_VERSION: "1.18.4",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await command.exited).toBe(0);
    expect(await new Response(command.stderr).text()).toBe("");
    expect(JSON.parse(await new Response(command.stdout).text())).toEqual({
      scope: { kind: "root" },
      items: [{ kind: "collection", id: "c", name: "c" }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI-002 process agent browse rejects an inapplicable output option without an error envelope", async () => {
  const command = Bun.spawn({
    cmd: [
      process.execPath,
      join(import.meta.dir, "../../src/main.ts"),
      "agent",
      "browse",
      "--output",
      "/tmp/out",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await command.exited).toBe(1);
  expect(await new Response(command.stdout).text()).toBe("");
  expect(await new Response(command.stderr).text()).toContain("Unknown or inapplicable option");
});
