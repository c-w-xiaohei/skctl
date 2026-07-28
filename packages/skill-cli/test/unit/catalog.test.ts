import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSkillCliCore } from "../../src/core/create-core";
import { StateCoordinator } from "../../src/core/internal/state";

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
    await expect(core.catalog.list({})).resolves.toMatchObject({
      value: { status: "unavailable", catalog: [] },
    });
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        agents: { opencode: "managed" },
        collections: { c: { members: { review: { source: "source", path: "review" } } } },
        use: ["c"],
      }),
    );
    await expect(core.catalog.list({})).resolves.toMatchObject({
      value: { status: "unavailable", catalog: [] },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("PROJ-015/016 projects direct Collection members and References without aliases", async () => {
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
    const catalog = await core.catalog.list({});
    expect(catalog.value).toEqual(
      expect.objectContaining({
        status: "available",
        catalog: [{ selector: "alpha:review", name: "review", description: "Review", aliases: [] }],
        references: [{ name: "docs", collection: "zeta", description: "Documentation" }],
      }),
    );
    await expect(core.catalog.list({ collection: "zeta" })).resolves.toMatchObject({
      value: {
        catalog: [{ selector: "zeta:again", name: "review", description: "Review", aliases: [] }],
      },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
