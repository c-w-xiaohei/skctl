import type { ManagementProjection } from "@skill-cli/core";
import type { SkillAddress } from "@skill-cli/core";
import {
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  Renderable,
  type BaseRenderable,
} from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { ActionRecord } from "./actions";
import type { FocusRegistry } from "./focus";
import type {
  CommandExecution,
  CommandRecord,
  CommandRegistration,
  FocusOwner,
  LayoutMode,
  NarrowLevel,
  ReaderState,
  RouteHandoff,
  WorkspaceScope,
} from "./types";
import { sameSkillAddress, skillAddressKey } from "./types";
import type { WorkspaceReadonly, ProblemRow } from "./workspace/state";
import { filterProblemRows, problemRowKey, problemRows } from "./workspace/state";
import {
  visibleExposureRows,
  unassignedSkills,
  type CollectionsReadonly,
} from "./collections/state";
import {
  CollectionsPage,
  type CollectionRelationshipIntent,
  type CollectionRemovalRow,
} from "./collections-page";
import { filterSkills, skillSearchMatch } from "./skills-filter";
import {
  restoreSelectScroll,
  restoreSelectState,
  selectScrollOffset,
  trackSelectScroll,
} from "./select-scroll";
import { Reader } from "./reader";
import { CommandControl } from "./command-control";
import { SectionTabs } from "./components/section-tabs";
import { Pane } from "./ui/pane";
import { MetadataGrid, type MetadataField } from "./ui/metadata-grid";
import { useTheme } from "./ui/use-theme";
import { DataList } from "./ui/data-list";
import { formatColumns, inlineNameColumnWidth } from "./ui/list-text";

export interface WorkspacePageProps {
  readonly workspace: WorkspaceReadonly;
  readonly collections: CollectionsReadonly;
  readonly reader: () => ReaderState;
  readonly overlay?: () => boolean;
  readonly mode: LayoutMode;
  readonly narrowLevel: NarrowLevel;
  readonly handoff?: RouteHandoff;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly registerCommand?: CommandRegistration;
  readonly executeCommand?: CommandExecution;
  readonly actions: readonly ActionRecord[];
  readonly onSelectSource: (source: string) => void;
  readonly onSkill: (address: SkillAddress, intent: "select" | "open") => void;
  readonly onToggleSkill: (address: SkillAddress) => void;
  readonly onSkillRelationship: (value: string) => void;
  readonly onSourceRelationship: (value: string) => void;
  readonly onSelectSourceRelationship: (value: string, scroll: number) => void;
  readonly onFirstSkill: () => void;
  readonly onDetail: () => void;
  readonly onScope: (scope: WorkspaceScope) => void;
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
  readonly onInspectorFocus: () => void;
  readonly onOpenReader: (address: SkillAddress) => void;
  readonly onReaderPatch: (value: Partial<ReaderState>) => void;
  readonly onReaderFindCommit: (value: string) => void;
  readonly onResources: (address: SkillAddress) => void;
  readonly onReadResource: (address: SkillAddress, path: string) => void;
  readonly onRetryResource: (address: SkillAddress) => void;
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
}

const views: readonly { label: string; value: WorkspaceScope }[] = [
  { label: "All Skills", value: "all-installed-skills" },
  { label: "Agent access", value: "current-exposure" },
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
  const allSkills = () => props.projection()?.installedSkills ?? [];
  const section = () => (workspace.sourceFilter() ? "skills" : workspace.section());
  const split = () => props.mode === "wide";
  const detail = () => props.narrowLevel === "detail";
  const scopeSkills = () =>
    workspace.scope() === "unassigned"
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
    }),
  );
  const skill = createMemo(() => {
    const address = workspace.selectedSkill();
    return (
      skills().find((candidate) => address && sameSkillAddress(candidate.address, address)) ??
      skills()[0]
    );
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
    const metadata = root?.findDescendantById(
      pane === "skill-inspector" ? "skill-inspector-metadata" : "source-metadata",
    );
    if (metadata instanceof Renderable && metadata.focusable) controls.push(metadata);
    return controls;
  };
  const toolbarControls = (): FocusOwner[] =>
    (
      [
        "skills-query",
        workspace.scope() === "problems"
          ? "command:problems-filter.open"
          : "command:skills-filter.open",
        ...Object.keys(workspace.filters())
          .filter((dimension) => workspace.filters()[dimension])
          .map((dimension) => `command:skills-filter.clear.${dimension}` as FocusOwner),
        "command:skills-filter.clear-all",
        ...(workspace.query() ? ["command:skills-search.clear" as const] : []),
        "command:add-source",
        "command:source-filter.clear",
        ...(workspace.selectedSkills().length ? ["command:skill-add-to-collection" as const] : []),
        "skills-views",
      ] satisfies FocusOwner[]
    ).filter((owner) => {
      const target = props.focusRegistry?.target(owner);
      return target instanceof Renderable && !target.isDestroyed && target.focusable;
    });
  const bindSourceMetadata = (target: ScrollBoxRenderable) => {
    bind("inspector", target);
    localMode(target, (key) => {
      if (key.name === "right") {
        focusControl(detailControls("source-details-pane")[0]);
        return "consumed";
      }
      if (key.name === "up" && target.scrollTop === 0) {
        if (!focus("command:add-source")) focus("local-nav");
        return "consumed";
      }
      return "declined";
    });
  };
  const bindList = (target: SelectRenderable, surface: string, owner: FocusOwner = "browser") => {
    bind(owner, target);
    if (owner === "browser") bind("work-area", target);
    const cancel = restoreSelectScroll(renderer, target, workspace.scroll(surface));
    target.once("destroyed", cancel);
    onCleanup(cancel);
    const stopTracking = trackSelectScroll(target, (offset) =>
      props.onWorkspaceScroll(surface, offset),
    );
    onCleanup(stopTracking);
  };
  const command = (id: string, record: CommandRecord, execute: () => void) => (
    <CommandControl
      id={id}
      record={record}
      keyboard={!props.executeCommand}
      register={(target) => {
        const owner: FocusOwner = `command:${record.id}`;
        bind(owner, target);
        localMode(target, (key) => {
          if (
            section() === "sources" &&
            record.id === "add-source" &&
            (key.name === "up" || key.name === "down")
          ) {
            focus(key.name === "down" ? "browser" : "local-nav");
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
          if (key.name !== "up" && key.name !== "down") return "declined";
          const pane = ["skill-inspector", "source-details-pane"].find(
            (id) => renderer.root.findDescendantById(id)?.findDescendantById(target.id) === target,
          );
          if (!pane) return "declined";
          const controls = detailControls(pane);
          const index = controls.indexOf(target);
          if (index < 0) return "declined";
          if (key.name === "up" && index === 0) {
            const metadata = renderer.root.findDescendantById(
              pane === "skill-inspector" ? "skill-inspector-metadata" : "source-metadata",
            );
            if (metadata instanceof Renderable) focusControl(metadata);
          } else
            focusControl(
              controls[
                Math.max(0, Math.min(controls.length - 1, index + (key.name === "up" ? -1 : 1)))
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
      },
      execute,
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
    <box flexDirection="row" height={1} flexShrink={0} gap={1} marginBottom={1}>
      <text fg={tokens().colors.mutedForeground} flexShrink={0}>
        Find
      </text>
      <input
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
    const mountedScope = workspace.scope();
    const surface = () => `skills:${mountedScope}`;
    const nameCounts = createMemo(() => {
      const counts = new Map<string, number>();
      for (const candidate of skills())
        counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
      return counts;
    });
    const searching = () => !!workspace.query().trim();
    const chipContentWidth = () =>
      Object.entries(workspace.filters()).reduce(
        (width, [dimension, value]) => width + Bun.stringWidth(`${dimension}: ${value} ×`) + 7,
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
        title={`Skills · ${skills().length} / ${scopeSkills().length}`}
        width={split() ? "55%" : "100%"}
      >
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
                  <box width={Bun.stringWidth(`${dimension}: ${value} ×`) + 6} flexShrink={0}>
                    {action(
                      `clear-skills-filter-${dimension.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
                      `${dimension}: ${value} ×`,
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
        <text height={1} flexShrink={0} wrapMode="none" fg={tokens().colors.mutedForeground}>
          {`   ${formatColumns("Skill", searching() ? "Match" : "Source", listWidth(), inlineNameColumnWidth(listWidth())).trimEnd()}`}
        </text>
        <Show
          when={skills().length}
          fallback={empty(
            allSkills().length ? "No matching Skills" : "Your Skill library is empty",
            allSkills().length
              ? "Change your search or clear the filters."
              : "Add a Source, discover its Skills, then install the ones you need.",
            false,
          )}
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
                  workspace.scope() === mountedScope &&
                  !target.isDestroyed &&
                  !!target.parent &&
                  renderer.root.findDescendantById("installed-skill-browser") === target,
              );
              onCleanup(restore);
              const unregister = props.focusRegistry?.registerModeHandler(target, (key) => {
                if (key.name === "up" && target.getSelectedIndex() === 0) {
                  focus("skills-query");
                  return "consumed";
                }
                if (key.name === "right") {
                  open(target.getSelectedIndex());
                  return "consumed";
                }
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
              if (workspace.scope() !== mountedScope) return;
              const candidate = skills()[index];
              if (candidate) props.onSkill(candidate.address, "select");
            }}
            onSelect={open}
          />
        </Show>
        <Show
          when={
            workspace.selectedSkills().length > 0 &&
            props.actions.find((record) => record.id === "skill-add-to-collection")
          }
          keyed
        >
          {(record) =>
            command(
              "workspace-batch-add-to-collection",
              {
                ...record,
                verb: `Add ${workspace.selectedSkills().length} selected to Collection`,
              },
              () => props.onDetailsAction(record.id),
            )
          }
        </Show>
        <text fg={tokens().colors.mutedForeground}>↑↓ choose · Enter open · Space mark</text>
      </Pane>
    );
  };

  const SkillDetails = () => (
    <Pane id="skill-inspector" title="Skill details" width={split() ? "45%" : "100%"}>
      <Show
        when={skill()}
        fallback={empty("Select a Skill", "Browse your library to see what each Skill does.")}
      >
        {(selected) => {
          const source = () => selected().source;
          const compactActions = () => !split() && terminal().height <= 18;
          const actionHeight = () =>
            Math.min(10, Math.max(2, Math.floor((terminal().height - 10) * 0.4)));
          const owner = () =>
            source() && !source()?.contribution
              ? props
                  .projection()
                  ?.configs.flatMap((config) => config.direct.sources)
                  .find((candidate) => candidate.id === source()!.id)?.ref.owner
              : undefined;
          const ownerRelation = createMemo(() =>
            source()?.contribution ? "config-source" : owner() ? "config" : undefined,
          );
          const selectorView = createMemo(() => {
            const views = selected().selectorViews;
            return views.status === "complete"
              ? views.values.find((view) => (view.exposurePaths?.length ?? 0) > 0)
              : undefined;
          });
          let metadata: ScrollBoxRenderable | undefined;
          const identity = createMemo(() => skillAddressKey(selected().address));
          createEffect(() => {
            identity();
            if (metadata && !metadata.isDestroyed) metadata.scrollTop = 0;
          });
          return (
            <>
              <text id="skill-inspector-title" height={1} flexShrink={0} wrapMode="none">
                <strong>{selected().name}</strong>
              </text>
              <scrollbox
                id="skill-inspector-metadata"
                flexGrow={1}
                flexBasis={0}
                flexShrink={1}
                minHeight={0}
                marginTop={compactActions() ? 0 : 1}
                marginBottom={compactActions() ? 0 : 1}
                ref={(target: ScrollBoxRenderable) => {
                  metadata = target;
                  bind("inspector", target);
                  localMode(target, (key) => {
                    if (key.name === "right") {
                      focusControl(detailControls("skill-inspector")[0]);
                      return "consumed";
                    }
                    if (key.name === "up" && target.scrollTop === 0) {
                      if (!focus("skills-query")) focus("local-nav");
                      return "consumed";
                    }
                    return "declined";
                  });
                }}
              >
                <Show when={skillSearchMatch(selected(), workspace.query(), true)} keyed>
                  {(match) => (
                    <text
                      id="skill-inspector-match"
                      selectable
                      wrapMode="word"
                      fg={tokens().colors.primary}
                    >{`Matched ${match.field}: ${match.field === "Description" ? (skillSearchMatch(selected(), workspace.query())?.value ?? match.value) : match.value}`}</text>
                  )}
                </Show>
                <text selectable wrapMode="word" fg={tokens().colors.mutedForeground}>
                  {selected().description || "No description provided."}
                </text>
                <box flexDirection="column" marginTop={1}>
                  <text
                    id="skill-inspector-address"
                    selectable
                    wrapMode="word"
                  >{`${selected().address.source}/${selected().address.path}`}</text>
                  <MetadataGrid
                    fields={[
                      field(
                        "Source",
                        `${selected().owner.source}${source() ? ` · ${source()!.kind}` : ""}`,
                      ),
                      field(
                        "Collections",
                        selected()
                          .collections.map((collection) => collection.id)
                          .join(", ") || "Unassigned",
                      ),
                      field("Health", selected().owner.health),
                      ...(selected().owner.relevantRemoteRevision
                        ? [field("Revision", selected().owner.relevantRemoteRevision!.slice(0, 12))]
                        : []),
                    ]}
                  />
                  <For each={selected().problems}>
                    {(problem) => (
                      <text wrapMode="word" fg={tokens().colors.warning}>
                        {problem.message}
                      </text>
                    )}
                  </For>
                </box>
              </scrollbox>
              <Show when={!compactActions()}>
                <text height={1} flexShrink={0} fg={tokens().colors.mutedForeground}>
                  ACTIONS
                </text>
              </Show>
              <scrollbox
                id="skill-inspector-actions"
                flexDirection="column"
                height={compactActions() ? undefined : actionHeight()}
                flexGrow={compactActions() ? 1 : 0}
                flexBasis={compactActions() ? 0 : undefined}
                flexShrink={compactActions() ? 1 : 0}
                minHeight={compactActions() ? 1 : 3}
                border={compactActions() ? undefined : ["top"]}
                borderColor={tokens().colors.border}
              >
                {action(
                  "skill-inspector-open-reader",
                  "Read SKILL.md",
                  "skill.open-skill-md",
                  () => props.onOpenReader(selected().address),
                  "Reader",
                )}
                {managedAction("skill-check-updates", "Check / update Skill…")}
                <Show when={!workspace.selectedSkills().length}>
                  {managedAction("skill-add-to-collection", "Add Skill to Collection")}
                </Show>
                {managedAction("skill-uninstall", "Uninstall Skill…")}
                <Show when={source()} keyed>
                  {(currentSource) =>
                    action(
                      "skill-inspector-relationship-source",
                      "View Source",
                      "skill.relationship.source",
                      () => props.onSkillRelationship("source"),
                      currentSource.id,
                    )
                  }
                </Show>
                <Show when={ownerRelation()} keyed>
                  {(relation) =>
                    action(
                      `skill-inspector-relationship-${relation}`,
                      "View owning Config",
                      `skill.relationship.${relation}`,
                      () => props.onSkillRelationship(relation),
                    )
                  }
                </Show>
                <For each={selected().collections}>
                  {(collection) =>
                    action(
                      `skill-inspector-relationship-collection-${collection.id.replaceAll(/[^a-zA-Z0-9-]/g, "-")}`,
                      `Collection: ${collection.id}`,
                      `skill.relationship.collection:${collection.id}`,
                      () => props.onSkillRelationship(`collection:${collection.id}`),
                    )
                  }
                </For>
                <Show when={selectorView()} keyed>
                  {(view) =>
                    action(
                      "skill-inspector-exposure-selectors",
                      "View agent selectors",
                      `skill.relationship.selectors:${view.collection}`,
                      () => props.onSkillRelationship(`selectors:${view.collection}`),
                    )
                  }
                </Show>
              </scrollbox>
            </>
          );
        }}
      </Show>
    </Pane>
  );

  const ReaderSurface = () => (
    <Show when={skill()} keyed>
      {(selected) => (
        <Reader
          reader={props.reader}
          projection={props.projection}
          skill={selected}
          mode={props.mode}
          focusRegistry={props.focusRegistry}
          registerCommand={props.registerCommand}
          executeCommand={props.executeCommand}
          actions={props.actions}
          onPatch={props.onReaderPatch}
          onCommitFind={props.onReaderFindCommit}
          onResources={() => props.onResources(selected.address)}
          onReadResource={(path) => props.onReadResource(selected.address, path)}
          onRetryResource={() => props.onRetryResource(selected.address)}
          onResourceBack={props.onResourceBack}
          onDetailsAction={props.onDetailsAction}
          onDetailsRelationship={props.onDetailsRelationship}
          onDetailsScroll={props.onDetailsScroll}
        />
      )}
    </Show>
  );

  const AgentAccess = () => {
    const effective = () => {
      const value = props.projection()?.effective;
      return value?.status === "complete" ? value : undefined;
    };
    const rows = createMemo(() =>
      props.projection()
        ? visibleExposureRows(props.projection()!, workspace.expandedExposurePaths())
        : [],
    );
    let browser: SelectRenderable | undefined;
    return (
      <Pane id="agent-access-pane" title="Agent access">
        <text fg={tokens().colors.mutedForeground} wrapMode="word">
          These Collections make their Skills available to your agent.
        </text>
        <Show
          when={rows().length}
          fallback={
            <box flexDirection="column" paddingTop={1}>
              {empty(
                "No Skills exposed yet",
                effective()?.managed
                  ? "Choose a Collection in Config to make it available to your agent."
                  : "Enable Managed OpenCode in Config to use Collections with your agent.",
              )}
              {(() => {
                const config =
                  props
                    .projection()
                    ?.configs.find(
                      (candidate) =>
                        candidate.level === "project" && candidate.file.status === "valid",
                    ) ??
                  props
                    .projection()
                    ?.configs.find((candidate) => candidate.file.status === "valid");
                const direct = props
                  .projection()
                  ?.configs.flatMap((candidate) => candidate.direct.collections)[0];
                return effective()?.managed
                  ? action(
                      "current-exposure-repair",
                      "Choose a Collection",
                      "current-exposure.repair",
                      () =>
                        props.onRepairCurrentExposure(
                          direct?.owner.level ?? "project",
                          "collections",
                          direct?.id,
                        ),
                    )
                  : config
                    ? action(
                        "current-exposure-enable-managed-opencode",
                        "Enable Managed OpenCode",
                        "managed-opencode.enable",
                        () => props.onEnableManagedOpenCode(config.level),
                      )
                    : null;
              })()}
            </box>
          }
        >
          <DataList
            id="current-exposure-browser"
            ref={(target: SelectRenderable) => {
              browser = target;
              bindList(target, "current-exposure");
              const dispose = props.focusRegistry?.registerModeHandler(target, (key) => {
                if (key.name === "up" && target.getSelectedIndex() === 0) {
                  focus("skills-views");
                  return "consumed";
                }
                if (key.name !== "left" && key.name !== "right") return "declined";
                const row = rows()[target.getSelectedIndex()];
                if (!row) return "declined";
                const expanded = workspace.isExposurePathExpanded(row.exposurePath);
                if ((key.name === "right" && !expanded) || (key.name === "left" && expanded)) {
                  workspace.toggleExposurePath(row.exposurePath);
                  return "consumed";
                }
                if (key.name === "left") {
                  const parentKey = JSON.stringify(
                    row.exposurePath.segments
                      .slice(0, -1)
                      .map((segment) => [segment.collection, segment.reference]),
                  );
                  const index = rows().findIndex((candidate) => candidate.key === parentKey);
                  if (index >= 0) {
                    target.setSelectedIndex(index);
                    return "consumed";
                  }
                }
                return "declined";
              });
              target.once("destroyed", () => dispose?.());
            }}
            options={rows().map((row) => ({
              name: `${"  ".repeat(row.depth)}${workspace.isExposurePathExpanded(row.exposurePath) ? "▾" : "▸"} ${row.collection}`,
              description: `${row.kind === "reference" ? "Reference · " : ""}${row.installedSkillCount} installed Skills · ${row.selectorCount} selectors`,
              value: row.key,
            }))}
            selectedIndex={Math.max(
              0,
              rows().findIndex((row) => row.key === workspace.selectedExposurePath()),
            )}
            flexGrow={1}
            minHeight={0}
            showDescription
            showSelectionIndicator
            showScrollIndicator
            onChange={(index) => {
              const row = rows()[index];
              if (row) props.onSelectExposurePath(row.key);
            }}
            onSelect={(index) => {
              const row = rows()[index];
              if (!row) return;
              if (browser) props.onWorkspaceScroll("current-exposure", selectScrollOffset(browser));
              props.onSelectExposurePath(row.key);
              props.onSelectCollection(row.collection);
              props.onCollectionDetail(row.collection);
            }}
          />
        </Show>
      </Pane>
    );
  };

  const Problems = () => {
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
                  bindList(target, "problems");
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
                  if (row?.intent) props.onProblem(row.intent, problemRowKey(row));
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
    const compact = () => !split() && terminal().height <= 18;
    const selected = () =>
      sources().find((candidate) => candidate.id === workspace.selectedSource()) ?? sources()[0];
    let browser: SelectRenderable | undefined;
    const open = (index: number) => {
      const source = sources()[index];
      if (!source) return;
      if (browser) props.onWorkspaceScroll("sources", selectScrollOffset(browser));
      props.onSelectSource(source.id);
      props.onDetail();
    };
    return (
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <Show when={split() || !detail()}>
          <Pane
            id="sources-list-pane"
            title={`Sources · ${sources().length}`}
            width={split() ? "43%" : "100%"}
          >
            {managedAction("add-source")}
            <Show when={!compact()}>
              <box height={1} flexShrink={0} />
            </Show>
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
                  if (key.name === "right") {
                    open(target.getSelectedIndex());
                    return "consumed";
                  }
                  if (key.name === "up" && target.getSelectedIndex() === 0) {
                    if (!focus("command:add-source")) focus("local-nav");
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
              showDescription={!compact()}
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
        </Show>
        <Show when={split() || detail()}>
          <Pane id="source-details-pane" title="Source details" width={split() ? "57%" : "100%"}>
            <Show when={selected()}>
              {(source) => {
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
                let metadata: ScrollBoxRenderable | undefined;
                let activeSource: string | undefined;
                let scrollReady = false;
                const identity = createMemo(() => source().id);
                createEffect(() => {
                  const id = identity();
                  if (activeSource && metadata && scrollReady)
                    untrack(() =>
                      props.onWorkspaceScroll(
                        `source:${activeSource}:details`,
                        metadata!.scrollTop,
                      ),
                    );
                  activeSource = id;
                  scrollReady = false;
                  const offset = untrack(() => workspace.scroll(`source:${id}:details`));
                  let cancelled = false;
                  const restore = () => {
                    if (
                      !cancelled &&
                      metadata?.parent &&
                      !metadata.isDestroyed &&
                      activeSource === id
                    ) {
                      metadata.scrollTop = offset;
                      scrollReady = true;
                    }
                  };
                  onCleanup(() => {
                    cancelled = true;
                    renderer.off("frame", restore);
                  });
                  queueMicrotask(() => {
                    if (
                      cancelled ||
                      !metadata?.parent ||
                      metadata.isDestroyed ||
                      activeSource !== id
                    )
                      return;
                    renderer.once("frame", restore);
                    renderer.requestRender();
                  });
                });
                const follow = (value: string) => {
                  props.onSelectSourceRelationship(value, 0);
                  if (metadata && scrollReady)
                    props.onWorkspaceScroll(`source:${source().id}:details`, metadata.scrollTop);
                  props.onSourceRelationship(value);
                };
                return (
                  <>
                    <text
                      height={1}
                      flexShrink={0}
                      wrapMode="none"
                    >{`${source().id} · Manage ↓`}</text>
                    <scrollbox
                      id="source-metadata"
                      ref={(target: ScrollBoxRenderable) => {
                        metadata = target;
                        bindSourceMetadata(target);
                        target.once("destroyed", () => {
                          if (activeSource && scrollReady)
                            props.onWorkspaceScroll(
                              `source:${activeSource}:details`,
                              target.scrollTop,
                            );
                        });
                      }}
                      flexGrow={1}
                      minHeight={0}
                    >
                      {managedAction("check-updates", "Check / update installed Skills")}
                      {managedAction("add-skills", "Find and install Skills…")}
                      {managedAction("remove-source", "Remove Source declaration…")}
                      {action(
                        "source-command-skills",
                        "Browse installed Skills",
                        "source.skills",
                        () => follow("skills"),
                        source().id,
                      )}
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
                      <text marginTop={1} fg={tokens().colors.mutedForeground}>
                        SOURCE DETAILS
                      </text>
                      <MetadataGrid
                        fields={[
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
                            source().contribution ? "Config Source" : "Direct declaration",
                          ),
                        ]}
                      />
                    </scrollbox>
                  </>
                );
              }}
            </Show>
          </Pane>
        </Show>
      </box>
    );
  };

  return (
    <box id="workspace-content" flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={section() === "skills" && !(props.mode !== "wide" && terminal().height <= 18)}>
        <SectionTabs
          id="skills-view"
          panelId="skills-local-views"
          options={views}
          value={workspace.scope()}
          owner="skills-views"
          focusRegistry={props.focusRegistry}
          compact={props.mode === "narrow"}
          onActivate={(scope) => props.onScope(scope)}
          onNavigate={(scope) => {
            props.onCaptureWorkspaceScroll(`skills:${workspace.scope()}`);
            props.onScope(scope);
          }}
        />
      </Show>
      <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1}>
        <Show
          when={section() === "sources"}
          fallback={
            <Show
              when={
                section() === "collections" ||
                (workspace.scope() === "current-exposure" && detail())
              }
              fallback={
                <Show
                  when={workspace.readerOpen()}
                  fallback={
                    <Show
                      when={workspace.scope() === "problems"}
                      fallback={
                        <Show
                          when={workspace.scope() === "current-exposure"}
                          fallback={
                            <box flexDirection="row" flexGrow={1} minHeight={0}>
                              <Show when={split() || !detail()}>
                                <Show when={workspace.scope()} keyed>
                                  {(_scope) => <SkillList />}
                                </Show>
                              </Show>
                              <Show when={split() || detail()}>
                                <SkillDetails />
                              </Show>
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
          <Sources />
        </Show>
      </box>
    </box>
  );
}
