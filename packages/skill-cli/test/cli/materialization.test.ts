import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentCommand } from "../../src/cli/agent";
import { runHumanCommand } from "../../src/cli/human";
import { createSkillCliCore } from "../../src/core/create-core";

test("CLI-001 public setup discovers and installs a Local Skill into a managed catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-cli-"));
  const state = join(root, "state");
  try {
    const source = join(root, "source");
    await mkdir(join(source, "review"), { recursive: true });
    await writeFile(
      join(source, "review", "SKILL.md"),
      "---\nname: review\ndescription: Review\n---\n",
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    expect(await runHumanCommand(["init", root, "--host", "project"], { cwd: root })).toBe(0);
    await writeFile(join(root, "skill-cli.jsonc"), '{ "collections": { "engineering": {} } }\n');
    for (const argv of [
      ["--project", root, "source", "register", "local", "local", "./source"],
      ["--project", root, "source", "discover", "local"],
      ["--project", root, "install", "local", "review"],
      [
        "--project",
        root,
        "collection",
        "member",
        "add",
        "engineering",
        "review",
        "local",
        "review",
      ],
      ["--project", root, "use", "set", "engineering"],
      ["--project", root, "managed", "set"],
    ] as const)
      expect(await runHumanCommand(argv, { cwd: root })).toBe(0);
    const catalog = await createSkillCliCore({ cwd: root }).catalog.list({});
    expect(catalog.value).toMatchObject({
      status: "available",
      mode: "managed",
      catalog: [{ selector: "engineering:review" }],
    });
    for (const argv of [
      ["list", "--json", "--protocol", "1"],
      ["load", "engineering:review", "--json", "--protocol", "1"],
    ]) {
      let output = "";
      expect(
        await runAgentCommand(argv, {
          cwd: root,
          stdout: { write: (chunk) => (output += String(chunk)) },
          stderr: { write() {} },
        }),
      ).toBe(0);
      expect(JSON.parse(output)).toMatchObject({ protocolVersion: 1, ok: true });
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
