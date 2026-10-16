import {
  InputRenderable,
  Renderable,
  SelectRenderable,
  ScrollBoxRenderable,
  type BoxRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { batch, createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { CollectionView, ConfigDeclarationOwner, ManagementProjection } from "@skill-cli/core";
import type { MemberOriginPath } from "@skill-cli/core";
import {
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
import { Input } from "./ui/input";
import { useTheme } from "./ui/use-theme";
import { DataList } from "./ui/data-list";
import { Pane } from "./ui/pane";
import {
  collectionMemberKey,
  collectionOriginKey,
  type CollectionsReadonly,
} from "./collections/state";
import { SectionTabs } from "./components/section-tabs";
import type { FocusRegistry, FocusTarget } from "./focus";
import {
  RelationshipInspector,
  collectionRelationKey,
  type CollectionMemberOriginRow,
  type CollectionRelationRow,
  type CollectionRelationshipIntent,
} from "./collections/relationship-inspector";
import type { CollectionTableRow } from "./collections/collection-table";
import type { ActionRecord } from "./actions";
import { DataTable, type DataTableColumn, type DataTableAction } from "./ui/data-table";
import { relationshipCommands } from "./collections/relationship-commands";
import type { ExecutableCommand } from "./commands";
import { usePageCommands, usePageReturn } from "./page-navigation";
import { Tree } from "./ui/tree";
import { createFocusRegistry } from "./focus";
import {
  collectionDescendants,
  collectionFilterPathKey,
  deriveCollectionFilterTree,
  findCollectionFilterPath,
} from "./collections/collection-filter-tree";
export type { CollectionRelationshipIntent } from "./collections/relationship-inspector";

function CurrentRowCommands(props: { readonly commands: readonly ExecutableCommand[] }) {
  usePageCommands(() => props.commands);
  return null;
}

const ownerText = (owner: ConfigDeclarationOwner): string =>
  `${owner.level} ${owner.file} ${owner.pointer}`;

const ownerProvenanceText = (owner: ConfigDeclarationOwner): string | undefined =>
  owner.contribution ? `Config Source ${ownerText(owner.contribution.configSource)}` : undefined;

const ownerKey = (owner: ConfigDeclarationOwner): string =>
  JSON.stringify([owner.level, owner.file, owner.pointer, owner.namespace, owner.contribution]);

const relationKey = (
  kind: CollectionRelationRow["kind"],
  collection: string,
  target: string | undefined,
  owner: ConfigDeclarationOwner | undefined,
  name?: string,
): string => JSON.stringify([kind, collection, name, target, owner ? ownerKey(owner) : undefined]);

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
    key: relationKey("collection-use", collectionId, collectionId, owner),
    kind: "collection-use",
    label: "Collection Use",
    owner,
    effect: `${selectors.length} selector${selectors.length === 1 ? "" : "s"} exposed`,
    provenance: ownerProvenanceText(owner),
    intent: { kind: "collection-use", collection: collectionId, owner },
  }));
  if (effective.use.includes(collectionId) && useOwners.length === 0)
    rows.push({
      key: relationKey("collection-use", collectionId, collectionId, undefined),
      kind: "collection-use",
      label: "Collection Use",
      target: collectionId,
      effect: "Owner unavailable · read-only",
    });
  rows.push(
    ...collection.references.map((reference) => ({
      key: relationKey(
        "collection-reference",
        collectionId,
        reference.collection,
        reference.owner,
        reference.name,
      ),
      kind: "collection-reference" as const,
      label: `Reference ${reference.name}`,
      target: reference.collection,
      targetAvailable: effective.collectionsView.some((item) => item.id === reference.collection),
      owner: reference.owner,
      effect: "Browse referenced Collection",
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
        key: relationKey("collection-link", collectionId, link.collection, link.owner),
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
  readonly active?: boolean;
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
  readonly onProblems?: () => void;
}) {
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  const [collectionToolbarWidth, setCollectionToolbarWidth] = createSignal(0);
  const collectionButtonWidth = (label: string) => label.length + 2 * tokens().density.paddingX;
  const utilityCaptions = () => {
    const compact = ["New", "Expand", "Collapse"];
    const full = ["New Collection", "Expand all", "Collapse all"];
    const captions: (string | undefined)[] = [...compact];
    let used = compact.reduce((width, label) => width + collectionButtonWidth(label), 2);
    full.forEach((label, index) => {
      const additional = collectionButtonWidth(label) - collectionButtonWidth(compact[index]!);
      if (used + additional <= collectionToolbarWidth()) {
        captions[index] = undefined;
        used += additional;
      }
    });
    return captions;
  };
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
  let collectionBrowser: ScrollBoxRenderable | undefined;
  let collectionToolbar: BoxRenderable | undefined;
  const treeFocus = props.focusRegistry ?? createFocusRegistry();
  const bindings = new Map<string, () => void>();
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
  const commandZone = (
    id: string,
    record: CommandRecord,
    execute: () => void,
    primary = false,
    caption?: string,
  ) => {
    const owner: FocusOwner = `command:${record.id}`;
    return (
      <CommandControl
        id={id}
        record={record}
        label={caption}
        intent={primary ? "primary" : "neutral"}
        keyboard={!props.executeCommand}
        showDisabledReason={false}
        register={(target) => {
          bind(owner, target);
          localMode(target, (key) => {
            if (!["up", "down", "left", "right"].includes(key.name)) return "declined";
            let pane = target.parent;
            while (pane && !pane.id.endsWith("-pane")) pane = pane.parent;
            const commands = commandsIn(pane?.id ?? "collections-list-pane");
            const index = commands.indexOf(target);
            focusControl(
              commands[
                Math.max(
                  0,
                  Math.min(
                    commands.length - 1,
                    index + (key.name === "up" || key.name === "left" ? -1 : 1),
                  ),
                )
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
  const managedAction = (id: ActionRecord["id"], label?: string, compactCaption?: string) => {
    const record = props.actions?.find((candidate) => candidate.id === id);
    return record
      ? commandZone(
          `collection-action-${id}`,
          label ? { ...record, verb: label } : record,
          () => props.onAction?.(id),
          id === "add-membership",
          compactCaption,
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
  const selected = () => effective().find((item) => item.id === props.collections.selected());
  const tab = (): CollectionTab => (selected() ? props.collections.tab(selected()!.id) : "entries");
  const filterState = props.collections.filter;
  const filterDimension = () => filterState().dimension as CollectionFilterDimension | undefined;
  const filterSearch = () => filterState().search;
  const matching = (values: readonly string[]) =>
    values.filter((value) =>
      value.toLocaleLowerCase().includes(filterSearch().toLocaleLowerCase()),
    );
  const navigator = createMemo(() => {
    const tree = deriveCollectionFilterTree(props.projection(), props.collections.expandedPaths());
    if (!query() && Object.keys(filters()).length === 0) return tree;
    const matches = new Set(collections().map((collection) => collection.id));
    return {
      ...tree,
      rows: tree.rows.filter((row) =>
        [...collectionDescendants(effective(), row.collection)].some((id) => matches.has(id)),
      ),
    };
  });
  const selectedPath = () =>
    navigator().rows.find(
      (row) =>
        row.key === props.collections.selectedPath() &&
        row.collection === props.collections.selected(),
    )?.key ?? navigator().rows.find((row) => row.collection === props.collections.selected())?.key;
  const selectedNavigatorRow = () => navigator().rows.find((row) => row.key === selectedPath());
  const NavigatorIssue = () => {
    let root: ScrollBoxRenderable | undefined;
    usePageReturn(() =>
      selectedNavigatorRow()?.issue && (props.surface === "browser" || props.mode === "wide")
        ? {
            record: {
              id: "collections.issue.back",
              keys: ["enter", "return"],
              verb: "Back",
              destination: "Collections",
              scope: "page",
              enabled: true,
              danger: false,
            },
            anchor: () => root,
            execute: () => {
              focus("browser");
            },
          }
        : undefined,
    );
    return (
      <scrollbox
        id="collection-tree-issue"
        flexGrow={1}
        minHeight={0}
        focusable
        ref={(target) => {
          root = target;
          bind("collection-tree-issue", target);
        }}
      >
        <text wrapMode="word" fg={tokens().colors.warning}>
          {selectedNavigatorRow()?.issue}
        </text>
        <text wrapMode="word">{`Target: ${selectedNavigatorRow()?.collection ?? "Unavailable"}`}</text>
        <text wrapMode="word">{`Path: ${
          selectedNavigatorRow()
            ?.path.segments.map((segment) => segment.reference?.name ?? segment.collection)
            .join(" / ") ?? "Unavailable"
        }`}</text>
      </scrollbox>
    );
  };
  const filterKey = createMemo(() => JSON.stringify([query(), filters()]));
  createEffect(() => {
    filterKey();
    untrack(() => {
      if (!query() && Object.keys(filters()).length === 0) return;
      const expanded = { ...props.collections.expandedPaths() };
      for (const collection of collections())
        for (const key of findCollectionFilterPath(props.projection(), collection.id)
          ?.ancestorKeys ?? [])
          expanded[key] = true;
      props.collections.setExpandedPaths(expanded);
    });
  });
  createEffect(() => {
    const id = props.collections.selected();
    if (!id || selectedPath()) return;
    const match = findCollectionFilterPath(props.projection(), id);
    if (!match) return;
    untrack(() =>
      batch(() => {
        for (const key of match.ancestorKeys) props.collections.setPathExpanded(key, true);
        props.collections.selectPath(collectionFilterPathKey(match.path));
      }),
    );
  });
  const selectPath = (key: string) => {
    const row = navigator().rows.find((candidate) => candidate.key === key);
    if (!row) return;
    batch(() => {
      props.collections.selectPath(key);
      props.onSelect(row.collection);
    });
  };
  const expandAll = () =>
    props.collections.setExpandedPaths(
      Object.fromEntries(
        deriveCollectionFilterTree(props.projection(), "all")
          .rows.filter((row) => row.expandable)
          .map((row) => [row.key, true]),
      ),
    );
  const collapseAll = () => {
    const row = navigator().rows.find((candidate) => candidate.key === selectedPath());
    const root = row?.path.segments[0];
    batch(() => {
      props.collections.setExpandedPaths({});
      if (root) {
        props.collections.selectPath(collectionFilterPathKey({ segments: [root] }));
        props.onSelect(root.collection);
      }
    });
    focus("command:collections.expand-all");
  };
  const FilterPanel = (panel: { readonly dimension?: CollectionFilterDimension }) => {
    const dimension = panel.dimension;
    let root: BoxRenderable | undefined;
    const backRecord = (): CommandRecord => ({
      id: "collections.filter.back",
      keys: ["enter", "return"],
      verb: "Back",
      destination: dimension ? "Filter categories" : "Collections",
      scope: "page",
      enabled: true,
      danger: false,
    });
    const goBack = () => (dimension ? props.onFilterDimension() : props.onFilterClose());
    const sharedReturn = usePageReturn(() =>
      filterState().open
        ? {
            record: backRecord(),
            anchor: () => root,
            execute: goBack,
          }
        : undefined,
    );
    const values = createMemo(() =>
      dimension
        ? matching(collectionFilterValues(dimension, effective()))
        : matching(collectionFilterDimensions),
    );
    const canClear = dimension !== undefined && filters()[dimension] !== undefined;
    return (
      <box
        flexDirection="column"
        border
        paddingLeft={1}
        flexGrow={1}
        minHeight={0}
        ref={(target) => {
          root = target;
        }}
      >
        <Input
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
          options={[
            ...(canClear
              ? [{ name: `Clear ${dimension} filter`, description: "", value: "" }]
              : []),
            ...values().map((value) => ({
              name: `${dimension && filters()[dimension] === value ? "✓ " : ""}${value}`,
              description: "",
              value,
            })),
          ]}
          showDescription={false}
          flexGrow={1}
          minHeight={1}
          onSelect={(index) => {
            if (canClear && index === 0 && dimension) {
              props.onClear(dimension);
              props.onFilterClose();
              return;
            }
            const value = values()[index - (canClear ? 1 : 0)];
            if (!value) return;
            if (dimension) {
              props.onFilter(dimension, value);
              props.onFilterClose();
            } else props.onFilterDimension(value as CollectionFilterDimension);
          }}
        />
        <Show when={!sharedReturn}>
          {commandZone("collections-filter-back", backRecord(), goBack)}
        </Show>
      </box>
    );
  };
  const detail = (collection: CollectionView | undefined) => {
    if (!collection)
      return (
        <Show
          when={selectedNavigatorRow()?.issue}
          fallback={
            <box flexDirection="column" flexGrow={1} paddingLeft={1}>
              {props.surface === "detail" ? (
                <>
                  <text>Collection unavailable.</text>
                  <text>Return to Collections to choose an available Collection.</text>
                </>
              ) : effective().length === 0 ? (
                <>
                  <text>Collections group Skills for reuse and agent disclosure.</text>
                  <text>Create a Collection here, or install one supplied by a repository.</text>
                </>
              ) : (
                <text>Select a Collection to see its Entries and Relations.</text>
              )}
            </box>
          }
        >
          <Pane
            id="collection-detail-pane"
            borderTitle={selectedNavigatorRow()?.collection ?? "Unavailable Collection"}
          >
            <box id="collection-tree-issue-pane" flexGrow={1} minHeight={0}>
              <NavigatorIssue />
            </box>
          </Pane>
        </Show>
      );
    const selectedTab = createMemo(() => tab());
    const [controlWidth, setControlWidth] = createSignal(0);
    let controls: BoxRenderable | undefined;
    let relationshipSelect: BoxRenderable | undefined;
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
    const relationRows = collectionRelationRows(collection.id, props.projection()!);
    const inspector = () => props.collections.inspector();
    const workAreaTitle = () => {
      const current = inspector();
      if (!current || current.collection !== collection.id) return "Collection details";
      if (current.kind === "collection") return collection.id;
      if (current.kind === "membership")
        return (
          collection.members.find(
            (member) =>
              collectionMemberKey(member) === current.member ||
              `${member.name}:0` === current.member,
          )?.name ?? "Membership details"
        );
      return (
        relationRows.find((relation) => collectionRelationKey(relation) === current.relation)
          ?.label ?? "Relationship details"
      );
    };
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
    type ContentDomain = (typeof memberRows)[number] | CollectionRelationRow;
    type ContentRow = CollectionTableRow<ContentDomain>;
    const relationRowsForTable = createMemo<readonly ContentRow[]>(() =>
      selectedTab() === "entries"
        ? [
            ...memberRows.map(
              (row): ContentRow => ({
                key: row.key,
                value: row.value,
                domain: row,
                cells: [row.name, entryAddress(row), row.origin],
                destination: "Membership details" as const,
              }),
            ),
            ...relationRows
              .filter((row) => row.kind === "collection-reference")
              .map(
                (row): ContentRow => ({
                  key: collectionRelationKey(row),
                  value: collectionRelationKey(row),
                  domain: row,
                  cells: [
                    row.intent?.kind === "collection-reference" ? row.intent.name : row.label,
                    row.target ?? "Unavailable",
                    "Reference",
                  ],
                  destination: "Collection details",
                }),
              ),
          ]
        : relationRows.map((row) => ({
            key: collectionRelationKey(row),
            value: collectionRelationKey(row),
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
    const currentRow = () =>
      relationRowsForTable().find(
        (row) => row.value === props.collections.selectedRow(collection.id, selectedTab()),
      ) ?? relationRowsForTable()[0];
    const compactSelectionDescription = () => {
      const rows = relationRowsForTable();
      const selectedValue = props.collections.selectedRow(collection.id, selectedTab());
      const row = rows.find((candidate) => candidate.value === selectedValue) ?? rows[0];
      if (!row) return undefined;
      if (row.domain.kind === "member") {
        const member = row.domain;
        return (
          props
            .projection()
            ?.installedSkills.find(
              (skill) =>
                skill.address.source === member.address.source &&
                skill.address.path === member.address.path,
            )?.description ?? "Skill description unavailable."
        );
      }
      const relation = row.domain;
      return relation.intent?.kind === "collection-reference"
        ? relation.intent.description
        : relation.effect;
    };
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
    const inspectRow = (row = currentRow()) => {
      if (!row) return;
      props.onRelationship(
        row.domain.kind === "member"
          ? { kind: "collection-membership-inspect", collection: collection.id, member: row.value }
          : { kind: "collection-relation-inspect", collection: collection.id, relation: row.value },
      );
    };
    const memberAvailable = (row: ContentRow) => {
      const member = row.domain;
      return (
        member.kind !== "member" ||
        props
          .projection()
          ?.installedSkills.some(
            (skill) =>
              skill.address.source === member.address.source &&
              skill.address.path === member.address.path &&
              skill.owner.health === "healthy",
          )
      );
    };
    const columns = (): readonly DataTableColumn<ContentRow>[] =>
      selectedTab() === "entries"
        ? [
            {
              id: "name",
              header: "Name",
              minWidth: controlWidth() >= 54 ? 24 : 12,
              cell: (row) => row.cells[0] ?? "",
            },
            {
              id: "kind",
              header: "Type",
              width: 10,
              optional: true,
              cell: (row) => (row.domain.kind === "member" ? "Skill" : "Collection"),
            },
            {
              id: "target",
              header: "Source / target",
              minWidth: 12,
              maxWidth: 32,
              optional: true,
              cell: (row) => row.cells[1] ?? "",
            },
            {
              id: "origin",
              header: "Origin",
              minWidth: 10,
              maxWidth: 24,
              optional: true,
              cell: (row) => row.cells[2] ?? "",
            },
          ]
        : [
            { id: "name", header: "Relation", minWidth: 12, cell: (row) => row.cells[0] ?? "" },
            {
              id: "target",
              header: "Target",
              minWidth: 10,
              optional: true,
              cell: (row) => row.cells[1] ?? "",
            },
            {
              id: "owner",
              header: "Owner",
              minWidth: 8,
              maxWidth: 12,
              optional: true,
              cell: (row) => row.cells[2] ?? "",
            },
          ];
    const selectedOrigins = () => props.collections.selectedOrigins(collection.id);
    const checkedRows = createMemo(
      () =>
        new Set(
          memberRows
            .filter(
              (row) =>
                row.origins.length &&
                row.origins.every((origin) => selectedOrigins().includes(origin.key)),
            )
            .map((row) => row.value),
        ),
    );
    const partialRows = createMemo(
      () =>
        new Set(
          memberRows
            .filter(
              (row) =>
                row.origins.some((origin) => selectedOrigins().includes(origin.key)) &&
                !row.origins.every((origin) => selectedOrigins().includes(origin.key)),
            )
            .map((row) => row.value),
        ),
    );
    const contentUnavailable = () => {
      const row = currentRow();
      if (row && !memberAvailable(row)) return "Installed Skill unavailable · Manage for ownership";
      if (row?.domain.kind === "collection-reference" && row.domain.targetAvailable === false)
        return "Referenced Collection unavailable";
      return undefined;
    };
    const commandsForRow = (row: ContentRow) => {
      const domain = row.domain;
      return relationshipCommands(
        collection.id,
        domain.kind === "member"
          ? {
              kind: "membership",
              member: { ...domain, available: memberAvailable(row) },
              origin: domain.origins.length === 1 ? domain.origins[0]?.path : undefined,
            }
          : { kind: "relation", relation: domain },
      );
    };
    const rowActions = (row: ContentRow): readonly DataTableAction[] => [
      {
        key: "manage",
        record: {
          id: `collection.row.${encodeURIComponent(collection.id)}.${encodeURIComponent(row.value)}.manage`,
          keys: ["enter", "return"],
          scope: "page",
          enabled: true,
          danger: false,
          verb: "Manage…",
          destination: `${collection.id} / ${row.cells[0]}`,
        },
        execute: () => inspectRow(row),
      },
    ];
    const currentCommands = (): readonly ExecutableCommand[] => {
      if (inspector() || props.collections.filter().open) return [];
      const row = currentRow();
      if (!row) return [];
      // Reading has an exact address even when managing requires choosing an origin.
      const commands = commandsForRow(row).filter(
        (command) =>
          row.domain.kind !== "member" ||
          row.domain.origins.length <= 1 ||
          command.id === "membership.open-skill",
      );
      return commands.map((command) => ({
        record: {
          ...command,
          destination: `${collection.id} / ${row.cells[0]} · ${command.destination}`,
        },
        execute: () => {
          if (!command.enabled || currentRow() !== row || inspector()) return;
          if (command.id === "membership.remove" && row.domain.kind === "member")
            props.onRemoveOrigins?.(collection.id, row.domain.origins);
          else if (command.intent) props.onRelationship(command.intent);
        },
      }));
    };
    return (
      <Pane
        id="collection-detail-pane"
        borderTitle={inspector() ? workAreaTitle() : collection.id}
        borderBottomTitle={
          contentUnavailable() ??
          (selectedNavigatorRow()?.cycle ? "Reference cycle · About for reason" : undefined)
        }
      >
        <Show when={!props.collections.inspector()}>
          <CurrentRowCommands commands={currentCommands()} />
          <box height={1} flexShrink={0} flexDirection="row">
            <box flexGrow={1} minWidth={0}>
              <SectionTabs
                id="collection-tabs"
                options={[
                  { label: "Contents", value: "entries" },
                  {
                    label: "Relations",
                    value: "relations",
                  },
                ]}
                value={selectedTab()}
                owner="inspector"
                focusRegistry={props.focusRegistry}
                onPrimaryPointerEntry={props.onInspectorFocus}
                onActivate={() => focus("collection-relationships")}
                onNavigate={(value) => {
                  const surface = `collection:${collection.id}:${selectedTab()}`;
                  const selectedRow = props.collections.selectedRow(collection.id, selectedTab());
                  props.collections.selectRow(collection.id, selectedTab(), selectedRow);
                  const body = relationshipSelect?.findDescendantById(
                    "collection-relationships-body",
                  );
                  if (body instanceof ScrollBoxRenderable)
                    props.onScroll?.(surface, body.scrollTop);
                  props.onTab(collection.id, value);
                }}
              />
            </box>
            {commandZone(
              "collection-about",
              {
                id: "collection.about",
                keys: ["enter", "return"],
                verb: "Info",
                destination: collection.id,
                scope: "page",
                enabled: true,
                danger: false,
              },
              () => props.onRelationship({ kind: "collection-info", collection: collection.id }),
            )}
          </box>
          <box
            id="collection-content-controls-pane"
            flexDirection="row"
            height={1}
            flexShrink={0}
            gap={1}
            ref={(value: BoxRenderable) => {
              controls = value;
              setControlWidth(value.width);
            }}
            onSizeChange={() => setControlWidth(controls?.width ?? 0)}
          >
            {managedAction("add-membership", "Add Skills…")}
            {managedAction("add-reference", "Add Reference…")}
            <Show when={controlWidth() >= 54}>
              {managedAction("add-link", "Link…")}
              {managedAction("import-collection", "Import…")}
            </Show>
          </box>
          <Show when={selectedOrigins().length > 0}>
            <box id="collection-batch-pane" flexDirection="row" height={1} flexShrink={0}>
              <text flexGrow={1} minWidth={0} height={1} wrapMode="none">
                {selectedOrigins().length} origins checked
              </text>
              {commandZone(
                "remove-from-collection",
                {
                  id: "collection.remove-selected-origins",
                  keys: ["enter", "return"],
                  verb: "Review removal",
                  destination: `${collection.id} · ${selectedOrigins().length} checked origins`,
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
            </box>
          </Show>
          <Show when={selectedTab()} keyed>
            {(view) => (
              <box id="collection-content-data-pane" flexGrow={1} minHeight={0}>
                <DataTable
                  id="collection-relationships"
                  rows={relationRowsForTable()}
                  columns={columns()}
                  actions={{
                    width: 9,
                    compactWidth: 9,
                    items: rowActions,
                    registerCommand: props.registerCommand,
                  }}
                  rowKey={(row) => row.value}
                  currentKey={props.collections.selectedRow(collection.id, view)}
                  onCurrentChange={(value) =>
                    props.collections.selectRow(collection.id, view, value)
                  }
                  initialScrollTop={props.collections.scroll(`collection:${collection.id}:${view}`)}
                  onScroll={(scroll) =>
                    props.onScroll?.(`collection:${collection.id}:${view}`, scroll)
                  }
                  selection={
                    view === "entries"
                      ? {
                          get keys() {
                            return checkedRows();
                          },
                          get partialKeys() {
                            return partialRows();
                          },
                          get showIndicators() {
                            return true;
                          },
                          canSelect: (row) => row.domain.kind === "member",
                          onToggle: (row) =>
                            toggleSelectedEntryOrigins(relationRowsForTable().indexOf(row)),
                        }
                      : undefined
                  }
                  focusRegistry={props.focusRegistry}
                  emptyText={
                    selectedTab() === "entries"
                      ? "Add Skills or a Reference to this Collection."
                      : "No relationships in this Collection."
                  }
                  ref={(value) => {
                    relationshipSelect = value;
                    bind("collection-relationships", value);
                  }}
                  width="100%"
                  flexGrow={1}
                  onActivate={(option) => {
                    if (!memberAvailable(option)) return;
                    props.collections.selectRow(collection.id, view, option.value);
                    if (option.domain.kind === "member")
                      props.onRelationship({
                        kind: "collection-open-skill",
                        collection: collection.id,
                        address: option.domain.address,
                      });
                    else if (view === "entries" && option.domain.kind === "collection-reference") {
                      if (option.domain.target && option.domain.targetAvailable !== false)
                        props.onRelationship({
                          kind: "collection-open-collection",
                          collection: collection.id,
                          target: option.domain.target,
                        });
                    } else inspectRow(option);
                  }}
                />
              </box>
            )}
          </Show>
          <Show when={terminal().height > 18 && compactSelectionDescription()}>
            <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
              {compactSelectionDescription()}
            </text>
          </Show>
        </Show>
        <RelationshipInspector
          collection={collection}
          contextIssue={selectedNavigatorRow()?.issue}
          memberOrigins={memberOrigins}
          relationRows={relationRows}
          memberDescription={(address) =>
            props
              .projection()
              ?.installedSkills.find(
                (skill) =>
                  skill.address.source === address.source && skill.address.path === address.path,
              )?.description
          }
          memberAvailable={(address) => {
            const skill = props
              .projection()
              ?.installedSkills.find(
                (candidate) =>
                  candidate.address.source === address.source &&
                  candidate.address.path === address.path,
              );
            return skill?.owner.health === "healthy";
          }}
          collections={props.collections}
          focusRegistry={props.focusRegistry}
          bind={bind}
          onRelationship={props.onRelationship}
          onScroll={props.onScroll}
          registerCommand={props.registerCommand}
          executeCommand={props.executeCommand}
        />
      </Pane>
    );
  };
  const BrowserList = () => (
    <Pane
      id="collections-list-pane"
      borderTitle={
        props.projection()?.effective.status === "complete"
          ? `Collections · ${collections().length}`
          : "Collections"
      }
      borderBottomTitle={
        selectedNavigatorRow()?.issue
          ? selectedNavigatorRow()?.cycle
            ? "Reference cycle · Enter contents"
            : "Unavailable · Enter reason"
          : undefined
      }
      width="100%"
    >
      <Show when={effective().length > 0}>
        <box flexDirection="column" height={3} gap={1} flexShrink={0}>
          <box
            id="collections-search-controls-pane"
            flexDirection="row"
            gap={1}
            height={1}
            flexShrink={0}
          >
            <Input
              id="collections-query"
              ref={(value: InputRenderable) => {
                bind("collections-query", value);
                localMode(value, (key) => {
                  if (key.name !== "enter") return "declined";
                  focus("browser");
                  return "consumed";
                });
              }}
              placeholder="Search…"
              flexGrow={1}
              flexBasis={0}
              width={0}
              minWidth={0}
              value={query()}
              onInput={props.onQuery}
            />
            {commandZone(
              "collections-filter",
              {
                id: "collections.filter.open",
                keys: ["enter", "return"],
                verb: Object.keys(filters()).length
                  ? `Filter ${Object.keys(filters()).length}`
                  : "Filter",
                destination: "Collections filters",
                scope: "page",
                enabled: true,
                danger: false,
              },
              () => {
                if (collectionBrowser)
                  props.onScroll?.("collection-browser", collectionBrowser.scrollTop);
                props.onFilterOpen();
              },
            )}
            <Show when={Boolean(query()) || Object.keys(filters()).length > 0}>
              {commandZone(
                "clear-all-collections-filters-keyboard",
                {
                  id: "collections.filter.clear-all",
                  keys: ["enter", "return"],
                  verb: "Clear filters",
                  destination: "Collections",
                  scope: "page",
                  enabled: true,
                  danger: false,
                },
                props.onClearAll,
                false,
                collectionToolbarWidth() < 46 ? "Clear" : undefined,
              )}
            </Show>
          </box>
          <box
            id="collections-tree-controls-pane"
            flexDirection="row"
            gap={1}
            height={1}
            flexShrink={0}
            ref={(target: BoxRenderable) => {
              collectionToolbar = target;
              setCollectionToolbarWidth(target.width);
            }}
            onSizeChange={() => {
              setCollectionToolbarWidth(collectionToolbar?.width ?? 0);
            }}
          >
            {managedAction("new-collection", undefined, utilityCaptions()[0])}
            {commandZone(
              "collections-expand-all",
              {
                id: "collections.expand-all",
                keys: ["enter", "return"],
                verb: "Expand all",
                destination: "All Collection Reference branches",
                scope: "page",
                enabled: effective().some((collection) => collection.references.length > 0),
                danger: false,
              },
              expandAll,
              false,
              utilityCaptions()[1],
            )}
            {commandZone(
              "collections-collapse-all",
              {
                id: "collections.collapse-all",
                keys: ["enter", "return"],
                verb: "Collapse all",
                destination: "All Collection Reference branches",
                scope: "page",
                enabled: Object.values(props.collections.expandedPaths()).some(Boolean),
                danger: false,
              },
              collapseAll,
              false,
              utilityCaptions()[2],
            )}
          </box>
        </box>
      </Show>
      <Show when={effective().length === 0 && props.projection()?.effective.status === "complete"}>
        {managedAction("new-collection", "New Collection…")}
      </Show>
      <Tree
        id="collection-browser"
        ref={(value) => {
          collectionBrowser = value;
          props.onWorkAreaTarget?.(value);
        }}
        rows={navigator().rows}
        selectedKey={selectedPath()}
        expandedKeys={
          new Set(
            Object.entries(props.collections.expandedPaths())
              .filter(([, open]) => open)
              .map(([key]) => key),
          )
        }
        activationMode="activate"
        focusOwner="browser"
        focusRegistry={treeFocus}
        active={props.active !== false && !props.collections.filter().open}
        initialScrollTop={props.collections.snapshot().scrolls["collection-browser"]}
        onScrollChange={(scroll) => props.onScroll?.("collection-browser", scroll)}
        onSelect={selectPath}
        onExpandedChange={(key, expanded) => props.collections.setPathExpanded(key, expanded)}
        onActivate={(key) => {
          const row = navigator().rows.find((candidate) => candidate.key === key);
          if (!row) return;
          if (row.issue && !effective().some((collection) => collection.id === row.collection)) {
            focus("collection-tree-issue");
            return;
          }
          if (collectionBrowser)
            props.onScroll?.("collection-browser", collectionBrowser.scrollTop);
          props.onDetail();
        }}
      />
      <Show when={props.mode !== "wide" && selectedNavigatorRow()?.issue}>
        <box id="collection-tree-issue-pane" height={3} flexShrink={0}>
          <NavigatorIssue />
        </box>
      </Show>
      <Show when={collections().length === 0}>
        <box flexDirection="column" paddingTop={1}>
          {!props.projection() ? (
            <text>Loading Collections…</text>
          ) : props.projection()?.effective.status !== "complete" ? (
            <>
              <text wrapMode="word">Collections unavailable. Check workspace Problems.</text>
              {commandZone(
                "collections-open-problems",
                {
                  id: "collections.open-problems",
                  keys: ["enter"],
                  verb: "View Problems",
                  destination: "Workspace Problems",
                  scope: "page",
                  enabled: !!props.onProblems,
                  danger: false,
                },
                () => props.onProblems?.(),
              )}
            </>
          ) : effective().length === 0 ? (
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
    </Pane>
  );
  const CollectionList = () => (
    <Show
      when={filterState().open}
      fallback={
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box
            width={
              props.mode === "wide"
                ? Math.min(38, Math.max(36, Math.floor(terminal().width * 0.28)))
                : "100%"
            }
            flexShrink={0}
            minHeight={0}
          >
            <BrowserList />
          </box>
          <Show when={props.mode === "wide"}>
            <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="column">
              <Show when={selected()} keyed fallback={detail(undefined)}>
                {(collection) => detail(collection)}
              </Show>
            </box>
          </Show>
        </box>
      }
    >
      <Show when={filterDimension() ?? ("dimensions" as const)} keyed>
        {(dimension) => (
          <FilterPanel dimension={dimension === "dimensions" ? undefined : dimension} />
        )}
      </Show>
    </Show>
  );
  const content = (
    <Show when={props.surface === "detail"} fallback={<CollectionList />}>
      <Show when={selected()} keyed fallback={detail(undefined)}>
        {(collection) => detail(collection)}
      </Show>
    </Show>
  );
  return content;
}
