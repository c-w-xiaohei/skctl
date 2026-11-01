import { batch, createSignal } from "solid-js";
import type { ConfigDeclarationOwner, WorkspaceView } from "@skctl/core";
import { filterCollections, type CollectionFilterDimension } from "../collections-filter";
import type { CollectionTab } from "../types";
import { skillAddressKey, type MemberOriginPath } from "@skctl/core";

const ownerFacts = (owner: ConfigDeclarationOwner) => ({
  level: owner.level,
  file: owner.file,
  pointer: owner.pointer,
  namespace: owner.namespace,
  contribution: owner.contribution
    ? {
        configSource: {
          level: owner.contribution.configSource.level,
          file: owner.contribution.configSource.file,
          pointer: owner.contribution.configSource.pointer,
          namespace: owner.contribution.configSource.namespace,
        },
        declaration: {
          level: owner.contribution.declaration.level,
          file: owner.contribution.declaration.file,
          pointer: owner.contribution.declaration.pointer,
          namespace: owner.contribution.declaration.namespace,
        },
      }
    : undefined,
});

/** Stable selection identity for one rendered member origin, including its structural provenance. */
export const collectionOriginKey = (
  collection: string,
  member: {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
  },
  path: MemberOriginPath | undefined,
  originIndex: number,
): string =>
  JSON.stringify([
    collection,
    member.name,
    member.address.source,
    member.address.path,
    path?.kind ?? "unavailable",
    path?.kind === "direct"
      ? [path.collection, path.entryName, path.owner ? ownerFacts(path.owner) : "owner-unavailable"]
      : path?.kind === "repository-derived"
        ? [path.repository, path.source, path.path]
        : path?.kind === "via-link"
          ? path.links.map((link) => [
              link.collection,
              link.linkedCollection,
              link.owner ? ownerFacts(link.owner) : "owner-unavailable",
            ])
          : "unavailable",
    originIndex,
  ]);

export interface CollectionsSnapshot {
  readonly selected?: string;
  readonly selectedPath?: string;
  readonly expandedPaths?: Readonly<Record<string, boolean>>;
  readonly query: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly tabs: Readonly<Record<string, CollectionTab>>;
  readonly selectedRows: Readonly<Record<string, string>>;
  readonly selectedOrigins: Readonly<Record<string, readonly string[]>>;
  readonly filter: {
    readonly open: boolean;
    readonly dimension?: CollectionFilterDimension;
    readonly search: string;
  };
  readonly scrolls: Readonly<Record<string, number>>;
  readonly inspector?:
    | {
        readonly kind: "membership";
        readonly collection: string;
        readonly member: string;
        readonly origin?: string;
      }
    | {
        readonly kind: "relation";
        readonly collection: string;
        readonly relation: string;
      };
}

export interface ExposureRow {
  readonly path: string;
  readonly exposurePath: ExposurePath;
  readonly key: string;
  readonly collection: string;
  readonly depth: number;
  readonly selectorCount: number;
  readonly installedSkillCount: number;
  readonly kind: "use" | "reference";
  readonly referenceName?: string;
}

export interface ExposurePathSegment {
  readonly collection: string;
  readonly reference?: { readonly name: string; readonly target: string };
}

export interface ExposurePath {
  readonly segments: readonly ExposurePathSegment[];
}

export const exposurePathKey = (path: ExposurePath): string =>
  JSON.stringify(path.segments.map((segment) => [segment.collection, segment.reference]));

export const collectionMemberKey = (member: {
  readonly name: string;
  readonly address: { readonly source: string; readonly path: string };
}): string => JSON.stringify([member.name, member.address.source, member.address.path]);

const directOrDerived = (path: MemberOriginPath) =>
  path.kind === "direct" || path.kind === "repository-derived";

export const unassignedSkills = (projection: WorkspaceView) =>
  projection.installedSkills.filter((skill) =>
    skill.collections.every((collection) =>
      collection.paths.every((path) => !directOrDerived(path)),
    ),
  );

const collectionFacts = (projection: WorkspaceView, collection: string) => {
  const skills = new Set<string>();
  let selectors = 0;
  for (const skill of projection.installedSkills) {
    if (skill.owner.health !== "healthy") continue;
    if (skill.selectorViews.status !== "complete") continue;
    for (const view of skill.selectorViews.values) {
      if (view.collection !== collection) continue;
      selectors += 1;
      skills.add(skillAddressKey(skill.address));
    }
  }
  return { selectorCount: selectors, installedSkillCount: skills.size };
};

export const exposureHierarchy = (projection: WorkspaceView): readonly ExposureRow[] => {
  if (projection.effective.status !== "complete" || projection.effective.use.length === 0)
    return [];
  const collections = new Map(projection.effective.collectionsView.map((item) => [item.id, item]));
  const rows: ExposureRow[] = [];
  const visit = (
    collection: string,
    path: string,
    depth: number,
    ancestors: ReadonlySet<string>,
    exposurePath: ExposurePath,
  ) => {
    const view = collections.get(collection);
    if (!view || ancestors.has(collection)) return;
    const facts = collectionFacts(projection, collection);
    rows.push({
      path,
      exposurePath,
      key: exposurePathKey(exposurePath),
      collection,
      depth,
      ...facts,
      kind: exposurePath.segments.length === 1 ? "use" : "reference",
      referenceName: exposurePath.segments.at(-1)?.reference?.name,
    });
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(collection);
    for (const reference of view.references)
      visit(reference.collection, `${path}/${reference.name}`, depth + 1, nextAncestors, {
        segments: [
          ...exposurePath.segments,
          {
            collection: reference.collection,
            reference: { name: reference.name, target: reference.collection },
          },
        ],
      });
  };
  for (const root of [...projection.effective.use].sort())
    visit(root, root, 0, new Set(), { segments: [{ collection: root }] });
  return rows;
};

export const currentExposureRows = exposureHierarchy;

/** Visible native-browser rows. Roots are open to their first Reference by default. */
export const visibleExposureRows = (
  projection: WorkspaceView,
  expanded: Readonly<Record<string, boolean>> = {},
): readonly ExposureRow[] => {
  const rows = exposureHierarchy(projection);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return rows.filter((row) =>
    row.exposurePath.segments.slice(1).every((_, index) => {
      const key = exposurePathKey({ segments: row.exposurePath.segments.slice(0, index + 1) });
      const ancestor = byKey.get(key);
      return ancestor !== undefined && (expanded[key] ?? ancestor.depth === 0) === true;
    }),
  );
};

const nearest = (
  selected: string | undefined,
  values: readonly string[],
  previous: readonly string[],
) =>
  selected && values.includes(selected)
    ? selected
    : values[Math.min(values.length - 1, Math.max(0, selected ? previous.indexOf(selected) : -1))];

export function createCollectionsState() {
  const [snapshot, setSnapshot] = createSignal<CollectionsSnapshot>({
    query: "",
    filters: {},
    tabs: {},
    selectedRows: {},
    selectedOrigins: {},
    filter: { open: false, search: "" },
    scrolls: {},
  });
  const update = (change: (current: CollectionsSnapshot) => CollectionsSnapshot) =>
    setSnapshot((current) => {
      const next = change(current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  return {
    snapshot,
    restore(next: CollectionsSnapshot) {
      setSnapshot(structuredClone(next));
    },
    selected: () => snapshot().selected,
    selectedPath: () => snapshot().selectedPath,
    expandedPaths: () => snapshot().expandedPaths ?? {},
    selectPath(selectedPath: string) {
      update((current) => ({ ...current, selectedPath }));
    },
    setPathExpanded(key: string, expanded: boolean) {
      update((current) => ({
        ...current,
        expandedPaths: { ...current.expandedPaths, [key]: expanded },
      }));
    },
    setExpandedPaths(expandedPaths: Readonly<Record<string, boolean>>) {
      update((current) => ({ ...current, expandedPaths }));
    },
    query: () => snapshot().query,
    filters: () => snapshot().filters,
    tab: (collection: string): CollectionTab => snapshot().tabs[collection] ?? "members",
    selectedRow: (collection: string, tab: CollectionTab) =>
      snapshot().selectedRows[`${collection}:${tab}`],
    selectedOrigins: (collection: string) => snapshot().selectedOrigins[collection] ?? [],
    inspector: () => snapshot().inspector,
    filter: () => snapshot().filter,
    scroll: (surface: string) => snapshot().scrolls[surface] ?? 0,
    setScroll(surface: string, scroll: number) {
      const value = Math.max(0, Math.floor(scroll));
      update((current) =>
        current.scrolls[surface] === value
          ? current
          : { ...current, scrolls: { ...current.scrolls, [surface]: value } },
      );
    },
    select(selected?: string) {
      update((current) => ({ ...current, selected }));
    },
    setQuery(query: string) {
      update((current) => ({ ...current, query }));
    },
    setFilter(dimension: string, value?: string) {
      update((current) => ({
        ...current,
        filters: value
          ? { ...current.filters, [dimension]: value }
          : Object.fromEntries(
              Object.entries(current.filters).filter(([key]) => key !== dimension),
            ),
      }));
    },
    clearFilters() {
      update((current) => ({ ...current, query: "", filters: {} }));
    },
    openFilter() {
      update((current) => ({ ...current, filter: { open: true, search: "" } }));
    },
    chooseFilterDimension(dimension?: CollectionFilterDimension) {
      update((current) => ({
        ...current,
        filter: dimension ? { open: true, dimension, search: "" } : { open: true, search: "" },
      }));
    },
    searchFilter(search: string) {
      update((current) => ({
        ...current,
        filter: { ...current.filter, search },
      }));
    },
    closeFilter() {
      update((current) => ({
        ...current,
        filter: { open: false, search: "" },
      }));
    },
    openMembership(collection: string, member: string) {
      update((current) => ({
        ...current,
        inspector: { kind: "membership", collection, member },
      }));
    },
    selectMembershipOrigin(origin: string) {
      update((current) =>
        current.inspector?.kind === "membership"
          ? { ...current, inspector: { ...current.inspector, origin } }
          : current,
      );
    },
    openRelation(collection: string, relation: string) {
      update((current) => ({
        ...current,
        inspector: { kind: "relation", collection, relation },
      }));
    },
    closeInspector() {
      update((current) => ({ ...current, inspector: undefined }));
    },
    selectTab(collection: string, tab: CollectionTab) {
      update((current) => ({
        ...current,
        inspector:
          current.inspector?.kind === "membership" &&
          current.inspector.collection === collection &&
          tab !== (current.tabs[collection] ?? "members")
            ? undefined
            : current.inspector,
        tabs: { ...current.tabs, [collection]: tab },
      }));
    },
    selectRow(collection: string, tab: CollectionTab, value?: string) {
      const key = `${collection}:${tab}`;
      update((current) => ({
        ...current,
        inspector:
          current.inspector?.kind === "membership" &&
          current.inspector.collection === collection &&
          current.selectedRows[key] !== undefined &&
          value !== current.selectedRows[key]
            ? undefined
            : current.inspector,
        selectedRows: value
          ? { ...current.selectedRows, [key]: value }
          : Object.fromEntries(
              Object.entries(current.selectedRows).filter(([entry]) => entry !== key),
            ),
      }));
    },
    toggleOrigin(collection: string, key: string) {
      update((current) => {
        const selected = current.selectedOrigins[collection] ?? [];
        const next = selected.includes(key)
          ? selected.filter((value) => value !== key)
          : [...selected, key];
        return {
          ...current,
          selectedOrigins: { ...current.selectedOrigins, [collection]: next },
        };
      });
    },
    toggleOrigins(collection: string, keys: readonly string[]) {
      update((current) => {
        const selected = current.selectedOrigins[collection] ?? [];
        const allSelected = keys.length > 0 && keys.every((key) => selected.includes(key));
        const next = allSelected
          ? selected.filter((key) => !keys.includes(key))
          : [...selected, ...keys.filter((key) => !selected.includes(key))];
        return {
          ...current,
          selectedOrigins: { ...current.selectedOrigins, [collection]: next },
        };
      });
    },
    clearOrigins(collection: string, keys?: readonly string[]) {
      update((current) => {
        const selected = current.selectedOrigins[collection] ?? [];
        const next = keys ? selected.filter((key) => !keys.includes(key)) : [];
        return {
          ...current,
          selectedOrigins: { ...current.selectedOrigins, [collection]: next },
        };
      });
    },
    reconcile(previous: WorkspaceView | undefined, current: WorkspaceView) {
      batch(() =>
        update((state) => {
          const values = (value: WorkspaceView | undefined) =>
            value?.effective.status === "complete"
              ? filterCollections(value.effective.collectionsView, {
                  query: state.query,
                  filters: state.filters,
                  agentUse: value.effective.use,
                  installedSkills: value.installedSkills,
                }).map((collection) => collection.id)
              : [];
          const originKeys = Object.fromEntries(
            current.effective.status === "complete"
              ? current.effective.collectionsView.map((collection) => [
                  collection.id,
                  (state.selectedOrigins[collection.id] ?? []).filter((key) =>
                    collection.members.some((member) =>
                      (member.paths.length ? member.paths : [undefined]).some(
                        (path, index) =>
                          key === collectionOriginKey(collection.id, member, path, index),
                      ),
                    ),
                  ),
                ])
              : [],
          );
          return {
            ...state,
            selected: nearest(state.selected, values(current), values(previous)),
            selectedOrigins: originKeys,
          };
        }),
      );
    },
  };
}

export type CollectionsState = ReturnType<typeof createCollectionsState>;
export type CollectionsReadonly = Pick<
  CollectionsState,
  | "snapshot"
  | "selected"
  | "selectedPath"
  | "expandedPaths"
  | "selectPath"
  | "setPathExpanded"
  | "setExpandedPaths"
  | "query"
  | "filters"
  | "tab"
  | "selectedRow"
  | "filter"
  | "selectedOrigins"
  | "inspector"
  | "closeInspector"
  | "selectMembershipOrigin"
  | "scroll"
  | "selectRow"
>;
