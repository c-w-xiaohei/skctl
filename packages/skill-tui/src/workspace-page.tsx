import type { ManagementCapability, ManagementProjection } from "@skill-cli/core";
import type { SkillAddress } from "@skill-cli/core";
import {
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  Renderable,
  type BaseRenderable,
} from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import type { ActionRecord } from "./actions";
import { createFocusRegistry, type FocusRegistry } from "./focus";
import type {
  CommandExecution,
  CommandRecord,
  CommandRegistration,
  FocusOwner,
  LayoutMode,
  NarrowLevel,
  NavigationSurface,
  ReaderState,
  RouteHandoff,
  SkillsView,
} from "./types";
import { sameSkillAddress, skillAddressKey } from "./types";
import type { WorkspaceReadonly, ProblemRow, SourceBrowseView } from "./workspace/state";
import { filterProblemRows, problemRowKey, problemRows } from "./workspace/state";
import { unassignedSkills, type CollectionsReadonly } from "./collections/state";
import {
  deriveAgentAccessTree,
  exposureTreePathKey,
  type AgentAccessTreeRow,
} from "./collections/agent-access-tree";
import {
  collectionFilterPathKey,
  deriveCollectionFilterTree,
  findCollectionFilterPath,
} from "./collections/collection-filter-tree";
import {
  CollectionsPage,
  type CollectionRelationshipIntent,
  type CollectionRemovalRow,
} from "./collections-page";
import { filterSkills, skillSearchMatch } from "./skills-filter";
import { restoreSelectState, selectScrollOffset } from "./select-scroll";
import { Reader } from "./reader";
import { CommandControl } from "./command-control";
import { usePageReturn } from "./page-navigation";
import { Input } from "./ui/input";
import { SectionTabs } from "./components/section-tabs";
import { Pane } from "./ui/pane";
import { MetadataGrid, type MetadataField } from "./ui/metadata-grid";
import { useTheme } from "./ui/use-theme";
import { DataList } from "./ui/data-list";
import { DataTable } from "./ui/data-table";
import { Tree } from "./ui/tree";
import { formatColumns, inlineNameColumnWidth } from "./ui/list-text";
import { SourceUpdatesPage, UpdatesPage } from "./updates/page";
import type { UpdateAddress } from "./updates/scope";
import type { UpdatesState, UpdateRun } from "./updates/state";

export interface WorkspacePageProps {
  readonly surface: NavigationSurface;
  readonly workspace: WorkspaceReadonly;
  readonly collections: CollectionsReadonly;
  readonly reader: () => ReaderState;
  readonly overlay?: () => boolean;
  readonly mode: LayoutMode;
  readonly narrowLevel: NarrowLevel;
  readonly handoff?: RouteHandoff;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  /** App owns deferred focus across page transitions; the page only requests a region. */
  readonly onRequestFocus?: (owner: FocusOwner) => void;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly actions: readonly ActionRecord[];
  readonly onSelectSource: (source: string) => void;
  readonly onSkill: (address: SkillAddress, intent: "select" | "open") => void;
  readonly onToggleSkill: (address: SkillAddress) => void;
  readonly onSkillRelationship: (value: string) => void;
  readonly onSourceRelationship: (value: string) => void;
  readonly onOpenSourceSkills?: (source: string) => void;
  readonly onSourceBrowseView?: (source: string, patch: Partial<SourceBrowseView>) => void;
  readonly onSelectSourceRelationship: (value: string, scroll: number) => void;
  readonly onFirstSkill: () => void;
  readonly onDetail: () => void;
  readonly onSkillsView: (view: SkillsView) => void;
  readonly onRepairCurrentExposure: (
    level: "global" | "project" | "local",
    section: "collections",
    collection?: string,
  ) => void;
  readonly onEnableManagedOpenCode: (level: "global" | "project" | "local") => void;
  readonly onClearSourceFilter: () => void;
  readonly onQuery: (value: string) => void;
  readonly onOpenFilter: () => void;
  readonly onClearAllFilters: () => void;
  readonly onClearFilter: (dimension: string) => void;
  readonly onSkillFilter?: (dimension: string, value?: string) => void;
  readonly onInspectorFocus: () => void;
  readonly onReaderPatch: (value: Partial<ReaderState>) => void;
  readonly onReaderFindCommit: (value: string) => void;
  readonly onResources: (address: SkillAddress) => void;
  readonly onReadResource: (address: SkillAddress, path: string) => void;
  readonly onRetryResource: (address: SkillAddress) => void;
  readonly onRetryContent?: (address: SkillAddress) => void;
  readonly onReloadContent?: (address: SkillAddress) => void;
  readonly onResourceBack: () => void;
  readonly onDetailsAction: (id: ActionRecord["id"]) => void;
  readonly onDetailsRelationship: (value: string) => void;
  readonly onDetailsScroll: (scroll: number) => void;
  readonly onSelectCollection: (collection: string) => void;
  readonly onCollectionQuery: (value: string) => void;
  readonly onCollectionFilter: (dimension: string, value?: string) => void;
  readonly onClearCollectionFilter: (dimension: string) => void;
  readonly onClearAllCollectionFilters: () => void;
  readonly onCollectionFilterOpen: () => void;
  readonly onCollectionFilterDimension: (
    dimension?: import("./collections-filter").CollectionFilterDimension,
  ) => void;
  readonly onCollectionFilterSearch: (value: string) => void;
  readonly onCollectionFilterClose: () => void;
  readonly onCollectionTab: (collection: string, tab: import("./types").CollectionTab) => void;
  readonly onCollectionDetail: (collection?: string) => void;
  readonly onCollectionRelationship: (intent: CollectionRelationshipIntent) => void;
  readonly onToggleCollectionOrigin: (collection: string, key: string) => void;
  readonly onToggleCollectionOrigins: (collection: string, keys: readonly string[]) => void;
  readonly onRemoveCollectionOrigins: (
    collection: string,
    rows: readonly CollectionRemovalRow[],
  ) => void;
  readonly onProblem: (intent: NonNullable<ProblemRow["intent"]>, key: string) => void;
  readonly onSelectProblem: (key: string) => void;
  readonly onWorkspaceScroll: (surface: string, scroll: number) => void;
  readonly onCaptureWorkspaceScroll: (surface: string) => void;
  readonly onCollectionScroll: (surface: string, scroll: number) => void;
  readonly onSelectExposurePath: (path: string) => void;
  readonly onToggleExposurePath: (path: import("./collections/state").ExposurePath) => void;
  readonly onSelectCollectionPath?: (path: string) => void;
  readonly onCollectionPathExpanded?: (path: string, expanded: boolean) => void;
  readonly onCollectionBrowserOpen?: (open: boolean) => void;
  /** AgentAccess hands the structural row to the route owner for existing update scope handling. */
  readonly onExposureUpdate?: (row: AgentAccessTreeRow) => void;
  readonly updates?: () => UpdatesState | undefined;
  readonly updatesActive?: () => boolean;
  readonly updatesRun?: () => UpdateRun | undefined;
  readonly updatesCheckingActive?: () => boolean;
  readonly updatesCurrentCheckSource?: () => string | undefined;
  readonly updatesCheckWarning?: () => string | undefined;
  readonly onUpdatesCheck?: (sources?: readonly string[]) => void;
  readonly onUpdatesSubmit?: (addresses: readonly UpdateAddress[]) => void;
  readonly onUpdateSource?: (source: string) => void;
  readonly onUpdatesStop?: () => void;
  readonly onUpdatesStopChecking?: () => void;
  readonly onUpdatesRetry?: () => void;
  readonly onUpdatesOpenSkill?: (address: UpdateAddress, tab?: "skill" | "details") => void;
  readonly previewUpdate?: ManagementCapability["previewUpdate"];
  readonly onUpdatesOpenSource?: (source: string) => void;
  readonly onOpenSourceUpdates?: (source: string) => void;
  readonly onSourceUpdatesDetails?: (source: string) => void;
  readonly sourceUpdates?: () =>
    | {
        readonly source: string;
        readonly query: string;
        readonly filter: "all" | "updates";
      }
    | undefined;
  readonly onSourceUpdatesQuery?: (value: string) => void;
  readonly onSourceUpdatesFilter?: (value: "all" | "updates") => void;
}

const views: readonly { label: string; value: SkillsView }[] = [
  { label: "Agent access", value: "current-exposure" },
  { label: "All Skills", value: "all-installed-skills" },
  { label: "Unassigned", value: "unassigned" },
  { label: "Problems", value: "problems" },
];

const field = (label: string, value: string): MetadataField => ({
  label,
  value,
  priority: 1,
  wrap: "word",
  narrow: "stack",
});

/** Workspace surfaces use the existing state owners; no page-local router or cache. */
export function WorkspacePage(props: WorkspacePageProps) {
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  const workspace = props.workspace;
  const treeFocus = props.focusRegistry ?? createFocusRegistry();
  const allSkills = () => props.projection()?.installedSkills ?? [];
  const collectionViews = createMemo(() => {
    const effective = props.projection()?.effective;
    return effective?.status === "complete" ? effective.collectionsView : undefined;
  });
  const section = workspace.section;
  const split = () => props.mode === "wide";
  const detail = () => props.narrowLevel === "detail";
  const compactCollections = () => terminal().width < 132 && workspace.collectionBrowserOpen();
  const scopeSkills = () =>
    workspace.skillsView() === "unassigned"
      ? props.projection()
        ? unassignedSkills(props.projection()!)
        : []
      : allSkills();
  const skills = createMemo(() =>
    filterSkills(scopeSkills(), {
      query: workspace.query(),
      filters: workspace.filters(),
      source: workspace.sourceFilter(),
      agentStatus: props.projection()?.effective.agent.status,
      collectionViews: collectionViews(),
    }),
  );
  const skill = createMemo(() => {
    const address = workspace.selectedSkill();
    return allSkills().find((candidate) => address && sameSkillAddress(candidate.address, address));
  });

  const bind = (owner: FocusOwner, target: Renderable) => {
    const dispose = props.focusRegistry?.register(owner, target);
    target.once("destroyed", () => dispose?.());
    onCleanup(() => dispose?.());
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
  const detailControls = (pane: string) => {
    const root = renderer.root.findDescendantById(pane);
    const controls: Renderable[] = [];
    const visit = (target: BaseRenderable) => {
      if (
        target instanceof Renderable &&
        target.focusable &&
        props.focusRegistry?.ownerOf(target)?.startsWith("command:")
      )
        controls.push(target);
      for (const child of target.getChildren()) visit(child);
    };
    if (root) visit(root);
    return controls;
  };
  const toolbarControls = (): FocusOwner[] =>
    (
      [
        "skills-query",
        workspace.skillsView() === "problems"
          ? "command:problems-filter.open"
          : "command:skills-filter.open",
        ...Object.keys(workspace.filters())
          .filter((dimension) => workspace.filters()[dimension])
          .map((dimension) => `command:skills-filter.clear.${dimension}` as FocusOwner),
        "command:skills-filter.clear-all",
        ...(workspace.query() ? ["command:skills-search.clear" as const] : []),
        "command:add-source",
        "command:source-filter.clear",
        ...(workspace.selectedSkills().length
          ? ["command:skill-add-selected-to-collection" as const]
          : []),
        "skills-views",
      ] satisfies FocusOwner[]
    ).filter((owner) => {
      const target = props.focusRegistry?.target(owner);
      return target instanceof Renderable && !target.isDestroyed && target.focusable;
    });
  const bindSourceMetadata = (target: ScrollBoxRenderable) => {
    bind("inspector", target);
    localMode(target, (key) => {
      if (key.name === "right" || key.name === "left") return "consumed";
      return "declined";
    });
  };
  const command = (
    id: string,
    record: CommandRecord,
    execute: () => void,
    intent?: "primary" | "neutral",
  ) => (
    <CommandControl
      id={id}
      record={record}
      intent={intent}
      keyboard={!props.executeCommand}
      showDisabledReason={false}
      register={(target) => {
        const owner: FocusOwner = `command:${record.id}`;
        bind(owner, target);
        localMode(target, (key) => {
          if (
            section() === "sources" &&
            record.id === "add-source" &&
            ["up", "down", "left", "right"].includes(key.name)
          ) {
            return "consumed";
          }
          if (
            toolbarControls().includes(owner) &&
            section() === "skills" &&
            renderer.root.findDescendantById("skills-list-pane")?.findDescendantById(target.id) ===
              target
          ) {
            const controls = toolbarControls();
            const index = controls.indexOf(owner);
            if (key.name === "up" || key.name === "down") {
              if (key.name === "down" && index === controls.length - 1) focus("browser");
              else
                focus(
                  controls[
                    Math.max(0, Math.min(controls.length - 1, index + (key.name === "up" ? -1 : 1)))
                  ]!,
                );
              return "consumed";
            }
          }
          if (!["up", "down", "left", "right"].includes(key.name)) return "declined";
          let pane = target.parent;
          while (
            pane &&
            !["source-content-controls-pane", "source-management-pane"].includes(pane.id)
          )
            pane = pane.parent;
          if (!pane) return "declined";
          const controls = detailControls(pane.id);
          const index = controls.indexOf(target);
          if (index < 0) return "declined";
          focusControl(
            controls[
              Math.max(
                0,
                Math.min(
                  controls.length - 1,
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
  const action = (
    id: string,
    verb: string,
    recordId: string,
    execute: () => void,
    destination = "",
    options: { intent?: "primary" | "neutral"; palette?: boolean; priority?: number } = {},
  ) =>
    command(
      id,
      {
        id: recordId,
        verb,
        destination,
        scope: "page",
        keys: ["enter", "return"],
        enabled: true,
        danger: false,
        ...(options.palette === false ? { palette: false } : {}),
        ...(options.priority === undefined ? {} : { priority: options.priority }),
      },
      execute,
      options.intent,
    );
  const managedAction = (id: ActionRecord["id"], label?: string) => {
    const record = props.actions.find((candidate) => candidate.id === id);
    return record
      ? command(`workspace-action-${id}`, label ? { ...record, verb: label } : record, () =>
          props.onDetailsAction(id),
        )
      : null;
  };
  const empty = (title: string, message: string, addSource = false) => (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>{title}</strong>
      </text>
      <text wrapMode="word" fg={tokens().colors.mutedForeground}>
        {message}
      </text>
      <Show when={addSource}>
        {(() => {
          const record = props.actions.find((candidate) => candidate.id === "add-source");
          return record ? command("empty-workspace-action", record, props.onFirstSkill) : null;
        })()}
      </Show>
    </box>
  );
  const search = (
    id: string,
    value: () => string,
    placeholder: string,
    change: (value: string) => void,
    owner: FocusOwner,
    filterId: string,
    filterRecordId: string,
  ) => (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      gap={1}
      marginBottom={owner === "skills-query" ? 0 : 1}
    >
      <text fg={tokens().colors.mutedForeground} flexShrink={0}>
        Find
      </text>
      <Input
        id={id}
        ref={(target: InputRenderable) => {
          bind(owner, target);
          localMode(target, (key) => {
            if (owner === "skills-query" && key.name === "down")
              return focus(`command:${filterRecordId}`) ? "consumed" : "declined";
            if (key.name !== "enter") return "declined";
            if (owner === "skills-query") return focus("browser") ? "consumed" : "declined";
            return focus(`command:${filterRecordId}`) ? "consumed" : "declined";
          });
        }}
        value={value()}
        placeholder={placeholder}
        onInput={change}
        flexGrow={1}
        flexBasis={0}
        width={0}
        minWidth={0}
        backgroundColor={tokens().colors.surface}
        focusedBackgroundColor={tokens().colors.surface}
        textColor={tokens().colors.foreground}
        focusedTextColor={tokens().colors.foreground}
        placeholderColor={tokens().colors.mutedForeground}
      />
      {action(
        filterId,
        owner === "skills-query"
          ? `Filter${Object.values(workspace.filters()).filter(Boolean).length + (workspace.sourceFilter() ? 1 : 0) ? ` (${Object.values(workspace.filters()).filter(Boolean).length + (workspace.sourceFilter() ? 1 : 0)})` : ""}`
          : "Filter",
        filterRecordId,
        props.onOpenFilter,
      )}
    </box>
  );

  const SkillList = () => {
    let browser: SelectRenderable | undefined;
    const [listWidth, setListWidth] = createSignal(0);
    const measureList = () => setListWidth(browser?.width ?? 0);
    renderer.on("frame", measureList);
    onCleanup(() => renderer.off("frame", measureList));
    const surface = () => `skills:${workspace.skillsView()}`;
    const scopeActive = () =>
      ["all-installed-skills", "unassigned"].includes(workspace.skillsView());
    const title = () => `Skills · ${skills().length} / ${scopeSkills().length}`;
    const emptyTitle = () =>
      allSkills().length ? "No matching Skills" : "Your Skill library is empty";
    const nameCounts = createMemo(() => {
      const counts = new Map<string, number>();
      for (const candidate of skills())
        counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
      return counts;
    });
    const searching = () => !!workspace.query().trim();
    const filterChipLabel = (dimension: string, value: string) =>
      `${dimension}: ${value}${dimension === "Collection" ? " (+ children)" : ""} ×`;
    const chipContentWidth = () =>
      Object.entries(workspace.filters()).reduce(
        (width, [dimension, value]) =>
          width + Bun.stringWidth(filterChipLabel(dimension, value)) + 7,
        0,
      ) +
      (Object.keys(workspace.filters()).length ? 22 : 0) +
      (workspace.query() ? 21 : 0) +
      (workspace.sourceFilter() ? Bun.stringWidth(`Source: ${workspace.sourceFilter()}`) + 23 : 0);
    const options = createMemo(() =>
      skills().map((candidate) => ({
        name: `${workspace.selectedSkills().some((address) => sameSkillAddress(address, candidate.address)) ? "✓ " : ""}${candidate.owner.health !== "healthy" ? "! " : ""}${candidate.name}${(nameCounts().get(candidate.name) ?? 0) > 1 ? ` · ${candidate.address.source}/${candidate.address.path}` : ""}`,
        description: searching()
          ? (() => {
              const match = skillSearchMatch(candidate, workspace.query());
              if (!match) return candidate.owner.source;
              const query = workspace.query().trim();
              const value = match.value;
              const index = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
              const matched = index < 0 ? value : value.slice(index);
              const field =
                match.field.toLocaleLowerCase() === "description"
                  ? "text"
                  : match.field.toLocaleLowerCase();
              return `${matched} · ${field}`;
            })()
          : candidate.owner.source,
        value: skillAddressKey(candidate.address),
      })),
    );
    const open = (index: number) => {
      const candidate = skills()[index];
      if (!candidate) return;
      if (browser) props.onWorkspaceScroll(surface(), selectScrollOffset(browser));
      props.onSkill(candidate.address, "open");
    };
    return (
      <Pane
        id="skills-list-pane"
        title={terminal().height > 18 ? title() : undefined}
        borderTitle={terminal().height <= 18 ? title() : undefined}
        width="100%"
      >
        <Show when={terminal().width < 132}>
          {action("open-collection-browser", "Collections", "workspace.collections.open", () =>
            props.onCollectionBrowserOpen?.(true),
          )}
        </Show>
        {search(
          "skills-query",
          workspace.query,
          "Search names, descriptions, Sources, paths…",
          props.onQuery,
          "skills-query",
          "open-skills-filter",
          "skills-filter.open",
        )}
        {managedAction("add-source")}
        <Show
          when={
            workspace.query().trim() ||
            workspace.sourceFilter() ||
            Object.values(workspace.filters()).some(Boolean)
          }
        >
          <box height={1} flexShrink={0} flexDirection="row" gap={1}>
            <scrollbox
              id="skills-filter-chips"
              flexGrow={1}
              flexShrink={1}
              flexBasis={0}
              minWidth={0}
              scrollX
              scrollY={false}
              horizontalScrollbarOptions={{ visible: false }}
              contentOptions={{ width: Math.max(1, chipContentWidth()), flexDirection: "row" }}
            >
              <box height={1} width={Math.max(1, chipContentWidth())} flexDirection="row" gap={1}>
                <Show when={workspace.sourceFilter()}>
                  <text wrapMode="none" fg={tokens().colors.mutedForeground}>
                    {`Source: ${workspace.sourceFilter()}`}
                  </text>
                </Show>
                <For each={Object.entries(workspace.filters()).filter(([, value]) => value)}>
                  {([dimension, value]) => (
                    <box
                      width={Bun.stringWidth(filterChipLabel(dimension, value)) + 6}
                      flexShrink={0}
                    >
                      {action(
                        `clear-skills-filter-${dimension.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
                        filterChipLabel(dimension, value),
                        `skills-filter.clear.${dimension}`,
                        () => props.onClearFilter(dimension),
                      )}
                    </box>
                  )}
                </For>
                <Show when={Object.values(workspace.filters()).some(Boolean)}>
                  <box width={21} flexShrink={0}>
                    {action(
                      "clear-all-skills-filters",
                      "Clear filters",
                      "skills-filter.clear-all",
                      props.onClearAllFilters,
                    )}
                  </box>
                </Show>
                <Show when={workspace.query()}>
                  <box width={20} flexShrink={0}>
                    {action("clear-skills-search", "Clear search", "skills-search.clear", () => {
                      props.onQuery("");
                      focus("skills-query");
                    })}
                  </box>
                </Show>
                <Show when={workspace.sourceFilter()}>
                  <box width={20} flexShrink={0}>
                    {action(
                      "clear-source-filter",
                      "Reset Source",
                      "source-filter.clear",
                      props.onClearSourceFilter,
                    )}
                  </box>
                </Show>
              </box>
            </scrollbox>
          </box>
        </Show>
        <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
          {`   ${formatColumns("Skill", searching() ? "Match" : "Source", listWidth(), inlineNameColumnWidth(listWidth())).trimEnd()}`}
        </text>
        <Show
          when={skills().length}
          fallback={
            <Show
              when={terminal().height <= 18}
              fallback={empty(
                emptyTitle(),
                allSkills().length
                  ? "Change your search or clear the filters."
                  : "Add a Source, discover its Skills, then install the ones you need.",
                false,
              )}
            >
              <text id="skills-empty-state" flexShrink={0} wrapMode="word">
                {emptyTitle()}
              </text>
            </Show>
          }
        >
          <DataList
            id="installed-skill-browser"
            ref={(target: SelectRenderable) => {
              browser = target;
              measureList();
              bind("browser", target);
              bind("work-area", target);
              const selectedIndex = Math.max(
                0,
                skills().findIndex(
                  (candidate) =>
                    !!workspace.selectedSkill() &&
                    sameSkillAddress(candidate.address, workspace.selectedSkill()!),
                ),
              );
              const restore = restoreSelectState(
                renderer,
                target,
                selectedIndex,
                workspace.scroll(surface()),
                (offset) => props.onWorkspaceScroll(surface(), offset),
                () =>
                  scopeActive() &&
                  !target.isDestroyed &&
                  !!target.parent &&
                  renderer.root.findDescendantById("installed-skill-browser") === target,
              );
              onCleanup(restore);
              const unregister = props.focusRegistry?.registerModeHandler(target, (key) => {
                if (key.name !== "character" || key.char !== " ") return "declined";
                const candidate = skills()[target.getSelectedIndex()];
                if (!candidate) return "declined";
                props.onToggleSkill(candidate.address);
                return "consumed";
              });
              target.once("destroyed", () => unregister?.());
            }}
            options={options()}
            selectedIndex={Math.max(
              0,
              skills().findIndex(
                (candidate) =>
                  !!workspace.selectedSkill() &&
                  sameSkillAddress(candidate.address, workspace.selectedSkill()!),
              ),
            )}
            showDescription={false}
            inlineDescription
            showSelectionIndicator
            showScrollIndicator
            flexGrow={1}
            minHeight={0}
            width="100%"
            onChange={(index) => {
              if (!scopeActive()) return;
              const candidate = skills()[index];
              if (candidate) props.onSkill(candidate.address, "select");
            }}
            onSelect={open}
          />
        </Show>
        <Show
          when={
            workspace.selectedSkills().length > 0 &&
            props.actions.find((record) => record.id === "skill-add-selected-to-collection")
          }
          keyed
        >
          {(record) =>
            command("workspace-batch-add-to-collection", record, () =>
              props.onDetailsAction(record.id),
            )
          }
        </Show>
      </Pane>
    );
  };

  const ReaderSurface = () => (
    <Show when={skill()}>
      {(selected) => (
        <Reader
          reader={props.reader}
          projection={props.projection}
          skill={selected()}
          mode={props.mode}
          active={(split() || detail()) && !compactCollections()}
          focusRegistry={props.focusRegistry}
          registerCommand={props.registerCommand}
          executeCommand={props.executeCommand}
          actions={props.actions}
          onPatch={props.onReaderPatch}
          onCommitFind={props.onReaderFindCommit}
          onResources={() => props.onResources(selected().address)}
          onReadResource={(path) => props.onReadResource(selected().address, path)}
          onRetryResource={() => props.onRetryResource(selected().address)}
          onRetryContent={() => props.onRetryContent?.(selected().address)}
          onReload={() => props.onReloadContent?.(selected().address)}
          onResourceBack={props.onResourceBack}
          onDetailsAction={props.onDetailsAction}
          onDetailsRelationship={props.onDetailsRelationship}
          onDetailsScroll={props.onDetailsScroll}
        />
      )}
    </Show>
  );

  const CollectionBrowser = () => {
    const [treeRoot, setTreeRoot] = createSignal<Renderable>();
    const sharedReturn = usePageReturn(() =>
      section() === "skills" && compactCollections() && (split() || !detail())
        ? {
            record: {
              id: "workspace.collections.close",
              verb: "Back to Skills",
              destination: "Skills",
              scope: "page",
              keys: ["enter", "return"],
              enabled: true,
              danger: false,
            },
            anchor: treeRoot,
            execute: () => props.onCollectionBrowserOpen?.(false),
          }
        : undefined,
    );
    const inventory = createMemo(() =>
      deriveCollectionFilterTree(props.projection(), workspace.expandedCollectionPaths()),
    );
    const rows = createMemo(() => [
      {
        key: "inventory-all",
        depth: 0,
        kind: "entry" as const,
        name: "All installed",
        expandable: false,
      },
      {
        key: "inventory-unassigned",
        depth: 0,
        kind: "entry" as const,
        name: "Unassigned",
        expandable: false,
      },
      ...inventory().rows,
    ]);
    const selectedKey = () => {
      const collection = workspace.filters().Collection;
      if (workspace.skillsView() === "unassigned") return "inventory-unassigned";
      if (!collection) return "inventory-all";
      const retained = inventory().rows.find(
        (row) => row.key === workspace.selectedCollectionPath() && row.collection === collection,
      );
      return retained?.key ?? inventory().rows.find((row) => row.collection === collection)?.key;
    };
    const currentPath = () =>
      inventory()
        .rows.find((row) => row.key === selectedKey())
        ?.path.segments.map((segment) => segment.reference?.name ?? segment.collection)
        .join(" / ") ??
      workspace.filters().Collection ??
      "All installed";
    createEffect(() => {
      const collection = workspace.filters().Collection;
      if (!collection || selectedKey()) return;
      const match = findCollectionFilterPath(props.projection(), collection);
      if (!match) return;
      untrack(() =>
        batch(() => {
          for (const key of match.ancestorKeys) props.onCollectionPathExpanded?.(key, true);
          props.onSelectCollectionPath?.(collectionFilterPathKey(match.path));
        }),
      );
    });
    return (
      <Pane id="collection-filter-pane" title="Collections">
        <box ref={setTreeRoot} flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
          <Show when={workspace.collectionBrowserOpen()}>
            <box flexDirection="row" height={1} flexShrink={0} minWidth={0}>
              <Show when={!sharedReturn}>
                {action(
                  "close-collection-browser",
                  "Back to Skills",
                  "workspace.collections.close",
                  () => props.onCollectionBrowserOpen?.(false),
                )}
              </Show>
              <box flexGrow={1} flexBasis={0} minWidth={0} overflow="hidden">
                <text wrapMode="none" fg={tokens().colors.mutedForeground}>
                  {currentPath()}
                </text>
              </box>
            </box>
          </Show>
          <Tree
            id="collection-filter-tree"
            rows={rows()}
            selectedKey={selectedKey()}
            expandedKeys={
              new Set(
                Object.entries(workspace.expandedCollectionPaths())
                  .filter(([, expanded]) => expanded)
                  .map(([key]) => key),
              )
            }
            focusOwner="collection-tree"
            focusRegistry={treeFocus}
            active={
              (terminal().width >= 132 || compactCollections()) &&
              (split() || !detail()) &&
              !props.overlay?.()
            }
            initialScrollTop={workspace.scroll("collection-filter-tree")}
            onScrollChange={(offset) => props.onWorkspaceScroll("collection-filter-tree", offset)}
            onSelect={(key) => {
              const row = inventory().rows.find((candidate) => candidate.key === key);
              batch(() => {
                props.onSelectCollectionPath?.(key);
                if (key === "inventory-unassigned") {
                  props.onSkillFilter?.("Collection", undefined);
                  props.onSkillsView("unassigned");
                } else {
                  if (workspace.skillsView() === "unassigned")
                    props.onSkillsView("all-installed-skills");
                  if (key === "inventory-all") props.onSkillFilter?.("Collection", undefined);
                  else if (row) props.onSkillFilter?.("Collection", row.collection);
                }
              });
            }}
            onExpandedChange={(key, expanded) => props.onCollectionPathExpanded?.(key, expanded)}
            onActivate={() =>
              compactCollections() ? props.onCollectionBrowserOpen?.(false) : focus("browser")
            }
          />
          <Show when={inventory().status === "unavailable"}>
            <text fg={tokens().colors.warning} wrapMode="word">
              Collection inventory is unavailable.
            </text>
          </Show>
        </box>
      </Pane>
    );
  };

  const AgentAccess = () => {
    const tree = createMemo(() =>
      deriveAgentAccessTree(props.projection(), workspace.expandedExposurePaths()),
    );
    const rows = () => (tree().status === "available" ? tree().rows : []);
    const selected = () => rows().find((row) => row.key === workspace.selectedExposurePath());
    createEffect(() => {
      const roots = rows().filter((row) => row.depth === 0);
      if (!rows().some((row) => row.key === workspace.selectedExposurePath()) && roots.length)
        untrack(() => props.onSelectExposurePath(roots[0]!.key));
    });
    const treeRows = () =>
      rows().map((row) => {
        const parentPath =
          row.kind === "skill"
            ? row.nodeId.path
            : { segments: row.nodeId.path.segments.slice(0, -1) };
        return {
          key: row.key,
          ...(row.depth === 0 ? {} : { parentKey: exposureTreePathKey(parentPath) }),
          depth: row.depth,
          kind: row.kind,
          name: row.name,
          expandable: row.expandable,
          issue: row.missingReason,
        };
      });
    const pathForRow = (row: AgentAccessTreeRow) => row.nodeId.path;
    const selectedRow = () => selected();
    const leftVisible = () => split() || !detail();
    const rightVisible = () => split() || detail();
    const unavailable = () => {
      const value = tree();
      return value.status === "unavailable" ? value.reason : undefined;
    };
    const config = () =>
      props
        .projection()
        ?.configs.find(
          (candidate) => candidate.level === "project" && candidate.file.status === "valid",
        ) ?? props.projection()?.configs.find((candidate) => candidate.file.status === "valid");
    const direct = () =>
      props.projection()?.configs.flatMap((candidate) => candidate.direct.collections)[0];
    const enableManagedTarget = () => {
      const effective = props.projection()?.effective;
      return effective?.status === "complete" && !effective.managed ? config() : undefined;
    };
    const activate = (row: AgentAccessTreeRow) => {
      if (row.kind === "skill" && row.availability.status === "available")
        props.onSkill(row.address, "open");
    };
    const previewTitle = () => selectedRow()?.name ?? "";
    const previewTarget = () => {
      const row = selectedRow();
      return row?.kind === "reference" && row.target !== row.name ? row.target : undefined;
    };
    const previewContext = () => {
      const row = selectedRow();
      return !row
        ? ""
        : row.kind === "skill"
          ? `${row.address.source}/${row.address.path}`
          : row.kind === "reference"
            ? `From ${row.nodeId.path.segments
                .slice(0, -1)
                .map((segment) => segment.reference?.name ?? segment.collection)
                .join(" / ")}`
            : "Shared with your agent";
    };
    const Preview = () => (
      <Show
        when={(() => {
          const row = selectedRow();
          return (
            row?.kind === "skill" &&
            row.availability.status === "available" &&
            skill() &&
            sameSkillAddress(skill()!.address, row.address)
          );
        })()}
        fallback={
          <box flexDirection="column" flexGrow={1} minHeight={0}>
            <box flexDirection="row" flexShrink={0} minWidth={0} gap={1}>
              <box flexGrow={1} flexBasis={0} minWidth={0}>
                <text id="agent-node-title" wrapMode="word">
                  <strong>{previewTitle()}</strong>
                </text>
              </box>
              <Show
                when={
                  selectedRow() && selectedRow()?.kind !== "skill" && !selectedRow()?.missingReason
                }
              >
                {action("agent-access-collection-details", "Details", "collection.detail", () => {
                  const row = selectedRow();
                  if (!row || row.kind === "skill") return;
                  const collection = row.kind === "reference" ? row.target : row.collection;
                  props.onSelectCollection(collection);
                  props.onCollectionDetail(collection);
                })}
              </Show>
            </box>
            <scrollbox
              id="agent-node-description"
              ref={(target) => bind("agent-preview", target)}
              flexGrow={1}
              minHeight={0}
            >
              <text wrapMode="word" fg={tokens().colors.mutedForeground}>
                {previewContext()}
              </text>
              <Show when={previewTarget()}>
                {(target) => (
                  <text
                    wrapMode="word"
                    fg={tokens().colors.mutedForeground}
                  >{`Target ${target()}`}</text>
                )}
              </Show>
              <text
                id="agent-node-description-text"
                width="100%"
                maxWidth={88}
                marginTop={1}
                wrapMode="word"
                fg={
                  selectedRow()?.missingReason
                    ? tokens().colors.warning
                    : tokens().colors.foreground
                }
              >
                {selectedRow()?.missingReason ??
                  selectedRow()?.description ??
                  "Description unavailable."}
              </text>
            </scrollbox>
          </box>
        }
      >
        <ReaderSurface />
      </Show>
    );
    return (
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <box
          visible={leftVisible()}
          width={split() ? "35%" : "100%"}
          flexGrow={split() ? 0 : 1}
          flexShrink={0}
          minWidth={0}
          minHeight={0}
        >
          <Pane id="agent-access-pane" borderTitle="Agent access">
            <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
              Shared with your agent
            </text>
            <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
              {terminal().height > 18 ? "C Collection · S Skill" : "C Col · S Skill"}
            </text>
            <Show when={terminal().height > 18}>
              <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
                Enter or ▸/▾ to expand/fold
              </text>
            </Show>
            <Show when={tree().status !== "available" || rows().length === 0}>
              <scrollbox
                minHeight={0}
                flexGrow={1}
                contentOptions={{ flexDirection: "column", padding: 1 }}
              >
                {empty(
                  tree().status === "unavailable"
                    ? "Agent access is unavailable"
                    : "No Collections in Use",
                  unavailable() ??
                    "Choose a Collection in Config to make it available to your agent.",
                )}
                <box
                  id="agent-access-recovery-actions"
                  flexDirection="column"
                  gap={1}
                  flexShrink={0}
                >
                  <Show when={tree().status === "available"}>
                    {action(
                      "current-exposure-repair",
                      "Choose a Collection",
                      "current-exposure.repair",
                      () =>
                        props.onRepairCurrentExposure(
                          direct()?.owner.level ?? "project",
                          "collections",
                          direct()?.id,
                        ),
                    )}
                  </Show>
                  <Show when={tree().status === "unavailable" && enableManagedTarget()}>
                    {(validConfig) =>
                      action(
                        "current-exposure-enable-managed-opencode",
                        "Enable Managed OpenCode",
                        "managed-opencode.enable",
                        () => props.onEnableManagedOpenCode(validConfig().level),
                      )
                    }
                  </Show>
                  {action(
                    "current-exposure-problems",
                    "View Problems",
                    "workspace.problems",
                    () => {
                      props.onSkillsView("problems");
                      props.onRequestFocus?.("browser");
                    },
                  )}
                </box>
              </scrollbox>
            </Show>
            <Show when={tree().status === "available" && rows().length > 0}>
              <Tree
                id="current-exposure-browser"
                rows={treeRows()}
                selectedKey={workspace.selectedExposurePath()}
                expandedKeys={
                  new Set(
                    Object.entries(workspace.expandedExposurePaths())
                      .filter(([, expanded]) => expanded)
                      .map(([key]) => key),
                  )
                }
                focusOwner="browser"
                focusRegistry={treeFocus}
                active={leftVisible() && !props.overlay?.()}
                initialScrollTop={workspace.scroll("current-exposure")}
                onScrollChange={(offset) => props.onWorkspaceScroll("current-exposure", offset)}
                onSelect={props.onSelectExposurePath}
                onExpandedChange={(key, expanded) => {
                  const row = rows().find((candidate) => candidate.key === key);
                  if (row && workspace.isExposurePathExpanded(pathForRow(row)) !== expanded)
                    props.onToggleExposurePath(pathForRow(row));
                }}
                onActivate={(key) => {
                  const row = rows().find((candidate) => candidate.key === key);
                  if (row) activate(row);
                }}
              />
            </Show>
          </Pane>
        </box>
        <box
          visible={rightVisible()}
          width={split() ? "65%" : "100%"}
          flexGrow={split() ? 0 : 1}
          flexShrink={0}
          minWidth={0}
          minHeight={0}
        >
          <Pane
            id="agent-node-pane"
            borderTitle={
              selectedRow()?.kind === "reference"
                ? "Collection reference"
                : selectedRow()?.kind === "collection"
                  ? "Collection"
                  : selectedRow()?.kind === "skill"
                    ? "Skill"
                    : undefined
            }
          >
            <Show
              when={selectedRow()}
              fallback={
                <text fg={tokens().colors.mutedForeground}>
                  Select an Agent access node to preview it.
                </text>
              }
            >
              <Preview />
            </Show>
          </Pane>
        </box>
      </box>
    );
  };

  const Problems = () => {
    let browser: SelectRenderable | undefined;
    const rows = createMemo(() =>
      filterProblemRows(
        props.projection() ? problemRows(props.projection()!) : [],
        workspace.query(),
        workspace.filters(),
      ),
    );
    const diagnostic = () =>
      rows().find((row) => problemRowKey(row) === workspace.diagnosticDetail());
    return (
      <Pane id="problems-pane" title="Problems">
        <Show
          when={workspace.diagnosticDetail()}
          fallback={
            <>
              {search(
                "problems-query",
                workspace.query,
                "Search Problems…",
                props.onQuery,
                "skills-query",
                "open-problems-filter",
                "problems-filter.open",
              )}
              <DataList
                id="problems-browser"
                ref={(target: SelectRenderable) => {
                  browser = target;
                  bind("browser", target);
                  bind("work-area", target);
                  const selected = rows().findIndex(
                    (row) => problemRowKey(row) === workspace.selectedProblem(),
                  );
                  const restore = restoreSelectState(
                    renderer,
                    target,
                    selected,
                    workspace.scroll("problems"),
                    (offset) => props.onWorkspaceScroll("problems", offset),
                    () =>
                      workspace.skillsView() === "problems" &&
                      !workspace.diagnosticDetail() &&
                      !target.isDestroyed &&
                      !!target.parent &&
                      renderer.root.findDescendantById("problems-browser") === target,
                  );
                  onCleanup(restore);
                  localMode(target, (key) => {
                    if (key.name !== "up" || target.getSelectedIndex() !== 0) return "declined";
                    focus("skills-query");
                    return "consumed";
                  });
                }}
                options={rows().map((row) => ({
                  name: `${row.severity}: ${row.subject}`,
                  description: row.message,
                  value: problemRowKey(row),
                }))}
                flexGrow={1}
                minHeight={0}
                showDescription
                showSelectionIndicator
                showScrollIndicator
                selectedIndex={Math.max(
                  0,
                  rows().findIndex((row) => problemRowKey(row) === workspace.selectedProblem()),
                )}
                onChange={(index) => {
                  const row = rows()[index];
                  if (row) props.onSelectProblem(problemRowKey(row));
                }}
                onSelect={(index) => {
                  const row = rows()[index];
                  if (row?.intent) {
                    if (browser) props.onWorkspaceScroll("problems", selectScrollOffset(browser));
                    props.onProblem(row.intent, problemRowKey(row));
                  }
                }}
              />
              <Show when={!rows().length}>
                {empty("No Problems", "No diagnostics match this view.")}
              </Show>
            </>
          }
        >
          <scrollbox
            id="workspace-diagnostic-detail"
            flexGrow={1}
            minHeight={0}
            ref={(target: ScrollBoxRenderable) => bind("work-area", target)}
          >
            <MetadataGrid
              fields={[
                field("File", diagnostic()?.location?.file ?? "Unavailable"),
                field("Pointer", diagnostic()?.location?.pointer ?? "Unavailable"),
                field("Code", diagnostic()?.code ?? "CONFIG_INVALID"),
                field("Cause", diagnostic()?.message ?? "Diagnostic unavailable"),
              ]}
            />
            <text wrapMode="word" fg={tokens().colors.warning}>
              Mutations are disabled until this Config is valid and readable.
            </text>
          </scrollbox>
        </Show>
      </Pane>
    );
  };

  const Sources = () => {
    const sources = () => props.projection()?.effective.sources ?? [];
    const selected = () =>
      sources().find((candidate) => candidate.id === workspace.selectedSource()) ?? sources()[0];
    let browser: SelectRenderable | undefined;
    const open = (index: number) => {
      const source = sources()[index];
      if (!source) return;
      if (browser) props.onWorkspaceScroll("sources", selectScrollOffset(browser));
      props.onSelectSource(source.id);
      if (
        props.onOpenSourceSkills &&
        props.projection()?.installedSkills.some((skill) => skill.address.source === source.id)
      )
        props.onOpenSourceSkills(source.id);
      else props.onDetail();
    };
    return (
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <Show when={!detail()}>
          <box
            width={
              split() ? Math.min(38, Math.max(26, Math.floor(terminal().width * 0.28))) : "100%"
            }
            flexShrink={0}
            minHeight={0}
          >
            <Pane id="sources-list-pane" borderTitle={`Sources · ${sources().length}`} width="100%">
              {managedAction("add-source")}
              <DataList
                id="source-browser"
                ref={(target: SelectRenderable) => {
                  browser = target;
                  bind("browser", target);
                  bind("work-area", target);
                  const selectedIndex = Math.max(
                    0,
                    sources().findIndex((source) => source.id === workspace.selectedSource()),
                  );
                  const restore = restoreSelectState(
                    renderer,
                    target,
                    selectedIndex,
                    workspace.scroll("sources"),
                    (offset) => props.onWorkspaceScroll("sources", offset),
                    () =>
                      workspace.section() === "sources" &&
                      !target.isDestroyed &&
                      !!target.parent &&
                      renderer.root.findDescendantById("source-browser") === target,
                  );
                  onCleanup(restore);
                  localMode(target, (key) => {
                    if (key.name === "right" || key.name === "left") {
                      return "consumed";
                    }
                    return "declined";
                  });
                }}
                options={sources().map((source) => ({
                  name: source.id,
                  description: `${source.kind} · ${source.contribution ? "Config Source" : "Direct"}`,
                  value: source.id,
                }))}
                selectedIndex={Math.max(
                  0,
                  sources().findIndex((source) => source.id === workspace.selectedSource()),
                )}
                flexGrow={1}
                minHeight={0}
                showDescription={false}
                showSelectionIndicator
                showScrollIndicator
                onChange={(index) => {
                  const source = sources()[index];
                  if (source) props.onSelectSource(source.id);
                }}
                onSelect={open}
              />
              <Show when={!sources().length}>
                {empty(
                  "No Sources yet",
                  "Sources tell skill-cli where to discover and install Skills.",
                  false,
                )}
              </Show>
            </Pane>
          </box>
        </Show>
        <Show when={split() || detail()}>
          <box flexGrow={1} flexBasis={0} minWidth={0} minHeight={0}>
            <Pane id="source-details-pane" borderTitle={selected()?.id ?? "Source"} width="100%">
              <Show when={selected()} keyed>
                {(value) => {
                  const source = () => value;
                  const installedSkills = () =>
                    props
                      .projection()
                      ?.installedSkills.filter((skill) => skill.address.source === source().id) ??
                    [];
                  const installedCount = () => installedSkills().length;
                  const location = () => source().origin || source().root || source().id;
                  const owner = () =>
                    source().contribution
                      ? undefined
                      : props
                          .projection()
                          ?.configs.flatMap((config) => config.direct.sources)
                          .find((candidate) => candidate.id === source().id)?.ref.owner;
                  const ownerRelation = createMemo(() =>
                    source().contribution ? "config-source" : owner() ? "config" : undefined,
                  );
                  const detailsOpen = () =>
                    workspace.sourceBrowseView(source().id).detailsOpen ?? false;
                  let metadata: ScrollBoxRenderable | undefined;
                  const follow = (value: string) => {
                    props.onSelectSourceRelationship(value, 0);
                    if (metadata && !metadata.isDestroyed)
                      props.onWorkspaceScroll(`source:${source().id}:details`, metadata.scrollTop);
                    props.onSourceRelationship(value);
                  };
                  return (
                    <>
                      <text
                        height={1}
                        flexShrink={0}
                        wrapMode="none"
                        fg={tokens().colors.mutedForeground}
                      >
                        {source().kind} ·{" "}
                        {source().contribution ? "Config Source" : "Direct declaration"} ·{" "}
                        {installedCount()} installed
                      </text>
                      <box
                        id="source-content-controls-pane"
                        flexDirection="row"
                        flexWrap="wrap"
                        gap={1}
                        minHeight={1}
                        flexShrink={0}
                      >
                        <Show
                          when={installedCount() > 0}
                          fallback={managedAction("add-skills", "Find and install…")}
                        >
                          {managedAction("check-updates", "Check updates")}
                          {action(
                            "source-command-skills",
                            "All Skills",
                            "source.skills",
                            () => follow("skills"),
                            source().id,
                          )}
                        </Show>
                        {action(
                          "source-details-toggle",
                          detailsOpen() ? "Skills" : "Details",
                          "source.details.toggle",
                          () =>
                            props.onSourceBrowseView?.(source().id, {
                              detailsOpen: !detailsOpen(),
                            }),
                        )}
                      </box>
                      <Show
                        when={!detailsOpen()}
                        fallback={
                          <>
                            <box id="source-technical-pane" flexGrow={1} minHeight={1}>
                              <scrollbox
                                id="source-metadata"
                                ref={(target: ScrollBoxRenderable) => {
                                  metadata = target;
                                  bindSourceMetadata(target);
                                  const surface = `source:${source().id}:details`;
                                  let offset = untrack(() => workspace.scroll(surface));
                                  let restored = false;
                                  const frame = () => {
                                    if (!restored) {
                                      target.scrollTop = offset;
                                      restored = true;
                                    }
                                    if (target.scrollTop !== offset) {
                                      offset = target.scrollTop;
                                      props.onWorkspaceScroll(surface, offset);
                                    }
                                  };
                                  renderer.on("frame", frame);
                                  target.once("destroyed", () => {
                                    renderer.off("frame", frame);
                                    if (restored) props.onWorkspaceScroll(surface, offset);
                                  });
                                }}
                                flexGrow={1}
                                minHeight={0}
                                focusable
                              >
                                <MetadataGrid
                                  fields={[
                                    field("Source", source().id),
                                    field("Kind", source().kind),
                                    field("Origin", source().origin),
                                    field("Root", source().root || "."),
                                    field("Tracked ref", source().ref ?? "None"),
                                    field(
                                      "Owner",
                                      `${source().provenance.level} ${source().provenance.file ?? ""}`,
                                    ),
                                    field(
                                      "Config",
                                      source().contribution
                                        ? "Config Source"
                                        : "Direct declaration",
                                    ),
                                  ]}
                                />
                              </scrollbox>
                            </box>
                            <scrollbox
                              id="source-management-pane"
                              height={terminal().height > 18 ? 4 : 2}
                              flexShrink={0}
                              contentOptions={{ flexDirection: "column", gap: 1 }}
                            >
                              <box
                                id="source-routine-actions"
                                flexDirection="row"
                                flexWrap="wrap"
                                gap={1}
                                minWidth={0}
                                flexShrink={0}
                              >
                                <Show when={installedCount() > 0}>
                                  {managedAction("add-skills", "Find and install Skills…")}
                                  {(() => {
                                    return command(
                                      "source-update-all",
                                      {
                                        id: "source.update-all",
                                        verb: "Update all installed…",
                                        destination: source().id,
                                        scope: "page",
                                        keys: ["enter", "return"],
                                        enabled: !props.updatesActive?.(),
                                        danger: false,
                                      },
                                      () => props.onUpdateSource?.(source().id),
                                    );
                                  })()}
                                </Show>
                              </box>
                              <box
                                id="source-owner-actions"
                                flexDirection="row"
                                flexWrap="wrap"
                                gap={1}
                                minWidth={0}
                                flexShrink={0}
                              >
                                <Show when={ownerRelation()} keyed>
                                  {(relation) =>
                                    action(
                                      `source-command-${relation}`,
                                      "View owning Config",
                                      `source.${relation}`,
                                      () => follow(relation),
                                      "",
                                    )
                                  }
                                </Show>
                              </box>
                              <box
                                id="source-danger-actions"
                                flexDirection="row"
                                flexWrap="wrap"
                                gap={1}
                                minWidth={0}
                                flexShrink={0}
                              >
                                {managedAction("remove-source", "Remove Source declaration…")}
                              </box>
                            </scrollbox>
                          </>
                        }
                      >
                        <Show when={terminal().height > 18}>
                          <text
                            height={1}
                            flexShrink={0}
                            wrapMode="none"
                            fg={tokens().colors.mutedForeground}
                          >
                            {location()}
                          </text>
                        </Show>
                        <Show
                          when={installedCount()}
                          fallback={
                            <text wrapMode="word">
                              No installed Skills. Find and install to add content from this Source.
                            </text>
                          }
                        >
                          <DataTable
                            id="source-installed-skills"
                            rows={installedSkills()}
                            columns={[
                              {
                                id: "name",
                                header: "Skill",
                                minWidth: 10,
                                maxWidth: 36,
                                cell: (skill) => skill.name,
                              },
                              {
                                id: "description",
                                header: "Description",
                                minWidth: 16,
                                optional: true,
                                cell: (skill) =>
                                  skill.owner.health === "healthy"
                                    ? skill.description
                                    : {
                                        text: `Unavailable · ${skill.description}`,
                                        tone: "warning",
                                      },
                              },
                              {
                                id: "path",
                                header: "Path",
                                minWidth: 12,
                                optional: true,
                                cell: (skill) => skill.address.path || ".",
                              },
                            ]}
                            rowKey={(skill) => skillAddressKey(skill.address)}
                            currentKey={workspace.sourceBrowseView(source().id).currentSkill}
                            onCurrentChange={(currentSkill) =>
                              props.onSourceBrowseView?.(source().id, { currentSkill })
                            }
                            onActivate={(skill) => {
                              if (skill.owner.health === "healthy")
                                props.onSkill(skill.address, "open");
                            }}
                            onKey={(key) =>
                              key.name === "left" || key.name === "right" ? "consumed" : "declined"
                            }
                            initialScrollTop={workspace.scroll(`source:${source().id}:skills`)}
                            onScroll={(scroll) =>
                              props.onWorkspaceScroll(`source:${source().id}:skills`, scroll)
                            }
                            focusRegistry={props.focusRegistry}
                            ref={(target) => bind("source-installed-skills", target)}
                            flexGrow={1}
                          />
                        </Show>
                      </Show>
                    </>
                  );
                }}
              </Show>
            </Pane>
          </box>
        </Show>
      </box>
    );
  };

  return (
    <box id="workspace-content" flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={section() === "skills"}>
        <SectionTabs
          id="skills-view"
          panelId="skills-local-views"
          options={views}
          value={workspace.skillsView()}
          owner="skills-views"
          focusRegistry={props.focusRegistry}
          compact={props.mode === "narrow" || (props.mode !== "wide" && terminal().height <= 18)}
          activationMode="automatic"
          onActivate={(view) => props.onSkillsView(view)}
          onNavigate={(view) => {
            props.onCaptureWorkspaceScroll(`skills:${workspace.skillsView()}`);
            props.onSkillsView(view);
          }}
        />
      </Show>
      <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={0}>
        <Show
          when={section() === "sources"}
          fallback={
            <Show
              when={section() === "updates" && props.updates?.()}
              fallback={
                <Show
                  when={section() === "collections"}
                  fallback={
                    <Show
                      when={
                        props.surface === "reader" &&
                        !["all-installed-skills", "unassigned"].includes(workspace.skillsView())
                      }
                      fallback={
                        <Show
                          when={workspace.skillsView() === "problems"}
                          fallback={
                            <Show
                              when={workspace.skillsView() === "current-exposure"}
                              fallback={
                                <box flexDirection="row" flexGrow={1} minHeight={0}>
                                  <box
                                    visible={
                                      (terminal().width >= 132 || compactCollections()) &&
                                      (split() || !detail())
                                    }
                                    width={compactCollections() ? "100%" : "26%"}
                                    flexShrink={0}
                                    minWidth={0}
                                    minHeight={0}
                                  >
                                    <CollectionBrowser />
                                  </box>
                                  <box
                                    visible={!compactCollections() && (split() || !detail())}
                                    width={
                                      split()
                                        ? terminal().width >= 132 &&
                                          (workspace.skillsView() === "all-installed-skills" ||
                                            workspace.skillsView() === "unassigned")
                                          ? "32%"
                                          : "35%"
                                        : "100%"
                                    }
                                    flexShrink={0}
                                    minWidth={0}
                                    minHeight={0}
                                  >
                                    <SkillList />
                                  </box>
                                  <box
                                    visible={!compactCollections() && (split() || detail())}
                                    width={split() ? "auto" : "100%"}
                                    flexGrow={split() ? 1 : 0}
                                    flexShrink={split() ? 1 : 0}
                                    minWidth={0}
                                    minHeight={0}
                                  >
                                    <Pane id="skill-reader-pane">
                                      <Show
                                        when={
                                          skill() &&
                                          skills().some((candidate) =>
                                            sameSkillAddress(candidate.address, skill()!.address),
                                          )
                                        }
                                        fallback={
                                          <text fg={tokens().colors.mutedForeground}>
                                            Select a Skill to read its instructions.
                                          </text>
                                        }
                                      >
                                        <ReaderSurface />
                                      </Show>
                                    </Pane>
                                  </box>
                                </box>
                              }
                            >
                              <AgentAccess />
                            </Show>
                          }
                        >
                          <Problems />
                        </Show>
                      }
                    >
                      <ReaderSurface />
                    </Show>
                  }
                >
                  <CollectionsPage
                    active={!props.overlay?.()}
                    collections={props.collections}
                    mode={props.mode}
                    surface={detail() ? "detail" : "browser"}
                    projection={props.projection}
                    focusRegistry={props.focusRegistry}
                    onWorkAreaTarget={(target) => {
                      const dispose = props.focusRegistry?.register("work-area", target);
                      target.once("destroyed", () => dispose?.());
                    }}
                    registerCommand={props.registerCommand}
                    executeCommand={props.executeCommand}
                    actions={props.actions}
                    onAction={props.onDetailsAction}
                    onProblems={() => props.onSkillsView("problems")}
                    onSelect={props.onSelectCollection}
                    onQuery={props.onCollectionQuery}
                    onFilter={props.onCollectionFilter}
                    onClear={props.onClearCollectionFilter}
                    onClearAll={props.onClearAllCollectionFilters}
                    onFilterOpen={props.onCollectionFilterOpen}
                    onFilterDimension={props.onCollectionFilterDimension}
                    onFilterSearch={props.onCollectionFilterSearch}
                    onFilterClose={props.onCollectionFilterClose}
                    onTab={props.onCollectionTab}
                    onInspectorFocus={props.onInspectorFocus}
                    onDetail={props.onCollectionDetail}
                    onRelationship={props.onCollectionRelationship}
                    onToggleOrigin={props.onToggleCollectionOrigin}
                    onToggleOrigins={props.onToggleCollectionOrigins}
                    onRemoveOrigins={props.onRemoveCollectionOrigins}
                    onScroll={props.onCollectionScroll}
                  />
                </Show>
              }
            >
              {(state) => (
                <Show
                  when={props.sourceUpdates?.()}
                  fallback={
                    <UpdatesPage
                      state={state()}
                      skills={props.projection()?.installedSkills ?? []}
                      active={props.updatesActive}
                      run={props.updatesRun}
                      checkingActive={props.updatesCheckingActive}
                      currentCheckSource={props.updatesCurrentCheckSource}
                      checkWarning={props.updatesCheckWarning}
                      onCheck={(sources) => props.onUpdatesCheck?.(sources)}
                      onUpdate={(addresses) => props.onUpdatesSubmit?.(addresses)}
                      onStop={() => props.onUpdatesStop?.()}
                      onStopChecking={() => props.onUpdatesStopChecking?.()}
                      onRetry={() => props.onUpdatesRetry?.()}
                      onOpenSkill={(address) => props.onUpdatesOpenSkill?.(address)}
                      previewUpdate={props.previewUpdate}
                      onInspectSkill={(address) => props.onUpdatesOpenSkill?.(address, "details")}
                      onInspectSource={(source) => props.onSourceUpdatesDetails?.(source)}
                      onOpenSource={(source) => props.onUpdatesOpenSource?.(source)}
                      focusRegistry={props.focusRegistry}
                      registerCommand={props.registerCommand}
                      executeCommand={props.executeCommand}
                    />
                  }
                >
                  {(sourceView) => (
                    <SourceUpdatesPage
                      state={state()}
                      source={sourceView().source}
                      skills={(props.projection()?.installedSkills ?? [])
                        .filter((skill) => skill.address.source === sourceView().source)
                        .map((skill) => ({
                          address: skill.address,
                          name: skill.name,
                          description: skill.description,
                        }))}
                      query={sourceView().query}
                      filter={sourceView().filter}
                      active={props.updatesActive}
                      run={props.updatesRun}
                      checkingActive={props.updatesCheckingActive}
                      currentCheckSource={props.updatesCurrentCheckSource}
                      checkWarning={props.updatesCheckWarning}
                      onCheck={(sources) => props.onUpdatesCheck?.(sources)}
                      onUpdate={(addresses) => props.onUpdatesSubmit?.(addresses)}
                      onStop={() => props.onUpdatesStop?.()}
                      onStopChecking={() => props.onUpdatesStopChecking?.()}
                      onRetry={() => props.onUpdatesRetry?.()}
                      onQuery={(value) => props.onSourceUpdatesQuery?.(value)}
                      onFilter={(value) => props.onSourceUpdatesFilter?.(value)}
                      onOpenSkill={(address) => props.onUpdatesOpenSkill?.(address)}
                      previewUpdate={props.previewUpdate}
                      onInspectSkill={(address) => props.onUpdatesOpenSkill?.(address, "details")}
                      onInspectSource={(source) => props.onSourceUpdatesDetails?.(source)}
                      onSourceDetails={() => props.onSourceUpdatesDetails?.(sourceView().source)}
                      focusRegistry={props.focusRegistry}
                      registerCommand={props.registerCommand}
                      executeCommand={props.executeCommand}
                    />
                  )}
                </Show>
              )}
            </Show>
          }
        >
          <Sources />
        </Show>
      </box>
    </box>
  );
}
