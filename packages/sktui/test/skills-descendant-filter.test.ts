import { expect, test } from "bun:test";
import { skillAddressKey, type CollectionView } from "@skctl/core";
import { collectionDescendants } from "../src/collections/collection-filter-tree";
import { filterSkills, filterValues } from "../src/skills-filter";
import { createWorkspaceState } from "../src/workspace/state";
import { unassignedSkills } from "../src/collections/state";
import type { InstalledSkill } from "../src/types";
import { readerProjection } from "./installed-reader.fixture";

const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections" };
const skill = (path: string, collections: readonly string[] = []): InstalledSkill => ({
  ...readerProjection().installedSkills[0]!,
  address: { source: "team-main", path },
  name: path,
  description: "A searchable guide",
  collections: collections.map((id) => ({ id, entry: path, paths: [] })),
});
const view = (
  id: string,
  references: readonly string[] = [],
  members: readonly InstalledSkill[] = [],
): CollectionView => ({
  id,
  declared: [owner],
  repository: { derived: false, producers: [] },
  references: references.map((collection) => ({
    name: collection,
    collection,
    description: "",
    owner,
  })),
  members: members.map(({ name, address }) => ({ name, address, paths: [] })),
  links: [],
});

test("Collection and Unassigned browsing never prune checked installed addresses", () => {
  const assigned: InstalledSkill = {
    ...skill("guide", ["child"]),
    collections: [
      {
        id: "child",
        entry: "guide",
        paths: [
          {
            kind: "direct",
            collection: "child",
            entryName: "guide",
            owner: { ...owner, pointer: "/collections/child/entries/guide" },
          },
        ],
      },
    ],
  };
  const unassigned = skill("reference");
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  const projection = {
    ...base,
    installedSkills: [assigned, unassigned],
    effective: {
      ...base.effective,
      collectionsView: [view("root", ["child"]), view("child", [], [assigned])],
    },
  };
  expect(unassignedSkills(projection)).toEqual([unassigned]);
  const state = createWorkspaceState();
  state.selectSkillsView("all-installed-skills");
  state.toggleSkill(assigned.address);
  state.toggleSkill(unassigned.address);
  state.selectSkillsView("unassigned");
  state.reconcile(projection, projection);
  expect(state.selectedSkills()).toEqual([assigned.address, unassigned.address]);
  state.selectSkillsView("all-installed-skills");
  state.setFilter("Collection", "child");
  state.reconcile(projection, projection);
  expect(state.selectedSkill()).toEqual(assigned.address);
  expect(state.selectedSkills()).toEqual([assigned.address, unassigned.address]);
});

test("Reference-only parents filter descendants while legacy callers keep exact membership", () => {
  const childSkill = skill("child-guide", ["child"]);
  const unrelated = skill("other-guide", ["parent/unrelated"]);
  const skills = [childSkill, unrelated];
  const collectionViews = [view("parent", ["child"]), view("child", [], [childSkill])];
  expect(filterSkills(skills, { filters: { Collection: "parent" } })).toEqual([]);
  expect(filterSkills(skills, { filters: { Collection: "parent" }, collectionViews })).toEqual([
    childSkill,
  ]);
  expect(filterValues(skills, "Collection", undefined, { collectionViews })).toEqual([
    "child",
    "parent",
    "parent/unrelated",
  ]);
});

test("direct and Link-effective members are included without traversing Link References", () => {
  const direct = skill("direct", ["parent"]);
  const linked = skill("linked"); // Effective view membership is sufficient, even without reverse facts.
  const membershipOnly = skill("reverse-fact", ["parent"]);
  const notLinked = skill("not-linked", ["link-grandchild"]);
  const collectionViews = [
    { ...view("parent", [], [direct, linked]), links: [{ collection: "link-target", owner }] },
    view("link-target", ["link-grandchild"], [linked]),
    view("link-grandchild", [], [notLinked]),
  ];
  expect(
    filterSkills([direct, linked, membershipOnly, notLinked], {
      filters: { Collection: "parent" },
      collectionViews,
    }),
  ).toEqual([direct, linked, membershipOnly]);
  expect([...collectionDescendants(collectionViews, "parent")]).toEqual(["parent"]);
});

test("diamonds and repeated installed rows yield one original object per SkillAddress", () => {
  const shared = skill("shared", ["leaf"]);
  const direct = skill("direct", ["root"]);
  const duplicate = { ...shared, name: "duplicate representation" };
  const collectionViews = [
    view("root", ["left", "right"], [direct]),
    view("left", ["leaf"]),
    view("right", ["leaf"]),
    view("leaf", [], [shared]),
  ];
  const filtered = filterSkills([shared, direct, duplicate], {
    filters: { Collection: "root" },
    collectionViews,
  });
  expect(filtered).toEqual([shared, direct]);
  expect(filtered[0]).toBe(shared);
  expect(filtered[1]).toBe(direct);
});

test("cycles and unknown targets terminate and unknown IDs preserve known membership", () => {
  const member = skill("guide", ["b"]);
  const stale = skill("stale", ["unknown"]);
  const collectionViews = [view("a", ["b", "unknown"]), view("b", ["a"], [member])];
  expect([...collectionDescendants(collectionViews, "a")].sort()).toEqual(["a", "b", "unknown"]);
  expect(filterSkills([member, stale], { filters: { Collection: "a" }, collectionViews })).toEqual([
    member,
    stale,
  ]);
  expect(
    filterSkills([member, stale], { filters: { Collection: "unknown" }, collectionViews }),
  ).toEqual([stale]);
  expect(filterSkills([member], { filters: { Collection: "missing" }, collectionViews })).toEqual(
    [],
  );
});

test("Collection facets retain query, Source context and other dimensions, including zero-count values", () => {
  const unhealthy = {
    ...skill("audit", ["child"]),
    owner: { source: "team-main", health: "missing" as const },
  };
  const healthy = skill("audit-healthy", ["child"]);
  const otherSource = {
    ...unhealthy,
    address: { source: "other", path: "audit" },
    owner: { source: "other", health: "missing" as const },
  };
  const differentQuery = {
    ...unhealthy,
    address: { source: "team-main", path: "writing" },
    name: "writing",
    description: "writing",
    collections: [{ id: "child", entry: "writing", paths: [] }],
  };
  const collectionViews = [
    view("parent", ["child"]),
    view("child", [], [unhealthy]),
    view("empty"),
  ];
  const state = {
    query: "audit",
    source: "team-main",
    collectionViews,
    filters: { Collection: "parent", Config: "project", Problems: "Has problems" },
  };
  const skills = [unhealthy, healthy, otherSource, differentQuery];
  expect(filterSkills(skills, state)).toEqual([unhealthy]);
  const { Collection: _collection, ...otherFilters } = state.filters;
  const facet = filterSkills(skills, { ...state, filters: otherFilters });
  const count = (Collection: string) =>
    filterSkills(facet, {
      collectionViews,
      filters: Collection ? { Collection } : {},
    }).length;
  expect(count("parent")).toBe(1);
  expect(count("child")).toBe(1);
  expect(count("empty")).toBe(0);
  expect(count("")).toBe(1);
  expect(
    filterValues(facet, "Collection", undefined, {
      collectionViews,
      filters: { Collection: "removed-applied" },
    }),
  ).toEqual(["child", "empty", "parent", "removed-applied"]);
  expect(filterValues([], "Source", undefined, { filters: { Source: "other" } })).toEqual([
    "other",
  ]);
  expect(filterValues(facet, "Config", undefined, { collectionViews })).toEqual(["project"]);
  expect(filterValues(facet, "Source", undefined, { collectionViews })).toEqual(["team-main"]);
});

test("classification never changes the installed input, Skill objects or batch address identities", () => {
  const child = skill("child", ["child"]);
  const hidden = skill("hidden", ["elsewhere"]);
  const skills = Object.freeze([child, hidden]);
  const checked = Object.freeze(skills.map(({ address }) => address));
  const before = JSON.stringify(skills);
  const collectionViews = [view("parent", ["child"]), view("child", [], [child])];
  const filtered = filterSkills(skills, { collectionViews, filters: { Collection: "parent" } });
  expect(filtered).toEqual([child]);
  expect(filtered[0]!.address).toBe(checked[0]);
  expect(checked.map(skillAddressKey)).toEqual(skills.map((row) => skillAddressKey(row.address)));
  expect(checked[1]).toBe(hidden.address);
  expect(JSON.stringify(skills)).toBe(before);
});

test("replacing Source or Config facets retains descendant Collection and all remaining conditions", () => {
  const child = skill("audit", ["child"]);
  const other = {
    ...child,
    address: { source: "other", path: "audit" },
    owner: { source: "other", health: "healthy" as const },
    source: { ...child.source!, provenance: { level: "global" as const } },
  };
  const outside = skill("audit-outside", ["outside"]);
  const collectionViews = [view("parent", ["child"]), view("child", [], [child, other])];
  const conditions = { query: "audit", collectionViews, filters: { Collection: "parent" } };
  const facet = filterSkills([child, other, outside], conditions);
  expect(filterValues(facet, "Source", undefined, conditions)).toEqual(["other", "team-main"]);
  expect(filterSkills(facet, { filters: { Source: "team-main" }, collectionViews })).toEqual([
    child,
  ]);
  expect(filterSkills(facet, { filters: { Source: "other" }, collectionViews })).toEqual([other]);
  expect(filterValues(facet, "Config", undefined, conditions)).toEqual(["global", "project"]);
  expect(filterSkills(facet, { filters: { Config: "global" }, collectionViews })).toEqual([other]);
  expect(filterSkills(facet, { filters: { Config: "project" }, collectionViews })).toEqual([child]);
  // Source context is not the Source facet and is not cleared when that facet is replaced.
  const contextualFacet = filterSkills([child, other, outside], {
    ...conditions,
    source: "team-main",
  });
  expect(filterSkills(contextualFacet, { filters: { Source: "other" }, collectionViews })).toEqual(
    [],
  );
});
