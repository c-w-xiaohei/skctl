import { expect, test } from "bun:test";
import {
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import {
  collectionFilterDimensions,
  collectionFilterValues,
  filterCollections,
} from "../src/collections-filter";
import { collectionRemovalPlan, collectionRelationRows } from "../src/collections-page";
import { relationshipCommands } from "../src/collections/relationship-commands";
import { collectionRelationKey } from "../src/collections/relationship-inspector";
import {
  collectionOriginKey,
  createCollectionsState,
  currentExposureRows,
  exposureHierarchy,
  unassignedSkills,
} from "../src/collections/state";
import { filterProblemRows, problemRowKey, problemRows } from "../src/workspace/state";
import { selectScrollOffset, setSelectScrollOffset } from "../src/select-scroll";
import { skillAddressKey } from "../src/types";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import {
  enterLive,
  focusLive,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
async function navigateToCollections(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.flush();
  await openMainPage(setup, "collections");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
  setup.renderer.root.findDescendantById("collection-browser")!.focus();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
}
async function openSkillView(
  setup: Awaited<ReturnType<typeof testRender>>,
  view: "current-exposure" | "problems",
) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(`skills-view-tab-${view}`));
  await enterLive(setup, `skills-view-tab-${view}`);
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById(
        view === "current-exposure" ? "current-exposure-browser" : "problems-browser",
      ),
  );
  const browser = setup.renderer.root.findDescendantById(
    view === "current-exposure" ? "current-exposure-browser" : "problems-browser",
  )!;
  browser.focus();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}
test("FILTER Collections combines semantic facts without Core calls", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/a",
  };
  const collections = [
    {
      id: "engineering",
      declared: [owner],
      repository: { derived: false, producers: [] },
      members: [
        {
          name: "review",
          address: { source: "main", path: "review" },
          paths: [],
        },
      ],
      references: [{ name: "docs", collection: "docs", description: "Read docs", owner }],
      links: [],
    },
    {
      id: "empty",
      declared: [],
      repository: { derived: false, producers: [] },
      members: [],
      references: [],
      links: [],
    },
  ];
  expect(
    filterCollections(collections, {
      query: "READ",
      filters: {
        "Contains Skill": skillAddressKey({ source: "main", path: "review" }),
        Config: "project",
      },
    }).map((item) => item.id),
  ).toEqual(["engineering"]);
  expect(filterCollections(collections, { query: "missing", filters: {} })).toEqual([]);
});
test("COLLECTION direct Membership intent preserves entry, address, Collection, and owner", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/engineering",
  };
  expect(
    relationshipCommands("engineering", {
      kind: "membership",
      member: {
        name: "stable-review",
        address: { source: "team-main", path: "review" },
      },
      origin: {
        kind: "direct",
        collection: "engineering",
        entryName: "stable-review",
        owner,
      },
    }).find((command) => command.id === "membership.remove")?.intent,
  ).toEqual({
    kind: "collection-direct",
    collection: "engineering",
    name: "stable-review",
    address: { source: "team-main", path: "review" },
    owner,
  });
});
test("COLLECTION member origins preserve contribution, producer, and outer Link routes", () => {
  const owner = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/collections/engineering",
    contribution: {
      configSource: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/configSources/team",
      },
      declaration: {
        level: "global" as const,
        pointer: "/collections/engineering",
      },
    },
  };
  const member = { name: "guide", address: { source: "team", path: "guide" } };
  expect(
    relationshipCommands("engineering", {
      kind: "membership",
      member,
      origin: {
        kind: "direct",
        collection: "engineering",
        entryName: "guide",
        owner,
      },
    }).find((command) => command.id === "membership.open-source")?.intent,
  ).toMatchObject({
    kind: "collection-contribution",
    collection: "engineering",
    owner,
  });
  expect(
    relationshipCommands("engineering", {
      kind: "membership",
      member,
      origin: {
        kind: "repository-derived",
        repository: "acme/team",
        source: "team",
        path: "guide",
      },
    }).find((command) => command.id === "membership.open-source")?.intent,
  ).toEqual({
    kind: "collection-producer",
    collection: "engineering",
    address: { source: "team", path: "guide" },
  });
  expect(
    relationshipCommands("engineering", {
      kind: "membership",
      member,
      origin: {
        kind: "via-link",
        links: [
          { collection: "engineering", linkedCollection: "shared", owner },
          { collection: "shared", linkedCollection: "nested", owner },
        ],
      },
    }).find((command) => command.id === "membership.open-link")?.intent,
  ).toMatchObject({
    kind: "collection-open-collection",
    collection: "engineering",
    target: "shared",
  });
});
test("COLLECTION command metadata distinguishes the current member, its Link, and the exact Use owner", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/team/members/guide",
  };
  const member = { name: "guide", address: { source: "skills", path: "review/guide" } };
  const direct = relationshipCommands("team", {
    kind: "membership",
    member,
    origin: { kind: "direct", collection: "team", entryName: "guide", owner },
  });
  const read = direct.find((command) => command.id === "membership.open-skill")!;
  expect(read.object).toContain("skills/review/guide");
  expect(read.group).toBe("member");
  expect(read.opens).toBeDefined();
  const remove = direct.find((command) => command.id === "membership.remove")!;
  expect(remove.object).toContain("team");
  expect(remove.object).toContain("guide");
  expect(remove.scopeText).toContain("/project.jsonc");
  expect(remove.scopeText).toContain("/collections/team/members/guide");
  expect(remove.scopeText).not.toContain("checked");
  expect(remove.opens).toBeDefined();
  expect(remove.group).toBe("member");
  const linked = relationshipCommands("team", {
    kind: "membership",
    member,
    origin: {
      kind: "via-link",
      links: [{ collection: "team", linkedCollection: "shared", owner }],
    },
  }).find((command) => command.id === "membership.open-link")!;
  expect(linked.object).toBe("shared");
  expect(linked.object).toContain("shared");
  expect(linked.danger).toBe(false);
  expect(linked.scopeText).toContain("/project.jsonc");
  expect(linked.group).toBe("member");
  const useOwner = { level: "global" as const, file: "/global.jsonc", pointer: "/use/2" };
  const use = relationshipCommands("team", {
    kind: "relation",
    relation: {
      kind: "collection-use",
      label: "Collection Use",
      owner: useOwner,
      effect: "active",
      intent: { kind: "collection-use", collection: "team", owner: useOwner },
    },
  }).find((command) => command.id === "relationship.edit-use")!;
  expect(use.object).toContain("team");
  expect(use.scopeText).toContain("/global.jsonc");
  expect(use.scopeText).toContain("/use/2");
  expect(use.scopeText).not.toContain("checked");
  expect(use.opens).toBeDefined();
  expect(use.group).toBe("member");
});
test("COLLECTION relation rows retain structural identities when their display order changes", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/team",
  };
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          id: "team",
          description: "Team workflows",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [
            {
              name: "docs",
              collection: "docs",
              description: "Read documentation",
              owner,
            },
            {
              name: "ops",
              collection: "ops",
              description: "Run operations",
              owner,
            },
          ],
          links: [],
        },
      ],
    },
  };
  const forward = collectionRelationRows("team", projection);
  const reverse = collectionRelationRows("team", {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          ...projection.effective.collectionsView[0]!,
          references: [...projection.effective.collectionsView[0]!.references].reverse(),
        },
      ],
    },
  });
  expect(forward.map((row) => [row.target, collectionRelationKey(row)]).sort()).toEqual(
    reverse.map((row) => [row.target, collectionRelationKey(row)]).sort(),
  );
  expect(forward.map(collectionRelationKey)).not.toContain(undefined);
});
test("COLLECTION removal plan keeps repeated exact origins separate and explains non-direct rows", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/team",
  };
  const memberOwner = { ...owner, pointer: "/collections/team/members/guide" };
  const contributedOwner = {
    ...owner,
    contribution: {
      configSource: owner,
      declaration: { level: "project" as const, pointer: "/collections/team" },
    },
  };
  const rows = [
    {
      key: "one",
      name: "guide",
      address: { source: "main", path: "guide" },
      path: {
        kind: "direct" as const,
        collection: "team",
        entryName: "guide",
        owner: memberOwner,
      },
    },
    {
      key: "two",
      name: "guide",
      address: { source: "main", path: "guide" },
      path: {
        kind: "direct" as const,
        collection: "team",
        entryName: "guide",
        owner: memberOwner,
      },
    },
    {
      key: "contributed",
      name: "config",
      address: { source: "config", path: "skill" },
      path: {
        kind: "direct" as const,
        collection: "team",
        entryName: "config",
        owner: contributedOwner,
      },
    },
    {
      key: "repository",
      name: "repo",
      address: { source: "repo", path: "skill" },
      path: {
        kind: "repository-derived" as const,
        repository: "acme/repo",
        source: "repo",
        path: "skill",
      },
    },
    {
      key: "link",
      name: "linked",
      address: { source: "linked", path: "skill" },
      path: {
        kind: "via-link" as const,
        links: [{ collection: "team", linkedCollection: "shared", owner }],
      },
    },
  ];
  const plan = collectionRemovalPlan({ id: "team", declared: [owner] }, rows);
  expect(plan.removals).toHaveLength(2);
  expect(plan.removals.map((item) => item.key)).toEqual(["one", "two"]);
  expect(plan.ownerGroups).toHaveLength(1);
  expect(plan.explanations.join("\n")).toContain("Config Source");
  expect(plan.explanations.join("\n")).toContain("Repository acme/repo");
  expect(plan.explanations.join("\n")).toContain("Link team -> shared");
});
test("COLLECTION origin keys distinguish repeated paths by structural origin facts", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/team",
  };
  const member = { name: "guide", address: { source: "main", path: "guide" } };
  const direct = {
    kind: "direct" as const,
    collection: "team",
    entryName: "stable-guide",
    owner,
  };
  const changedOwner = { ...owner, pointer: "/collections/other" };
  expect(collectionOriginKey("team", member, direct, 0)).not.toBe(
    collectionOriginKey("team", member, { ...direct, owner: changedOwner }, 0),
  );
  expect(collectionOriginKey("team", member, direct, 0)).not.toBe(
    collectionOriginKey("team", member, direct, 1),
  );
  expect(collectionOriginKey("team", member, direct, 0)).not.toBe(
    collectionOriginKey(
      "team",
      member,
      {
        kind: "repository-derived",
        repository: "acme/main",
        source: "main",
        path: "guide",
      },
      0,
    ),
  );
  expect(collectionOriginKey("team", member, direct, 0)).not.toBe(
    collectionOriginKey("team", member, { ...direct, owner: { ...owner, namespace: "other" } }, 0),
  );
  expect(collectionOriginKey("team", member, direct, 0)).not.toBe(
    collectionOriginKey(
      "team",
      member,
      {
        ...direct,
        owner: {
          ...owner,
          contribution: {
            configSource: {
              level: "global",
              file: "/global.jsonc",
              pointer: "/configSources/team",
            },
            declaration: {
              level: "project",
              file: "/one.jsonc",
              pointer: "/collections/team",
            },
          },
        },
      },
      0,
    ),
  );
  expect(
    collectionOriginKey(
      "team",
      member,
      {
        ...direct,
        owner: {
          ...owner,
          contribution: {
            configSource: {
              level: "global",
              file: "/global.jsonc",
              pointer: "/configSources/team",
            },
            declaration: {
              level: "project",
              file: "/one.jsonc",
              pointer: "/collections/team",
              namespace: "one",
            },
          },
        },
      },
      0,
    ),
  ).not.toBe(
    collectionOriginKey(
      "team",
      member,
      {
        ...direct,
        owner: {
          ...owner,
          contribution: {
            configSource: {
              level: "global",
              file: "/global.jsonc",
              pointer: "/configSources/team",
            },
            declaration: {
              level: "project",
              file: "/one.jsonc",
              pointer: "/collections/team",
              namespace: "two",
            },
          },
        },
      },
      0,
    ),
  );
});
test("COLLECTION origin reconciliation retains only structural origins still projected", () => {
  const state = createCollectionsState();
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/team",
  };
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const member = {
    name: "guide",
    address: { source: "main", path: "guide" },
    paths: [
      {
        kind: "direct" as const,
        collection: "team",
        entryName: "guide",
        owner,
      },
    ],
  };
  const current = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "team",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [member],
          references: [],
          links: [],
        },
      ],
    },
  };
  const key = collectionOriginKey("team", member, member.paths[0], 0);
  state.toggleOrigin("team", key);
  state.reconcile(undefined, current);
  expect(state.selectedOrigins("team")).toEqual([key]);
  state.reconcile(current, {
    ...current,
    effective: {
      ...current.effective,
      collectionsView: [{ ...current.effective.collectionsView[0]!, members: [] }],
    },
  });
  expect(state.selectedOrigins("team")).toEqual([]);
});
test("COLLECTION removal plan uses the direct path entry name and requires a direct removal", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/team",
  };
  const row = {
    key: "direct",
    name: "display-name",
    address: { source: "main", path: "guide" },
    path: {
      kind: "direct" as const,
      collection: "team",
      entryName: "stable-name",
      owner: { ...owner, pointer: "/collections/team/members/stable-name" },
    },
  };
  const collection = {
    id: "team",
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  };
  expect(collectionRemovalPlan(collection, [row]).removals[0]?.entryName).toBe("stable-name");
  expect(collectionRemovalPlan(collection, [{ ...row, path: undefined }]).executable).toBe(false);
});
test("EXPOSURE hierarchy preserves repeated Reference routes, excludes Links, and counts selectors separately from Skills", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/root",
  };
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      managed: true,
      use: ["root"],
      collectionsView: [
        {
          id: "root",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [
            { name: "docs", collection: "docs", description: "Docs", owner },
            {
              name: "shared",
              collection: "shared",
              description: "Shared",
              owner,
            },
          ],
          links: [{ collection: "linked", owner }],
        },
        {
          id: "docs",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [
            {
              name: "shared",
              collection: "shared",
              description: "Shared",
              owner,
            },
          ],
          links: [],
        },
        {
          id: "shared",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: [
      {
        address: { source: "team", path: "guide" },
        name: "guide",
        description: "",
        owner: { source: "team", health: "healthy" as const },
        collections: [],
        selectors: ["root:guide", "docs:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "root:guide",
              collection: "root",
              entry: "guide",
              paths: [],
              useOwners: [],
            },
            {
              selector: "docs:guide",
              collection: "docs",
              entry: "guide",
              paths: [],
              useOwners: [],
            },
          ],
        },
        aliases: ["docs:guide"],
        primary: "root:guide",
        problems: [],
      },
    ],
  };
  const rows = exposureHierarchy(complete);
  expect(rows.map((row) => row.path)).toEqual([
    "root",
    "root/docs",
    "root/docs/shared",
    "root/shared",
  ]);
  expect(rows.find((row) => row.path === "root")!).toMatchObject({
    selectorCount: 1,
    installedSkillCount: 1,
  });
  expect(rows.find((row) => row.path === "root/docs")!).toMatchObject({
    selectorCount: 1,
    installedSkillCount: 1,
  });
  expect(rows.map((row) => row.collection)).not.toContain("linked");
  expect(currentExposureRows(complete)).toEqual(rows);
});
test("EXPOSURE counts only healthy Installed Skills while retaining selector paths", () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      use: ["engineering"],
      collectionsView: [
        {
          id: "engineering",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: [
      ...base.installedSkills,
      {
        ...base.installedSkills[0]!,
        address: { source: "broken", path: "guide" },
        owner: { source: "broken", health: "missing" as const },
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: [],
              useOwners: [],
            },
          ],
        },
      },
    ],
  };
  expect(exposureHierarchy(projection)[0]).toMatchObject({
    selectorCount: 0,
    installedSkillCount: 0,
  });
});
test("PROBLEMS deduplicates identical diagnostics, keeps compact facts searchable, and preserves exact subjects", () => {
  const base = workspaceProjection();
  const installed = {
    code: "SOURCE_NOT_FOUND",
    severity: "warning" as const,
    message: "owner source is unavailable",
    location: { file: "/project.jsonc", pointer: "/sources/team" },
    suggestion: "Rebind the Installed Skill",
    subject: {
      kind: "installed-skill" as const,
      address: { source: "team", path: "guide" },
    },
  };
  const config = {
    code: "CONFIG_INVALID",
    severity: "warning" as const,
    message: "Collection Use needs repair",
    subject: {
      kind: "config" as const,
      owner: {
        level: "project" as const,
        file: "/project.jsonc",
        pointer: "/forAgents/use",
      },
    },
  };
  const projection = {
    ...base,
    diagnostics: [installed, config, installed],
    installedSkills: [
      {
        address: { source: "team", path: "guide" },
        name: "guide",
        description: "",
        owner: { source: "team", health: "missing" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [installed],
      },
    ],
    configs: [
      {
        ...base.configs[0]!,
        level: "project" as const,
        direct: {
          ...base.configs[0]!.direct,
          collectionUse: [{ collection: "engineering", owner: config.subject.owner }],
        },
      },
    ],
  };
  const rows = problemRows(projection);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.context).join(" ")).toContain("SOURCE_NOT_FOUND");
  expect(rows.find((row) => row.message === installed.message)?.intent).toEqual({
    kind: "installed-skill",
    address: { source: "team", path: "guide" },
  });
  expect(rows.find((row) => row.message === config.message)?.intent).toEqual({
    kind: "config-route",
    destination: "project",
    section: "collections",
    selection: "engineering",
    owner: config.subject.owner,
  });
  expect(
    filterProblemRows(rows, "rebind", {
      Severity: "warning",
      Code: "SOURCE_NOT_FOUND",
    }),
  ).toHaveLength(1);
});
test("PROBLEMS canonical identity ignores container fallback and routes semantic Config owners", () => {
  const base = workspaceProjection();
  const sourceOwner = base.configs[1]!.direct.sources[0]!.ref.owner;
  const configSourceOwner = base.configs[0]!.direct.configSources[0]!.owner;
  const collectionOwner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/docs",
  };
  const integrationOwner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/integrations/opencode",
  };
  const repeated = {
    code: "CONFIG_INVALID",
    severity: "warning" as const,
    message: "same diagnostic",
    location: { file: "/project.jsonc", pointer: "/use" },
    related: [{ message: "related", file: "/related.jsonc", pointer: "/sources/team" }],
    suggestion: "repair",
  };
  const projection = {
    ...base,
    diagnostics: [
      repeated,
      { ...repeated, subject: { kind: "config" as const, owner: sourceOwner } },
      {
        ...repeated,
        subject: { kind: "config" as const, owner: configSourceOwner },
      },
      {
        ...repeated,
        subject: { kind: "config" as const, owner: collectionOwner },
      },
      {
        ...repeated,
        subject: { kind: "config" as const, owner: integrationOwner },
      },
    ],
    effective: {
      ...base.effective,
      agent: { ...base.effective.agent, reasons: [repeated] },
    },
    configs: [
      base.configs[0]!,
      {
        ...base.configs[1]!,
        direct: {
          ...base.configs[1]!.direct,
          collections: [{ id: "docs", owner: collectionOwner }],
          integrations: [{ kind: "opencode" as const, owner: integrationOwner }],
        },
      },
    ],
  };
  const rows = problemRows(projection);
  expect(rows).toHaveLength(5);
  expect(rows[0]!.context).toContain("/related.jsonc/sources/team");
  expect(rows.map((row) => row.intent)).toEqual(
    expect.arrayContaining([
      {
        kind: "config-route",
        destination: "project",
        section: "sources",
        selection: "team-main",
        owner: sourceOwner,
      },
      {
        kind: "config-route",
        destination: "global",
        section: "config-sources",
        selection: "/configSources/team-config",
        owner: configSourceOwner,
      },
      {
        kind: "config-route",
        destination: "project",
        section: "collections",
        selection: "docs",
        owner: collectionOwner,
      },
      {
        kind: "config-route",
        destination: "project",
        section: "integrations",
        owner: integrationOwner,
      },
    ]),
  );
});
test("RENDER Problems uses native search and filters, routes subjects, and keeps unmatched rows Read-only", async () => {
  const base = readerProjection();
  const actionable = {
    code: "SOURCE_NOT_FOUND",
    severity: "warning" as const,
    message: "owner source is unavailable",
    location: { file: "/wrong-owner.jsonc", pointer: "/not-a-route" },
    subject: {
      kind: "installed-skill" as const,
      address: { source: "team", path: "guide" },
    },
  };
  const unmatched = {
    code: "CONFIG_INVALID",
    severity: "info" as const,
    message: "diagnostic has no semantic subject",
    location: {
      file: "/project.jsonc",
      pointer: "/collections/should-not-route",
    },
  };
  const projection = {
    ...base,
    diagnostics: [actionable, unmatched],
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        address: actionable.subject.address,
        problems: [actionable],
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openSkillView(setup, "problems");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
    const count = () =>
      (setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable).options
        .length;
    expect(count()).toBe(2);
    expect(
      problemRows(projection).find((row) => row.message === unmatched.message)?.intent,
    ).toBeUndefined();
    const problemsBrowser = setup.renderer.root.findDescendantById("problems-browser")!;
    problemsBrowser.focus();
    await setup.renderOnce();
    const query = setup.renderer.root.findDescendantById("problems-query")!;
    query.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
    const filter = setup.renderer.root.findDescendantById("open-problems-filter")!;
    filter.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === filter);
    query.focus();
    for (const character of "SOURCE_NOT_FOUND") {
      setup.mockInput.pressKey(character);
      await setup.renderOnce();
    }
    await setup.renderOnce();
    await setup.waitFor(() => count() === 1);
    setup.mockInput.pressKey("u", { ctrl: true });
    await setup.waitFor(() => count() === 2);
    for (const [dimension, value] of [
      ["Severity", "info"],
      ["Code", "CONFIG_INVALID"],
    ]) {
      await enterLive(setup, "open-problems-filter");
      const dimensions = (await focusLive(setup, "skills-filter-dimensions")) as SelectRenderable;
      const dimensionIndex = dimensions.options.findIndex((option) => option.value === dimension);
      expect(dimensionIndex).toBeGreaterThanOrEqual(0);
      dimensions.setSelectedIndex(dimensionIndex);
      await setup.flush();
      await parsedEnter(setup);
      const values = (await focusLive(setup, "skills-filter-values")) as SelectRenderable;
      const valueIndex = values.options.findIndex((option) => option.value === value);
      expect(valueIndex).toBeGreaterThanOrEqual(0);
      values.setSelectedIndex(valueIndex);
      await parsedEnter(setup);
      await setup.waitFor(() => count() === 1);
      expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
      await enterLive(setup, "skills-filter-clear-all");
      await setup.waitFor(() => count() === 2);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "open-problems-filter",
      );
    }
    const browser = setup.renderer.root.findDescendantById("problems-browser")!;
    browser.focus();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await parsedEnter(setup);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("problems-browser");
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    await parsedEnter(setup);
    await openReaderTab(setup, 2);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("team/guide");
    expect(setup.captureCharFrame()).not.toContain("wrong-owner.jsonc");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER narrow Problems handoff reads the exact installed subject and Escape restores Problems", async () => {
  const loads: string[] = [];
  const base = readerProjection();
  const problem = {
    code: "SOURCE_NOT_FOUND",
    severity: "warning" as const,
    message: "owner source is unavailable",
    subject: {
      kind: "installed-skill" as const,
      address: { source: "team-main", path: "guide" },
    },
  };
  const projection = {
    ...base,
    diagnostics: [problem],
    installedSkills: [{ ...base.installedSkills[0]!, problems: [problem] }],
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: (_environment: import("@skctl/core").CoreOptions, request) => {
            loads.push(request.address.path);
            return Promise.resolve(readerContent);
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 30 },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    setup.resize(43, 30);
    await openSkillView(setup, "problems");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    const startupLoads = [...loads];
    expect(startupLoads.every((path) => path === "guide")).toBe(true);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect(setup.renderer.root.findDescendantById("skill-inspector-open-reader")).toBeUndefined();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    await openReaderTab(setup, 2);
    await setup.waitForFrame((frame) => frame.includes("team-main/guide"));
    expect(loads.length).toBeGreaterThanOrEqual(startupLoads.length);
    expect(loads).toContain("guide");
    expect(loads.every((path) => path === "guide")).toBe(true);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER invalid Config diagnostic detail preserves exact row selection and native scroll at 120, 80, and 43 columns", async () => {
  const base = workspaceProjection();
  const diagnostics = Array.from({ length: 30 }, (_, index) => ({
    code: "CONFIG_INVALID",
    severity: "warning" as const,
    message: `invalid configuration ${index}`,
    location: {
      file: `/workspace/invalid-${index}.jsonc`,
      pointer: "/agents/opencode",
    },
    subject: {
      kind: "config" as const,
      owner: {
        level: "project" as const,
        file: `/workspace/invalid-${index}.jsonc`,
        pointer: "/agents/opencode",
      },
    },
  }));
  const projection = { ...base, diagnostics };
  expect(problemRows(projection).every((row) => row.intent?.kind === "diagnostic-detail")).toBe(
    true,
  );
  for (const width of [120, 80, 43] as const) {
    const setup = await testRender(
      () => <App core={directSourceCore(projection)} exit={() => {}} />,
      { width, height: 30 },
    );
    try {
      await setup.renderOnce();
      await openSkillView(setup, "problems");
      await setup.renderOnce();
      const browser = setup.renderer.root.findDescendantById(
        "problems-browser",
      ) as SelectRenderable;
      browser.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
      for (let index = 0; index < 7; index++) {
        setup.mockInput.pressArrow("down");
        await setup.renderOnce();
        await setup.waitFor(
          () =>
            (
              setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable
            ).getSelectedIndex() ===
            index + 1,
        );
      }
      setSelectScrollOffset(browser, 4);
      await setup.waitForFrame((frame) => frame.includes("invalid configuration 7"));
      const selected = browser.getSelectedOption()?.value;
      expect(selected).toBeDefined();
      expect(browser.getSelectedIndex()).toBe(7);
      expect(selectScrollOffset(browser)).toBe(4);
      await setup.waitFor(() => browser.getSelectedOption()?.value === selected);
      await parsedEnter(setup);
      const texts = (node: BaseRenderable): string[] => [
        ...(node instanceof TextRenderable ? [node.plainText] : []),
        ...node.getChildren().flatMap(texts),
      ];
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("workspace-diagnostic-detail"),
      );
      await setup.flush();
      const metadata = texts(
        setup.renderer.root.findDescendantById("workspace-diagnostic-detail")!,
      );
      expect(metadata).toContain("/workspace/invalid-7.jsonc");
      expect(metadata).toContain("/agents/opencode");
      expect(metadata).toContain("invalid configuration 7");
      const detailFrame = setup.captureCharFrame();
      expect(
        detailFrame
          .split("\n")
          .map((line) => line.replace(/^[ │]+|[ │]+$/g, ""))
          .join(" ")
          .replace(/\s+/g, " "),
      ).toContain("Mutations are disabled until this Config is valid and readable.");
      expect(detailFrame).toContain("Esc");
      expect(setup.renderer.root.findDescendantById("config-operation-review")).toBeUndefined();
      await parsedEscape(setup);
      await setup.waitFor(
        () =>
          !!setup.renderer.root.findDescendantById("problems-browser") &&
          !setup.renderer.root.findDescendantById("workspace-diagnostic-detail") &&
          !setup.renderer.root.findDescendantById("route-back") &&
          setup.renderer.currentFocusedRenderable?.id === "problems-browser",
      );
      const restored = setup.renderer.root.findDescendantById(
        "problems-browser",
      ) as SelectRenderable;
      await setup.renderOnce();
      const current = setup.renderer.root.findDescendantById(
        "problems-browser",
      ) as SelectRenderable;
      expect(current).toBeDefined();
      expect(current.getSelectedOption()?.value).toBe(selected);
      expect(selectScrollOffset(current)).toBe(4);
      expect(setup.renderer.root.findDescendantById("workspace-diagnostic-detail")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("problems-browser");
      expect(setup.renderer.currentFocusedRenderable === current).toBe(true);
      expect(setup.renderer.currentFocusedRenderable === restored).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  }
});
test("RENDER unavailable Agent access routes to authoritative Problems without inventing a repair", async () => {
  const base = readerProjection();
  const problem = {
    code: "CONFIG_INVALID",
    severity: "warning" as const,
    message: "Collection Use is unavailable",
    subject: {
      kind: "installed-skill" as const,
      address: { source: "team-main", path: "guide" },
    },
  };
  const readOnlyProblem = {
    code: "CONFIG_INVALID",
    severity: "info" as const,
    message: "No owner is available",
  };
  const projection = {
    ...base,
    diagnostics: [],
    effective: {
      ...base.effective,
      status: "unavailable" as const,
      reasons: [problem, readOnlyProblem],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "agent");
    expect(
      setup.renderer.root.findDescendantById("current-exposure-enable-managed-opencode"),
    ).toBeUndefined();
    await openMainPage(setup, "skills");
    await enterLive(setup, "skills-view-tab-problems");
    await focusLive(setup, "problems-browser");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "problems-browser");
    const diagnostics = setup.renderer.root.findDescendantById(
      "problems-browser",
    ) as SelectRenderable;
    expect(diagnostics).toBeDefined();
    expect(diagnostics.options).toHaveLength(2);
    const facts = problemRows(projection);
    const actionable = facts.find((row) => row.message === problem.message)!;
    const readOnly = facts.find((row) => row.message === readOnlyProblem.message)!;
    expect(actionable.intent).toEqual({
      kind: "installed-skill",
      address: problem.subject.address,
    });
    expect(readOnly.intent).toBeUndefined();
    expect(diagnostics.options.map((option) => option.value)).toEqual(facts.map(problemRowKey));
    expect(diagnostics.options.map((option) => option.description?.trimEnd())).toEqual([
      problem.message,
      readOnlyProblem.message,
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER empty Agent Collection Enter stays in the tree and explicit Details returns to its command", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/use/0",
  };
  const projection = {
    ...base,
    configs: [
      base.configs[0]!,
      {
        ...base.configs[1]!,
        direct: {
          ...base.configs[1]!.direct,
          collectionUse: [{ collection: "root", owner }],
        },
      },
    ],
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["root"],
      collectionsView: [
        {
          id: "root",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "agent");
    await focusLive(setup, "current-exposure-browser");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
    );
    const tree = setup.renderer.root.findDescendantById(
      "current-exposure-browser",
    ) as ScrollBoxRenderable;
    await parsedEnter(setup);
    expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
    expect(tree.content.getChildren()).toHaveLength(1);
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeUndefined();
    await enterLive(setup, "agent-access-collection-details");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-members" ||
        setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "agent-access-collection-details",
    );
    expect(setup.renderer.currentFocusedRenderable?.focused).toBe(true);
    expect(setup.captureCharFrame()).toContain("Agent access");
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("current-exposure-browser")).toBeInstanceOf(
      ScrollBoxRenderable,
    );
    const key = JSON.stringify([["root", null]]);
    expect(
      setup.renderer.root.findDescendantById(
        `current-exposure-browser-row-${encodeURIComponent(key)}-name`,
      ),
    ).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("EXPOSURE Unassigned ignores via-Link-only paths but keeps direct and repository-derived memberships assigned", () => {
  const base = workspaceProjection();
  const skill = (
    source: string,
    path: string,
    paths: readonly import("@skctl/core").MemberOriginPath[] = [],
  ) => ({
    address: { source, path },
    name: path,
    description: "",
    owner: { source, health: "healthy" as const },
    collections: paths.length ? [{ id: "linked", entry: path, paths }] : [],
    selectors: [],
    selectorViews: { status: "complete" as const, values: [] },
    aliases: [],
    problems: [],
  });
  const viaLink = skill("team", "linked-only", [
    {
      kind: "via-link" as const,
      links: [{ collection: "outer", linkedCollection: "linked" }],
    },
  ]);
  const direct = skill("team", "direct", [
    { kind: "direct" as const, collection: "docs", entryName: "direct" },
  ]);
  const derived = skill("repo", "derived", [
    {
      kind: "repository-derived" as const,
      repository: "acme/repo",
      source: "repo",
      path: "derived",
    },
  ]);
  expect(unassignedSkills({ ...base, installedSkills: [viaLink, direct, derived] })).toEqual([
    viaLink,
  ]);
});
test("COLLECTION Relations unify Use, Reference, and Link with owners, effects, and provenance", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/root",
  };
  const configSource = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/configSources/team",
  };
  const contribution = {
    ...owner,
    contribution: { configSource, declaration: owner },
  };
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const collection = {
    id: "root",
    declared: [contribution],
    repository: { derived: false, producers: [] },
    members: [],
    references: [
      {
        name: "docs",
        collection: "docs",
        description: "Read docs",
        owner: contribution,
      },
    ],
    links: [{ collection: "shared", owner: contribution }],
  };
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      use: ["root"],
      collectionsView: [collection],
    },
    installedSkills: [
      {
        address: { source: "team", path: "guide" },
        name: "guide",
        description: "",
        owner: { source: "team", health: "healthy" as const },
        collections: [],
        selectors: ["root:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "root:guide",
              collection: "root",
              entry: "guide",
              paths: [
                {
                  kind: "via-link" as const,
                  links: [
                    {
                      collection: "root",
                      linkedCollection: "shared",
                      owner: contribution,
                    },
                  ],
                },
              ],
              useOwners: [contribution],
            },
          ],
        },
        aliases: [],
        primary: "root:guide",
        problems: [],
      },
    ],
  };
  expect(collectionRelationRows("root", projection)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "collection-use",
        owner: contribution,
        effect: expect.stringContaining("1 selector"),
      }),
      expect.objectContaining({
        kind: "collection-reference",
        target: "docs",
        effect: "Browse referenced Collection",
      }),
      expect.objectContaining({
        kind: "collection-link",
        target: "shared",
        effect: expect.stringContaining("1 selector"),
      }),
    ]),
  );
  expect(collectionRelationRows("root", projection).map((row) => row.owner?.contribution)).toEqual([
    contribution.contribution,
    contribution.contribution,
    contribution.contribution,
  ]);
});
test("COLLECTION Relations retain an authoritative empty Collection Use owner", () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/use/0",
  };
  const projection = {
    ...base,
    configs: [
      {
        ...base.configs[0]!,
        direct: {
          ...base.configs[0]!.direct,
          collectionUse: [{ collection: "empty", owner }],
        },
      },
    ],
    effective: {
      ...base.effective,
      use: ["empty"],
      collectionsView: [
        {
          id: "empty",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: [],
  };
  expect(collectionRelationRows("empty", projection)).toContainEqual(
    expect.objectContaining({
      kind: "collection-use",
      owner,
      effect: "0 selectors exposed",
      intent: { kind: "collection-use", collection: "empty", owner },
    }),
  );
});
test("FILTER Collection values are exact structural and explicit booleans", () => {
  const owner = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/collections/docs",
  };
  const collection = {
    id: "docs",
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [{ name: "guide", address: { source: "team", path: "guide" }, paths: [] }],
    references: [],
    links: [],
  };
  expect(collectionFilterValues("Contains Skill", [collection])).toEqual([
    skillAddressKey({ source: "team", path: "guide" }),
  ]);
  expect(collectionFilterValues("Config", [collection])).toEqual(["global"]);
  expect(collectionFilterValues("Problems", [collection])).toEqual(["Has problems", "No problems"]);
  expect(collectionFilterValues("Problems", [collection])).toEqual(["Has problems", "No problems"]);
});
test("FILTER Collection Use is exposed as the user-visible Exposure dimension", () => {
  const collections = [
    {
      id: "exposed",
      declared: [],
      repository: { derived: false, producers: [] },
      members: [],
      references: [],
      links: [],
    },
    {
      id: "hidden",
      declared: [],
      repository: { derived: false, producers: [] },
      members: [],
      references: [],
      links: [],
    },
  ];
  expect(collectionFilterDimensions).toContain("Exposure");
  expect(collectionFilterDimensions).not.toContain("For agents");
  expect(collectionFilterValues("Exposure", collections)).toEqual(["Included", "Excluded"]);
  expect(
    filterCollections(collections, {
      filters: { Exposure: "Included" },
      agentUse: ["exposed"],
    }).map((collection) => collection.id),
  ).toEqual(["exposed"]);
  expect(
    filterCollections(collections, {
      filters: { Exposure: "Excluded" },
      agentUse: ["exposed"],
    }).map((collection) => collection.id),
  ).toEqual(["hidden"]);
});
test("RENDER Collection producer Open Source navigates to its owning Source", async () => {
  const loads: string[] = [];
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collections: ["engineering"],
      collectionsView: [
        {
          id: "engineering",
          declared: [],
          repository: { derived: true, producers: [readerSecondAddress] },
          members: [
            {
              name: "reference",
              address: readerSecondAddress,
              paths: [
                {
                  kind: "repository-derived" as const,
                  repository: "acme/main",
                  source: readerSecondAddress.source,
                  path: readerSecondAddress.path,
                },
              ],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: (_environment: import("@skctl/core").CoreOptions, request) => {
            loads.push(request.address.path);
            const result =
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent;
            return Promise.resolve(result);
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.flush();
    const startupLoads = [...loads];
    await navigateToCollections(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    expect(setup.captureCharFrame()).toContain("engineering");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeDefined();
    await enterLive(setup, "collection-current-details");
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Target  team-main/reference"));
    expect(setup.renderer.root.findDescendantById("collection-membership-inspector")).toBeDefined();
    expect(loads).toEqual(startupLoads);
    expect(!!setup.renderer.root.findDescendantById("membership.open-skill")).toBe(false);
    expect(loads).toEqual(startupLoads);
    const openSource = setup.renderer.root.findDescendantById("membership.open-source");
    expect(openSource?.id).toBe("membership.open-source");
    await enterLive(setup, "membership.open-source");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    expect(setup.captureCharFrame()).toContain(readerSecondAddress.source);
    expect(loads).toEqual(startupLoads);
  } finally {
    setup.renderer.destroy();
  }
});
