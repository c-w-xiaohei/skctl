import { expect, test } from "bun:test";
import {
  actionIntent,
  arbitrateKey,
  installedSkillContext,
  reachableActions,
  skillSourceIntent,
  sourceOperationIntent,
  sourceRouteIntent,
  selectedSkillActions,
} from "../../src/tui/actions";
import { createTuiState, reduceTui } from "../../src/tui/model";
import { configSourceOwner, directOwner, workspaceProjection } from "./direct-source.fixture";

test("MGMT-002/004 uses exact direct owner and contribution route intents", () => {
  let state = reduceTui(createTuiState(), {
    type: "section.select",
    section: "sources",
  });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: workspaceProjection(),
  });
  const projection = workspaceProjection();
  expect(actionIntent("remove-source", state, projection)).toEqual({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(sourceRouteIntent("open-config", state, projection)).toEqual({
    kind: "open-config",
    source: "team-main",
    owner: directOwner,
  });
  state = reduceTui(state, {
    type: "selection.set",
    key: "sources",
    value: "team-config/lark",
  });
  expect(sourceRouteIntent("open-config-source", state, projection)).toEqual({
    kind: "open-config-source",
    source: "team-config/lark",
    contribution: {
      configSource: configSourceOwner,
      declaration: { level: "global", pointer: "/sources/lark" },
    },
  });
  expect(reachableActions(state, projection).map((action) => action.id)).not.toContain(
    "remove-source",
  );
});

test("Installed Skill actions use structural selection and selector-view availability", () => {
  const address = { source: "team-main", path: "guide" };
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address,
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        source: workspaceProjection().effective.sources[0],
        collections: [],
        selectors: ["engineering:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "guide",
                  owner: directOwner,
                },
              ],
              useOwners: [directOwner],
            },
          ],
        },
        aliases: [],
        problems: [],
      },
    ],
  };
  let state = reduceTui(createTuiState(), { type: "workspace.replace", workspace: projection });
  state = reduceTui(state, { type: "selection.set", key: "skills", value: "team-main/guide" });
  expect(selectedSkillActions(state, projection).map((action) => action.id)).toEqual([
    "skill-add-to-collection",
    "skill-for-agents",
    "skill-open-source",
    "skill-check-updates",
    "skill-rebind",
    "skill-uninstall",
  ]);
  expect(
    selectedSkillActions(state, projection).find((action) => action.id === "skill-open-source"),
  ).toMatchObject({ enabled: true });
  expect(installedSkillContext(state, projection)?.skill.address).toEqual(address);
  expect(skillSourceIntent(state, projection)).toEqual({
    kind: "source-update",
    source: "team-main",
    path: "guide",
  });
  const missing = {
    ...projection,
    installedSkills: [
      {
        ...projection.installedSkills[0]!,
        owner: { source: "team-main", health: "missing" as const },
        source: undefined,
      },
    ],
  };
  expect(
    selectedSkillActions(state, missing).find((action) => action.id === "skill-open-source"),
  ).toMatchObject({ enabled: false });
  const unavailable = {
    ...projection,
    installedSkills: [
      { ...projection.installedSkills[0]!, selectorViews: { status: "unavailable" as const } },
    ],
  };
  expect(
    selectedSkillActions(state, unavailable).find((action) => action.id === "skill-for-agents"),
  ).toMatchObject({ enabled: false, reason: "Agent selector paths are unavailable" });
});

test("STATE-007/008 arbitration leaves native select keys alone and only opens palette globally", () => {
  const state = createTuiState();
  expect(arbitrateKey({ name: "p", ctrl: true }, state)).toBe("palette");
  expect(arbitrateKey({ name: "return" }, state)).toBe("none");
  expect(arbitrateKey({ name: "down" }, { ...state, overlay: "actions", focus: "dialog" })).toBe(
    "none",
  );
  expect(arbitrateKey({ name: "escape" }, { ...state, overlay: "actions", focus: "dialog" })).toBe(
    "close",
  );
  expect(arbitrateKey({ name: "escape" }, { ...state, narrow: true, narrowLevel: "detail" })).toBe(
    "close",
  );
});

test("MGMT-002 disables removal when the effective projection or owner Config is unavailable", () => {
  let state = reduceTui(createTuiState(), {
    type: "section.select",
    section: "sources",
  });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: workspaceProjection(),
  });
  const unavailable = {
    ...workspaceProjection(),
    effective: {
      status: "unavailable" as const,
      reasons: [
        {
          code: "CONFIG_INVALID",
          severity: "warning" as const,
          message: "Project Config is invalid",
        },
      ],
      sources: workspaceProjection().effective.sources,
      collections: [],
      agent: {
        status: "unavailable" as const,
        integration: [],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
  };
  expect(
    reachableActions(state, unavailable).find((action) => action.id === "remove-source"),
  ).toMatchObject({
    enabled: false,
    reason: "Project Config is invalid",
  });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: unavailable,
  });
  expect(state.workspace?.effective.status).toBe("unavailable");
});

test("MGMT-004 Source actions use the selected Project direct or contributed Source, never Workspace memory", () => {
  let state = reduceTui(createTuiState(), {
    type: "workspace.replace",
    workspace: workspaceProjection(),
  });
  state = reduceTui(state, { type: "destination.select", destination: "project" });
  state = reduceTui(state, {
    type: "selection.set",
    key: "sources",
    value: "team-main",
  });
  const projection = workspaceProjection();
  expect(sourceOperationIntent("add-skills", state, projection)).toEqual({
    kind: "source-discovery",
    source: "team-main",
  });
  state = reduceTui(state, {
    type: "selection.set",
    key: "sources",
    value: "team-config/lark",
  });
  expect(sourceOperationIntent("check-updates", state, projection)).toEqual({
    kind: "source-update",
    source: "team-config/lark",
  });
});

test("Collection actions expose only direct editable and repository contribution paths", () => {
  const owner = {
    level: "project" as const,
    file: "skill-cli.jsonc",
    pointer: "/collections/team",
  };
  const projection = {
    ...workspaceProjection(),
    effective: {
      ...workspaceProjection().effective,
      collectionsView: [
        {
          id: "team",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "derived",
          declared: [],
          repository: { derived: true, producers: [{ source: "team-main", path: "guide" }] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        source: workspaceProjection().effective.sources[0],
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  let state = reduceTui(createTuiState(), { type: "workspace.replace", workspace: projection });
  state = reduceTui(state, { type: "section.select", section: "collections" });
  state = reduceTui(state, { type: "selection.set", key: "collections", value: "team" });
  expect(reachableActions(state, projection).map((action) => action.id)).toEqual([
    "new-collection",
    "add-membership",
    "import-collection",
    "add-reference",
    "add-link",
    "remove-collection",
  ]);
  state = reduceTui(state, { type: "selection.set", key: "collections", value: "derived" });
  expect(reachableActions(state, projection).map((action) => action.id)).toEqual([
    "new-collection",
    "add-membership",
  ]);
});
