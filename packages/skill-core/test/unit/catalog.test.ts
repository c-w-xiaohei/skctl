import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSkillCliCore } from "../../src/create-core";
import { StateCoordinator } from "../../src/internal/state";

test("PROJ-016 reports managed catalog unavailable for absent, empty, or incomplete Use", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-catalog-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ agents: { opencode: "managed" }, use: [] }),
    );
    const core = createSkillCliCore({ cwd: root });
    await expect(core.catalog.browse({})).resolves.toMatchObject({
      value: { status: "unavailable", reason: expect.any(String) },
    });
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        agents: { opencode: "managed" },
        collections: { c: { members: { review: { source: "source", path: "review" } } } },
        use: ["c"],
      }),
    );
    await expect(core.catalog.browse({})).resolves.toMatchObject({
      value: { status: "unavailable", reason: expect.any(String) },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-015/016 projects root and collection nodes without aliases or graph terms", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-catalog-records-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
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
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(global, "{}\n");
    await new StateCoordinator(state).installLocal("source", "review", skill);
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    const catalog = await core.catalog.browse({});
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
    await expect(core.catalog.browse({ collection: "alpha" })).resolves.toMatchObject({
      value: {
        scope: { kind: "collection", id: "alpha" },
        items: [
          { kind: "skill", selector: "alpha:review", name: "review", description: "Review" },
          { kind: "collection", id: "zeta", name: "docs", description: "Documentation" },
        ],
      },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
