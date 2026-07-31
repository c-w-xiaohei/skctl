import { batch, createSignal } from "solid-js";
import type { ManagementProjection } from "../../core/api";
import { filterCollections, type CollectionFilterDimension } from "../collections-filter";
import type { CollectionTab } from "../types";

export interface CollectionsSnapshot {
  readonly selected?: string;
  readonly query: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly tabs: Readonly<Record<string, CollectionTab>>;
  readonly filter: {
    readonly open: boolean;
    readonly dimension?: CollectionFilterDimension;
    readonly search: string;
  };
}

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
    filter: { open: false, search: "" },
  });
  const update = (change: (current: CollectionsSnapshot) => CollectionsSnapshot) =>
    setSnapshot((current) => {
      const next = change(current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  return {
    snapshot,
    selected: () => snapshot().selected,
    query: () => snapshot().query,
    filters: () => snapshot().filters,
    tab: (collection: string): CollectionTab => snapshot().tabs[collection] ?? "members",
    filter: () => snapshot().filter,
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
    clearFilter(dimension: string) {
      update((current) => ({
        ...current,
        filters: Object.fromEntries(
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
      update((current) => ({ ...current, filter: { ...current.filter, search } }));
    },
    closeFilter() {
      update((current) => ({ ...current, filter: { open: false, search: "" } }));
    },
    selectTab(collection: string, tab: CollectionTab) {
      update((current) => ({ ...current, tabs: { ...current.tabs, [collection]: tab } }));
    },
    reconcile(previous: ManagementProjection | undefined, current: ManagementProjection) {
      batch(() =>
        update((state) => {
          const values = (value: ManagementProjection | undefined) =>
            value?.effective.status === "complete"
              ? filterCollections(value.effective.collectionsView, {
                  query: state.query,
                  filters: state.filters,
                  agentUse: value.effective.use,
                  installedSkills: value.installedSkills,
                }).map((collection) => collection.id)
              : [];
          return { ...state, selected: nearest(state.selected, values(current), values(previous)) };
        }),
      );
    },
  };
}

export type CollectionsState = ReturnType<typeof createCollectionsState>;
export type CollectionsReadonly = Pick<
  CollectionsState,
  "snapshot" | "selected" | "query" | "filters" | "tab" | "filter"
>;
export type CollectionsCommands = Omit<CollectionsState, keyof CollectionsReadonly>;
