import { InputRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import type { CollectionView, ConfigDeclarationOwner, ManagementProjection } from "../core/api";
import type { MemberOriginPath } from "../core/collections";
import {
  collectionContributionText,
  collectionFilterDimensions,
  collectionFilterValues,
  filterCollections,
  type CollectionFilterDimension,
} from "./collections-filter";
import type { CollectionTab, NarrowLevel } from "./types";
import type { CollectionsReadonly } from "./collections/state";
import { SectionTabs } from "./components/section-tabs";
import type { FocusRegistry, FocusTarget } from "./focus";

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

const ownerText = (owner: ConfigDeclarationOwner): string =>
  `${owner.level} ${owner.file} ${owner.pointer}`;

const ownerProvenanceText = (owner: ConfigDeclarationOwner): string | undefined =>
  owner.contribution ? `Config Source ${ownerText(owner.contribution.configSource)}` : undefined;

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
  readonly collections: CollectionsReadonly;
  readonly narrow?: boolean;
  readonly wide?: boolean;
  readonly narrowLevel: NarrowLevel;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
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
  readonly onInspectorFocus: () => void;
  readonly onDetail: () => void;
  readonly onRelationship: (intent: CollectionRelationshipIntent) => void;
}) {
  const bindings = new Map<string, () => void>();
  const bind = (
    owner: Parameters<FocusRegistry["register"]>[0],
    target: FocusTarget & Pick<BaseRenderable, "once" | "off">,
  ) => {
    bindings.get(owner)?.();
    if (!props.focusRegistry) return;
    const dispose = props.focusRegistry.register(owner, target);
    const release = () => dispose();
    target.once("destroyed", release);
    bindings.set(owner, () => {
      target.off("destroyed", release);
      dispose();
    });
  };
  onCleanup(() => bindings.forEach((dispose) => dispose()));
  const effective = (): readonly CollectionView[] => {
    const workspace = props.projection();
    return workspace?.effective.status === "complete" ? workspace.effective.collectionsView : [];
  };
  const query = props.collections.query;
  const filters = props.collections.filters;
  const agentUse = () => {
    const workspace = props.projection();
    return workspace?.effective.status === "complete" ? workspace.effective.use : [];
  };
  const collections = () =>
    filterCollections(effective(), {
      query: query(),
      filters: filters(),
      agentUse: agentUse(),
      installedSkills: props.projection()?.installedSkills,
    });
  const selected = () => collections().find((item) => item.id === props.collections.selected());
  const tab = (): CollectionTab => (selected() ? props.collections.tab(selected()!.id) : "members");
  const filterState = props.collections.filter;
  const filterDimension = () => filterState().dimension as CollectionFilterDimension | undefined;
  const filterSearch = () => filterState().search;
  const [selectedRelationship, setSelectedRelationship] = createSignal(0);
  createEffect(() => {
    void selected()?.id;
    void tab();
    setSelectedRelationship(0);
  });
  const matching = (values: readonly string[]) =>
    values.filter((value) =>
      value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
    );
  const options = createMemo(() =>
    collections().map((item) => ({
      name: item.id,
      description: `${item.members.length} ${item.members.length === 1 ? "member" : "members"} · ${collectionContributionText(item)}`,
      value: item.id,
    })),
  );
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
            bind("collections-filter-search", value);
          }}
          placeholder={dimension ? "Search values" : "Search dimensions"}
          value={filterSearch()}
          onInput={props.onFilterSearch}
        />
        <select
          id={dimension ? "collections-filter-values" : "collections-filter-dimensions"}
          ref={(value: SelectRenderable) => {
            bind(dimension ? "collections-filter-values" : "collections-filter-dimensions", value);
          }}
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
        <box flexDirection="column" flexGrow={1} paddingLeft={1}>
          {effective().length === 0 ? (
            <>
              <text>Collections group Skills for reuse and agent disclosure.</text>
              <text>
                Declared in a Config (Ctrl+P → New Collection) or derived from a repository.
              </text>
            </>
          ) : (
            <text>Select a Collection to see its Members, References, and Links.</text>
          )}
        </box>
      );
    const selectedTab = tab();
    const memberOrigins = collection.members.flatMap((member) =>
      member.paths.map((path, index) => ({
        kind: "member" as const,
        name: member.name,
        address: member.address,
        origin: pathText(path),
        description: `${member.address.source}/${member.address.path} · ${pathText(path)}`,
        value: `${member.name}:${index}`,
        intent: collectionMemberOriginIntent(collection.id, member, path),
      })),
    );
    const relationOptions =
      selectedTab === "members"
        ? memberOrigins
        : selectedTab === "references"
          ? collection.references.map((reference) => ({
              kind: "reference" as const,
              name: reference.name,
              target: reference.collection,
              referenceDescription: reference.description,
              owner: reference.owner,
              description: `${reference.collection} · ${reference.description} · ${reference.owner.level} · 0 Skills exposed`,
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
              kind: "link" as const,
              name: link.collection,
              target: link.collection,
              owner: link.owner,
              description: link.owner.level,
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
        <SectionTabs
          id="collection-tabs"
          options={[
            { label: "Members", compactLabel: "Members", value: "members" },
            { label: "References", compactLabel: "Refs", value: "references" },
            { label: "Links", compactLabel: "Links", value: "links" },
          ]}
          value={selectedTab}
          owner="inspector"
          focusRegistry={props.focusRegistry}
          compact={props.narrow === true}
          label="View"
          onPrimaryPointerEntry={props.onInspectorFocus}
          onNavigate={(value) => {
            setSelectedRelationship(0);
            props.onTab(collection.id, value);
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
        {(() => {
          const relation = relationOptions[selectedRelationship()] ?? relationOptions[0];
          if (!relation) return undefined;
          if (relation.kind === "member")
            return (
              <text
                selectable
              >{`Selected Member  ${relation.name}\nSkill  ${relation.address.source}/${relation.address.path}\nOrigin  ${relation.origin}`}</text>
            );
          if (relation.kind === "reference")
            return (
              <text
                selectable
              >{`Selected Reference  ${relation.name}\nTarget  ${relation.target}\nDescription  ${relation.referenceDescription}\nOwner  ${ownerText(relation.owner)}${ownerProvenanceText(relation.owner) ? `\nProvenance  ${ownerProvenanceText(relation.owner)}` : ""}\n0 Skills exposed`}</text>
            );
          return (
            <text
              selectable
            >{`Selected Link  ${relation.name}\nTarget  ${relation.target}\nOwner  ${ownerText(relation.owner)}${ownerProvenanceText(relation.owner) ? `\nProvenance  ${ownerProvenanceText(relation.owner)}` : ""}`}</text>
          );
        })()}
        <select
          id="collection-relationships"
          ref={(value: SelectRenderable) => {
            bind("collection-relationships", value);
          }}
          options={relationOptions.map(({ name, description, value }) => ({
            name,
            description,
            value,
          }))}
          showDescription={false}
          showSelectionIndicator
          showScrollIndicator
          onChange={(index) => setSelectedRelationship(index)}
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
      <box
        flexDirection="column"
        flexGrow={props.wide ? 1 : undefined}
        width={props.narrow === true ? "100%" : "48%"}
      >
        <text>{`Collections ${collections().length}/${effective().length}${Object.keys(filters()).length ? ` · ${Object.keys(filters()).length} filters` : ""}`}</text>
        <Show when={effective().length > 0}>
          <box flexDirection="row">
            <input
              id="collections-query"
              ref={(value: InputRenderable) => {
                bind("collections-query", value);
              }}
              placeholder="Search Collections"
              value={query()}
              onInput={props.onQuery}
            />
            <select
              id="collections-filter"
              ref={(value: SelectRenderable) => {
                bind("collections-filter-open", value);
              }}
              height={1}
              options={[{ name: "Filter", description: "", value: "filter" }]}
              showDescription={false}
              onSelect={props.onFilterOpen}
            />
          </box>
          {Object.entries(filters()).map(([dimension, value]) => {
            const clear = () => props.onClear(dimension);
            const id = `clear-collections-filter-${dimension}`;
            return (
              <box
                id={id}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  clear();
                }}
              >
                <select
                  id={`${id}-keyboard`}
                  ref={(value: SelectRenderable) => {
                    bind("collections-filter-clear", value);
                  }}
                  height={1}
                  options={[
                    { name: `${dimension}: ${value}  Clear`, description: "", value: dimension },
                  ]}
                  showDescription={false}
                  onSelect={clear}
                />
              </box>
            );
          })}
          <Show when={Boolean(query()) || Object.keys(filters()).length > 0}>
            <box
              id="clear-all-collections-filters"
              onMouseDown={(event) => {
                event.stopPropagation();
                props.onClearAll();
              }}
            >
              <select
                id="clear-all-collections-filters-keyboard"
                ref={(value: SelectRenderable) => {
                  bind("collections-filter-clear-all", value);
                }}
                height={1}
                options={[{ name: "Clear all", description: "", value: "clear" }]}
                showDescription={false}
                onSelect={props.onClearAll}
              />
            </box>
          </Show>
          <text>COLLECTION</text>
        </Show>
        <select
          id="collection-browser"
          ref={(value: SelectRenderable) => {
            bind("browser", value);
          }}
          options={options()}
          flexGrow={1}
          selectedIndex={Math.max(
            0,
            options().findIndex((option) => option.value === props.collections.selected()),
          )}
          showDescription={false}
          showSelectionIndicator
          showScrollIndicator
          onChange={(index) => choose(index, false)}
          onSelect={(index) => choose(index, true)}
        />
        <Show when={collections().length === 0}>
          <box flexDirection="column" paddingTop={1}>
            {effective().length === 0 ? (
              <>
                <text>No Collections yet</text>
                <text>Collections group Skills for reuse and agent disclosure.</text>
                <text>Ctrl+P → New Collection</text>
              </>
            ) : (
              <>
                <text>No Collections match the current search or filters.</text>
                <text>Clear the search and filters to see Collections.</text>
              </>
            )}
          </box>
        </Show>
      </box>
    );
  return (
    <Show
      when={props.narrow === true}
      fallback={
        <box flexDirection="row" flexGrow={1}>
          {list()}
          <Show
            when={props.wide}
            fallback={
              <>
                <box id="collections-inspector-separator" height="100%" border={["left"]} />
                {detail()}
              </>
            }
          >
            <box
              id="collections-inspector-panel"
              flexDirection="column"
              flexGrow={1}
              width="50%"
              border
            >
              <text>Inspector</text>
              {detail()}
            </box>
          </Show>
        </box>
      }
    >
      <Show when={props.narrowLevel === "list"} fallback={detail()}>
        {list()}
      </Show>
    </Show>
  );
}
