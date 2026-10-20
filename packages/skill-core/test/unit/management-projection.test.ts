import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("MGMT-029 execution requests accept no preview token generation or digest authority", () => {
  type Forbidden = "token" | "generation" | "digest";
  type Clean<T> = Extract<keyof T, Forbidden> extends never ? true : false;
  const requests: true[] = [
    true as Clean<Parameters<typeof import("@skctl/core").removeSource>[1]>,
    true as Clean<Parameters<typeof import("@skctl/core").rebindSkill>[1]>,
    true as Clean<Parameters<typeof import("@skctl/core").uninstallSkills>[1]>,
    true as Clean<Parameters<typeof import("@skctl/core").adoptConfigSource>[1]>,
    true as Clean<Parameters<typeof import("@skctl/core").forgetConfig>[1]>,
    true as Clean<Parameters<typeof import("@skctl/core").removeConfig>[1]>,
    true as Clean<Parameters<typeof import("@skctl/core").editMembers>[1]>,
  ];
  expect(requests).toEqual([true, true, true, true, true, true, true]);
});
test("PROJ-022 contains no private state or generic management fields in a real projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-projection-containment-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(global, "{}\n");
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    const projection = (await api.getWorkspace({ cwd: root, userConfigPath: global })).value;
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
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("PROJ-023 uses only global project local Config levels in a real workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-projection-levels-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(global, "{}\n");
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await writeFile(join(root, "skctl.local.jsonc"), "{}\n");
    const levels = (
      await api.getWorkspace({ cwd: root, userConfigPath: global })
    ).value.configs.map((config) => config.level);
    expect(levels).toEqual(["global", "project", "local"]);
    expect(levels).not.toContain("user");
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("PROJ-024 exposes one workspace authority and focused mutation results", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-projection-authority-"));
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    const core = { cwd: root };
    const result = await api.registerSource(core, {
      level: "project",
      id: "reviews",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    expect(result.value).toEqual({
      level: "project",
      file: join(root, "skctl.jsonc"),
      changed: true,
    });
    expect("workspace" in result.value).toBe(false);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("PROJ-004/005/006 projects direct and unadopted Remote Config Sources without cache or provider access", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-projection-unit-"));
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(join(root, "skills"));
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        configSources: {
          remote: { kind: "git", origin: "https://example.test/config", root: "", ref: "main" },
        },
        sources: { local: { kind: "local", path: "./skills", root: "" } },
      }),
    );
    const projection = (await api.getWorkspace({ cwd: root })).value;
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
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("PROJ direct Source rows retain binding tracked refs apart from declaration ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-projection-tracked-ref-"));
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(join(root, "skills"));
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: {
          local: { kind: "local", path: "./skills", root: "" },
          git: { kind: "git", origin: "https://example.test/skills", root: "", ref: "release" },
          github: { kind: "github", origin: "acme/skills", root: "", ref: "main" },
        },
      }),
    );
    const project = (await api.getWorkspace({ cwd: root })).value.configs.find(
      (view) => view.level === "project",
    )!;
    const source = (id: string) => project.direct.sources.find((item) => item.id === id)!;
    expect(source("git")).toMatchObject({ trackedRef: "release", ref: { id: "git" } });
    expect(source("github")).toMatchObject({ trackedRef: "main", ref: { id: "github" } });
    expect(source("local")).toMatchObject({ ref: { id: "local" } });
    expect(source("local").trackedRef).toBeUndefined();
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("PROJ-017 excludes unresolved owners from selectors without blocking structural reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-projection-content-"));
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(global, "{}\n");
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        collections: { reviews: { members: { review: { source: "gone", path: "review" } } } },
        use: ["reviews"],
        agents: { opencode: "managed" },
      }),
    );
    const core = { cwd: root, userConfigPath: global };
    await api.registerSource(core, {
      level: "project",
      id: "gone",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await api.installSkills(core, { source: "gone", paths: ["review"] });
    const host = join(root, "skctl.jsonc");
    const config = JSON.parse(await readFile(host, "utf8"));
    delete config.sources.gone;
    await writeFile(host, JSON.stringify(config));
    await expect(api.loadSkill(core, { selector: "reviews:review" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(
      (await api.loadInstalledSkill(core, { address: { source: "gone", path: "review" } })).name,
    ).toBe("review");
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
