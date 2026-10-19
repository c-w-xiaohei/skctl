import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
test("PROJ-016 reports managed catalog unavailable for absent, empty, or incomplete Use", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-catalog-"));
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({ agents: { opencode: "managed" }, use: [] }),
    );
    const core = { cwd: root };
    await expect(api.browseCatalog(core, {})).resolves.toMatchObject({
      value: { status: "unavailable", reason: expect.any(String) },
    });
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        agents: { opencode: "managed" },
        collections: { c: { members: { review: { source: "source", path: "review" } } } },
        use: ["c"],
      }),
    );
    await expect(api.browseCatalog(core, {})).resolves.toMatchObject({
      value: { status: "unavailable", reason: expect.any(String) },
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("PROJ-015/016 projects root and collection nodes without aliases or graph terms", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-catalog-records-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: {
          alpha: {
            description: "Engineering review workflows",
            members: { review: { source: "source", path: "review" } },
            references: { docs: { collection: "zeta", description: "Documentation" } },
          },
          zeta: { members: { again: { source: "source", path: "review" } } },
        },
        use: ["alpha"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(global, "{}\n");
    await new StateCoordinator(state).installLocal("source", "review", skill);
    const core = { cwd: root, userConfigPath: global };
    const catalog = await api.browseCatalog(core, {});
    expect(catalog.value).toEqual(
      expect.objectContaining({
        status: "available",
        scope: { kind: "root" },
        items: [
          {
            kind: "collection",
            id: "alpha",
            name: "alpha",
            description: "Engineering review workflows",
          },
        ],
      }),
    );
    await expect(api.browseCatalog(core, { collection: "alpha" })).resolves.toMatchObject({
      value: {
        scope: { kind: "collection", id: "alpha" },
        items: [
          { kind: "skill", selector: "alpha:review", name: "review", description: "Review" },
          { kind: "collection", id: "zeta", name: "docs", description: "Documentation" },
        ],
      },
    });
    await expect(api.searchSkills(core, { query: "review" })).resolves.toMatchObject({
      value: {
        results: [{ selector: "alpha:review", name: "review", description: "Review" }],
        truncated: false,
      },
    });
    expect((await api.inspectCollection(core, { collection: "alpha" })).value).toMatchObject({
      id: "alpha",
      catalogPreview: { skills: 1, linkedSkills: 0, collections: 1 },
      disclosure: { available: true, useRoot: true, referenceReachable: false },
    });
    expect(
      (await api.inspectCollection(core, { collection: "zeta" })).value.disclosure,
    ).toMatchObject({ useRoot: false, referenceReachable: true });
    expect(
      (await api.inspectCollection(core, { collection: "alpha", level: "global" })).value,
    ).toMatchObject({
      declared: [],
      references: [],
      links: [],
      catalogPreview: { skills: 1, linkedSkills: 0, collections: 0 },
      disclosure: { useRoot: true, referenceReachable: false },
    });
    await expect(api.searchSkills(core, { query: "again" })).resolves.toMatchObject({
      value: { results: [] },
    });
    expect((await api.searchSkills(core, { query: "review", limit: 0 })).value).toEqual({
      results: [],
      truncated: true,
    });
    expect((await api.searchSkills(core, { query: "absent", limit: 0 })).value).toEqual({
      results: [],
      truncated: false,
    });
    await expect(api.searchSkills(core, { query: "review", limit: -1 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      api.searchSkills(core, { query: "review", collection: "zeta" }),
    ).resolves.toMatchObject({
      value: { results: [{ selector: "zeta:again", name: "review", description: "Review" }] },
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("Collection inspection does not match colliding source/path concatenations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-catalog-address-collision-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    const skill = join(root, "skills", "main", "guide");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: guide\ndescription: Guide\n---\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: {
          team: { kind: "local", path: "./skills", root: "" },
          "team/main": { kind: "local", path: "./skills/main", root: "" },
        },
        collections: {
          docs: { members: { guide: { source: "team/main", path: "guide" } } },
        },
        use: ["docs"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    await writeFile(global, "{}\n");
    const core = { cwd: root, userConfigPath: global };
    await api.installSkills(core, { source: "team", paths: ["main/guide"] });
    expect((await api.getWorkspace(core)).value.installedSkills[0]?.owner.health).toBe("healthy");
    const inspection = await api.inspectCollection(core, { collection: "docs" });
    expect(inspection.value.members[0]?.address).toEqual({ source: "team/main", path: "guide" });
    expect(inspection.value.catalogPreview.skills).toBe(0);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
