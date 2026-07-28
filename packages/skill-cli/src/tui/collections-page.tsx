import { InputRenderable, SelectRenderable } from "@opentui/core";
import { createEffect, createMemo, Match, Show, Switch } from "solid-js";
import type { CollectionView, ConfigDeclarationOwner } from "../core/api";
import type { MemberOriginPath } from "../core/collections";
import {
  collectionContributionText,
  collectionFilterDimensions,
  collectionFilterValues,
  filterCollections,
  type CollectionFilterDimension,
} from "./collections-filter";
import type { CollectionTab, TuiState } from "./model";

export type CollectionRelationshipIntent =
  | {
      readonly kind: "collection-direct";
      readonly collection: string;
      readonly name: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-contribution";
      readonly collection: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-reference";
      readonly collection: string;
      readonly name: string;
      readonly target: string;
      readonly description: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-link";
      readonly collection: string;
      readonly target: string;
      readonly owner: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "collection-producer";
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
    };

const pathText = (path: MemberOriginPath): string =>
  path.kind === "direct"
    ? path.owner?.contribution
      ? `${path.owner.level} / ${path.owner.contribution.configSource.pointer}`
      : (path.owner?.level ?? "Direct")
    : path.kind === "repository-derived"
      ? `Repository ${path.source}/${path.path}`
      : `via ${path.links.map((link) => link.linkedCollection).join(" -> ")}`;

export const collectionMemberOriginIntent = (
  collection: string,
  member: {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
  },
  path: MemberOriginPath,
): CollectionRelationshipIntent | undefined => {
  if (path.kind === "direct" && path.owner?.contribution)
    return {
      kind: "collection-contribution",
      collection,
      owner: path.owner,
    };
  if (path.kind === "direct" && path.owner)
    return {
      kind: "collection-direct",
      collection,
      name: member.name,
      address: member.address,
      owner: path.owner,
    };
  if (path.kind === "repository-derived")
    return {
      kind: "collection-producer",
      collection,
      address: { source: path.source, path: path.path },
    };
  const link = path.kind === "via-link" ? path.links[0] : undefined;
  return link?.owner
    ? {
        kind: "collection-link",
        collection: link.collection,
        target: link.linkedCollection,
        owner: link.owner,
      }
    : undefined;
};

export function CollectionsPage(props: {
  readonly state: TuiState;
  readonly onSelect: (id: string) => void;
  readonly onQuery: (value: string) => void;
  readonly onFilter: (dimension: string, value?: string) => void;
  readonly onClear: (dimension: string) => void;
  readonly onClearAll: () => void;
  readonly onFilterOpen: () => void;
  readonly onFilterDimension: (dimension?: CollectionFilterDimension) => void;
  readonly onFilterSearch: (value: string) => void;
  readonly onFilterClose: () => void;
  readonly onTab: (collection: string, tab: CollectionTab) => void;
  readonly onDetail: () => void;
  readonly onRelationship: (intent: CollectionRelationshipIntent) => void;
}) {
  let browser: SelectRenderable | undefined;
  let queryInput: InputRenderable | undefined;
  let filterInput: InputRenderable | undefined;
  let tabs: SelectRenderable | undefined;
  let relationships: SelectRenderable | undefined;
  let clearAll: SelectRenderable | undefined;
  const clearFilters = new Map<string, SelectRenderable>();
  const effective = (): readonly CollectionView[] =>
    props.state.workspace?.effective.status === "complete"
      ? props.state.workspace.effective.collectionsView
      : [];
  const memory = () => props.state.memory.workspace;
  const query = () => memory().query.collections ?? "";
  const filters = () => memory().filters.collections ?? {};
  const agentUse = () =>
    props.state.workspace?.effective.status === "complete"
      ? props.state.workspace.effective.use
      : [];
  const collections = () =>
    filterCollections(effective(), {
      query: query(),
      filters: filters(),
      agentUse: agentUse(),
      installedSkills: props.state.workspace?.installedSkills,
    });
  const selected = () => collections().find((item) => item.id === memory().selection.collections);
  const tab = (): CollectionTab =>
    selected() ? (memory().collectionTab[selected()!.id] ?? "members") : "members";
  const filterState = () => memory().collectionFilter ?? { open: false, search: "" };
  const filterDimension = () => filterState().dimension as CollectionFilterDimension | undefined;
  const filterSearch = () => filterState().search;
  const matching = (values: readonly string[]) =>
    values.filter((value) =>
      value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
    );
  const options = createMemo(() =>
    collections().map((item) => ({
      name: `${item.id}  ${item.members.length}  ${collectionContributionText(item)}`,
      description: "",
      value: item.id,
    })),
  );
  createEffect(() => {
    if (props.state.focus === "collections-query") queryInput?.focus();
    else if (props.state.focus === "collections-filter-search") filterInput?.focus();
    else if (!props.state.overlay && props.state.focus === "collections-filter-clear")
      clearFilters.values().next().value?.focus();
    else if (!props.state.overlay && props.state.focus === "collections-filter-clear-all")
      clearAll?.focus();
    else if (!props.state.overlay && props.state.focus === "collection-relationships")
      relationships?.focus();
    else if (
      !props.state.overlay &&
      props.state.focus === "inspector" &&
      (!props.state.narrow || props.state.narrowLevel === "detail")
    )
      tabs?.focus();
    else if (
      !props.state.overlay &&
      props.state.focus === "browser" &&
      (!props.state.narrow || props.state.narrowLevel === "list")
    )
      browser?.focus();
  });
  const choose = (index: number, open: boolean) => {
    const collection = collections()[index];
    if (!collection) return;
    props.onSelect(collection.id);
    if (open) props.onDetail();
  };
  const filterPanel = () => {
    const dimension = filterDimension();
    const values = dimension
      ? matching(collectionFilterValues(dimension, effective()))
      : matching(collectionFilterDimensions);
    return (
      <box flexDirection="column" border paddingLeft={1}>
        <input
          id="collections-filter-search"
          ref={(value: InputRenderable) => {
            filterInput = value;
          }}
          focused={props.state.focus === "collections-filter-search"}
          placeholder={dimension ? "Search values" : "Search dimensions"}
          value={filterSearch()}
          onInput={props.onFilterSearch}
        />
        <select
          id={dimension ? "collections-filter-values" : "collections-filter-dimensions"}
          focused={
            props.state.focus === "collections-filter-dimensions" ||
            props.state.focus === "collections-filter-values"
          }
          options={values.map((value) => ({ name: value, description: "", value }))}
          showDescription={false}
          onSelect={(index) => {
            const value = values[index];
            if (!value) return;
            if (dimension) {
              props.onFilter(dimension, value);
              props.onFilterClose();
            } else props.onFilterDimension(value as CollectionFilterDimension);
          }}
        />
        <box onMouseDown={dimension ? () => props.onFilterDimension() : props.onFilterClose}>
          <text selectable>{dimension ? "Back" : "Close"}</text>
        </box>
      </box>
    );
  };
  const detail = () => {
    const collection = selected();
    if (!collection)
      return (
        <box flexGrow={1} paddingLeft={1}>
          <text>No Collection Selected</text>
        </box>
      );
    const selectedTab = tab();
    const memberOrigins = collection.members.flatMap((member) =>
      member.paths.map((path, index) => ({
        name: `${member.name}  ${member.address.source}/${member.address.path}  ${pathText(path)}`,
        value: `${member.name}:${index}`,
        intent: collectionMemberOriginIntent(collection.id, member, path),
      })),
    );
    const relationOptions =
      selectedTab === "members"
        ? memberOrigins
        : selectedTab === "references"
          ? collection.references.map((reference) => ({
              name: `${reference.name}  ${reference.collection}  ${reference.description}  ${reference.owner.level}  0 Skills`,
              value: reference.name,
              intent: {
                kind: "collection-reference" as const,
                collection: collection.id,
                name: reference.name,
                target: reference.collection,
                description: reference.description,
                owner: reference.owner,
              },
            }))
          : collection.links.map((link) => ({
              name: `${link.collection}  ${link.owner.level}`,
              value: link.collection,
              intent: {
                kind: "collection-link" as const,
                collection: collection.id,
                target: link.collection,
                owner: link.owner,
              },
            }));
    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <text>{`${collection.id}  ${collection.members.length} Skills  ${collectionContributionText(collection)}`}</text>
        <select
          id="collection-tabs"
          ref={(value: SelectRenderable) => {
            tabs = value;
          }}
          focused={
            !props.state.overlay &&
            props.state.focus === "inspector" &&
            (!props.state.narrow || props.state.narrowLevel === "detail")
          }
          height={1}
          options={[
            { name: "Members", description: "", value: "members" },
            { name: "References", description: "", value: "references" },
            { name: "Links", description: "", value: "links" },
          ]}
          selectedIndex={["members", "references", "links"].indexOf(selectedTab)}
          showDescription={false}
          onChange={(index) => {
            const value = (["members", "references", "links"] as const)[index];
            if (value) props.onTab(collection.id, value);
          }}
        />
        <Switch>
          <Match when={selectedTab === "members"}>
            <text>NAME SKILL FROM</text>
            <Show when={memberOrigins.length === 0}>
              <text>Empty Collection</text>
            </Show>
          </Match>
          <Match when={selectedTab === "references"}>
            <text>NAME TARGET DESCRIPTION FROM 0 Skills exposed</text>
            <Show when={relationOptions.length === 0}>
              <text>No References 0 Skills exposed</text>
            </Show>
          </Match>
          <Match when={selectedTab === "links"}>
            <text>TARGET FROM</text>
            <Show when={relationOptions.length === 0}>
              <text>No Links</text>
            </Show>
          </Match>
        </Switch>
        <select
          id="collection-relationships"
          ref={(value: SelectRenderable) => {
            relationships = value;
          }}
          focused={!props.state.overlay && props.state.focus === "collection-relationships"}
          options={relationOptions.map(({ name, value }) => ({ name, description: "", value }))}
          showDescription={false}
          onSelect={(index) => {
            const intent = relationOptions[index]?.intent;
            if (intent) props.onRelationship(intent);
          }}
        />
      </box>
    );
  };
  const list = () =>
    filterState().open ? (
      filterPanel()
    ) : (
      <box flexDirection="column" width={props.state.narrow ? "100%" : "48%"}>
        <text>{`Collections ${collections().length}/${effective().length}${Object.keys(filters()).length ? ` · ${Object.keys(filters()).length} filters` : ""}`}</text>
        <box flexDirection="row">
          <input
            id="collections-query"
            ref={(value: InputRenderable) => {
              queryInput = value;
            }}
            focused={props.state.focus === "collections-query"}
            placeholder="Search Collections"
            value={query()}
            onInput={props.onQuery}
          />
          <select
            id="collections-filter"
            focused={props.state.focus === "collections-filter-open"}
            options={[{ name: "Filter", description: "", value: "filter" }]}
            showDescription={false}
            onSelect={props.onFilterOpen}
          />
        </box>
        {Object.entries(filters()).map(([dimension, value]) => (
          <select
            id={`clear-collections-filter-${dimension}`}
            ref={(value: SelectRenderable) => {
              clearFilters.set(dimension, value);
            }}
            options={[{ name: `${dimension}: ${value}  Clear`, description: "", value: dimension }]}
            showDescription={false}
            onSelect={() => props.onClear(dimension)}
          />
        ))}
        <Show when={Boolean(query()) || Object.keys(filters()).length > 0}>
          <select
            id="clear-all-collections-filters"
            ref={(value: SelectRenderable) => {
              clearAll = value;
            }}
            options={[{ name: "Clear all", description: "", value: "clear" }]}
            showDescription={false}
            onSelect={props.onClearAll}
          />
        </Show>
        <text>NAME SKILLS FROM</text>
        <select
          id="collection-browser"
          ref={(value: SelectRenderable) => {
            browser = value;
          }}
          focused={!props.state.overlay && props.state.focus === "browser"}
          options={options()}
          height={10}
          selectedIndex={Math.max(
            0,
            options().findIndex((option) => option.value === memory().selection.collections),
          )}
          showDescription={false}
          onChange={(index) => choose(index, false)}
          onSelect={(index) => choose(index, true)}
        />
        <Show when={collections().length === 0}>
          <text>No Collections</text>
        </Show>
      </box>
    );
  return (
    <Show
      when={props.state.narrow}
      fallback={
        <box flexDirection="row" flexGrow={1}>
          {list()}
          <box id="collections-inspector-separator" height="100%" border={["left"]} />
          {detail()}
        </box>
      }
    >
      <Show when={props.state.narrowLevel === "list"} fallback={detail()}>
        {list()}
      </Show>
    </Show>
  );
}
