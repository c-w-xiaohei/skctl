import { expect, test } from "bun:test";
import {
  actionIntent,
  installedSkillContext,
  reachableActions,
  skillSourceIntent,
  sourceOperationIntent,
  sourceRouteIntent,
  selectedSkillActions,
} from "../../src/tui/actions";
import { createCollectionsState } from "../../src/tui/collections/state";
import { createConfigState } from "../../src/tui/config/state";
import { createWorkspaceState } from "../../src/tui/workspace/state";
import { parseNavKey, resolve, type NavFacts } from "../../src/tui/navigation";
import { configSourceOwner, directOwner, workspaceProjection } from "./direct-source.fixture";

function pages() {
  const workspace = createWorkspaceState();
  const collections = createCollectionsState();
  const config = createConfigState();
  const facts = {
    get workspace() {
      return workspace.snapshot();
    },
    get collections() {
      return collections.snapshot();
    },
    config: config.snapshot,
  };
  return { workspace, collections, config, facts };
}

const nativeSelectFacts: NavFacts = {
  destination: "workspace",
  section: "skills",
  focus: "browser",
  overlay: undefined,
  task: false,
  narrow: false,
  narrowLevel: "list",
  sourceFilter: false,
  canReturn: false,
  emptyWorkspaceAction: false,
  nativeInput: false,
  tabsPart: false,
  readerActive: false,
  readerTab: "skill",
  readerRetry: false,
  readerResourceLevel: undefined,
  collectionFilterOpen: false,
  collectionFilterDimension: false,
};

test("STATE-007/008 native select keys remain native and only Ctrl+P opens the global palette", () => {
  for (const name of ["return", "down", "up", "left", "right"]) {
    expect(resolve(nativeSelectFacts, parseNavKey({ name }))).toBeNull();
  }
  expect(resolve(nativeSelectFacts, parseNavKey({ name: "p", ctrl: true }))).toEqual({
    kind: "events",
    events: [{ type: "palette.open" }],
  });
});

test("MGMT-002/004 uses exact direct owner and contribution route intents", () => {
  const projection = workspaceProjection();
  const owners = pages();
  owners.workspace.selectSection("sources");
  owners.workspace.selectSource("team-main");
  expect(actionIntent("remove-source", "workspace", projection, owners.facts)).toEqual({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(sourceRouteIntent("open-config", "workspace", projection, owners.facts)).toEqual({
    kind: "open-config",
    source: "team-main",
    owner: directOwner,
  });
  owners.workspace.selectSource("team-config/lark");
  expect(sourceRouteIntent("open-config-source", "workspace", projection, owners.facts)).toEqual({
    kind: "open-config-source",
    source: "team-config/lark",
    contribution: {
      configSource: configSourceOwner,
      declaration: { level: "global", pointer: "/sources/lark" },
    },
  });
  expect(
    reachableActions("workspace", projection, owners.facts).map((action) => action.id),
  ).not.toContain("remove-source");
});

test("Installed Skill actions use structural selection and selector-view availability", () => {
  const address = { source: "team-main", path: "guide" };
  const base = workspaceProjection();
  const projection = {
    ...base,
    installedSkills: [
      {
        address,
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        source: base.effective.sources[0],
        collections: [],
        selectors: ["engineering:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: [],
              useOwners: [directOwner],
            },
          ],
        },
        aliases: [],
        problems: [],
      },
    ],
  };
  const owners = pages();
  owners.workspace.selectSkill("team-main/guide");
  expect(
    selectedSkillActions("workspace", projection, owners.facts).map((action) => action.id),
  ).toEqual([
    "skill-add-to-collection",
    "skill-for-agents",
    "skill-open-source",
    "skill-check-updates",
    "skill-rebind",
    "skill-uninstall",
  ]);
  expect(installedSkillContext("workspace", projection, owners.facts)?.skill.address).toEqual(
    address,
  );
  expect(skillSourceIntent("workspace", projection, owners.facts)).toEqual({
    kind: "source-update",
    source: "team-main",
    path: "guide",
  });
  const unavailable = {
    ...projection,
    installedSkills: [
      {
        ...projection.installedSkills[0]!,
        selectorViews: { status: "unavailable" as const },
      },
    ],
  };
  expect(
    selectedSkillActions("workspace", unavailable, owners.facts).find(
      (action) => action.id === "skill-for-agents",
    ),
  ).toMatchObject({
    enabled: false,
    reason: "Agent selector paths are unavailable",
  });
});

test("MGMT-002 disables removal when the effective projection is unavailable", () => {
  const base = workspaceProjection();
  const unavailable = {
    ...base,
    effective: {
      status: "unavailable" as const,
      reasons: [
        {
          code: "CONFIG_INVALID",
          severity: "warning" as const,
          message: "Project Config is invalid",
        },
      ],
      sources: base.effective.sources,
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
  const owners = pages();
  owners.workspace.selectSection("sources");
  owners.workspace.selectSource("team-main");
  expect(
    reachableActions("workspace", unavailable, owners.facts).find(
      (action) => action.id === "remove-source",
    ),
  ).toMatchObject({ enabled: false, reason: "Project Config is invalid" });
});

test("MGMT-004 Source actions use the selected Project direct or contributed Source, never Workspace memory", () => {
  const projection = workspaceProjection();
  const owners = pages();
  owners.workspace.selectSection("sources");
  owners.workspace.selectSource("team-config/lark");
  owners.config.land("project", "sources", "team-main");
  expect(sourceOperationIntent("add-skills", "project", projection, owners.facts)).toEqual({
    kind: "source-discovery",
    source: "team-main",
  });
  owners.config.select("project", "team-config/lark");
  expect(sourceOperationIntent("check-updates", "project", projection, owners.facts)).toEqual({
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
  const base = workspaceProjection();
  const projection = {
    ...base,
    effective: {
      ...base.effective,
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
          repository: {
            derived: true,
            producers: [{ source: "team-main", path: "guide" }],
          },
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
        source: base.effective.sources[0],
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const owners = pages();
  owners.workspace.selectSection("collections");
  owners.collections.select("team");
  expect(
    reachableActions("workspace", projection, owners.facts).map((action) => action.id),
  ).toEqual([
    "new-collection",
    "add-membership",
    "import-collection",
    "add-reference",
    "add-link",
    "remove-collection",
  ]);
  owners.collections.select("derived");
  expect(
    reachableActions("workspace", projection, owners.facts).map((action) => action.id),
  ).toEqual(["new-collection", "add-membership"]);
});
