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
import type { CollectionView } from "@skill-cli/core";
import {
  collectionFilterDimensions,
  collectionFilterValues,
  filterCollections,
  type CollectionFilterDimension,
} from "./collections-filter";
import type { CommandRecord, FocusOwner } from "./types";
import { CommandControl } from "./command-control";
import { Input } from "./ui/input";
import { useTheme } from "./ui/use-theme";
import { DataList } from "./ui/data-list";
import { Pane } from "./ui/pane";
import type { FocusRegistry, FocusTarget } from "./focus";
import { CollectionDetail } from "./collections/collection-detail";
import type { CollectionsPageProps } from "./collections/page-props";
import type { ActionRecord } from "./actions";
import { usePageReturn } from "./page-navigation";
import { Tree } from "./ui/tree";
import { createFocusRegistry } from "./focus";
import {
  collectionDescendants,
  collectionFilterPathKey,
  deriveCollectionFilterTree,
  findCollectionFilterPath,
} from "./collections/collection-filter-tree";
export type { CollectionRelationshipIntent } from "./collections/relationship-inspector";

export {
  collectionRelationRows,
  collectionRemovalPlan,
  type CollectionRemovalRow,
} from "./collections/relationship-model";

export function CollectionsPage(props: CollectionsPageProps) {
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
    return (
      <CollectionDetail
        {...props}
        collection={collection}
        issue={selectedNavigatorRow()?.issue}
        cycle={selectedNavigatorRow()?.cycle}
        bind={bind}
        commandZone={commandZone}
        managedAction={managedAction}
      />
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
