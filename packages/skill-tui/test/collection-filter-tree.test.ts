import { expect, test } from "bun:test";
import type { CollectionView, ManagementProjection } from "@skill-cli/core";
import {
  collectionFilterPathAncestors,
  collectionFilterPathKey,
  deriveCollectionFilterTree,
  findCollectionFilterPath,
} from "../src/collections/collection-filter-tree";
import { readerProjection } from "./installed-reader.fixture";

const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections" };
const view = (id: string, references: readonly string[] = []): CollectionView => ({
  id,
  description: `${id} description`,
  declared: [owner],
  repository: { derived: false, producers: [] },
  members: [],
  references: references.map((collection) => ({
    name: `to-${collection}`,
    collection,
    description: `Reference to ${collection}`,
    owner,
  })),
  links: [],
});
function projection(collectionViews: readonly CollectionView[]): ManagementProjection {
  const base = readerProjection();
  return {
    ...base,
    effective: {
      status: "complete",
      sources: [],
      collections: collectionViews.map(({ id }) => id),
      collectionsView: collectionViews,
      use: [],
      managed: false,
      agent: { ...base.effective.agent, status: "unavailable" },
    },
  };
}
const rows = (source: ManagementProjection, expanded: Readonly<Record<string, boolean>> = {}) => {
  const tree = deriveCollectionFilterTree(source, expanded);
  if (tree.status !== "available") throw new Error(tree.reason);
  return tree.rows;
};

test("inventory is independent of Use and materialises only expanded immediate layers", () => {
  const source = projection([
    view("parent", ["child"]),
    view("child", ["grandchild"]),
    view("grandchild"),
  ]);
  const initial = rows(source);
  expect(initial.map(({ kind, collection }) => [kind, collection])).toEqual([
    ["collection", "parent"],
  ]);
  const parent = initial[0]!;
  expect(parent).toMatchObject({ expandable: true, depth: 0, description: "parent description" });
  const expanded = { [parent.key]: true };
  const layer = rows(source, expanded);
  expect(layer.map(({ collection }) => collection)).toEqual(["parent", "child"]);
  const child = layer[1]!;
  expect(child).toMatchObject({
    kind: "reference",
    name: "to-child",
    parentKey: parent.key,
    depth: 1,
    description: "Reference to child",
  });
  expect(
    rows(source, { ...expanded, [child.key]: true }).map(({ collection }) => collection),
  ).toEqual(["parent", "child", "grandchild"]);
  // An expanded descendant does not force a collapsed ancestor open.
  expect(rows(source, { [child.key]: true })).toEqual(initial);
  expect(expanded).toEqual({ [parent.key]: true });
});

test("member-only Collections have no arrow and direct or Link members never become tree entries", () => {
  const base = readerProjection();
  const direct = base.installedSkills[0]!;
  const linked = base.installedSkills[1]!;
  const source = projection([
    {
      ...view("parent"),
      links: [{ collection: "link-target", owner }],
      members: [
        { name: "direct", address: direct.address, paths: [] },
        { name: "linked", address: linked.address, paths: [] },
        { name: "missing", address: { source: "gone", path: "guide" }, paths: [] },
      ],
    },
    view("link-target", ["not-a-link-level"]),
    view("not-a-link-level"),
  ]);
  const changed = {
    ...source,
    installedSkills: [
      direct,
      { ...linked, owner: { ...linked.owner, health: "drifted" as const } },
    ],
  };
  const parent = rows(changed).find((row) => row.collection === "parent")!;
  expect(parent).toMatchObject({ kind: "collection", expandable: false });
  expect(parent.issue).toBeUndefined();
  expect(rows(changed, { [parent.key]: true })).toEqual(rows(changed));
  const linkTarget = rows(changed).find((row) => row.collection === "link-target")!;
  const visible = rows(changed, { [parent.key]: true, [linkTarget.key]: true });
  expect(visible.map(({ kind, collection }) => [kind, collection])).toEqual([
    ["collection", "link-target"],
    ["reference", "not-a-link-level"],
    ["collection", "parent"],
  ]);
  expect(visible.every((row) => row.kind === "collection" || row.kind === "reference")).toBe(true);
  expect(visible.every((row) => !("address" in row))).toBe(true);
  expect(rows({ ...changed, installedSkills: [] }, { [linkTarget.key]: true })).toEqual(visible);
});

test("Reference targets with only effective members are visible but not expandable", () => {
  const member = readerProjection().installedSkills[0]!;
  const source = projection([
    view("parent", ["member-child", "empty-child"]),
    {
      ...view("member-child"),
      members: [{ name: "guide", address: member.address, paths: [] }],
    },
    view("empty-child"),
  ]);
  const parent = rows(source)[0]!;
  const visible = rows(source, { [parent.key]: true });
  expect(visible.map(({ kind, collection, expandable }) => [kind, collection, expandable])).toEqual(
    [
      ["collection", "parent", true],
      ["reference", "empty-child", false],
      ["reference", "member-child", false],
    ],
  );
  const expanded = Object.fromEntries(visible.map(({ key }) => [key, true]));
  expect(rows(source, expanded)).toEqual(visible);
  expect(visible.every((row) => !row.issue)).toBe(true);
});

test("diamonds preserve separate paths, parent keys and ancestor expansion keys", () => {
  const source = projection([
    view("root", ["left", "right"]),
    view("left", ["leaf"]),
    view("right", ["leaf"]),
    view("leaf"),
  ]);
  const root = rows(source)[0]!;
  const branches = rows(source, { [root.key]: true }).filter((row) => row.kind === "reference");
  const expanded = Object.fromEntries([root, ...branches].map((row) => [row.key, true]));
  const leaves = rows(source, expanded).filter((row) => row.collection === "leaf");
  expect(leaves).toHaveLength(2);
  expect(leaves[0]!.key).not.toBe(leaves[1]!.key);
  expect(leaves.map(({ parentKey }) => parentKey)).toEqual(branches.map(({ key }) => key));
  for (const leaf of leaves) {
    expect(collectionFilterPathKey(leaf.path)).toBe(leaf.key);
    expect(collectionFilterPathAncestors(leaf.path)).toEqual([root.key, leaf.parentKey!]);
  }
  if (source.effective.status !== "complete") throw new Error("complete fixture required");
  const reordered = projection([...source.effective.collectionsView].reverse());
  expect(rows(reordered, expanded).map(({ key }) => key)).toEqual(
    rows(source, expanded).map(({ key }) => key),
  );
});

test("multiple named References to one target have separate stable structural identities", () => {
  const source = projection([
    {
      ...view("root"),
      references: [
        { name: "first/route", collection: "child", description: "First route", owner },
        { name: "second:route", collection: "child", description: "Second route", owner },
      ],
    },
    view("child"),
  ]);
  const root = rows(source)[0]!;
  const references = rows(source, { [root.key]: true }).filter((row) => row.kind === "reference");
  expect(references).toHaveLength(2);
  expect(new Set(references.map(({ key }) => key)).size).toBe(2);
  expect(references.map(({ collection }) => collection)).toEqual(["child", "child"]);
  expect(references.map(({ description }) => description)).toEqual(["First route", "Second route"]);
  expect(
    collectionFilterPathKey({
      segments: [
        { collection: "root" },
        { collection: "child", reference: { target: "child", name: "first/route" } },
      ],
    }),
  ).toBe(references[0]!.key);
});

test("non-Use, disconnected and entrance-free cycle components all receive roots", () => {
  const source = projection([
    view("used", ["used-child"]),
    view("used-child"),
    view("unexposed", ["private-child"]),
    view("private-child"),
    view("disconnected"),
    view("cycle-a", ["cycle-b"]),
    view("cycle-b", ["cycle-a"]),
    view("self", ["self"]),
  ]);
  if (source.effective.status !== "complete") throw new Error("complete fixture required");
  const withUse = { ...source, effective: { ...source.effective, use: ["used"] } };
  const roots = rows(withUse);
  expect(roots.map(({ collection }) => collection)).toEqual([
    "cycle-a",
    "disconnected",
    "self",
    "unexposed",
    "used",
  ]);
  const expanded = Object.fromEntries(roots.map(({ key }) => [key, true]));
  const layer = rows(withUse, expanded);
  const cycleB = layer.find((row) => row.collection === "cycle-b")!;
  const visible = rows(withUse, { ...expanded, [cycleB.key]: true });
  expect(new Set(visible.map(({ collection }) => collection))).toEqual(
    new Set(source.effective.collections),
  );
  const cycles = visible.filter((row) => row.cycle);
  expect(cycles.map(({ collection }) => collection)).toEqual(["cycle-a", "self"]);
  expect(cycles.every((row) => !row.expandable && !!row.issue)).toBe(true);
  const attempt = {
    ...expanded,
    [cycleB.key]: true,
    ...Object.fromEntries(cycles.map(({ key }) => [key, true])),
  };
  expect(rows(withUse, attempt)).toEqual(visible);
});

test("external Collection selection resolves its first deterministic actual Reference path", () => {
  const source = projection([
    view("root", ["right", "left"]),
    view("left", ["leaf"]),
    view("right", ["leaf"]),
    view("leaf"),
  ]);
  const match = findCollectionFilterPath(source, "leaf");
  expect(match?.path.segments).toEqual([
    { collection: "root" },
    { collection: "left", reference: { name: "to-left", target: "left" } },
    { collection: "leaf", reference: { name: "to-leaf", target: "leaf" } },
  ]);
  if (!match) throw new Error("expected inventory path");
  const visible = rows(source, Object.fromEntries(match.ancestorKeys.map((key) => [key, true])));
  expect(visible.find((row) => row.key === collectionFilterPathKey(match.path))).toMatchObject({
    kind: "reference",
    collection: "leaf",
  });
  expect(findCollectionFilterPath(source, "root")).toEqual({
    path: { segments: [{ collection: "root" }] },
    ancestorKeys: [],
  });
  expect(findCollectionFilterPath(source, "root/not-a-reference")).toBeUndefined();
  if (source.effective.status !== "complete") throw new Error("complete fixture required");
  expect(
    findCollectionFilterPath(projection([...source.effective.collectionsView].reverse()), "leaf"),
  ).toEqual(match);
});

test("path lookup handles cyclic, disconnected and missing-reference inventory without Link traversal", () => {
  const source = projection([
    view("cycle-a", ["cycle-b"]),
    view("cycle-b", ["cycle-a"]),
    {
      ...view("root", ["unknown"]),
      links: [{ collection: "link-only", owner }],
    },
    view("disconnected"),
    view("link-only"),
  ]);
  expect(findCollectionFilterPath(source, "cycle-b")?.path.segments).toEqual([
    { collection: "cycle-a" },
    { collection: "cycle-b", reference: { name: "to-cycle-b", target: "cycle-b" } },
  ]);
  expect(findCollectionFilterPath(source, "disconnected")?.ancestorKeys).toEqual([]);
  expect(findCollectionFilterPath(source, "link-only")?.path.segments).toEqual([
    { collection: "link-only" },
  ]);
  expect(findCollectionFilterPath(source, "unknown")?.path.segments).toEqual([
    { collection: "root" },
    { collection: "unknown", reference: { name: "to-unknown", target: "unknown" } },
  ]);
  expect(findCollectionFilterPath(source, "absent")).toBeUndefined();
  expect(findCollectionFilterPath(undefined, "root")).toBeUndefined();
  if (source.effective.status !== "complete") throw new Error("complete fixture required");
  expect(
    findCollectionFilterPath(
      {
        ...source,
        effective: {
          status: "unavailable",
          reasons: [],
          sources: [],
          collections: ["root"],
          agent: source.effective.agent,
        },
      },
      "root",
    ),
  ).toBeUndefined();
});

test("unknown references and unavailable effective inventory explain issues rather than using stale facts", () => {
  const source = projection([view("root", ["unknown"])]);
  const root = rows(source)[0]!;
  expect(rows(source, { [root.key]: true })[1]).toMatchObject({
    kind: "reference",
    collection: "unknown",
    expandable: false,
    issue: "Collection 'unknown' is unavailable",
  });
  if (source.effective.status !== "complete") throw new Error("complete fixture required");
  const declaredMissing = {
    ...source,
    effective: { ...source.effective, collections: ["root", "absent-view"] },
  };
  expect(rows(declaredMissing).find((row) => row.collection === "absent-view")).toMatchObject({
    kind: "collection",
    expandable: false,
    issue: "Collection 'absent-view' is unavailable",
  });
  expect(deriveCollectionFilterTree(undefined)).toMatchObject({ status: "unavailable", rows: [] });
  expect(
    deriveCollectionFilterTree({
      ...source,
      effective: {
        status: "unavailable",
        reasons: [],
        sources: [],
        collections: ["root"],
        agent: source.effective.agent,
      },
    }),
  ).toMatchObject({ status: "unavailable", rows: [] });
});
