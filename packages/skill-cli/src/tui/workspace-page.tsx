import type { ManagementProjection } from "../core/api";
import type { SkillAddress } from "../core/collections";
import { InputRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { createMemo, onCleanup, Show } from "solid-js";
import type { ActionDescriptor } from "./actions";
import type { NarrowLevel, ReaderState, RouteHandoff, WorkspaceSection } from "./types";
import type { WorkspaceReadonly } from "./workspace/state";
import type { CollectionsReadonly } from "./collections/state";
import { skillKey } from "./types";
import { filterSkills } from "./skills-filter";
import { Reader } from "./reader";
import { CollectionsPage, type CollectionRelationshipIntent } from "./collections-page";
import { SectionTabs } from "./components/section-tabs";
import { EmptyState } from "./presentation";
import type { FocusRegistry, FocusTarget } from "./focus";

export function WorkspacePage(props: {
  readonly workspace: WorkspaceReadonly;
  readonly collections: CollectionsReadonly;
  readonly reader: () => ReaderState;
  readonly overlay?: () => boolean;
  readonly narrow?: boolean;
  readonly narrowLevel: NarrowLevel;
  readonly handoff?: RouteHandoff;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly actions: readonly ActionDescriptor[];
  readonly onSelectSource: (source: string) => void;
  readonly onSkill: (address: SkillAddress, intent: "select" | "open") => void;
  readonly onActions: () => void;
  readonly onFirstSkill: () => void;
  readonly onDetail: () => void;
  readonly onClearSourceFilter: () => void;
  readonly onQuery: (value: string) => void;
  readonly onOpenFilter: () => void;
  readonly onClearFilter: (dimension: string) => void;
  readonly onClearAllFilters: () => void;
  readonly onSection: (section: WorkspaceSection) => void;
  readonly onLocalNavFocus: () => void;
  readonly onInspectorFocus: () => void;
  readonly onReaderPatch: (value: Partial<ReaderState>) => void;
  readonly onReaderFindCommit: (value: string) => void;
  readonly onResources: (address: { readonly source: string; readonly path: string }) => void;
  readonly onReadResource: (
    address: { readonly source: string; readonly path: string },
    path: string,
  ) => void;
  readonly onRetryResource: (address: { readonly source: string; readonly path: string }) => void;
  readonly onResourceBack: () => void;
  readonly onDetailsActions: () => void;
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
  readonly onCollectionDetail: () => void;
  readonly onCollectionRelationship: (intent: CollectionRelationshipIntent) => void;
}) {
  return <WorkspacePageContent {...props} />;
}

function WorkspacePageContent(props: {
  readonly workspace: WorkspaceReadonly;
  readonly collections: CollectionsReadonly;
  readonly reader: () => ReaderState;
  readonly overlay?: () => boolean;
  readonly narrow?: boolean;
  readonly narrowLevel: NarrowLevel;
  readonly handoff?: RouteHandoff;
  readonly projection: () => ManagementProjection | undefined;
  readonly focusRegistry?: FocusRegistry;
  readonly actions: readonly ActionDescriptor[];
  readonly onSelectSource: (source: string) => void;
  readonly onSkill: (address: SkillAddress, intent: "select" | "open") => void;
  readonly onActions: () => void;
  readonly onFirstSkill: () => void;
  readonly onDetail: () => void;
  readonly onClearSourceFilter: () => void;
  readonly onQuery: (value: string) => void;
  readonly onOpenFilter: () => void;
  readonly onClearFilter: (dimension: string) => void;
  readonly onClearAllFilters: () => void;
  readonly onSection: (section: WorkspaceSection) => void;
  readonly onLocalNavFocus: () => void;
  readonly onInspectorFocus: () => void;
  readonly onReaderPatch: (value: Partial<ReaderState>) => void;
  readonly onReaderFindCommit: (value: string) => void;
  readonly onResources: (address: { readonly source: string; readonly path: string }) => void;
  readonly onReadResource: (
    address: { readonly source: string; readonly path: string },
    path: string,
  ) => void;
  readonly onRetryResource: (address: { readonly source: string; readonly path: string }) => void;
  readonly onResourceBack: () => void;
  readonly onDetailsActions: () => void;
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
  readonly onCollectionDetail: () => void;
  readonly onCollectionRelationship: (intent: CollectionRelationshipIntent) => void;
}) {
  let installedSkillBrowser: SelectRenderable | undefined;
  const bindings = new Map<string, () => void>();
  const bind = (
    owner: Parameters<FocusRegistry["register"]>[0],
    target: FocusTarget & Pick<BaseRenderable, "once" | "off">,
  ) => {
    bindings.get(owner)?.();
    if (!props.focusRegistry) return;
    const dispose = props.focusRegistry.register(owner, target);
    let cleanup: () => void;
    const release = () => {
      dispose();
      if (bindings.get(owner) === cleanup) bindings.delete(owner);
    };
    target.once("destroyed", release);
    cleanup = () => {
      target.off("destroyed", release);
      dispose();
      if (bindings.get(owner) === cleanup) bindings.delete(owner);
    };
    bindings.set(owner, cleanup);
  };
  onCleanup(() => bindings.forEach((dispose) => dispose()));
  const projection = props.projection;
  const sources = () => projection()?.effective.sources ?? [];
  const query = props.workspace.query;
  const filters = props.workspace.filters;
  const filterCount = () => Object.keys(filters()).length;
  const allSkills = () => projection()?.installedSkills ?? [];
  const skills = () =>
    filterSkills(allSkills(), {
      query: query(),
      filters: filters(),
      source: props.workspace.sourceFilter(),
      agentStatus: projection()?.effective.agent.status,
    });
  const selectedSkill = () =>
    skills().find((skill) => skillKey(skill.address) === props.workspace.selectedSkill());
  const chooseSkill = (address: SkillAddress, intent: "select" | "open") => {
    props.onSkill(address, intent);
  };
  const selected = props.workspace.selectedSource;
  const source = () => sources().find((item) => item.id === selected());
  const producerHandoff = () =>
    props.handoff?.kind === "agent-producer"
      ? `Agent producer handoff  ${props.handoff.address.source}/${props.handoff.address.path}`
      : undefined;
  const options = () =>
    sources().map((item) => ({
      name: `${item.id}  ${item.kind}  ${item.contribution ? "Config Source" : "Direct"}`,
      description: item.origin,
      value: item.id,
    }));
  const sourceOptions = createMemo(options, [], {
    equals: (previous, next) =>
      previous.length === next.length &&
      previous.every(
        (option, index) =>
          option.name === next[index]?.name &&
          option.description === next[index]?.description &&
          option.value === next[index]?.value,
      ),
  });
  const skillOptions = createMemo(
    () =>
      skills().map((skill) => ({
        name: `${skill.owner.health === "healthy" ? "" : "! "}${skill.name}  ${skill.description}${props.narrow === true ? "" : `  ${skill.address.source}`}`,
        description: "",
        value: skillKey(skill.address),
      })),
    [],
    {
      equals: (previous, next) =>
        previous.length === next.length &&
        previous.every(
          (option, index) =>
            option.name === next[index]?.name &&
            option.description === next[index]?.description &&
            option.value === next[index]?.value,
        ),
    },
  );
  const detail = () => (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      {sources().length === 0 ? (
        <>
          <text>Sources declare where Skills live.</text>
          <text>Add a Source to discover and install Skills.</text>
        </>
      ) : (
        <text>{source()?.id ?? "Select a Source to see its binding."}</text>
      )}
      {source() && (
        <text>{`Origin  ${source()!.origin}\nRoot    ${source()!.root}\nConfig  ${source()!.contribution ? "Config Source" : "Direct declaration"}`}</text>
      )}
      {source() && (
        <select
          id="source-actions"
          height={1}
          options={[
            {
              name: "Actions",
              description: "Actions for the selected Source",
              value: "actions",
            },
          ]}
          showDescription={false}
          onSelect={() => props.onActions()}
        />
      )}
      {props.actions.map((action) => (
        <text>{`${action.title}${action.enabled ? "" : `: ${action.reason ?? "unavailable"}`}`}</text>
      ))}
    </box>
  );
  const list = () => (
    <box width={props.narrow === true ? "100%" : "48%"} border>
      <scrollbox width="100%" height="100%">
        <Show when={props.overlay?.() ? "inactive" : "active"} keyed>
          {(_state) => (
            <select
              id="source-browser"
              ref={(value: SelectRenderable) => {
                bind("browser", value);
              }}
              options={sourceOptions()}
              selectedIndex={Math.max(
                0,
                options().findIndex((option) => option.value === selected()),
              )}
              showDescription={false}
              onChange={(index) => props.onSelectSource(options()[index]!.value)}
              onSelect={(index) => {
                props.onSelectSource(options()[index]!.value);
                if (props.narrow === true) props.onDetail();
                else props.onActions();
              }}
            />
          )}
        </Show>
        {sources().length === 0 && (
          <box flexDirection="column" paddingTop={1}>
            <text>No Sources yet</text>
            <text>Sources are where Skills are discovered and installed.</text>
            <text>Ctrl+P → Add Source</text>
          </box>
        )}
      </scrollbox>
    </box>
  );
  const trueEmpty = () => allSkills().length === 0 && !props.workspace.sourceFilter();
  const SkillList = () => {
    const list = () => (
      <box
        flexDirection="column"
        flexGrow={props.workspace.sourceFilter() || trueEmpty() ? 1 : undefined}
        width={props.narrow === true ? "100%" : props.workspace.sourceFilter() ? undefined : "45%"}
      >
        <text>
          {props.workspace.sourceFilter()
            ? `Installed Skills from ${props.workspace.sourceFilter()} ${skills().length}/${allSkills().filter((skill) => skill.address.source === props.workspace.sourceFilter()).length}`
            : `Installed Skills ${skills().length}/${allSkills().length}${filterCount() ? ` · ${filterCount()} filters` : ""}`}
        </text>
        {!trueEmpty() && (
          <>
            <box flexDirection="row">
              <input
                id="skills-query"
                ref={(value: InputRenderable) => {
                  bind("skills-query", value);
                }}
                placeholder="Search Skills"
                value={query()}
                onInput={props.onQuery}
              />
              <select
                id="open-skills-filter"
                ref={(value: SelectRenderable) => {
                  bind("skills-filter-open", value);
                }}
                height={1}
                options={[
                  { name: "Filter", description: "Filter Installed Skills", value: "filter" },
                ]}
                showDescription={false}
                onSelect={props.onOpenFilter}
              />
            </box>
            {Object.entries(filters()).map(([dimension, value]) => {
              const clear = () => props.onClearFilter(dimension);
              const id = `clear-skills-filter-${dimension}`;
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
                    ref={(renderable: SelectRenderable) => {
                      bind("skills-filter-clear", renderable);
                    }}
                    height={1}
                    options={[
                      {
                        name: `${dimension}: ${value}`,
                        description: "Clear filter",
                        value: dimension,
                      },
                    ]}
                    showDescription={false}
                    onSelect={clear}
                  />
                </box>
              );
            })}
            {(query() || Object.keys(filters()).length > 0) && (
              <box
                id="clear-all-skills-filters"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  props.onClearAllFilters();
                }}
              >
                <select
                  id="clear-all-skills-filters-keyboard"
                  ref={(value: SelectRenderable) => {
                    bind("skills-filter-clear-all", value);
                  }}
                  height={1}
                  options={[
                    {
                      name: "Clear all",
                      description: "Clear local query and filters",
                      value: "clear",
                    },
                  ]}
                  showDescription={false}
                  onSelect={props.onClearAllFilters}
                />
              </box>
            )}
          </>
        )}
        {producerHandoff() && <text selectable>{producerHandoff()}</text>}
        {!trueEmpty() && (
          <select
            id="installed-skill-browser"
            ref={(value: SelectRenderable | undefined) => {
              installedSkillBrowser = value;
              if (value && !trueEmpty()) bind("browser", value);
            }}
            height={10}
            options={skillOptions()}
            selectedIndex={Math.max(
              0,
              skills().findIndex(
                (skill) => skillKey(skill.address) === props.workspace.selectedSkill(),
              ),
            )}
            showDescription={false}
            onChange={(index) => {
              const skill = skills()[index];
              if (skill) chooseSkill(skill.address, "select");
            }}
            onSelect={(index) => {
              const skill = selectedSkill() ?? skills()[index];
              if (skill) chooseSkill(skill.address, "open");
            }}
            onMouseDown={(event) => {
              const index = event.y - (installedSkillBrowser?.screenY ?? event.y) - 1;
              const skill = skills()[index];
              if (skill) chooseSkill(skill.address, "open");
            }}
          />
        )}
        {props.workspace.sourceFilter() && (
          <select
            id="clear-source-filter"
            height={1}
            options={[
              { name: "Clear Source filter", description: "Return to Sources", value: "clear" },
            ]}
            showDescription={false}
            onSelect={() => props.onClearSourceFilter()}
          />
        )}
        {trueEmpty() ? (
          <EmptyState
            title="Add your first Skill"
            lines={[
              "Skills are discovered from Sources and installed here.",
              "1. Add a Source  2. Discover  3. Install",
            ]}
            action={{
              id: "empty-workspace-action",
              name: "Add a Source",
              description: "Register a Source, then discover and install",
              registerRef: (value) => {
                if (value && trueEmpty()) bind("browser", value);
              },
              onSelect: props.onFirstSkill,
            }}
            hint="Enter Add a Source · Ctrl+P all actions"
          />
        ) : (
          skills().length === 0 && (
            <box flexDirection="column" paddingTop={1}>
              {props.workspace.sourceFilter() ? (
                <>
                  <text>{`No Installed Skills from ${props.workspace.sourceFilter()}.`}</text>
                  <text>Clear the Source filter to see all Installed Skills.</text>
                </>
              ) : (
                <>
                  <text>No Skills match the current search or filters.</text>
                  <text>Clear the search and filters to see Installed Skills.</text>
                </>
              )}
            </box>
          )
        )}
      </box>
    );
    return list();
  };
  const ReaderPane = () => (
    <Show when={!trueEmpty() && (props.narrow !== true || props.narrowLevel === "detail")}>
      <>
        {props.narrow !== true && (
          <box id="skills-reader-separator" height="100%" border={["left"]} />
        )}
        <Show
          when={selectedSkill()}
          fallback={
            <box flexDirection="column" flexGrow={1} paddingLeft={1}>
              <text>Select a Skill to read its SKILL.md, resources, and details.</text>
            </box>
          }
        >
          {(skill) => (
            <Reader
              reader={props.reader}
              projection={projection}
              focusRegistry={props.focusRegistry}
              skill={skill()}
              narrow={props.narrow === true}
              onPatch={props.onReaderPatch}
              onCommitFind={props.onReaderFindCommit}
              onResources={() => props.onResources(skill().address)}
              onReadResource={(path) => props.onReadResource(skill().address, path)}
              onRetryResource={() => props.onRetryResource(skill().address)}
              onResourceBack={props.onResourceBack}
              onDetailsActions={props.onDetailsActions}
              onDetailsRelationship={props.onDetailsRelationship}
              onDetailsScroll={props.onDetailsScroll}
            />
          )}
        </Show>
      </>
    </Show>
  );
  const browserSection = (): WorkspaceSection =>
    props.workspace.sourceFilter() ? "skills" : props.workspace.section();
  const BrowserSurface = (surface: { readonly section: WorkspaceSection }) =>
    surface.section === "skills" ? (
      <Show when={props.narrow !== true || props.narrowLevel === "list"}>
        <SkillList />
      </Show>
    ) : surface.section === "collections" ? (
      <CollectionsPage
        collections={props.collections}
        narrow={props.narrow === true}
        narrowLevel={props.narrowLevel}
        projection={projection}
        focusRegistry={props.focusRegistry}
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
      />
    ) : (
      <box flexDirection="row" flexGrow={1}>
        {props.narrow !== true || props.narrowLevel === "list" ? list() : detail()}
        {props.narrow !== true && detail()}
      </box>
    );
  return (
    <box flexDirection="column" flexGrow={1}>
      <SectionTabs
        id="workspace-section-browser"
        options={[
          { label: "Skills", value: "skills" },
          { label: "Collections", value: "collections" },
          { label: "Sources", value: "sources" },
        ]}
        value={props.workspace.section()}
        owner="local-nav"
        focusRegistry={props.focusRegistry}
        compact={props.narrow === true}
        onPrimaryPointerEntry={props.onLocalNavFocus}
        onNavigate={props.onSection}
      />
      <box flexDirection="row" flexGrow={1}>
        <Show when={browserSection()} keyed>
          {(section) => <BrowserSurface section={section} />}
        </Show>
        <Show when={browserSection() === "skills"}>
          <ReaderPane />
        </Show>
      </box>
    </box>
  );
}
