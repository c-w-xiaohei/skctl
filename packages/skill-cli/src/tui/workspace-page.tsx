import type { ManagementProjection } from "../core/api";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { createEffect, createMemo, onMount, Show } from "solid-js";
import type { ActionDescriptor } from "./actions";
import type { TuiState, WorkspaceSection } from "./model";
import { skillKey } from "./model";
import { filterSkills } from "./skills-filter";
import { Reader } from "./reader";
import { CollectionsPage, type CollectionRelationshipIntent } from "./collections-page";

export function WorkspacePage(props: {
  readonly state: TuiState;
  readonly actions: readonly ActionDescriptor[];
  readonly onSelectSource: (source: string) => void;
  readonly onSelectSkill: (skill: string) => void;
  readonly onActions: () => void;
  readonly onFirstSkill: () => void;
  readonly onDetail: () => void;
  readonly onClearSourceFilter: () => void;
  readonly onQuery: (value: string) => void;
  readonly onOpenFilter: () => void;
  readonly onClearFilter: (dimension: string) => void;
  readonly onClearAllFilters: () => void;
  readonly onSection: (section: WorkspaceSection) => void;
  readonly onReaderPatch: (value: Partial<TuiState["reader"]>) => void;
  readonly onReaderFindCommit: (value: string) => void;
  readonly onRegisterReaderFindCommit: (commit: () => void) => void;
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
  readonly onCollectionTab: (collection: string, tab: import("./model").CollectionTab) => void;
  readonly onCollectionDetail: () => void;
  readonly onCollectionRelationship: (intent: CollectionRelationshipIntent) => void;
}) {
  return <WorkspacePageContent {...props} />;
}

function WorkspacePageContent(props: {
  readonly state: TuiState;
  readonly actions: readonly ActionDescriptor[];
  readonly onSelectSource: (source: string) => void;
  readonly onSelectSkill: (skill: string) => void;
  readonly onActions: () => void;
  readonly onFirstSkill: () => void;
  readonly onDetail: () => void;
  readonly onClearSourceFilter: () => void;
  readonly onQuery: (value: string) => void;
  readonly onOpenFilter: () => void;
  readonly onClearFilter: (dimension: string) => void;
  readonly onClearAllFilters: () => void;
  readonly onSection: (section: WorkspaceSection) => void;
  readonly onReaderPatch: (value: Partial<TuiState["reader"]>) => void;
  readonly onReaderFindCommit: (value: string) => void;
  readonly onRegisterReaderFindCommit: (commit: () => void) => void;
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
  readonly onCollectionTab: (collection: string, tab: import("./model").CollectionTab) => void;
  readonly onCollectionDetail: () => void;
  readonly onCollectionRelationship: (intent: CollectionRelationshipIntent) => void;
}) {
  let sectionBrowser: SelectRenderable | undefined;
  let sourceBrowser: SelectRenderable | undefined;
  let installedSkillBrowser: SelectRenderable | undefined;
  let queryInput: InputRenderable | undefined;
  let filterOpen: SelectRenderable | undefined;
  let clearAll: SelectRenderable | undefined;
  let emptyWorkspaceAction: SelectRenderable | undefined;
  const clearFilters = new Map<string, SelectRenderable>();
  const projection = (): ManagementProjection | undefined => props.state.workspace;
  const sources = () => projection()?.effective.sources ?? [];
  const query = () => props.state.memory.workspace.query.skills ?? "";
  const filters = () => props.state.memory.workspace.filters.skills ?? {};
  const filterCount = () => Object.keys(filters()).length;
  const allSkills = () => projection()?.installedSkills ?? [];
  const skills = () =>
    filterSkills(allSkills(), {
      query: query(),
      filters: filters(),
      source: props.state.sourceFilter,
      agentStatus: projection()?.effective.agent.status,
    });
  const selectedSkill = () =>
    skills().find(
      (skill) => skillKey(skill.address) === props.state.memory.workspace.selection.skills,
    );
  const selected = () => props.state.memory.workspace.selection.sources;
  onMount(() =>
    queueMicrotask(() => {
      if (props.state.memory.workspace.section === "skills" && skills().length === 0)
        emptyWorkspaceAction?.focus();
    }),
  );
  const sectionBrowserOwnsFocus = () =>
    !props.state.overlay && !props.state.sourceFilter && props.state.focus === "local-nav";
  const source = () => sources().find((item) => item.id === selected());
  const producerHandoff = () =>
    props.state.handoff?.kind === "agent-producer"
      ? `Agent producer handoff  ${props.state.handoff.address.source}/${props.state.handoff.address.path}`
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
        name: `${skill.owner.health === "healthy" ? "" : "! "}${skill.name}  ${skill.description}${props.state.narrow ? "" : `  ${skill.address.source}`}`,
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
  createEffect(() => {
    if (sectionBrowserOwnsFocus()) sectionBrowser?.focus();
    else if (
      !props.state.overlay &&
      props.state.focus === "browser" &&
      !props.state.sourceFilter &&
      props.state.memory.workspace.section === "sources" &&
      (!props.state.narrow || props.state.narrowLevel === "list")
    )
      sourceBrowser?.focus();
    else if (
      !props.state.overlay &&
      props.state.focus === "browser" &&
      (props.state.sourceFilter || props.state.memory.workspace.section === "skills") &&
      (props.state.sourceFilter || skills().length > 0) &&
      (!props.state.narrow || props.state.narrowLevel === "list")
    ) {
      if (skills().length === 0 && !props.state.sourceFilter) return;
      installedSkillBrowser?.focus();
    } else if (!props.state.overlay && props.state.focus === "skills-query") queryInput?.focus();
    else if (!props.state.overlay && props.state.focus === "skills-filter-open")
      filterOpen?.focus();
    else if (!props.state.overlay && props.state.focus === "skills-filter-clear")
      clearFilters.values().next().value?.focus();
    else if (!props.state.overlay && props.state.focus === "skills-filter-clear-all")
      clearAll?.focus();
    else if (
      !props.state.overlay &&
      props.state.focus === "browser" &&
      props.state.memory.workspace.section === "skills" &&
      skills().length === 0 &&
      !props.state.sourceFilter
    )
      queueMicrotask(() => emptyWorkspaceAction?.focus());
  });
  const detail = () => (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text>{source()?.id ?? "No Source selected"}</text>
      {source() && (
        <text>{`Origin  ${source()!.origin}\nRoot    ${source()!.root}\nConfig  ${source()!.contribution ? "Config Source" : "Direct declaration"}`}</text>
      )}
      <select
        id="source-actions"
        focused={
          !props.state.overlay &&
          (props.state.focus === "browser" ||
            props.state.focus === "inspector" ||
            props.state.focus === "reader") &&
          props.state.narrow &&
          props.state.narrowLevel === "detail"
        }
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
      {props.actions.map((action) => (
        <text>{`${action.title}${action.enabled ? "" : `: ${action.reason ?? "unavailable"}`}`}</text>
      ))}
    </box>
  );
  const list = () => (
    <box width={props.state.narrow ? "100%" : "48%"} border>
      <scrollbox width="100%" height="100%">
        <select
          id={props.state.overlay ? "source-browser-inactive" : "source-browser"}
          ref={(value: SelectRenderable) => {
            sourceBrowser = value;
          }}
          focused={
            !props.state.overlay &&
            props.state.focus === "browser" &&
            sources().length > 0 &&
            (!props.state.narrow || props.state.narrowLevel === "list")
          }
          options={sourceOptions()}
          selectedIndex={Math.max(
            0,
            options().findIndex((option) => option.value === selected()),
          )}
          showDescription={false}
          onChange={(index) => props.onSelectSource(options()[index]!.value)}
          onSelect={(index) => {
            props.onSelectSource(options()[index]!.value);
            if (props.state.narrow) props.onDetail();
            else props.onActions();
          }}
        />
        {sources().length === 0 && (
          <box flexDirection="column" paddingTop={1}>
            <text>No Sources yet</text>
            <text>Sources are where Skills are discovered and installed.</text>
            <text>Enter Add Source</text>
          </box>
        )}
      </scrollbox>
    </box>
  );
  const SkillList = () => {
    const list = () => (
      <box
        flexDirection="column"
        flexGrow={props.state.sourceFilter ? 1 : undefined}
        width={props.state.narrow ? "100%" : props.state.sourceFilter ? undefined : "45%"}
      >
        <text>
          {props.state.sourceFilter
            ? `Installed Skills from ${props.state.sourceFilter} ${skills().length}/${allSkills().filter((skill) => skill.address.source === props.state.sourceFilter).length}`
            : `Installed Skills ${skills().length}/${allSkills().length}${filterCount() ? ` · ${filterCount()} filters` : ""}`}
        </text>
        <box flexDirection="row">
          <input
            id="skills-query"
            ref={(value: InputRenderable) => {
              queryInput = value;
            }}
            focused={props.state.focus === "skills-query"}
            placeholder="Search Skills"
            value={query()}
            onInput={props.onQuery}
          />
          <select
            id="open-skills-filter"
            ref={(value: SelectRenderable) => {
              filterOpen = value;
            }}
            focused={props.state.focus === "skills-filter-open"}
            options={[{ name: "Filter", description: "Filter Installed Skills", value: "filter" }]}
            showDescription={false}
            onSelect={props.onOpenFilter}
          />
        </box>
        {Object.entries(filters()).map(([dimension, value]) => (
          <select
            id={`clear-skills-filter-${dimension}`}
            ref={(renderable: SelectRenderable) => {
              clearFilters.set(dimension, renderable);
            }}
            focused={props.state.focus === "skills-filter-clear"}
            options={[
              { name: `${dimension}: ${value}`, description: "Clear filter", value: dimension },
            ]}
            showDescription={false}
            onSelect={() => props.onClearFilter(dimension)}
          />
        ))}
        {(query() || Object.keys(filters()).length > 0) && (
          <select
            id="clear-all-skills-filters"
            ref={(value: SelectRenderable) => {
              clearAll = value;
            }}
            focused={props.state.focus === "skills-filter-clear-all"}
            options={[
              { name: "Clear all", description: "Clear local query and filters", value: "clear" },
            ]}
            showDescription={false}
            onSelect={props.onClearAllFilters}
          />
        )}
        {producerHandoff() && <text selectable>{producerHandoff()}</text>}
        <select
          id="installed-skill-browser"
          ref={(value: SelectRenderable) => {
            installedSkillBrowser = value;
          }}
          focused={
            !props.state.overlay &&
            props.state.focus === "browser" &&
            (!props.state.narrow || props.state.narrowLevel === "list")
          }
          height={10}
          options={skillOptions()}
          selectedIndex={Math.max(
            0,
            skills().findIndex(
              (skill) => skillKey(skill.address) === props.state.memory.workspace.selection.skills,
            ),
          )}
          showDescription={false}
          onChange={(index) => {
            const skill = skills()[index];
            if (skill) props.onSelectSkill(skillKey(skill.address));
          }}
          onSelect={(index) => {
            const skill = skills()[index];
            if (skill) {
              props.onSelectSkill(skillKey(skill.address));
              props.onDetail();
            } else if (skills().length === 0 && !props.state.sourceFilter) props.onFirstSkill();
          }}
        />
        {props.state.sourceFilter && (
          <select
            id="clear-source-filter"
            focused={false}
            options={[
              { name: "Clear Source filter", description: "Return to Sources", value: "clear" },
            ]}
            showDescription={false}
            onSelect={() => props.onClearSourceFilter()}
          />
        )}
        {skills().length === 0 && (
          <box flexDirection="column" paddingTop={1}>
            <text>Add your first Skill</text>
            <select
              id="empty-workspace-action"
              ref={(value: SelectRenderable) => {
                emptyWorkspaceAction = value;
              }}
              focused={!props.state.overlay && props.state.focus === "browser"}
              options={[
                {
                  name: "Add Source",
                  description: "Register a Source, then discover and install",
                  value: "add-source",
                },
              ]}
              showDescription={false}
              onSelect={props.onFirstSkill}
            />
            <text>1 Add Source 2 Discover 3 Install reviewed Skill</text>
            <text>Enter Add Source | Ctrl+P Actions | Tab nav</text>
          </box>
        )}
      </box>
    );
    return (
      <>
        {(!props.state.narrow || props.state.narrowLevel === "list") && list()}
        {!props.state.narrow && (
          <box id="skills-reader-separator" height="100%" border={["left"]} />
        )}
        <Show when={!props.state.narrow || props.state.narrowLevel === "detail"}>
          <Show
            when={selectedSkill()}
            fallback={
              <box flexDirection="column" flexGrow={1} paddingLeft={1}>
                <text>Choose an Installed Skill to read its details.</text>
                <text>Use the section navigation to switch views.</text>
              </box>
            }
          >
            {(skill) => (
              <Reader
                state={props.state}
                skill={skill()}
                narrow={props.state.narrow}
                onPatch={props.onReaderPatch}
                onCommitFind={props.onReaderFindCommit}
                onRegisterFindCommit={props.onRegisterReaderFindCommit}
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
        </Show>
      </>
    );
  };
  return (
    <box flexDirection="column" flexGrow={1}>
      <select
        id="workspace-section-browser"
        ref={(value: SelectRenderable) => {
          sectionBrowser = value;
        }}
        focused={sectionBrowserOwnsFocus()}
        height={1}
        options={[
          { name: "Skills", description: "Browse Installed Skills", value: "skills" },
          { name: "Collections", description: "Browse Collections", value: "collections" },
          { name: "Sources", description: "Browse Sources", value: "sources" },
        ]}
        selectedIndex={["skills", "collections", "sources"].indexOf(
          props.state.memory.workspace.section,
        )}
        showDescription={false}
        onSelect={(_index, option) => {
          if (
            option?.value === "skills" ||
            option?.value === "collections" ||
            option?.value === "sources"
          )
            props.onSection(option.value);
        }}
      />
      <box flexDirection="row" flexGrow={1}>
        {props.state.sourceFilter || props.state.memory.workspace.section === "skills" ? (
          <SkillList />
        ) : props.state.memory.workspace.section === "collections" ? (
          <CollectionsPage
            state={props.state}
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
            onDetail={props.onCollectionDetail}
            onRelationship={props.onCollectionRelationship}
          />
        ) : (
          <>
            {!props.state.narrow || props.state.narrowLevel === "list" ? list() : detail()}
            {!props.state.narrow && detail()}
          </>
        )}
      </box>
    </box>
  );
}
