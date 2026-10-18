import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/create-core";
import { StateCoordinator } from "../../src/storage/state";
import type { SourcesCapability } from "../../src/source/types";
import type { InstalledCapability } from "../../src/installed/types";
import type { ConfigSourcesCapability } from "../../src/config/types";
import type { CollectionsCapability } from "../../src/collection/types";

test("MGMT-029 execution requests accept no preview token generation or digest authority", () => {
  type Forbidden = "token" | "generation" | "digest";
  type Clean<T> = Extract<keyof T, Forbidden> extends never ? true : false;
  const requests: true[] = [
    true as Clean<Parameters<SourcesCapability["remove"]>[0]>,
    true as Clean<Parameters<InstalledCapability["rebind"]>[0]>,
    true as Clean<Parameters<InstalledCapability["uninstall"]>[0]>,
    true as Clean<Parameters<ConfigSourcesCapability["adopt"]>[0]>,
    true as Clean<Parameters<ConfigSourcesCapability["forget"]>[0]>,
    true as Clean<Parameters<ConfigSourcesCapability["remove"]>[0]>,
    true as Clean<Parameters<CollectionsCapability["editMembers"]>[0]>,
  ];
  expect(requests).toEqual([true, true, true, true, true, true, true]);
});

test("PROJ-022 contains no private state or generic management fields in a real projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-containment-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(global, "{}\n");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const projection = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value;
    const serialized = JSON.stringify(projection);
    for (const forbidden of [
      "generation",
      "digest",
      "snapshot",
      "cache",
      "state.json",
      "transaction",
      "lock",
      "stage",
      "materialization",
      "editable",
      "writable",
      "target",
    ])
      expect(serialized.toLowerCase()).not.toContain(forbidden);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-023 uses only global project local Config levels in a real workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-levels-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(global, "{}\n");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await writeFile(join(root, "skill-cli.local.jsonc"), "{}\n");
    const levels = (
      await createSkillCliCore({ cwd: root, userConfigPath: global }).workspace.get()
    ).value.configs.map((config) => config.level);
    expect(levels).toEqual(["global", "project", "local"]);
    expect(levels).not.toContain("user");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-024 exposes one workspace authority and focused mutation results", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-authority-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root });
    const result = await core.sources.register({
      level: "project",
      id: "reviews",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    expect(result.value).toEqual({
      level: "project",
      file: join(root, "skill-cli.jsonc"),
      changed: true,
    });
    expect("workspace" in result.value).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-004/005/006 projects direct and unadopted Remote Config Sources without cache or provider access", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-unit-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "skills"));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        configSources: {
          remote: { kind: "git", origin: "https://example.test/config", root: "", ref: "main" },
        },
        sources: { local: { kind: "local", path: "./skills", root: "" } },
      }),
    );
    const projection = (await createSkillCliCore({ cwd: root }).workspace.get()).value;
    const project = projection.configs.find((view) => view.level === "project")!;
    expect(project.direct.configSources).toEqual([
      expect.objectContaining({
        id: "remote",
        binding: expect.objectContaining({ kind: "git", origin: "https://example.test/config" }),
        adoption: { status: "not-adopted" },
        contributed: { sources: [], collections: [] },
      }),
    ]);
    expect(JSON.stringify(projection)).not.toContain("configs/");
    expect(JSON.stringify(projection)).not.toContain("bindingDigest");
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ direct Source rows retain binding tracked refs apart from declaration ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-tracked-ref-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(join(root, "skills"));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          local: { kind: "local", path: "./skills", root: "" },
          git: { kind: "git", origin: "https://example.test/skills", root: "", ref: "release" },
          github: { kind: "github", origin: "acme/skills", root: "", ref: "main" },
        },
      }),
    );
    const project = (await createSkillCliCore({ cwd: root }).workspace.get()).value.configs.find(
      (view) => view.level === "project",
    )!;
    const source = (id: string) => project.direct.sources.find((item) => item.id === id)!;
    expect(source("git")).toMatchObject({ trackedRef: "release", ref: { id: "git" } });
    expect(source("github")).toMatchObject({ trackedRef: "main", ref: { id: "github" } });
    expect(source("local")).toMatchObject({ ref: { id: "local" } });
    expect(source("local").trackedRef).toBeUndefined();
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-017 excludes unresolved owners from selectors without blocking structural reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-projection-content-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(global, "{}\n");
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        collections: { reviews: { members: { review: { source: "gone", path: "review" } } } },
        use: ["reviews"],
        agents: { opencode: "managed" },
      }),
    );
    await new StateCoordinator(state).installLocal("gone", "review", skill);
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    await expect(core.content.load({ selector: "reviews:review" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect((await core.installed.load({ address: { source: "gone", path: "review" } })).name).toBe(
      "review",
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
