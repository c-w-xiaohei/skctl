import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/create-core";
import { setConfigReadHookForTest } from "../../src/internal/config";
import { setAcquisitionTrapForTest } from "../../src/internal/sources";
import { setSemanticStateReadHookForTest, StateCoordinator } from "../../src/internal/state";
import { exposureHierarchy } from "../../../skill-tui/src/collections/state";

test("PROJ-001 resolves an exact nearest Config project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-root-"));
  const nested = join(root, "nested", "child");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const projection = (await createSkillCliCore({ cwd: nested }).workspace.get()).value;
    expect(projection.project).toEqual({ root, resolution: "nearest-config" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-002 reports missing Global Project and Local Config files with empty direct groups", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-missing-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const projection = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    expect(
      projection.configs.map(({ level, file, direct }) => [level, file.status, direct]),
    ).toEqual([
      [
        "global",
        "missing",
        { sources: [], configSources: [], collections: [], collectionUse: [], integrations: [] },
      ],
      [
        "project",
        "valid",
        { sources: [], configSources: [], collections: [], collectionUse: [], integrations: [] },
      ],
      [
        "local",
        "missing",
        { sources: [], configSources: [], collections: [], collectionUse: [], integrations: [] },
      ],
    ]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-003/021 contains an invalid sibling while retaining valid direct facts and semantic diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "skills"));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "sources": { "local": { "kind": "local", "path": "./skills", "root": "" } } }',
    );
    await writeFile(join(root, "skill-cli.local.jsonc"), "{ invalid");
    const projection = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    expect(projection.configs.map((view) => view.level)).toEqual(["global", "project", "local"]);
    expect(projection.configs[0]!.file.status).toBe("missing");
    expect(projection.configs[1]!.direct.sources[0]!.ref.owner.level).toBe("project");
    expect(projection.configs[2]!.file.status).toBe("invalid");
    expect(projection.configs[2]!.file.problem!.subject).toEqual({
      kind: "config",
      owner: { level: "local", file: join(root, "skill-cli.local.jsonc"), pointer: "" },
    });
    expect(projection.effective.status).toBe("unavailable");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ invalid Config reports its exact file, pointer, and validation cause without discarding valid siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-invalid-detail-"));
  const global = join(root, "global.jsonc");
  const project = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(global, "{}\n");
    await writeFile(
      project,
      JSON.stringify({ sources: { source: { kind: "local", path: 42, root: "" } } }),
    );
    const workspace = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    const invalid = workspace.configs.find((config) => config.level === "project")!;
    expect(invalid.file).toMatchObject({
      status: "invalid",
      file: project,
      problem: {
        code: "CONFIG_INVALID",
        location: { file: project, pointer: "/sources/source/path" },
      },
    });
    expect(invalid.file.problem!.message).toContain("must be string");
    expect(workspace.configs.find((config) => config.level === "global")!.file.status).toBe(
      "valid",
    );
    expect(workspace.effective.status).toBe("unavailable");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ invalid qualified Collection IDs stay contained as invalid Config diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-invalid-id-"));
  const project = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      project,
      JSON.stringify({ collections: { "not valid": {} }, use: ["not valid"] }),
    );
    const workspace = (await createSkillCliCore({ cwd: root }).workspace.get()).value;
    const invalid = workspace.configs.find((config) => config.level === "project")!;
    expect(invalid.file).toMatchObject({ status: "invalid", file: project });
    expect(invalid.file.problem).toMatchObject({
      location: { file: project, pointer: "/collections/not valid" },
    });
    expect(workspace.effective.status).toBe("unavailable");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ contains invalid Source and Config Source bindings without discarding valid siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-invalid-binding-"));
  const global = join(root, "global.jsonc");
  const project = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      global,
      JSON.stringify({ sources: { valid: { kind: "local", path: "./skills", root: "" } } }),
    );
    for (const [declaration, pointer] of [
      [
        { sources: { invalid: { kind: "local", path: "./skills", root: "../escape" } } },
        "/sources/invalid/root",
      ],
      [
        {
          sources: {
            invalid: {
              kind: "git",
              origin: "https://example.test/repo",
              root: "/escape",
              ref: "main",
            },
          },
        },
        "/sources/invalid/root",
      ],
      [{ sources: { invalid: { kind: "local", path: "", root: "" } } }, "/sources/invalid/path"],
      [
        {
          sources: {
            invalid: {
              kind: "git",
              origin: "https://user@example.test/repo",
              root: "",
              ref: "main",
            },
          },
        },
        "/sources/invalid/origin",
      ],
      [
        { configSources: { invalid: { kind: "local", path: "./module", root: "/escape" } } },
        "/configSources/invalid/root",
      ],
      [
        {
          configSources: {
            invalid: {
              kind: "git",
              origin: "https://example.test/repo",
              root: "../escape",
              ref: "main",
            },
          },
        },
        "/configSources/invalid/root",
      ],
      [
        { configSources: { invalid: { kind: "local", path: "", root: "" } } },
        "/configSources/invalid/path",
      ],
      [
        {
          configSources: {
            invalid: {
              kind: "git",
              origin: "https://user@example.test/repo",
              root: "",
              ref: "main",
            },
          },
        },
        "/configSources/invalid/origin",
      ],
    ] as const) {
      await writeFile(project, JSON.stringify(declaration));
      const workspace = (
        await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
      ).value;
      const invalid = workspace.configs.find((config) => config.level === "project")!;
      expect(invalid.file).toMatchObject({
        status: "invalid",
        file: project,
        problem: { code: "CONFIG_INVALID", location: { file: project, pointer } },
      });
      expect(workspace.configs.find((config) => config.level === "global")!.file.status).toBe(
        "valid",
      );
      expect(workspace.effective.status).toBe("unavailable");
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ attributes invalid local reusable Config bytes to its host Config Source", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-invalid-reusable-"));
  const global = join(root, "global.jsonc");
  const project = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await mkdir(join(root, "module"));
    await writeFile(
      global,
      JSON.stringify({ sources: { valid: { kind: "local", path: "./skills", root: "" } } }),
    );
    await writeFile(
      join(root, "module", "config.jsonc"),
      JSON.stringify({
        sources: { invalid: { kind: "local", path: "./skills", root: "../escape" } },
      }),
    );
    await writeFile(
      project,
      JSON.stringify({ configSources: { shared: { kind: "local", path: "./module", root: "" } } }),
    );
    const workspace = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    const invalid = workspace.configs.find((config) => config.level === "project")!;
    expect(invalid.file).toMatchObject({
      status: "invalid",
      file: project,
      problem: {
        code: "CONFIG_INVALID",
        message: "Source Root must be a relative normalized path",
        location: { file: project, pointer: "/configSources/shared" },
      },
    });
    expect(workspace.configs.find((config) => config.level === "global")!.file.status).toBe(
      "valid",
    );
    expect(workspace.effective.status).toBe("unavailable");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-012/013/014/015/018 reports complete effective projection, Installed detail, and selector owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-agent-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
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
          base: { members: { review: { source: "source", path: "review" } } },
          exposed: { links: ["base"] },
        },
        use: ["exposed"],
      }),
    );
    const { StateCoordinator } = await import("../../src/internal/state");
    await new StateCoordinator(state).installLocal("source", "review", skill);
    const projection = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    expect(projection.effective).toMatchObject({
      status: "complete",
      agent: {
        status: "available",
        integration: [{ level: "global", file: global, pointer: "/agents/opencode" }],
        use: [{ level: "project", pointer: "/use" }],
        catalog: [{ selector: "exposed:review", aliases: [] }],
      },
    });
    if (projection.effective.status !== "complete") throw new Error("expected complete projection");
    expect(projection.effective.collectionsView).toContainEqual(
      expect.objectContaining({
        id: "exposed",
        members: [
          expect.objectContaining({
            name: "review",
            paths: [expect.objectContaining({ kind: "via-link" })],
          }),
        ],
      }),
    );
    expect(projection.installedSkills[0]).toMatchObject({
      owner: { health: "healthy", relevantLocalRoot: skill },
      primary: "exposed:review",
    });
    const json = JSON.stringify(projection);
    expect(json).not.toContain("bindingDigest");
    expect(json).not.toContain("layer");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-015 projects selector-local member paths and Collection Use owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-selector-owners-"));
  const global = join(root, "global.jsonc");
  const project = join(root, "skill-cli.jsonc");
  const local = join(root, "skill-cli.local.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" }, use: ["alpha"] }));
    await writeFile(
      project,
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          base: { members: { review: { source: "source", path: "review" } } },
          middle: { links: ["base"] },
          alpha: {
            members: { review: { source: "source", path: "review" } },
            links: ["base", "middle"],
          },
        },
        use: ["alpha"],
      }),
    );
    await writeFile(local, JSON.stringify({ use: ["base"] }));
    await new StateCoordinator(state).installLocal("source", "review", skill);

    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    const projection = (await core.workspace.get()).value;
    const installed = projection.installedSkills[0]!;
    expect(installed.selectorViews).toEqual({
      status: "complete",
      values: [
        {
          selector: "alpha:review",
          collection: "alpha",
          entry: "review",
          paths: [
            expect.objectContaining({ kind: "direct", collection: "alpha", entryName: "review" }),
            expect.objectContaining({ kind: "via-link" }),
            expect.objectContaining({ kind: "via-link" }),
          ],
          exposurePaths: [
            {
              owner: { level: "global", file: global, pointer: "/use" },
              segments: [{ collection: "alpha" }],
            },
            {
              owner: { level: "project", file: project, pointer: "/use" },
              segments: [{ collection: "alpha" }],
            },
          ],
          useOwners: [
            { level: "global", file: global, pointer: "/use" },
            { level: "project", file: project, pointer: "/use" },
          ],
        },
        {
          selector: "base:review",
          collection: "base",
          entry: "review",
          paths: [
            expect.objectContaining({ kind: "direct", collection: "base", entryName: "review" }),
          ],
          exposurePaths: [
            {
              owner: { level: "local", file: local, pointer: "/use" },
              segments: [{ collection: "base" }],
            },
          ],
          useOwners: [{ level: "local", file: local, pointer: "/use" }],
        },
      ],
    });
    expect(installed.primary).toBe("alpha:review");
    expect(installed.aliases).toEqual(["base:review"]);
    const browsed = (await core.catalog.browse({ collection: "alpha" })).value;
    expect(browsed).toMatchObject({ status: "available" });
    if (browsed.status === "available")
      expect(browsed.items).toEqual([expect.objectContaining({ selector: "alpha:review" })]);

    await writeFile(local, "{ invalid");
    expect((await core.workspace.get()).value.installedSkills[0]!.selectorViews).toEqual({
      status: "unavailable",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ Reference-reachable Collections contribute management selectors without broadening root browse", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-reference-exposure-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
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
          root: {
            references: { child: { collection: "child", description: "Child skills" } },
          },
          child: { members: { ready: { source: "source", path: "review" } } },
        },
        use: ["root"],
      }),
    );
    await new StateCoordinator(state).installLocal("source", "review", skill);

    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    const projection = (await core.workspace.get()).value;
    const installed = projection.installedSkills[0]!;
    expect(installed.selectorViews).toEqual({
      status: "complete",
      values: [
        {
          selector: "child:ready",
          collection: "child",
          entry: "ready",
          paths: [expect.objectContaining({ kind: "direct", collection: "child" })],
          useOwners: [],
          exposurePaths: [
            {
              owner: { level: "project", file: join(root, "skill-cli.jsonc"), pointer: "/use" },
              segments: [
                { collection: "root" },
                { collection: "child", reference: { name: "child", target: "child" } },
              ],
            },
          ],
        },
      ],
    });
    expect(installed.primary).toBe("child:ready");
    expect(installed.aliases).toEqual([]);
    expect(projection.effective).toMatchObject({
      status: "complete",
      agent: { catalog: [{ selector: "child:ready", aliases: [] }] },
    });
    expect((await core.catalog.browse({})).value).toMatchObject({
      scope: { kind: "root" },
      items: [{ kind: "collection", id: "root" }],
    });
    expect((await core.catalog.browse({ collection: "root" })).value).toMatchObject({
      items: [{ kind: "collection", id: "child" }],
    });
    expect((await core.catalog.browse({ collection: "child" })).value).toMatchObject({
      items: [{ kind: "skill", selector: "child:ready" }],
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ Reference paths deduplicate linked selectors and Current Exposure facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-reference-paths-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
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
          root: {
            references: {
              child: { collection: "child", description: "Child" },
              middle: { collection: "middle", description: "Middle" },
              leaf: { collection: "leaf", description: "Leaf" },
            },
          },
          middle: { references: { child: { collection: "child", description: "Child" } } },
          child: { links: ["base"] },
          base: { members: { ready: { source: "source", path: "review" } } },
          leaf: { members: { alternate: { source: "source", path: "review" } } },
        },
        use: ["root"],
      }),
    );
    await new StateCoordinator(state).installLocal("source", "review", skill);

    const projection = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    const installed = projection.installedSkills[0]!;
    expect(installed.selectorViews).toMatchObject({
      status: "complete",
      values: [
        {
          selector: "child:ready",
          useOwners: [],
          exposurePaths: [
            {
              segments: [
                { collection: "root" },
                { collection: "child", reference: { name: "child", target: "child" } },
              ],
            },
            {
              segments: [
                { collection: "root" },
                { collection: "middle", reference: { name: "middle", target: "middle" } },
                { collection: "child", reference: { name: "child", target: "child" } },
              ],
            },
          ],
        },
        {
          selector: "leaf:alternate",
          useOwners: [],
          exposurePaths: [
            {
              segments: [
                { collection: "root" },
                { collection: "leaf", reference: { name: "leaf", target: "leaf" } },
              ],
            },
          ],
        },
      ],
    });
    expect(installed.primary).toBe("child:ready");
    expect(installed.aliases).toEqual(["leaf:alternate"]);
    expect(projection.effective).toMatchObject({
      status: "complete",
      agent: { catalog: [{ selector: "child:ready", aliases: ["leaf:alternate"] }] },
    });
    expect(
      exposureHierarchy(projection).map(({ collection, selectorCount, installedSkillCount }) => ({
        collection,
        selectorCount,
        installedSkillCount,
      })),
    ).toEqual([
      { collection: "root", selectorCount: 0, installedSkillCount: 0 },
      { collection: "child", selectorCount: 1, installedSkillCount: 1 },
      { collection: "leaf", selectorCount: 1, installedSkillCount: 1 },
      { collection: "middle", selectorCount: 0, installedSkillCount: 0 },
      { collection: "child", selectorCount: 1, installedSkillCount: 1 },
    ]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-016/017 excludes a drifted Local owner from Agent disclosure and selector content", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-drifted-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nbody\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { team: { members: { review: { source: "source", path: "review" } } } },
        use: ["team"],
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    await new StateCoordinator(state).installLocal("source", "review", skill);
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./replacement", root: "" } },
        collections: { team: { members: { review: { source: "source", path: "review" } } } },
        use: ["team"],
      }),
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    const workspace = (await core.workspace.get()).value;
    expect(workspace.installedSkills[0]).toMatchObject({ owner: { health: "drifted" } });
    expect(workspace.installedSkills[0]!.source).toBeUndefined();
    expect((await core.catalog.browse({ collection: "team" })).value).toMatchObject({
      status: "available",
      items: [],
    });
    await expect(core.content.load({ selector: "team:review" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(
      (await core.content.loadInstalled({ address: { source: "source", path: "review" } })).value
        .markdownText,
    ).toContain("body");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        collections: { team: { members: { review: { source: "source", path: "review" } } } },
        use: ["team"],
      }),
    );
    expect((await core.workspace.get()).value.installedSkills[0]).toMatchObject({
      owner: { health: "missing" },
    });
    expect((await core.catalog.browse({ collection: "team" })).value).toMatchObject({
      status: "available",
      items: [],
    });
    await expect(
      core.content.read({ selector: "team:review", path: "SKILL.md" }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-019 sorts direct and contributed projection groups deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-order-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "reusable"));
    await writeFile(
      join(root, "reusable", "config.jsonc"),
      JSON.stringify({
        sources: {
          zebra: { kind: "local", path: "./z", root: "" },
          alpha: { kind: "local", path: "./a", root: "" },
        },
        collections: { zebra: {}, alpha: {} },
      }),
    );
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          zebra: { kind: "local", path: "./z", root: "" },
          alpha: { kind: "local", path: "./a", root: "" },
        },
        configSources: { shared: { kind: "local", path: "./reusable", root: "" } },
      }),
    );
    const project = (await createSkillCliCore({ cwd: root }).workspace.get()).value.configs[1]!;
    expect(project.direct.sources.map((source) => source.id)).toEqual(["alpha", "zebra"]);
    expect(project.contributed.sources.map((source) => source.id)).toEqual([
      "shared/alpha",
      "shared/zebra",
    ]);
    expect(project.contributed.collections).toEqual(["shared/alpha", "shared/zebra"]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-019 attributes nested Config Source contributions by exact owner and rejects real collisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-nested-config-source-"));
  const state = join(root, "state");
  const sharedConfig = join(root, "reusable", "shared", "config.jsonc");
  const nestedConfig = join(root, "reusable", "nested", "config.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "reusable", "shared"), { recursive: true });
    await mkdir(join(root, "reusable", "nested"), { recursive: true });
    await writeFile(
      sharedConfig,
      JSON.stringify({
        sources: { alpha: { kind: "local", path: "./alpha", root: "" } },
        collections: { "team/inner": {} },
      }),
    );
    await writeFile(
      nestedConfig,
      JSON.stringify({
        sources: { beta: { kind: "local", path: "./beta", root: "" } },
        collections: { other: {} },
      }),
    );
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        configSources: {
          shared: { kind: "local", path: "./reusable/shared", root: "" },
          "shared/team": { kind: "local", path: "./reusable/nested", root: "" },
        },
      }),
    );

    const core = createSkillCliCore({ cwd: root });
    const project = (await core.workspace.get()).value.configs.find(
      (config) => config.level === "project",
    )!;
    expect(
      project.direct.configSources.map(({ id, contributed }) => [
        id,
        contributed.sources.map(({ id: sourceId }) => sourceId),
        contributed.collections.map(({ id: collectionId }) => collectionId),
      ]),
    ).toEqual([
      ["shared", ["shared/alpha"], ["shared/team/inner"]],
      ["shared/team", ["shared/team/beta"], ["shared/team/other"]],
    ]);
    expect(project.contributed.sources.map(({ id }) => id)).toEqual([
      "shared/alpha",
      "shared/team/beta",
    ]);
    expect(project.contributed.collections).toEqual(["shared/team/inner", "shared/team/other"]);

    await writeFile(
      sharedConfig,
      JSON.stringify({
        sources: {
          alpha: { kind: "local", path: "./alpha", root: "" },
          "team/beta": { kind: "local", path: "./beta", root: "" },
        },
        collections: { "team/inner": {} },
      }),
    );
    await expect(core.workspace.get()).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await writeFile(
      nestedConfig,
      JSON.stringify({
        sources: { gamma: { kind: "local", path: "./gamma", root: "" } },
        collections: { inner: {} },
      }),
    );
    await expect(core.workspace.get()).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
      message: "Collection is declared more than once: shared/team/inner",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-020 captures every concrete Config and private state exactly once under one workspace lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-capture-"));
  const global = join(root, "global.jsonc");
  const project = join(root, "skill-cli.jsonc");
  const local = join(root, "skill-cli.local.jsonc");
  const state = join(root, "state");
  const configReads = new Map<string, number>();
  let stateReads = 0;
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      project,
      JSON.stringify({
        configSources: {
          remote: { kind: "git", origin: "https://example.test/config", root: "", ref: "main" },
        },
      }),
    );
    await writeFile(local, JSON.stringify({ use: [] }));
    const applied = Buffer.from(
      JSON.stringify({ sources: { shared: { kind: "local", path: "./skills", root: "" } } }),
    );
    await new StateCoordinator(state).publishRemoteConfig("remote", "a".repeat(40), applied);
    setSemanticStateReadHookForTest(() => stateReads++);
    setConfigReadHookForTest((path) => configReads.set(path, (configReads.get(path) ?? 0) + 1));
    setAcquisitionTrapForTest(() => {
      throw new Error("workspace projection must not acquire a provider");
    });

    await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get();

    expect(stateReads).toBe(1);
    expect([...configReads.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual(
      [
        [global, 1],
        [project, 1],
        [local, 1],
        [
          join(
            state,
            "configs",
            new Bun.CryptoHasher("sha256").update(applied).digest("hex"),
            "config.jsonc",
          ),
          1,
        ],
      ],
    );
  } finally {
    setAcquisitionTrapForTest();
    setConfigReadHookForTest();
    setSemanticStateReadHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-005 projects adopted Remote Config Source commit and contributions without provider access", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-remote-config-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        configSources: {
          remote: { kind: "git", origin: "https://example.test/config", root: "", ref: "main" },
        },
      }),
    );
    await new StateCoordinator(state).publishRemoteConfig(
      "remote",
      "b".repeat(40),
      Buffer.from(
        JSON.stringify({
          sources: { shared: { kind: "local", path: "./skills", root: "" } },
          collections: { reviews: {} },
        }),
      ),
    );
    setAcquisitionTrapForTest(() => {
      throw new Error("workspace projection must not acquire a provider");
    });
    const config = (await createSkillCliCore({ cwd: root }).workspace.get()).value.configs[1]!;
    expect(config.direct.configSources).toEqual([
      expect.objectContaining({
        id: "remote",
        adoption: { status: "adopted", commit: "b".repeat(40) },
        contributed: {
          sources: [expect.objectContaining({ id: "remote/shared" })],
          collections: [expect.objectContaining({ id: "remote/reviews" })],
        },
      }),
    ]);
    expect(JSON.stringify(config)).not.toContain(join(state, "configs"));
  } finally {
    setAcquisitionTrapForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-004/006 preserves Config Source host and reusable declaration owners across levels", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-hosts-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "reusable"));
    await writeFile(
      join(root, "reusable", "config.jsonc"),
      JSON.stringify({
        sources: { review: { kind: "local", path: "./skills", root: "" } },
        collections: { reviews: {} },
      }),
    );
    for (const [level, file] of [
      ["global", global],
      ["project", join(root, "skill-cli.jsonc")],
      ["local", join(root, "skill-cli.local.jsonc")],
    ] as const) {
      await writeFile(global, "{}\n");
      await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
      await writeFile(join(root, "skill-cli.local.jsonc"), "{}\n");
      await writeFile(
        file,
        JSON.stringify({
          configSources: { shared: { kind: "local", path: "./reusable", root: "" } },
        }),
      );
      const projection = (
        await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
      ).value;
      const config = projection.configs.find((config) => config.level === level)!;
      expect(config.contributed.sources).toEqual([
        expect.objectContaining({
          id: "shared/review",
          provenance: {
            level,
            file: join(root, "reusable", "config.jsonc"),
            pointer: "/sources/review",
            namespace: "shared",
          },
          contribution: {
            configSource: { level, file, pointer: "/configSources/shared" },
            declaration: {
              level,
              file: join(root, "reusable", "config.jsonc"),
              pointer: "/sources/review",
              namespace: "shared",
            },
          },
        }),
      ]);
      expect(
        config.direct.configSources[0]!.contributed.collections[0]!.owner.contribution,
      ).toEqual({
        configSource: { level, file, pointer: "/configSources/shared" },
        declaration: {
          level,
          file: join(root, "reusable", "config.jsonc"),
          pointer: "/collections/reviews",
          namespace: "shared",
        },
      });
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
