import { InputRenderable, Renderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { createMemo, For, onCleanup, Show, untrack } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { restoreSelectScroll, selectScrollOffset, trackSelectScroll } from "./select-scroll";
import type { CollectionView, ConfigDeclarationOwner, ManagementProjection } from "@skill-cli/core";
import type { MemberOriginPath } from "@skill-cli/core";
import {
  collectionContributionText,
  collectionFilterDimensions,
  collectionFilterValues,
  filterCollections,
  type CollectionFilterDimension,
} from "./collections-filter";
import type {
  CollectionTab,
  CommandExecution,
  CommandRegistration,
  CommandRecord,
  FocusOwner,
  LayoutMode,
} from "./types";
import { CommandControl } from "./command-control";
import { useTheme } from "./ui/use-theme";
import { DataList } from "./ui/data-list";
import { Pane } from "./ui/pane";
import { MetadataGrid } from "./ui/metadata-grid";
import {
  collectionMemberKey,
  collectionOriginKey,
  type CollectionsReadonly,
} from "./collections/state";
import { SectionTabs } from "./components/section-tabs";
import type { FocusRegistry, FocusTarget } from "./focus";
import {
  RelationshipInspector,
  type CollectionMemberOriginRow,
  type CollectionRelationRow,
  type CollectionRelationshipIntent,
} from "./collections/relationship-inspector";
import type { CollectionTableRow } from "./collections/collection-table";
import type { ActionRecord } from "./actions";
export type { CollectionRelationshipIntent } from "./collections/relationship-inspector";

const ownerText = (owner: ConfigDeclarationOwner): string =>
  `${owner.level} ${owner.file} ${owner.pointer}`;

const ownerProvenanceText = (owner: ConfigDeclarationOwner): string | undefined =>
  owner.contribution ? `Config Source ${ownerText(owner.contribution.configSource)}` : undefined;

const ownerKey = (owner: ConfigDeclarationOwner): string =>
  JSON.stringify([owner.level, owner.file, owner.pointer, owner.namespace, owner.contribution]);

export const collectionRelationRows = (
  collectionId: string,
  projection: ManagementProjection,
): readonly CollectionRelationRow[] => {
  const effective = projection.effective;
  if (effective.status !== "complete") return [];
  const collection = effective.collectionsView.find((item) => item.id === collectionId);
  if (!collection) return [];
  const selectors = projection.installedSkills.flatMap((skill) =>
    skill.selectorViews.status === "complete"
      ? skill.selectorViews.values.filter((view) => view.collection === collectionId)
      : [],
  );
  const useOwners = [
    ...new Map(
      [
        ...selectors.flatMap((view) => view.useOwners),
        ...projection.configs.flatMap((config) =>
          config.direct.collectionUse
            .filter((use) => use.collection === collectionId)
            .map((use) => use.owner),
        ),
      ].map((owner) => [ownerKey(owner), owner]),
    ).values(),
  ];
  const rows: CollectionRelationRow[] = useOwners.map((owner) => ({
    kind: "collection-use",
    label: "Collection Use",
    owner,
    effect: `${selectors.length} selector${selectors.length === 1 ? "" : "s"} exposed`,
    provenance: ownerProvenanceText(owner),
    intent: { kind: "collection-use", collection: collectionId, owner },
  }));
  if (effective.use.includes(collectionId) && useOwners.length === 0)
    rows.push({
      kind: "collection-use",
      label: "Collection Use",
      target: collectionId,
      effect: "Owner unavailable · read-only",
    });
  rows.push(
    ...collection.references.map((reference) => ({
      kind: "collection-reference" as const,
      label: `Reference ${reference.name}`,
      target: reference.collection,
      owner: reference.owner,
      effect: "0 Skills exposed",
      provenance: ownerProvenanceText(reference.owner),
      intent: {
        kind: "collection-reference" as const,
        collection: collectionId,
        name: reference.name,
        target: reference.collection,
        description: reference.description,
        owner: reference.owner,
      },
    })),
  );
  rows.push(
    ...collection.links.map((link) => {
      const linkedSelectors = projection.installedSkills.flatMap((skill) =>
        skill.selectorViews.status === "complete"
          ? skill.selectorViews.values.filter((view) =>
              view.paths.some(
                (path) =>
                  path.kind === "via-link" &&
                  path.links.some(
                    (item) =>
                      item.collection === collectionId && item.linkedCollection === link.collection,
                  ),
              ),
            )
          : [],
      );
      return {
        kind: "collection-link" as const,
        label: `Link ${link.collection}`,
        target: link.collection,
        owner: link.owner,
        effect: `${linkedSelectors.length} selector${linkedSelectors.length === 1 ? "" : "s"} exposed`,
        provenance: ownerProvenanceText(link.owner),
        intent: {
          kind: "collection-link" as const,
          collection: collectionId,
          target: link.collection,
          owner: link.owner,
        },
      };
    }),
  );
  return rows;
};

const pathText = (path: MemberOriginPath): string =>
  path.kind === "direct"
    ? path.owner?.contribution
      ? `${path.owner.level} / ${path.owner.contribution.configSource.pointer}`
      : (path.owner?.level ?? "Direct")
    : path.kind === "repository-derived"
      ? `Repository ${path.source}/${path.path}`
      : `via ${path.links.map((link) => link.linkedCollection).join(" -> ")}`;

const compactAddress = (address: { readonly source: string; readonly path: string }): string => {
  const value = `${address.source}/${address.path}`;
  if (value.length <= 24) return value;
  const leaf = address.path.split("/").at(-1) ?? address.path;
  return `${address.source}/.../${leaf}`;
};

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

export interface CollectionRemovalRow {
  readonly key: string;
  readonly name: string;
  readonly address: { readonly source: string; readonly path: string };
  readonly path?: MemberOriginPath;
}

export const collectionRemovalPlan = (
  collection: Pick<CollectionView, "id" | "declared">,
  rows: readonly CollectionRemovalRow[],
) => {
  const removals = rows
    .filter(
      (
        row,
      ): row is CollectionRemovalRow & {
        readonly path: Extract<MemberOriginPath, { readonly kind: "direct" }>;
      } => row.path?.kind === "direct" && !!row.path.owner && !row.path.owner.contribution,
    )
    .flatMap((row) => {
      const owner = row.path!.owner!;
      const declaration = collection.declared.find(
        (candidate) =>
          !candidate.contribution &&
          candidate.level === owner.level &&
          candidate.file === owner.file &&
          candidate.namespace === owner.namespace &&
          owner.pointer === `${candidate.pointer}/members/${row.path!.entryName}`,
      );
      return declaration ? [{ ...row, entryName: row.path!.entryName, owner: declaration }] : [];
    });
  const ownerGroups = [
    ...new Map(
      removals.map((row) => [
        ownerKey(row.owner),
        {
          owner: row.owner,
          rows: removals.filter((candidate) => ownerKey(candidate.owner) === ownerKey(row.owner)),
        },
      ]),
    ).values(),
  ];
  const explanations = rows.flatMap((row) => {
    const path = row.path;
    if (!path) return [`${row.name}: Origin unavailable`];
    if (path.kind === "direct" && !path.owner)
      return [`${row.name}: Direct Membership owner unavailable`];
    if (path.kind === "direct" && path.owner?.contribution)
      return [
        `${row.name}: Config Source ${ownerText(path.owner.contribution.configSource)} owns this contribution`,
      ];
    if (path.kind === "repository-derived")
      return [
        `${row.name}: Repository ${path.repository} (${path.source}/${path.path}) owns this entry`,
      ];
    if (path.kind === "via-link") {
      const link = path.links[0];
      return [
        `${row.name}: Link ${link ? `${link.collection} -> ${link.linkedCollection}` : "owner unavailable"} owns this entry`,
      ];
    }
    return [];
  });
  return {
    collection: collection.id,
    rows,
    removals,
    ownerGroups,
    explanations,
    executable: ownerGroups.length === 1 && removals.length > 0,
  };
};

export function CollectionsPage(props: {
  readonly collections: CollectionsReadonly;
  readonly mode: LayoutMode;
  readonly surface: "browser" | "detail";
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly onWorkAreaTarget?: (target: FocusTarget & Pick<BaseRenderable, "once" | "off">) => void;
  readonly onScroll?: (surface: string, scroll: number) => void;
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
  readonly onOpenMembership?: (collection: string, member: string) => void;
  readonly onOpenRelation?: (collection: string, relation: string) => void;
  readonly onToggleOrigin?: (collection: string, key: string) => void;
  readonly onToggleOrigins?: (collection: string, keys: readonly string[]) => void;
  readonly onRemoveOrigins?: (collection: string, rows: readonly CollectionRemovalRow[]) => void;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly actions?: readonly ActionRecord[];
  readonly onAction?: (id: ActionRecord["id"]) => void;
}) {
  const renderer = useRenderer();
  const tokens = useTheme();
  const commandsIn = (pane: string) => {
    const commands: Renderable[] = [];
    const visit = (target: BaseRenderable) => {
      if (
        target instanceof Renderable &&
        target.focusable &&
        props.focusRegistry?.ownerOf(target)?.startsWith("command:")
      )
        commands.push(target);
      for (const child of target.getChildren()) visit(child);
    };
    const root = renderer.root.findDescendantById(pane);
    if (root) visit(root);
    return commands;
  };
  const localMode = (
    target: Renderable,
    handler: Parameters<FocusRegistry["registerModeHandler"]>[1],
  ) => {
    const dispose = props.focusRegistry?.registerModeHandler(target, handler);
    target.once("destroyed", () => dispose?.());
  };
  const focus = (owner: FocusOwner) => props.focusRegistry?.applyFocus(owner) ?? false;
  const focusControl = (target: Renderable | undefined) => {
    const owner = target && props.focusRegistry?.ownerOf(target);
    if (owner) focus(owner);
  };
  let collectionBrowser: SelectRenderable | undefined;
  const bindings = new Map<string, () => void>();
  const bindScroll = (
    surface: string,
    target: SelectRenderable,
    options: () => readonly unknown[],
  ) => {
    void options();
    const cancel = restoreSelectScroll(renderer, target, props.collections.scroll(surface));
    onCleanup(cancel);
  };
  const bind = (
    owner: Parameters<FocusRegistry["register"]>[0],
    target: FocusTarget & Pick<BaseRenderable, "once" | "off">,
  ): (() => void) | undefined => {
    bindings.get(owner)?.();
    if (!props.focusRegistry) return;
    const dispose = props.focusRegistry.register(owner, target);
    const release = () => dispose();
    target.once("destroyed", release);
    bindings.set(owner, () => {
      target.off("destroyed", release);
      dispose();
    });
    return release;
  };
  onCleanup(() => bindings.forEach((dispose) => dispose()));
  const effective = (): readonly CollectionView[] => {
    const workspace = props.projection();
    return workspace?.effective.status === "complete" ? workspace.effective.collectionsView : [];
  };
  const commandZone = (id: string, record: CommandRecord, execute: () => void) => {
    const owner: FocusOwner = `command:${record.id}`;
    return (
      <CommandControl
        id={id}
        record={record}
        keyboard={!props.executeCommand}
        register={(target) => {
          bind(owner, target);
          localMode(target, (key) => {
            if (key.name !== "up" && key.name !== "down") return "declined";
            const pane =
              renderer.root
                .findDescendantById("collection-detail-pane")
                ?.findDescendantById(target.id) === target
                ? "collection-detail-pane"
                : "collections-list-pane";
            const commands = commandsIn(pane);
            const index = commands.indexOf(target);
            if (key.name === "up" && index === 0) {
              if (
                !focus(
                  pane === "collection-detail-pane"
                    ? "collection-relationships"
                    : "collections-query",
                )
              )
                focus("local-nav");
            } else if (
              key.name === "down" &&
              index === commands.length - 1 &&
              pane === "collections-list-pane"
            )
              focus("browser");
            else
              focusControl(
                commands[
                  Math.max(0, Math.min(commands.length - 1, index + (key.name === "up" ? -1 : 1)))
                ],
              );
            return "consumed";
          });
          return props.registerCommand?.(record, owner, id, execute);
        }}
        execute={() => (props.executeCommand ? props.executeCommand(record.id) : execute())}
      />
    );
  };
  const managedAction = (id: ActionRecord["id"], label?: string) => {
    const record = props.actions?.find((candidate) => candidate.id === id);
    return record
      ? commandZone(`collection-action-${id}`, label ? { ...record, verb: label } : record, () =>
          props.onAction?.(id),
        )
      : null;
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
  const tab = (): CollectionTab => (selected() ? props.collections.tab(selected()!.id) : "entries");
  const filterState = props.collections.filter;
  const filterDimension = () => filterState().dimension as CollectionFilterDimension | undefined;
  const filterSearch = () => filterState().search;
  const matching = (values: readonly string[]) =>
    values.filter((value) =>
      value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
    );
  const options = createMemo(() =>
    collections().map((item) => ({
      name: item.id,
      description: "",
      value: item.id,
    })),
  );
  const choose = (index: number, open: boolean) => {
    const collection = collections()[index];
    if (!collection) return;
    const browserScroll = collectionBrowser ? selectScrollOffset(collectionBrowser) : undefined;
    props.onSelect(collection.id);
    if (open) {
      if (browserScroll !== undefined) props.onScroll?.("collection-browser", browserScroll);
      props.onDetail();
    }
  };
  const FilterPanel = () => {
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
        <DataList
          id={dimension ? "collections-filter-values" : "collections-filter-dimensions"}
          ref={(value: SelectRenderable) => {
            bind(dimension ? "collections-filter-values" : "collections-filter-dimensions", value);
          }}
          options={values.map((value) => ({
            name: value,
            description: "",
            value,
          }))}
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
              <text>Create a Collection here, or install one supplied by a repository.</text>
            </>
          ) : (
            <text>Select a Collection to see its Entries and Relations.</text>
          )}
        </box>
      );
    const selectedTab = createMemo(() => tab());
    let relationshipSelect: SelectRenderable | undefined;
    const memberOrigins: CollectionMemberOriginRow[] = collection.members.flatMap((member) =>
      (member.paths.length ? member.paths : [undefined]).map((path, index) => ({
        kind: "member" as const,
        name: member.name,
        address: member.address,
        origin: path ? pathText(path) : "Origin unavailable",
        description: `${member.address.source}/${member.address.path} · ${path ? pathText(path) : "Origin unavailable"}`,
        key: collectionOriginKey(collection.id, member, path, index),
        value: `${member.name}:${index}`,
        path,
        intent: path ? collectionMemberOriginIntent(collection.id, member, path) : undefined,
      })),
    );
    const memberRows = collection.members.map((member) => {
      const origins = memberOrigins.filter(
        (row) =>
          row.name === member.name &&
          row.address.source === member.address.source &&
          row.address.path === member.address.path,
      );
      const summaries = [...new Set(origins.map((row) => row.origin))];
      const value =
        collection.members.filter((candidate) => candidate.name === member.name).length === 1
          ? `${member.name}:0`
          : collectionMemberKey(member);
      return {
        kind: "member" as const,
        name: member.name,
        address: member.address,
        origin:
          summaries.length === 0
            ? "Origin unavailable"
            : summaries.length === 1
              ? summaries[0]!
              : `${summaries.length} origins`,
        description: `${compactAddress(member.address)} · ${summaries.join(" · ") || "Origin unavailable"}`,
        key: collectionMemberKey(member),
        value,
        member,
        origins,
      };
    });
    const originCount = memberOrigins.length;
    const relationRows = collectionRelationRows(collection.id, props.projection()!);
    const entryAddress = (row: {
      readonly name: string;
      readonly address: { readonly source: string; readonly path: string };
    }) => {
      const leaf = row.address.path.split("/").at(-1);
      const sameIdentity = memberRows.some(
        (candidate) =>
          candidate !== row &&
          candidate.name === row.name &&
          candidate.address.source === row.address.source &&
          candidate.address.path !== row.address.path,
      );
      return !sameIdentity && leaf === row.name
        ? row.address.source
        : sameIdentity
          ? `${row.address.source}/${row.address.path}`
          : compactAddress(row.address);
    };
    const relationRowsForTable = createMemo<readonly CollectionTableRow[]>(() =>
      selectedTab() === "entries"
        ? memberRows.map((row) => ({
            key: row.key,
            value: row.value,
            domain: row,
            cells: [
              `${row.origins.some((origin) => props.collections.selectedOrigins(collection.id).includes(origin.key)) ? "[x]" : "[ ]"} ${row.name}`,
              entryAddress(row),
              row.origin,
            ],
            destination: "Membership details" as const,
          }))
        : relationRows.map((row, index) => ({
            key: `${row.kind}:${index}`,
            value: `${row.kind}:${index}`,
            domain: row,
            cells: [
              row.label,
              row.kind === "collection-use"
                ? row.target
                  ? `uses ${row.target}`
                  : "active"
                : (row.target ?? ""),
              row.owner?.level ?? "Read-only",
              row.effect,
            ],
            destination: "Relationship details" as const,
          })),
    );
    const toggleSelectedEntryOrigins = (index: number) => {
      if (selectedTab() !== "entries") return false;
      const row = relationRowsForTable()[index];
      const member = row && memberRows.find((candidate) => candidate.value === row.value);
      if (!member) return false;
      const keys = [
        ...(member.member.paths.length ? member.member.paths : [undefined]).entries(),
      ].map(([originIndex, path]) =>
        collectionOriginKey(collection.id, member.member, path, originIndex),
      );
      props.onToggleOrigins?.(collection.id, keys);
      return true;
    };
    return (
      <Pane id="collection-detail-pane" title="Collection details">
        <text wrapMode="word">
          <strong>{collection.id}</strong>
        </text>
        <text
          fg={tokens().colors.mutedForeground}
          wrapMode="word"
        >{`${collection.members.length} Skills · ${originCount} origins · ${collectionContributionText(collection)}`}</text>
        <Show when={!props.collections.inspector()}>
          <SectionTabs
            id="collection-tabs"
            options={[
              { label: "Entries", value: "entries" },
              {
                label: "Relations",
                value: "relations",
              },
            ]}
            value={selectedTab()}
            owner="inspector"
            focusRegistry={props.focusRegistry}
            label="View"
            onPrimaryPointerEntry={props.onInspectorFocus}
            onActivate={() => focus("collection-relationships")}
            onNavigate={(value) => {
              const surface = `collection:${collection.id}:${selectedTab()}`;
              const selectedRow = props.collections.selectedRow(collection.id, selectedTab());
              props.collections.selectRow(collection.id, selectedTab(), selectedRow);
              if (relationshipSelect)
                props.onScroll?.(surface, selectScrollOffset(relationshipSelect));
              props.onTab(collection.id, value);
            }}
          />
          <Show when={relationRowsForTable().length === 0}>
            <text fg={tokens().colors.mutedForeground}>
              {selectedTab() === "entries" ? "Empty Collection" : "No Relations"}
            </text>
          </Show>
          <Show when={selectedTab() === "entries"}>
            <text fg={tokens().colors.mutedForeground}>
              Space selects entries · Enter shows ownership
            </text>
            <Show when={props.collections.selectedOrigins(collection.id).length > 0}>
              <text>{`${props.collections.selectedOrigins(collection.id).length} origins selected`}</text>
              <Show when={!props.collections.inspector()}>
                {commandZone(
                  "remove-from-collection",
                  {
                    id: "collection.remove-selected-origins",
                    keys: ["enter", "return"],
                    verb: "Remove selected origins",
                    destination: "Review removal",
                    scope: "page",
                    enabled: true,
                    danger: true,
                  },
                  () =>
                    props.onRemoveOrigins?.(
                      collection.id,
                      memberOrigins.filter((row) =>
                        props.collections.selectedOrigins(collection.id).includes(row.key),
                      ),
                    ),
                )}
              </Show>
            </Show>
          </Show>
          <DataList
            id="collection-relationships"
            ref={(value: SelectRenderable) => {
              relationshipSelect = value;
              bind("collection-relationships", value);
              const surface = `collection:${collection.id}:${selectedTab()}`;
              const row = untrack(() =>
                props.collections.selectedRow(collection.id, selectedTab()),
              );
              const index = relationRowsForTable().findIndex((option) => option.value === row);
              const isLive = () =>
                value.parent !== undefined &&
                renderer.root.findDescendantById("collection-relationships") === value &&
                selected()?.id === collection.id &&
                tab() === selectedTab();
              queueMicrotask(() => {
                if (isLive() && index >= 0) value.setSelectedIndex(index);
              });
              const cancel = restoreSelectScroll(
                renderer,
                value,
                props.collections.scroll(surface),
              );
              trackSelectScroll(value, (scroll) => {
                if (isLive()) props.onScroll?.(surface, scroll);
              });
              value.once("destroyed", cancel);
              const unregister = props.focusRegistry?.registerModeHandler(value, (key) => {
                if (key.name === "up" && value.getSelectedIndex() === 0) {
                  focus("inspector");
                  return "consumed";
                }
                if (key.name === "right") {
                  focusControl(commandsIn("collection-detail-pane")[0]);
                  return "consumed";
                }
                if (key.name !== "character" || key.char !== " " || selectedTab() !== "entries")
                  return "declined";
                return toggleSelectedEntryOrigins(value.getSelectedIndex())
                  ? "consumed"
                  : "declined";
              });
              value.once("destroyed", () => unregister?.());
            }}
            options={relationRowsForTable().map((row) => ({
              name: row.cells[0] ?? "",
              description: row.cells.slice(1).join(" · "),
              value: row.value,
            }))}
            showDescription
            showSelectionIndicator
            showScrollIndicator
            width="100%"
            flexGrow={1}
            minHeight={0}
            onChange={(index) => {
              const option = relationRowsForTable()[index];
              if (option) props.collections.selectRow(collection.id, selectedTab(), option.value);
            }}
            onSelect={(index) => {
              const option = relationRowsForTable()[index];
              if (option) {
                const surface = `collection:${collection.id}:${selectedTab()}`;
                props.collections.selectRow(collection.id, selectedTab(), option.value);
                if (relationshipSelect)
                  props.onScroll?.(surface, selectScrollOffset(relationshipSelect));
                if (selectedTab() === "entries") {
                  props.onRelationship({
                    kind: "collection-membership-inspect",
                    collection: collection.id,
                    member: option.value,
                  });
                } else
                  props.onRelationship({
                    kind: "collection-relation-inspect",
                    collection: collection.id,
                    relation: option.value,
                  });
              }
            }}
          />
        </Show>
        <RelationshipInspector
          collection={collection}
          memberOrigins={memberOrigins}
          relationRows={relationRows}
          collections={props.collections}
          focusRegistry={props.focusRegistry}
          bind={bind}
          onRelationship={props.onRelationship}
          registerCommand={props.registerCommand}
          executeCommand={props.executeCommand}
        />
        <box
          flexDirection="column"
          flexShrink={0}
          border={["top"]}
          borderColor={tokens().colors.border}
        >
          <text fg={tokens().colors.mutedForeground}>MANAGE COLLECTION</text>
          {managedAction("add-membership", "Add Skills to Collection…")}
          {managedAction("add-reference", "Add discovery reference…")}
          {managedAction("add-link", "Link another Collection's Skills…")}
          {managedAction("remove-collection", "Remove Collection declaration…")}
        </box>
      </Pane>
    );
  };
  const BrowserList = () => (
    <Pane
      id="collections-list-pane"
      title={`Collections · ${collections().length}`}
      width={props.mode === "wide" ? "43%" : "100%"}
    >
      {managedAction("new-collection", "New Collection…")}
      <Show when={effective().length > 0}>
        <box flexDirection="row" gap={1} height={1} flexShrink={0} marginBottom={1}>
          <input
            id="collections-query"
            ref={(value: InputRenderable) => {
              bind("collections-query", value);
              localMode(value, (key) => {
                if (key.name !== "enter") return "declined";
                focus("command:collections.filter.open");
                return "consumed";
              });
            }}
            placeholder={props.mode === "narrow" ? "Search…" : "Search Collections…"}
            flexGrow={1}
            flexBasis={0}
            width={0}
            minWidth={0}
            backgroundColor={tokens().colors.surface}
            focusedBackgroundColor={tokens().colors.surface}
            focusedTextColor={tokens().colors.foreground}
            placeholderColor={tokens().colors.mutedForeground}
            value={query()}
            onInput={props.onQuery}
          />
          {commandZone(
            "collections-filter",
            {
              id: "collections.filter.open",
              keys: ["enter", "return"],
              verb: "Filter",
              destination: "Collections filters",
              scope: "page",
              enabled: true,
              danger: false,
            },
            () => {
              props.onScroll?.("collection-browser", selectScrollOffset(collectionBrowser!));
              props.onFilterOpen();
            },
          )}
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
              {commandZone(
                `${id}-keyboard`,
                {
                  id: `collections.filter.clear.${dimension}`,
                  keys: ["enter", "return"],
                  verb: `${dimension}: ${value} Clear`,
                  destination: "Collections",
                  scope: "page",
                  enabled: true,
                  danger: false,
                },
                clear,
              )}
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
            {commandZone(
              "clear-all-collections-filters-keyboard",
              {
                id: "collections.filter.clear-all",
                keys: ["enter", "return"],
                verb: "Clear all",
                destination: "Collections",
                scope: "page",
                enabled: true,
                danger: false,
              },
              props.onClearAll,
            )}
          </box>
        </Show>
      </Show>
      <DataList
        id="collection-browser"
        ref={(value: SelectRenderable) => {
          collectionBrowser = value;
          bind("browser", value);
          localMode(value, (key) => {
            if (key.name === "up" && value.getSelectedIndex() === 0) {
              if (!focus("collections-query")) focus("command:new-collection");
              return "consumed";
            }
            if (key.name === "right") {
              choose(value.getSelectedIndex(), true);
              return "consumed";
            }
            return "declined";
          });
          props.onWorkAreaTarget?.(value);
          bindScroll("collection-browser", value, options);
        }}
        options={options()}
        flexGrow={1}
        minHeight={0}
        width="100%"
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
            </>
          ) : (
            <>
              <text>No Collections match the current search or filters.</text>
              <text>Clear the search and filters to see Collections.</text>
            </>
          )}
        </box>
      </Show>
      <text fg={tokens().colors.mutedForeground}>Enter details</text>
    </Pane>
  );
  const CollectionPreview = () => (
    <Pane id="collection-preview-pane" title="Collection overview" width="57%">
      <Show
        when={selected() ?? collections()[0]}
        fallback={
          <text fg={tokens().colors.mutedForeground}>
            Select a Collection to preview its Skills.
          </text>
        }
      >
        {(collection) => (
          <>
            <text wrapMode="word">
              <strong>{collection().id}</strong>
            </text>
            <scrollbox
              id="collection-preview"
              flexGrow={1}
              minHeight={0}
              marginTop={1}
              ref={(target) => bind("inspector", target)}
            >
              <text wrapMode="word" fg={tokens().colors.mutedForeground}>
                A reusable group of Skills. Enter opens membership and relationship details.
              </text>
              <box flexDirection="column" marginTop={1} marginBottom={1}>
                <MetadataGrid
                  fields={[
                    {
                      label: "Skills",
                      value: String(collection().members.length),
                      priority: 1,
                      wrap: "word",
                      narrow: "stack",
                    },
                    {
                      label: "Origin",
                      value: collectionContributionText(collection()),
                      priority: 1,
                      wrap: "word",
                      narrow: "stack",
                    },
                    {
                      label: "Agent access",
                      value: agentUse().includes(collection().id)
                        ? "Used directly"
                        : "Not used directly",
                      priority: 1,
                      wrap: "word",
                      narrow: "stack",
                    },
                    {
                      label: "Links",
                      value: String(collection().links.length),
                      priority: 1,
                      wrap: "word",
                      narrow: "stack",
                    },
                    {
                      label: "References",
                      value: String(collection().references.length),
                      priority: 1,
                      wrap: "word",
                      narrow: "stack",
                    },
                  ]}
                />
              </box>
              <text fg={tokens().colors.mutedForeground}>SKILLS</text>
              <For each={collection().members}>
                {(member) => (
                  <box flexDirection="column" marginTop={1}>
                    <text wrapMode="word">{member.name}</text>
                    <text
                      wrapMode="word"
                      fg={tokens().colors.mutedForeground}
                    >{`${member.address.source}/${member.address.path}`}</text>
                  </box>
                )}
              </For>
              <Show when={!collection().members.length}>
                <text fg={tokens().colors.mutedForeground}>No members yet.</text>
              </Show>
            </scrollbox>
          </>
        )}
      </Show>
    </Pane>
  );
  const CollectionList = () => (
    <Show
      when={filterState().open}
      fallback={
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <BrowserList />
          <Show when={props.mode === "wide"}>
            <box width="57%" flexGrow={1} minHeight={0} minWidth={0} flexDirection="column">
              <Show when={selected()} keyed fallback={<CollectionPreview />}>
                {(_collection) => detail()}
              </Show>
            </box>
          </Show>
        </box>
      }
    >
      <FilterPanel />
    </Show>
  );
  const content = (
    <Show
      when={props.mode !== "wide" && props.surface === "detail" && selected()}
      keyed
      fallback={<CollectionList />}
    >
      {(_collection) => detail()}
    </Show>
  );
  return content;
}
