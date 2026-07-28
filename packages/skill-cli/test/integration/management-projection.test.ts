import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/core/create-core";
import { setConfigReadHookForTest } from "../../src/core/internal/config";
import { setAcquisitionTrapForTest } from "../../src/core/internal/sources";
import { setSemanticStateReadHookForTest, StateCoordinator } from "../../src/core/internal/state";

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
    const { StateCoordinator } = await import("../../src/core/internal/state");
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
          useOwners: [{ level: "local", file: local, pointer: "/use" }],
        },
      ],
    });
    expect(installed.primary).toBe("alpha:review");
    expect(installed.aliases).toEqual(["base:review"]);
    expect((await core.catalog.list({})).value.catalog).toEqual([
      expect.objectContaining({ selector: "alpha:review", aliases: ["base:review"] }),
    ]);

    await writeFile(local, "{ invalid");
    expect((await core.workspace.get()).value.installedSkills[0]!.selectorViews).toEqual({
      status: "unavailable",
    });
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
    expect((await core.catalog.list({})).value).toMatchObject({ status: "available", catalog: [] });
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
    expect((await core.catalog.list({})).value).toMatchObject({ status: "available", catalog: [] });
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

test("PROJ-004/006 separates Local Config Source host and reusable declaration owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-contribution-"));
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
    await writeFile(
      global,
      JSON.stringify({
        configSources: { shared: { kind: "local", path: "./reusable", root: "" } },
      }),
    );
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const config = (await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get())
      .value.configs[0]!;
    expect(config.contributed.sources).toEqual([
      expect.objectContaining({
        id: "shared/review",
        provenance: {
          level: "global",
          file: join(root, "reusable", "config.jsonc"),
          pointer: "/sources/review",
          namespace: "shared",
        },
        contribution: {
          configSource: { level: "global", file: global, pointer: "/configSources/shared" },
          declaration: {
            level: "global",
            file: join(root, "reusable", "config.jsonc"),
            pointer: "/sources/review",
            namespace: "shared",
          },
        },
      }),
    ]);
    expect(config.direct.configSources[0]!.contributed.collections[0]!.owner.contribution).toEqual({
      configSource: { level: "global", file: global, pointer: "/configSources/shared" },
      declaration: {
        level: "global",
        file: join(root, "reusable", "config.jsonc"),
        pointer: "/collections/reviews",
        namespace: "shared",
      },
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

test("PROJ-006 preserves Global Project and Local Config Source host owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-hosts-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "reusable"));
    await writeFile(
      join(root, "reusable", "config.jsonc"),
      JSON.stringify({ sources: { shared: { kind: "local", path: "./skills", root: "" } } }),
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
      const source = projection.configs.find((config) => config.level === level)!.contributed
        .sources[0]!;
      expect(source.contribution!.configSource).toEqual({
        level,
        file,
        pointer: "/configSources/shared",
      });
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
