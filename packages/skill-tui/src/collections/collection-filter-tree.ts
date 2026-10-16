import type { CollectionView, ManagementProjection } from "@skill-cli/core";

/** All Skills classification follows References, never ID prefixes or Link edges. */
export function collectionDescendants(
  collectionViews: readonly CollectionView[],
  collection: string,
): ReadonlySet<string> {
  const views = new Map(collectionViews.map((view) => [view.id, view]));
  const descendants = new Set<string>();
  const pending = [collection];
  while (pending.length) {
    const id = pending.pop()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    for (const reference of views.get(id)?.references ?? []) pending.push(reference.collection);
  }
  return descendants;
}

export interface CollectionFilterPath {
  readonly segments: readonly {
    readonly collection: string;
    readonly reference?: { readonly name: string; readonly target: string };
  }[];
}

/** Paths, not Collection IDs, own expansion: shared Reference targets have separate branches. */
export const collectionFilterPathKey = (path: CollectionFilterPath): string =>
  JSON.stringify(
    path.segments.map(({ collection, reference }) => [
      collection,
      reference?.name ?? null,
      reference?.target ?? null,
    ]),
  );

/** Open these ancestors to reveal a selected path; do not expand the selected node itself. */
export const collectionFilterPathAncestors = (path: CollectionFilterPath): readonly string[] =>
  path.segments
    .slice(1)
    .map((_, index) => collectionFilterPathKey({ segments: path.segments.slice(0, index + 1) }));

export interface CollectionFilterTreeRow {
  readonly key: string;
  readonly parentKey?: string;
  readonly path: CollectionFilterPath;
  readonly depth: number;
  readonly name: string;
  readonly collection: string;
  readonly description?: string;
  readonly issue?: string;
  readonly kind: "collection" | "reference";
  readonly expandable: boolean;
  readonly cycle?: boolean;
}

export type CollectionFilterTree =
  | { readonly status: "unavailable"; readonly reason: string; readonly rows: readonly [] }
  | { readonly status: "available"; readonly rows: readonly CollectionFilterTreeRow[] };

function inventoryRoots(
  views: ReadonlyMap<string, CollectionView>,
  ids: readonly string[],
): string[] {
  const referenced = new Set(
    [...views.values()].flatMap((view) => view.references.map((reference) => reference.collection)),
  );
  const roots = ids.filter((id) => !referenced.has(id));
  const covered = new Set<string>();
  const cover = (root: string) => {
    const pending = [root];
    while (pending.length) {
      const id = pending.pop()!;
      if (covered.has(id)) continue;
      covered.add(id);
      for (const reference of views.get(id)?.references ?? []) pending.push(reference.collection);
    }
  };
  roots.forEach(cover);
  // Components without an entrance (including cycles) still get a deterministic root.
  for (const id of ids) {
    if (covered.has(id)) continue;
    roots.push(id);
    cover(id);
  }
  return roots.sort((a, b) => a.localeCompare(b));
}

const inventoryIds = (
  collections: readonly string[],
  views: ReadonlyMap<string, CollectionView>,
): readonly string[] =>
  [...new Set([...collections, ...views.keys()])].sort((a, b) => a.localeCompare(b));

const sortedReferences = (view: CollectionView): readonly CollectionView["references"][number][] =>
  [...view.references].sort(
    (a, b) => a.name.localeCompare(b.name) || a.collection.localeCompare(b.collection),
  );

/** First inventory preorder path, visiting each Collection once instead of enumerating graph paths. */
export function findCollectionFilterPath(
  projection: ManagementProjection | undefined,
  collection: string,
): { readonly path: CollectionFilterPath; readonly ancestorKeys: readonly string[] } | undefined {
  if (!projection || projection.effective.status !== "complete") return undefined;
  const views = new Map(projection.effective.collectionsView.map((view) => [view.id, view]));
  const roots = inventoryRoots(views, inventoryIds(projection.effective.collections, views));
  const visited = new Set<string>();
  for (const root of roots) {
    const pending: CollectionFilterPath[] = [{ segments: [{ collection: root }] }];
    while (pending.length) {
      const path = pending.pop()!;
      const id = path.segments[path.segments.length - 1]!.collection;
      if (visited.has(id)) continue;
      visited.add(id);
      if (id === collection) return { path, ancestorKeys: collectionFilterPathAncestors(path) };
      const view = views.get(id);
      if (!view) continue;
      for (const reference of [...sortedReferences(view)].reverse())
        pending.push({
          segments: [
            ...path.segments,
            {
              collection: reference.collection,
              reference: { name: reference.name, target: reference.collection },
            },
          ],
        });
    }
  }
  return undefined;
}

/**
 * Entire effective inventory, independent of Use or Agent availability. Only expanded paths
 * materialise Reference children. Skills belong in the middle list; members and Links add no level.
 */
export function deriveCollectionFilterTree(
  projection: ManagementProjection | undefined,
  expanded: Readonly<Record<string, boolean>> | "all" = {},
): CollectionFilterTree {
  if (!projection || projection.effective.status !== "complete")
    return {
      status: "unavailable",
      reason: "Collection inventory is unavailable until the workspace projection is complete",
      rows: [],
    };

  const views = new Map(projection.effective.collectionsView.map((view) => [view.id, view]));
  const ids = inventoryIds(projection.effective.collections, views);
  const rows: CollectionFilterTreeRow[] = [];

  const append = (
    path: CollectionFilterPath,
    ancestors: ReadonlySet<string>,
    parentKey?: string,
    reference?: CollectionView["references"][number],
  ) => {
    const collection = path.segments[path.segments.length - 1]!.collection;
    const view = views.get(collection);
    const key = collectionFilterPathKey(path);
    const depth = path.segments.length - 1;
    const cycle = ancestors.has(collection);
    const expandable = !cycle && !!view && view.references.length > 0;
    rows.push({
      kind: reference ? "reference" : "collection",
      key,
      parentKey,
      path,
      depth,
      name: reference?.name ?? collection,
      collection,
      description: reference?.description ?? view?.description,
      expandable,
      cycle,
      issue: cycle
        ? `Reference cycle returns to Collection '${collection}'`
        : !view
          ? `Collection '${collection}' is unavailable`
          : undefined,
    });
    if (!view || !expandable || (expanded !== "all" && !expanded[key])) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(collection);
    for (const child of sortedReferences(view)) {
      append(
        {
          segments: [
            ...path.segments,
            {
              collection: child.collection,
              reference: { name: child.name, target: child.collection },
            },
          ],
        },
        nextAncestors,
        key,
        child,
      );
    }
  };

  for (const root of inventoryRoots(views, ids))
    append({ segments: [{ collection: root }] }, new Set());
  return { status: "available", rows };
}
