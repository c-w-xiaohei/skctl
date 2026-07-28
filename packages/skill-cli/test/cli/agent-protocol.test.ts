import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentCommand } from "../../src/cli/agent";
import { createSkillCliCore } from "../../src/core/create-core";
import { StateCoordinator } from "../../src/core/internal/state";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-reference-"));
  const state = join(root, "state");
  process.env.SKILL_CLI_STATE_DIR = state;
  const global = join(root, "global.jsonc");
  for (const name of ["router", "specialist", "private"]) {
    const skill = join(root, "skills", name);
    await mkdir(skill, { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n`,
    );
  }
  await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
  await writeFile(
    join(root, "skill-cli.jsonc"),
    JSON.stringify({
      sources: { source: { kind: "local", path: "./skills", root: "" } },
      collections: {
        gingiris: {
          members: { router: { source: "source", path: "router" } },
          references: { category: { collection: "category", description: "Specialists" } },
        },
        category: { members: { specialist: { source: "source", path: "specialist" } } },
        hidden: { members: { private: { source: "source", path: "private" } } },
      },
      use: ["gingiris"],
    }),
  );
  const coordinator = new StateCoordinator(state);
  for (const name of ["router", "specialist", "private"])
    await coordinator.installLocal("source", name, join(root, "skills", name));
  return { root, state, global };
}

async function command(
  root: string,
  global: string,
  argv: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await runAgentCommand(argv, {
    cwd: root,
    createCore: (options) => createSkillCliCore({ ...options, userConfigPath: global }),
    stdout: { write: (value) => (stdout += String(value)) },
    stderr: { write: (value) => (stderr += String(value)) },
  });
  return { code, stdout, stderr };
}

test("agent list progressively discloses root members and references", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const result = await command(root, global, ["list"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      skills: [{ selector: "gingiris:router", name: "router", description: "router skill" }],
      references: [{ name: "category", description: "Specialists", collection: "category" }],
    });
    expect(result.stdout).not.toContain("specialist");
    expect(result.stdout).not.toContain("provenance");
    expect(result.stdout).not.toContain("protocolVersion");
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent list and load permit a reference-reachable category but reject an inaccessible collection", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const listed = await command(root, global, ["list", "category"]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual({
      skills: [
        { selector: "category:specialist", name: "specialist", description: "specialist skill" },
      ],
      references: [],
    });

    const loaded = await command(root, global, ["load", "category:specialist"]);
    expect(loaded.code).toBe(0);
    expect(JSON.parse(loaded.stdout)).toEqual({
      selector: "category:specialist",
      name: "specialist",
      description: "specialist skill",
      path: "SKILL.md",
      text: "---\nname: specialist\ndescription: specialist skill\n---\n",
    });

    const hidden = await command(root, global, ["load", "hidden:private"]);
    expect(hidden.code).toBe(1);
    expect(hidden.stdout).toBe("");
    expect(hidden.stderr).toContain("Skill Selector is not exposed");
    expect(hidden.stderr).not.toContain("SKILL_NOT_FOUND");

    const inaccessibleList = await command(root, global, ["list", "hidden"]);
    expect(inaccessibleList.code).toBe(1);
    expect(inaccessibleList.stdout).toBe("");

    const rootSearch = await command(root, global, ["search", "router"]);
    expect(JSON.parse(rootSearch.stdout)).toEqual({
      query: "router",
      results: [
        { rank: 1, selector: "gingiris:router", name: "router", description: "router skill" },
      ],
    });
    const categorySearch = await command(root, global, ["search", "specialist"]);
    expect(JSON.parse(categorySearch.stdout)).toEqual({ query: "specialist", results: [] });
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent commands reject removed protocol and JSON flags", async () => {
  for (const argv of [
    ["list", "--protocol", "1"],
    ["list", "--json"],
    ["load", "gingiris:router", "--protocol", "1"],
    ["load", "gingiris:router", "--json"],
  ]) {
    const result = await command("/tmp", "/missing", argv);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown or inapplicable option");
    expect(result.stderr).not.toContain("INVALID_ARGUMENT");
  }
});
