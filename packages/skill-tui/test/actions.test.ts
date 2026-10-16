import { expect, test } from "bun:test";
import type { ManagementProjection, SkillAddress } from "@skill-cli/core";
import {
  actionIntent,
  installedSkillContext,
  reachableActions,
  skillCollectionTargets,
  skillSourceIntent,
  sourceOperationIntent,
  sourceRouteIntent,
  selectedSkillActions,
} from "../src/actions";
import { createCollectionsState } from "../src/collections/state";
import { configDeclarationOwnerKey, createConfigState } from "../src/config/state";
import { createWorkspaceState, problemRowKey, problemRows } from "../src/workspace/state";
import { parseNavKey, resolve, type NavFacts } from "../src/navigation";
import { configSourceOwner, directOwner, workspaceProjection } from "./direct-source.fixture";

function pages() {
  const workspace = createWorkspaceState();
  workspace.selectSkillsView("all-installed-skills");
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

function collectionTargetProjection(
  addresses: readonly SkillAddress[] = [
    { source: "team-main", path: "a" },
    { source: "team-main", path: "b" },
    { source: "team-main", path: "c" },
  ],
): ManagementProjection {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("Expected a complete test projection");
  return {
    ...base,
    effective: {
      ...base.effective,
      status: "complete",
      collectionsView: [
        {
          id: "team",
          declared: [{ ...directOwner, pointer: "/collections/team" }],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: addresses.map((address): ManagementProjection["installedSkills"][number] => ({
      address,
      name: address.path,
      description: `Skill ${address.path}`,
      owner: { source: address.source, health: "healthy" },
      source: base.effective.sources.find((source) => source.id === address.source),
      collections: [],
      selectors: [],
      selectorViews: { status: "complete", values: [] },
      aliases: [],
      problems: [],
    })),
  };
}

test("K6 current B Collection and update actions never inherit checked A/C targets", () => {
  const projection = collectionTargetProjection();
  const [a, b, c] = projection.installedSkills.map((skill) => skill.address);
  const owners = pages();
  owners.workspace.selectSkill(b!);
  owners.workspace.toggleSkill(a!);
  owners.workspace.toggleSkill(c!);

  expect(
    skillCollectionTargets("skill-add-to-collection", "workspace", projection, owners.facts),
  ).toEqual({ addresses: [b] });
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [a, c] });
  expect(skillSourceIntent("workspace", projection, owners.facts)).toEqual({
    kind: "source-update",
    source: b!.source,
    path: b!.path,
  });
  expect(installedSkillContext("workspace", projection, owners.facts)?.skill.address).toEqual(b);
  const currentActions = selectedSkillActions("workspace", projection, owners.facts);
  expect(currentActions.map((action) => action.id)).not.toContain(
    "skill-add-selected-to-collection",
  );
  expect(currentActions.find((action) => action.id === "skill-add-to-collection")).toMatchObject({
    enabled: true,
    description: `Add only the current Installed Skill ${JSON.stringify(b)}; choose a destination Collection`,
  });
  expect(
    reachableActions("workspace", projection, owners.facts).find(
      (action) => action.id === "skill-add-selected-to-collection",
    ),
  ).toMatchObject({
    verb: "Add 2 selected to Collection",
    destination: "Collection chooser",
    enabled: true,
    description: `Add exactly the checked Installed Skills, including targets hidden by this view: ${JSON.stringify(a)}, ${JSON.stringify(c)}; choose a destination Collection`,
  });
});

test("K6/K7 hidden checked targets remain reachable with no current visible row", () => {
  const projection = collectionTargetProjection();
  const [a, b, c] = projection.installedSkills.map((skill) => skill.address);
  const owners = pages();
  owners.workspace.selectSkill(b!);
  owners.workspace.toggleSkill(a!);
  owners.workspace.toggleSkill(c!);
  owners.workspace.setQuery("b");
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [a, c] });

  owners.workspace.setQuery("no results");
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  expect(selectedSkillActions("workspace", projection, owners.facts)).toEqual([]);
  expect(() => skillSourceIntent("workspace", projection, owners.facts)).toThrow(
    "No Installed Skill is selected",
  );
  expect(
    skillCollectionTargets("skill-add-to-collection", "workspace", projection, owners.facts),
  ).toEqual({ addresses: [], reason: "No current visible Installed Skill is selected" });
  expect(reachableActions("workspace", projection, owners.facts)).toEqual([
    expect.objectContaining({
      id: "skill-add-selected-to-collection",
      verb: "Add 2 selected to Collection",
      enabled: true,
    }),
  ]);
  owners.workspace.selectSkill(undefined);
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [a, c] });
});

test("K6 absent or stale checked targets reject the batch instead of falling back to current B", () => {
  const projection = collectionTargetProjection();
  const [a, b, c] = projection.installedSkills.map((skill) => skill.address);
  const owners = pages();
  owners.workspace.selectSkill(b!);
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [], reason: "No Installed Skills are checked" });
  owners.workspace.toggleSkill(a!);
  owners.workspace.toggleSkill(c!);
  const stale = { ...projection, installedSkills: projection.installedSkills.slice(0, 2) };
  const reason = `Checked Installed Skills are no longer installed: ${JSON.stringify(c)}; clear or reselect the checked set`;
  expect(
    skillCollectionTargets("skill-add-selected-to-collection", "workspace", stale, owners.facts),
  ).toEqual({ addresses: [], reason });
  expect(
    reachableActions("workspace", stale, owners.facts).find(
      (action) => action.id === "skill-add-selected-to-collection",
    ),
  ).toMatchObject({ enabled: false, disabledReason: reason, verb: "Add 2 selected to Collection" });
  expect(
    skillCollectionTargets("skill-add-to-collection", "workspace", stale, owners.facts),
  ).toEqual({ addresses: [b] });
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      { ...projection, installedSkills: [] },
      owners.facts,
    ),
  ).toMatchObject({ addresses: [], reason: expect.stringContaining(JSON.stringify(a)) });
});

test("K7 current-object eligibility respects Source and dimension filters, not the checked set", () => {
  const projection = collectionTargetProjection();
  const b = projection.installedSkills[1]!.address;
  const owners = pages();
  owners.workspace.selectSkill(b);
  owners.workspace.toggleSkill(b);
  owners.workspace.showInstalledSkillsFromSource("other-source");
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [b] });
  owners.workspace.showInstalledSkillsFromSource("team-main");
  owners.workspace.setFilter("Problems", "Has problems");
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  expect(selectedSkillActions("workspace", projection, owners.facts)).toEqual([]);
  owners.workspace.clearFilters();
  expect(installedSkillContext("workspace", projection, owners.facts)?.skill.address).toEqual(b);
});

test("K6 structural Collection targets do not confuse slash-colliding addresses", () => {
  const a = { source: "team/config", path: "nested/guide" };
  const b = { source: "team", path: "config/nested/guide" };
  const projection = collectionTargetProjection([a, b]);
  const owners = pages();
  owners.workspace.selectSkill({ ...b });
  owners.workspace.toggleSkill({ ...a });
  expect(
    skillCollectionTargets("skill-add-to-collection", "workspace", projection, owners.facts),
  ).toEqual({ addresses: [b] });
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [a] });
  const stale = { ...projection, installedSkills: [projection.installedSkills[1]!] };
  expect(
    skillCollectionTargets("skill-add-selected-to-collection", "workspace", stale, owners.facts),
  ).toMatchObject({ addresses: [], reason: expect.stringContaining(JSON.stringify(a)) });
  expect(
    reachableActions("workspace", projection, owners.facts).find(
      (action) => action.id === "skill-add-selected-to-collection",
    )?.description,
  ).toContain(JSON.stringify(a));
});

test("K7 Unassigned eligibility excludes assigned cursor memory but preserves checked targets", () => {
  const base = collectionTargetProjection();
  const b = base.installedSkills[1]!;
  const projection: ManagementProjection = {
    ...base,
    installedSkills: base.installedSkills.map((skill) =>
      skill === b
        ? {
            ...skill,
            collections: [
              {
                id: "team",
                entry: "b",
                paths: [{ kind: "direct", collection: "team", entryName: "b", owner: directOwner }],
              },
            ],
          }
        : skill,
    ),
  };
  const owners = pages();
  owners.workspace.selectSkill(b.address);
  owners.workspace.toggleSkill(b.address);
  owners.workspace.selectSkillsView("unassigned");
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  expect(selectedSkillActions("workspace", projection, owners.facts)).toEqual([]);
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toEqual({ addresses: [b.address] });
  owners.workspace.selectSkill(projection.installedSkills[0]!.address);
  expect(installedSkillContext("workspace", projection, owners.facts)?.skill.address).toEqual(
    projection.installedSkills[0]!.address,
  );
});

test("K7 Problems eligibility follows the selected visible diagnostic's exact Installed Skill", () => {
  const base = collectionTargetProjection();
  const a = base.installedSkills[0]!.address;
  const b = base.installedSkills[1]!.address;
  const projection: ManagementProjection = {
    ...base,
    diagnostics: [
      {
        code: "SKILL_NOT_FOUND",
        severity: "warning",
        message: "B diagnostic",
        subject: { kind: "installed-skill", address: b },
      },
      { code: "CONFIG_INVALID", severity: "warning", message: "Workspace diagnostic" },
    ],
  };
  const owners = pages();
  owners.workspace.selectSkillsView("problems");
  owners.workspace.selectSkill(b);
  owners.workspace.selectProblem(problemRowKey(problemRows(projection)[0]!));
  expect(installedSkillContext("workspace", projection, owners.facts)?.skill.address).toEqual(b);
  owners.workspace.selectSkill(a);
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  owners.workspace.selectSkill(b);
  owners.workspace.setFilter("Severity", "error");
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  owners.workspace.clearFilters();
  owners.workspace.setQuery("no diagnostic matches");
  expect(selectedSkillActions("workspace", projection, owners.facts)).toEqual([]);
  owners.workspace.setQuery("");
  owners.workspace.selectProblem(problemRowKey(problemRows(projection)[1]!));
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
});

test("explicit semantic Skill detail may own a filtered object, but not an uninstalled object", () => {
  const projection = collectionTargetProjection();
  const b = projection.installedSkills[1]!.address;
  const owners = pages();
  owners.workspace.selectSkill(b);
  owners.workspace.setQuery("no results");
  owners.workspace.openReader();
  expect(installedSkillContext("workspace", projection, owners.facts)).toBeUndefined();
  const explicit = { ...owners.facts, explicitSkillDetail: true };
  expect(installedSkillContext("workspace", projection, explicit)?.skill.address).toEqual(b);
  const stale = { ...projection, installedSkills: [] };
  expect(installedSkillContext("workspace", stale, explicit)).toBeUndefined();
  expect(installedSkillContext("project", projection, explicit)).toBeUndefined();
});

test("Collection chooser eligibility preserves repository-derived destinations and rejects unavailable views", () => {
  const base = collectionTargetProjection();
  if (base.effective.status !== "complete") throw new Error("Expected a complete test projection");
  const projection: ManagementProjection = {
    ...base,
    effective: {
      ...base.effective,
      status: "complete",
      collectionsView: [
        {
          id: "derived",
          declared: [],
          repository: { derived: true, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  if (projection.effective.status !== "complete")
    throw new Error("Expected a complete test projection");
  const owners = pages();
  const b = projection.installedSkills[1]!.address;
  owners.workspace.selectSkill(b);
  owners.workspace.toggleSkill(b);
  for (const id of ["skill-add-to-collection", "skill-add-selected-to-collection"] as const) {
    expect(skillCollectionTargets(id, "workspace", projection, owners.facts)).toEqual({
      addresses: [b],
    });
    expect(skillCollectionTargets(id, "project", projection, owners.facts).reason).toBeDefined();
    expect(skillCollectionTargets(id, "workspace", undefined, owners.facts).reason).toBeDefined();
    const emptyCollections = {
      ...projection,
      effective: { ...projection.effective, status: "complete" as const, collectionsView: [] },
    };
    expect(skillCollectionTargets(id, "workspace", emptyCollections, owners.facts).reason).toBe(
      "No direct or repository-derived Collection is available for these targets",
    );
    const unavailable: ManagementProjection = {
      ...projection,
      effective: {
        status: "unavailable",
        reasons: [],
        sources: projection.effective.sources,
        collections: [],
        agent: projection.effective.agent,
      },
    };
    expect(skillCollectionTargets(id, "workspace", unavailable, owners.facts).reason).toBe(
      "No direct or repository-derived Collection is available for these targets",
    );
  }
  owners.workspace.selectSection("sources");
  expect(
    reachableActions("workspace", projection, owners.facts).map((action) => action.id),
  ).not.toContain("skill-add-selected-to-collection");
  expect(
    skillCollectionTargets(
      "skill-add-selected-to-collection",
      "workspace",
      projection,
      owners.facts,
    ),
  ).toMatchObject({ addresses: [], reason: expect.any(String) });
});

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
        destination: "Updates",
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

test("Collection actions retain read-only update access while edits use direct or contribution paths", () => {
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
    "collection-check-updates",
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
  ).toEqual(["collection-check-updates", "new-collection", "add-membership"]);
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
