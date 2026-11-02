import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "../../../skctl/src/main";
import { installSkills } from "../../src/index";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-reference-"));
  const state = join(root, "state");
  process.env.SKCTL_STATE_DIR = state;
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
    join(root, "skctl.jsonc"),
    JSON.stringify({
      sources: { source: { kind: "local", path: "./skills", root: "" } },
      collections: {
        gingiris: {
          description: "Routing and specialist skills",
          instructions: "Choose the router first; load specialists only when needed.",
          members: { router: { source: "source", path: "router" } },
          references: {
            category: { collection: "category", description: "Specialists" },
            alsoCategory: { collection: "category", description: "Also specialists" },
          },
        },
        category: {
          instructions: "Check the specialist evidence.",
          members: { specialist: { source: "source", path: "specialist" } },
        },
        hidden: { members: { private: { source: "source", path: "private" } } },
      },
      use: ["gingiris"],
    }),
  );
  await installSkills(
    { cwd: root, userConfigPath: global },
    { source: "source", paths: ["router", "specialist", "private"] },
  );
  return { root, state, global };
}
async function command(
  root: string,
  global: string,
  argv: readonly string[],
): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const code = await runMain(["agent", ...argv], {
    cwd: root,
    environment: { userConfigPath: global },
    stdout: { write: (value) => (stdout += String(value)) },
    stderr: { write: (value) => (stderr += String(value)) },
  });
  return { code, stdout, stderr };
}
test("agent load returns exact installed text even when frontmatter cannot be parsed", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    for (const text of [
      "# Plain instructions\nUse this Skill without frontmatter.",
      "---\nname: [broken\n---\n# Instructions\nKeep this text.",
      "---\nname: router\n# Missing closing delimiter\n",
      "---\nname: router\nname: duplicate\ndescription: Duplicate YAML keys\n---\nbody",
      "---\nname: 42\ndescription: [not, a, string]\n---\nbody",
      "---\nname: router\ndescription: &instructions Read carefully\n---\nbody",
      "---\r\nname: [broken\r\n---\r\nNo final newline",
    ]) {
      await writeFile(join(root, "skills", "router", "SKILL.md"), text);
      expect(await command(root, global, ["load", "gingiris:router"])).toEqual({
        code: 0,
        stdout: text,
        stderr: "",
      });
    }
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent load accepts multiple selectors and identifies each Skill", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const result = await command(root, global, ["load", "gingiris:router", "category:specialist"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      '<skill selector="gingiris:router">\n---\nname: router\ndescription: router skill\n---\n</skill>\n' +
        '<skill selector="category:specialist">\n---\nname: specialist\ndescription: specialist skill\n---\n</skill>\n',
    );
    const failure = await command(root, global, ["load", "gingiris:router", "hidden:private"]);
    expect(failure.code).toBe(1);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("hidden:private");
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent browse returns only Use roots before progressively disclosing collection contents", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const result = await command(root, global, ["browse"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('<managed_skill_catalog scope="root">');
    expect(result.stdout).toContain("<id>gingiris</id>");
    expect(result.stdout).toContain("Routing and specialist skills");
    expect(result.stdout).toContain("skctl agent browse <collection-id>");
    expect(result.stdout).toContain("skctl agent load <selector>");
    expect(result.stdout).not.toContain("gingiris:router");
    expect(result.stdout).not.toContain("Choose the router first");
    expect(result.stdout).not.toContain("Check the specialist evidence");
    const collection = await command(root, global, ["browse", "gingiris"]);
    expect(collection.stdout).toContain('<managed_skill_catalog scope="collection" id="gingiris">');
    expect(collection.stdout).not.toContain("Managed Skills");
    expect(collection.stdout).toContain(
      "<instructions>Choose the router first; load specialists only when needed.</instructions>",
    );
    expect(collection.stdout).not.toContain("Routing and specialist skills");
    expect(collection.stdout).not.toContain("Check the specialist evidence");
    expect(collection.stdout.trim().split("\n")).toHaveLength(1);
    expect(collection.stdout).toContain("<selector>gingiris:router</selector>");
    expect(collection.stdout).toContain("<id>category</id>");
    expect(collection.stdout).not.toContain("category:specialist");
    expect(collection.stdout).toContain("Also specialists");
    expect(collection.stdout).toContain("Specialists");
    expect(collection.stdout).not.toContain("reference");
    expect(collection.stdout).not.toContain("provenance");
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent browse uses a global catalog outside a project", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-global-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  const outside = join(root, "outside");
  process.env.SKCTL_STATE_DIR = state;
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
    await installSkills(
      { cwd: outside, userConfigPath: global },
      { source: "source", paths: ["router"] },
    );
    const result = await command(outside, global, ["browse", "catalog"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('<managed_skill_catalog scope="collection" id="catalog">');
    expect(result.stdout).toContain("<selector>catalog:router</selector>");
    expect(result.stdout).toContain("<description>router skill</description>");
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent browse and load permit a reference-reachable category but reject an inaccessible collection", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const listed = await command(root, global, ["browse", "category"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('<managed_skill_catalog scope="collection" id="category">');
    expect(listed.stdout).toContain("<selector>category:specialist</selector>");
    expect(listed.stdout).toContain("<description>specialist skill</description>");
    expect(listed.stdout).toContain("<instructions>Check the specialist evidence.</instructions>");
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
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent read reports a missing resource directory as not found", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const result = await command(root, global, ["read", "gingiris:router", "docs/missing.md"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Resource not found");
    expect(result.stderr).toContain("skctl agent ls");
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent ls bounds output, supports navigation options and rejects inaccessible paths", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const skill = join(root, "skills", "router");
    await mkdir(join(skill, "refs"));
    await writeFile(join(skill, "refs", "one.md"), "one");
    await writeFile(join(skill, "refs", "two\nlines.md"), "two");
    await writeFile(join(skill, ".hidden"), "hidden");
    await symlink("refs", join(skill, "link"));
    const first = await command(root, global, ["list", "-1", "--limit", "2", "gingiris:router"]);
    expect(first).toEqual({
      code: 0,
      stdout: "SKILL.md\n! link (unsupported)\n",
      stderr: "More entries: --offset 2\n",
    });
    const second = await command(root, global, [
      "ls",
      "--limit",
      "2",
      "--offset",
      "2",
      "gingiris:router",
    ]);
    expect(second).toEqual({ code: 0, stdout: "refs/\n", stderr: "" });
    const all = await command(root, global, ["ls", "-aR", "gingiris:router"]);
    expect(all.code).toBe(0);
    expect(all.stdout).toContain(".hidden\n");
    expect(all.stdout).toContain('"refs/two\\nlines.md"\n');
    expect(all.stdout).toContain("refs/one.md\n");
    expect((await command(root, global, ["ls", "gingiris:router", "link"])).code).toBe(1);
    expect((await command(root, global, ["ls", "gingiris:router", "../"])).code).toBe(1);
    expect((await command(root, global, ["ls", "hidden:private"])).code).toBe(1);
    expect((await command(root, global, ["ls", "--limit", "201", "gingiris:router"])).code).toBe(1);
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent ls discovers resource paths without loading content", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const skill = join(root, "skills", "router");
    await mkdir(join(skill, "references"));
    await writeFile(join(skill, "references", "orca.md"), "methodology");
    expect(await command(root, global, ["ls", "gingiris:router"])).toEqual({
      code: 0,
      stdout: "SKILL.md\nreferences/\n",
      stderr: "",
    });
    expect(await command(root, global, ["list", "gingiris:router", "references/"])).toEqual({
      code: 0,
      stdout: "references/orca.md\n",
      stderr: "",
    });
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent ls continues after the byte budget without losing paths", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const { root, global } = await fixture();
  try {
    const skill = join(root, "skills", "router");
    await mkdir(join(skill, "refs"));
    for (let index = 0; index < 45; index++)
      await writeFile(
        join(skill, "refs", `${String(index).padStart(2, "0")}-${"x".repeat(190)}.md`),
        "",
      );
    const first = await command(root, global, ["ls", "--limit", "100", "gingiris:router", "refs"]);
    expect(first.code).toBe(0);
    expect(Buffer.byteLength(first.stdout)).toBeLessThanOrEqual(8192);
    const offset = Number(/More entries: --offset (\d+)/u.exec(first.stderr)?.[1]);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(45);
    const next = await command(root, global, [
      "ls",
      "--limit",
      "100",
      "--offset",
      String(offset),
      "gingiris:router",
      "refs",
    ]);
    expect(next.code).toBe(0);
    expect(next.stderr).toBe("");
    expect([...first.stdout.trim().split("\n"), ...next.stdout.trim().split("\n")]).toHaveLength(
      45,
    );
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent loads a ready child Skill without requiring unrelated child members", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-partial-child-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    process.env.SKCTL_STATE_DIR = state;
    const ready = join(root, "skills", "ready");
    await mkdir(ready, { recursive: true });
    await writeFile(join(ready, "SKILL.md"), "---\nname: ready\ndescription: Ready\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skctl.jsonc"),
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
    await installSkills(
      { cwd: root, userConfigPath: global },
      { source: "source", paths: ["ready"] },
    );
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
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent refuses content when the host Use is incomplete", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-incomplete-root-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    process.env.SKCTL_STATE_DIR = state;
    const ready = join(root, "skills", "ready");
    await mkdir(ready, { recursive: true });
    await writeFile(join(ready, "SKILL.md"), "---\nname: ready\ndescription: Ready\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skctl.jsonc"),
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
    await installSkills(
      { cwd: root, userConfigPath: global },
      { source: "source", paths: ["ready"] },
    );
    expect((await command(root, global, ["browse"])).stdout).toContain(
      "managed catalog is unavailable",
    );
    const loaded = await command(root, global, ["load", "root:ready"]);
    expect(loaded.code).toBe(1);
    expect(loaded.stderr).toContain("Collection Use is incomplete");
  } finally {
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent search includes each Use-root selector for one installed Skill", async () => {
  const previousState = process.env.SKCTL_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-multiple-use-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    process.env.SKCTL_STATE_DIR = state;
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          alpha: { members: { first: { source: "source", path: "review" } } },
          beta: { members: { second: { source: "source", path: "review" } } },
        },
        use: ["alpha", "beta"],
      }),
    );
    await installSkills(
      { cwd: root, userConfigPath: global },
      { source: "source", paths: ["review"] },
    );
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
    if (previousState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
test("agent commands reject unsupported protocol and JSON flags", async () => {
  for (const argv of [
    ["browse", "--json"],
    ["load", "gingiris:router", "--protocol", "1"],
    ["load", "gingiris:router", "--json"],
  ]) {
    const result = await command("/tmp", "/missing", argv);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown option");
    expect(result.stderr).not.toContain("INVALID_ARGUMENT");
  }
});
test("agent reports an empty catalog when no Collections are exposed", async () => {
  const result = await command("/tmp", "/missing", ["browse"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("No managed Collections are currently exposed.");
  expect(result.stderr).toBe("");
});
test("agent rejects collection IDs and Skill Selectors in the wrong address positions before Core", async () => {
  let created = 0;
  const unexpected = async (): Promise<never> => {
    created++;
    throw new Error("Core must not be called");
  };
  const options = {
    cwd: "/tmp",
    api: {
      browseCatalog: unexpected,
      searchSkills: unexpected,
      loadSkill: unexpected,
      readResource: unexpected,
      downloadResource: unexpected,
      runSkill: unexpected,
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
