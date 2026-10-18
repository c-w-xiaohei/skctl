import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "../../../skill-cli/src/main";
import { createSkillCliCore } from "../../src/create-core";
import { StateCoordinator } from "../../src/internal/state";

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
          description: "Routing and specialist skills",
          members: { router: { source: "source", path: "router" } },
          references: {
            category: { collection: "category", description: "Specialists" },
            alsoCategory: { collection: "category", description: "Also specialists" },
          },
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
  const code = await runMain(["agent", ...argv], {
    cwd: root,
    createCore: (options) => createSkillCliCore({ ...options, userConfigPath: global }),
    stdout: { write: (value) => (stdout += String(value)) },
    stderr: { write: (value) => (stderr += String(value)) },
  });
  return { code, stdout, stderr };
}

test("agent browse returns only Use roots before progressively disclosing collection contents", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const result = await command(root, global, ["browse"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('<managed_skill_catalog scope="root">');
    expect(result.stdout).toContain("<id>gingiris</id>");
    expect(result.stdout).toContain("Routing and specialist skills");
    expect(result.stdout).toContain("skill-cli agent browse <collection-id>");
    expect(result.stdout).toContain("skill-cli agent load <selector>");
    expect(result.stdout).not.toContain("gingiris:router");
    const collection = await command(root, global, ["browse", "gingiris"]);
    expect(collection.stdout).toContain('<managed_skill_catalog scope="collection" id="gingiris">');
    expect(collection.stdout).not.toContain("Managed Skills");
    expect(collection.stdout.trim().split("\n")).toHaveLength(1);
    expect(collection.stdout).toContain("<selector>gingiris:router</selector>");
    expect(collection.stdout).toContain("<id>category</id>");
    expect(collection.stdout).not.toContain("category:specialist");
    expect(collection.stdout).toContain("Also specialists");
    expect(collection.stdout).toContain("Specialists");
    expect(collection.stdout).not.toContain("reference");
    expect(collection.stdout).not.toContain("provenance");
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent browse uses a global catalog outside a project", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-global-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  const outside = join(root, "outside");
  process.env.SKILL_CLI_STATE_DIR = state;
  try {
    const skill = join(root, "skills", "router");
    await mkdir(skill, { recursive: true });
    await mkdir(outside);
    await writeFile(join(skill, "SKILL.md"), "---\nname: router\ndescription: router skill\n---\n");
    await writeFile(
      global,
      JSON.stringify({
        agents: { opencode: "managed" },
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          catalog: {
            description: "Routing skills",
            members: { router: { source: "source", path: "router" } },
          },
        },
        use: ["catalog"],
      }),
    );
    await new StateCoordinator(state).installLocal("source", "router", skill);

    const result = await command(outside, global, ["browse", "catalog"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('<managed_skill_catalog scope="collection" id="catalog">');
    expect(result.stdout).toContain("<selector>catalog:router</selector>");
    expect(result.stdout).toContain("<description>router skill</description>");
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent browse and load permit a reference-reachable category but reject an inaccessible collection", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const listed = await command(root, global, ["browse", "category"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('<managed_skill_catalog scope="collection" id="category">');
    expect(listed.stdout).toContain("<selector>category:specialist</selector>");
    expect(listed.stdout).toContain("<description>specialist skill</description>");

    const loaded = await command(root, global, ["load", "category:specialist"]);
    expect(loaded.code).toBe(0);
    expect(loaded.stdout).toBe("---\nname: specialist\ndescription: specialist skill\n---\n");

    const hidden = await command(root, global, ["load", "hidden:private"]);
    expect(hidden.code).toBe(1);
    expect(hidden.stdout).toBe("");
    expect(hidden.stderr).toContain("Skill Selector is not exposed");
    expect(hidden.stderr).not.toContain("SKILL_NOT_FOUND");

    const inaccessibleList = await command(root, global, ["browse", "hidden"]);
    expect(inaccessibleList.code).toBe(1);
    expect(inaccessibleList.stdout).toBe("");

    const rootSearch = await command(root, global, ["search", "router"]);
    expect(JSON.parse(rootSearch.stdout)).toEqual({
      results: [
        {
          selector: "gingiris:router",
          name: "router",
          description: "router skill",
        },
      ],
    });
    const categorySearch = await command(root, global, ["search", "specialist"]);
    expect(JSON.parse(categorySearch.stdout)).toEqual({ results: [] });
    const searchedIn = await command(root, global, ["search", "specialist", "--in", "category"]);
    expect(JSON.parse(searchedIn.stdout)).toEqual({
      results: [
        {
          selector: "category:specialist",
          name: "specialist",
          description: "specialist skill",
        },
      ],
    });
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent read reports a missing resource directory as not found", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const result = await command(root, global, ["read", "gingiris:router", "docs/missing.md"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Resource not found\n");
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent loads a ready child Skill without requiring unrelated child members", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-partial-child-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const ready = join(root, "skills", "ready");
    await mkdir(ready, { recursive: true });
    await writeFile(join(ready, "SKILL.md"), "---\nname: ready\ndescription: Ready\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          root: {
            references: {
              child: { collection: "child", description: "Child" },
              pending: { collection: "pending", description: "Pending" },
            },
          },
          pending: { members: { missing: { source: "source", path: "missing" } } },
          child: {
            members: {
              ready: { source: "source", path: "ready" },
              missing: { source: "source", path: "missing" },
            },
          },
        },
        use: ["root"],
      }),
    );
    await new StateCoordinator(state).installLocal("source", "ready", ready);
    const browsed = await command(root, global, ["browse", "child"]);
    expect(browsed.stdout).toContain('<managed_skill_catalog scope="collection" id="child">');
    expect(browsed.stdout).toContain("<selector>child:ready</selector>");
    expect((await command(root, global, ["load", "child:ready"])).code).toBe(0);
    expect((await command(root, global, ["load", "child:missing"])).code).toBe(1);
    expect(await command(root, global, ["browse", "pending"])).toEqual({
      code: 0,
      stdout:
        '<managed_skill_catalog scope="collection" id="pending">No Skills or referenced Collections are available in this Collection.</managed_skill_catalog>\n',
      stderr: "",
    });
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent refuses content when the host Use is incomplete", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-incomplete-root-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const ready = join(root, "skills", "ready");
    await mkdir(ready, { recursive: true });
    await writeFile(join(ready, "SKILL.md"), "---\nname: ready\ndescription: Ready\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          root: {
            members: {
              ready: { source: "source", path: "ready" },
              missing: { source: "source", path: "missing" },
            },
          },
        },
        use: ["root"],
      }),
    );
    await new StateCoordinator(state).installLocal("source", "ready", ready);
    expect((await command(root, global, ["browse"])).stdout).toContain(
      "managed catalog is unavailable",
    );
    const loaded = await command(root, global, ["load", "root:ready"]);
    expect(loaded.code).toBe(1);
    expect(loaded.stderr).toContain("Collection Use is incomplete");
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent search includes each Use-root selector for one installed Skill", async () => {
  const previousState = process.env.SKILL_CLI_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-multiple-use-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          alpha: { members: { first: { source: "source", path: "review" } } },
          beta: { members: { second: { source: "source", path: "review" } } },
        },
        use: ["alpha", "beta"],
      }),
    );
    await new StateCoordinator(state).installLocal("source", "review", skill);
    expect(JSON.parse((await command(root, global, ["search", "beta:second"])).stdout)).toEqual({
      results: [
        {
          selector: "beta:second",
          name: "review",
          description: "Review",
        },
      ],
    });
  } finally {
    if (previousState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
    else process.env.SKILL_CLI_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent commands reject the removed list protocol and JSON flags", async () => {
  for (const argv of [
    ["list"],
    ["browse", "--json"],
    ["load", "gingiris:router", "--protocol", "1"],
    ["load", "gingiris:router", "--json"],
  ]) {
    const result = await command("/tmp", "/missing", argv);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(argv[0] === "list" ? "unknown command" : "unknown option");
    expect(result.stderr).not.toContain("INVALID_ARGUMENT");
  }
});

test("agent reports unavailable catalogs as system-prompt guidance", async () => {
  const result = await command("/tmp", "/missing", ["browse"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("managed catalog is unavailable");
  expect(result.stderr).toBe("");
});

test("agent rejects collection IDs and Skill Selectors in the wrong address positions before Core", async () => {
  let created = 0;
  const options = {
    cwd: "/tmp",
    createCore: () => {
      created += 1;
      throw new Error("Core must not be called");
    },
    stdout: { write() {} },
    stderr: { write() {} },
  };
  for (const argv of [
    ["browse", "team:deploy"],
    ["search", "deploy", "--in", "team:deploy"],
    ["load", "team"],
    ["read", "team", "SKILL.md"],
    ["download", "team", "SKILL.md", "--output", "/tmp/out"],
    ["run", "team", "--", "true"],
    ["search", "review", "--limit=0"],
    ["search", "review", "--limit=1.5"],
    ["download", "team:review", "note.txt"],
    ["read", "team:review", "note.txt", "extra"],
    ["run", "team:review", "binary"],
    ["run", "team:review", "--"],
  ])
    expect(await runMain(["agent", ...argv], options)).toBe(1);
  expect(created).toBe(0);
});

test("agent help explains the browse to Skill workflow on stdout", async () => {
  const result = await command("/tmp", "/missing", ["--help"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Collection IDs");
  expect(result.stdout).toContain("Skill selectors");
  expect(result.stdout).toContain("browse [collection-id]");
  expect(result.stdout).toContain("load <selector>");
});

test("agent subcommand help identifies the accepted address", async () => {
  const browse = await command("/tmp", "/missing", ["browse", "--help"]);
  const load = await command("/tmp", "/missing", ["load", "--help"]);
  expect(browse.code).toBe(0);
  expect(browse.stderr).toBe("");
  expect(browse.stdout).toContain("collection-id");
  expect(load.code).toBe(0);
  expect(load.stderr).toBe("");
  expect(load.stdout).toContain("Skill selector");
});
