import { expect, test } from "bun:test";
import {
  actionIntent,
  installedSkillContext,
  reachableActions,
  skillSourceIntent,
  sourceOperationIntent,
  sourceRouteIntent,
  selectedSkillActions,
} from "../src/actions";
import { createCollectionsState } from "../src/collections/state";
import { configDeclarationOwnerKey, createConfigState } from "../src/config/state";
import { createWorkspaceState } from "../src/workspace/state";
import { parseNavKey, resolve, type NavFacts } from "../src/navigation";
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
  tabOrder: ["top-nav", "local-nav", "browser"],
  overlay: undefined,
  task: false,
  narrow: false,
  narrowLevel: "list",
  canReturn: false,
  readerActive: false,
  readerTab: "skill",
  readerResourceLevel: undefined,
  collectionFilterOpen: false,
  collectionFilterDimension: false,
};

test("STATE-007/008 native select keys remain native and only Ctrl+P opens the global palette", () => {
  for (const name of ["return", "down", "up", "right"]) {
    expect(resolve(nativeSelectFacts, parseNavKey({ name }))).toBeNull();
  }
  expect(resolve(nativeSelectFacts, parseNavKey({ name: "left" }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
  expect(resolve(nativeSelectFacts, parseNavKey({ name: "p", ctrl: true }))).toEqual({
    kind: "events",
    events: [{ type: "palette.open" }],
  });
});

test("native Left returns from a page when a back route is available", () => {
  expect(resolve({ ...nativeSelectFacts, canReturn: true }, parseNavKey({ name: "left" }))).toEqual(
    {
      kind: "events",
      events: [{ type: "route.back" }],
    },
  );
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
  owners.workspace.selectSection("skills");
  owners.workspace.selectSkill({ source: "team-main", path: "guide" });
  expect(
    selectedSkillActions("workspace", projection, owners.facts).map((action) => action.id),
  ).toEqual([
    "skill-add-to-collection",
    "skill-open-collection-use",
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
      (action) => action.id === "skill-open-collection-use",
    ),
  ).toMatchObject({
    enabled: false,
    disabledReason: "Collection Use relationship paths are unavailable",
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
  ).toMatchObject({
    id: "remove-source",
    verb: "Remove Source",
    destination: "Review Source removal",
    keys: ["enter"],
    scope: "page",
    enabled: false,
    disabledReason: "Project Config is invalid",
    danger: true,
  });
});

test("Task6 action projection exposes command records with the dispatched action ID", () => {
  const projection = workspaceProjection();
  const owners = pages();
  owners.workspace.selectSection("sources");
  owners.workspace.selectSource("team-main");

  const record = reachableActions("workspace", projection, owners.facts).find(
    (action) => action.id === "add-skills",
  );

  expect(record).toEqual({
    id: "add-skills",
    keys: ["enter"],
    verb: "Add Skills",
    destination: "Source selection",
    scope: "page",
    enabled: true,
    danger: false,
  });
  expect(record?.id).toBe("add-skills");
});

test("Task6 command mappings preserve visible enabled, danger, and next-surface facts", () => {
  const base = workspaceProjection();
  const projection = {
    ...base,
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        source: base.effective.sources[0],
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      },
    ],
  };
  const owners = pages();
  owners.workspace.selectSection("sources");
  owners.workspace.selectSource("team-main");
  expect(reachableActions("workspace", projection, owners.facts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "check-updates",
        verb: "Check Updates",
        destination: "Update review",
        enabled: true,
        danger: false,
      }),
      expect.objectContaining({
        id: "remove-source",
        verb: "Remove Source",
        destination: "Review Source removal",
        enabled: true,
        danger: true,
      }),
      expect.objectContaining({
        id: "add-source",
        verb: "Add Source",
        destination: "Source registration form",
        enabled: true,
        danger: false,
      }),
    ]),
  );

  owners.workspace.selectSection("skills");
  owners.workspace.selectSkill({ source: "team-main", path: "guide" });
  expect(selectedSkillActions("workspace", projection, owners.facts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "skill-rebind",
        verb: "Rebind",
        destination: "Rebind form",
        enabled: true,
        danger: false,
      }),
      expect.objectContaining({
        id: "skill-uninstall",
        verb: "Uninstall",
        destination: "Uninstall review",
        enabled: true,
        danger: true,
      }),
    ]),
  );
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

test("Config integration Actions open an inherited owner instead of enabling the current Config", () => {
  const base = workspaceProjection();
  const inheritedOwner = {
    level: "global" as const,
    file: "/home/user/.config/skill-cli.jsonc",
    pointer: "/agents/opencode",
  };
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, integrations: [] } }
        : config,
    ),
    effective: {
      ...base.effective,
      agent: {
        status: "available" as const,
        integration: [inheritedOwner],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
  };
  const owners = pages();
  owners.config.land("project", "integrations", configDeclarationOwnerKey(inheritedOwner));
  expect(reachableActions("project", projection, owners.facts).map((action) => action.id)).toEqual([
    "open-config-integration",
  ]);
});

test("Config integration Actions follow the selected owner when direct and inherited rows coexist", () => {
  const base = workspaceProjection();
  const projectOwner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/agents/opencode",
  };
  const globalOwner = {
    level: "global" as const,
    file: "/home/user/.config/skill-cli.jsonc",
    pointer: "/agents/opencode",
  };
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              integrations: [{ kind: "opencode" as const, owner: projectOwner }],
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      agent: {
        status: "available" as const,
        integration: [projectOwner, globalOwner],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
  };
  const owners = pages();
  owners.config.land("project", "integrations", configDeclarationOwnerKey(globalOwner));
  expect(reachableActions("project", projection, owners.facts).map((action) => action.id)).toEqual([
    "open-config-integration",
  ]);
  owners.config.land("project", "integrations", configDeclarationOwnerKey(projectOwner));
  expect(reachableActions("project", projection, owners.facts).map((action) => action.id)).toEqual([
    "disable-managed-opencode",
  ]);
});

test.each(["invalid", "unreadable"] as const)(
  "RED Config %s status exposes no Config mutation actions but leaves a missing Config creatable",
  (status) => {
    const base = workspaceProjection();
    const projection = {
      ...base,
      configs: base.configs.map((config) =>
        config.level === "project" ? { ...config, file: { ...config.file, status } } : config,
      ),
    };
    const owners = pages();
    for (const section of ["sources", "config-sources", "collections", "integrations"] as const) {
      owners.config.selectSection("project", section);
      expect(reachableActions("project", projection, owners.facts)).toEqual([]);
    }
    const missing = {
      ...base,
      configs: base.configs.map((config) =>
        config.level === "project"
          ? { ...config, file: { ...config.file, status: "missing" as const } }
          : config,
      ),
    };
    owners.config.selectSection("project", "sources");
    expect(reachableActions("project", missing, owners.facts).map((action) => action.id)).toContain(
      "add-source",
    );
  },
);
