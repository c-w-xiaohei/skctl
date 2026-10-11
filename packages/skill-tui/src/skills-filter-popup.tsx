import { InputRenderable, SelectRenderable, type MouseEvent } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import {
  batch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
} from "solid-js";
import type { ManagementProjection } from "@skill-cli/core";
import { filterDimensions } from "./types";
import { filterSkills, filterValues } from "./skills-filter";
import {
  type WorkspaceState,
  filterProblemRows,
  problemFilterDimensions,
  problemFilterValues,
  problemRows,
} from "./workspace/state";
import { unassignedSkills } from "./collections/state";
import { hasModalKeyModifier, useModalControl, useModalControls } from "./modal-controls";
import { ModalCommand } from "./operations";
import { selectScrollOffset } from "./select-scroll";
import { fitColumn } from "./ui/list-text";
import { useTheme } from "./ui/use-theme";

const plurals: Record<string, string> = {
  Collection: "Collections",
  Source: "Sources",
  Config: "Configs",
  Problems: "Problems",
  "Contains Skill": "Skills",
  Type: "Types",
  Updates: "Updates",
  Severity: "Severities",
  Code: "Codes",
};

/** One mounted popup owns editor state; workspace owns the live filter conditions. */
export function SkillsFilterPopup(props: {
  workspace: WorkspaceState;
  projection: Accessor<ManagementProjection | undefined>;
  onClose: () => void;
}) {
  const state = props.workspace,
    renderer = useRenderer(),
    terminal = useTerminalDimensions();
  const controls = useModalControls()!,
    tokens = useTheme();
  const problems = () => state.scope() === "problems";
  const dimensions = () => (problems() ? problemFilterDimensions : filterDimensions("skills"));
  const [dimension, setDimension] = createSignal(untrack(() => dimensions()[0] ?? "Collection"));
  const [search, setSearch] = createSignal("");
  let categories: SelectRenderable | undefined, values: SelectRenderable | undefined;
  let input: InputRenderable | undefined,
    mounted = false;
  const trigger = renderer.root.findDescendantById(
    untrack(problems) ? "open-problems-filter" : "open-skills-filter",
  );
  const anchor = { x: trigger?.screenX ?? 1, y: trigger?.screenY ?? 1 };
  const width = () => Math.max(1, Math.min(78, terminal().width - 2));
  const height = () =>
    Math.max(7, Math.min(12, Math.max(dimensions().length + 5, terminal().height - 1)));
  const categoryWidth = () => (terminal().width < 80 ? 14 : 22);
  const paneHeight = () => Math.max(1, Math.min(dimensions().length, height() - 5));
  const facetFilters = (excluded: string) =>
    Object.fromEntries(Object.entries(state.filters()).filter(([key]) => key !== excluded));
  const skillFacet = (excluded: string) => {
    const workspace = props.projection();
    return workspace
      ? filterSkills(
          state.scope() === "unassigned" ? unassignedSkills(workspace) : workspace.installedSkills,
          {
            query: state.query(),
            source: state.sourceFilter(),
            filters: facetFilters(excluded),
            agentStatus: workspace.effective.agent.status,
          },
        )
      : [];
  };
  const problemFacet = (excluded: string, value?: string) => {
    const workspace = props.projection();
    return workspace
      ? filterProblemRows(problemRows(workspace), state.query(), {
          ...facetFilters(excluded),
          ...(value ? { [excluded]: value } : {}),
        })
      : [];
  };
  const count = (excluded: string, value = "") =>
    problems()
      ? problemFacet(excluded, value).length
      : filterSkills(skillFacet(excluded), {
          filters: value ? { [excluded]: value } : undefined,
          agentStatus: props.projection()?.effective.agent.status,
        }).length;
  const choices = createMemo(() => [
    "",
    ...(problems()
      ? problemFilterValues(problemFacet(dimension()), dimension())
      : filterValues(
          skillFacet(dimension()),
          dimension(),
          props.projection()?.effective.agent.status,
        )
    ).filter((value) => value.toLocaleLowerCase().includes(search().toLocaleLowerCase())),
  ]);
  const label = (value: string) => {
    const suffix = ` · ${count(dimension(), value)}`;
    const text =
      value || (terminal().width < 80 ? "All" : `All ${plurals[dimension()] ?? `${dimension()}s`}`);
    return `${(state.filters()[dimension()] ?? "") === value ? "✓ " : "  "}${fitColumn(
      text,
      Math.max(1, width() - categoryWidth() - 8 - Bun.stringWidth(suffix)),
    ).trimEnd()}${suffix}`;
  };
  const reconcile = () => {
    const workspace = props.projection();
    if (workspace) state.reconcile(workspace, workspace);
  };
  const chooseDimension = (value: string) =>
    batch(() => {
      setDimension(value);
      setSearch("");
    });
  const apply = (value: string) => {
    state.setFilter(dimension(), value || undefined);
    reconcile();
  };
  const pointer = (select: SelectRenderable, event: MouseEvent, category: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    const option = select.options[event.y - select.screenY + selectScrollOffset(select)];
    if (!option) return;
    select.setSelectedIndex(select.options.indexOf(option));
    if (category) chooseDimension(option.value);
    else apply(option.value);
  };
  onCleanup(
    controls.intercept((event, current) => {
      const key = event.name.toLowerCase().replace(/^arrow[_-]?/, "");
      if (hasModalKeyModifier(event, key === "tab")) return false;
      if (key === "tab") return true;
      if (key === "left" && !(current instanceof InputRenderable)) {
        if (current === values) categories?.focus();
        return true;
      }
      if ((key === "return" || key === "enter" || key === "right") && current === categories) {
        values?.focus();
        return true;
      }
      if ((key === "return" || key === "enter") && current === input) {
        values?.focus();
        return true;
      }
      return key === "right" && current === values;
    }),
  );
  const registerCategories = useModalControl("skills-filter-dimensions", controls, 10);
  const registerSearch = useModalControl("skills-filter-search", controls, 20);
  const registerValues = useModalControl("skills-filter-values", controls, 30);
  onMount(() =>
    queueMicrotask(() => {
      if (categories?.isDestroyed) return;
      categories?.setSelectedIndex(0);
      mounted = true;
      categories?.focus();
    }),
  );
  return (
    <>
      <box
        id="skills-filter-underlay"
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={1}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }}
      />
      <box
        id="skills-filter-overlay"
        position="absolute"
        top={Math.max(0, Math.min(anchor.y + 1, terminal().height - height() - 1))}
        left={Math.max(0, Math.min(anchor.x, terminal().width - width()))}
        width={width()}
        height={height()}
        zIndex={2}
        border
        flexDirection="column"
        backgroundColor={tokens().colors.surface}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <text height={1} flexShrink={0} wrapMode="none">
          {problems() ? "Filter Problems" : "Filter Skills"}
        </text>
        <text height={1} flexShrink={0} wrapMode="none">
          {state.query() ? `Query: ${state.query()} · ` : ""}
          {count("")} matching {problems() ? "Problems" : "Skills"}
        </text>
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box width={categoryWidth()} flexShrink={0} flexDirection="column">
            <text height={1} flexShrink={0} wrapMode="none">
              Category
            </text>
            <select
              id="skills-filter-dimensions"
              ref={(target: SelectRenderable) => {
                categories = target;
                registerCategories(target);
              }}
              selectedIndex={0}
              height={paneHeight()}
              flexShrink={0}
              showDescription={false}
              options={dimensions().map((value) => ({
                name:
                  terminal().width < 80 ? value : `${value}   ${state.filters()[value] ?? "Any"}`,
                description: "Choose filter value",
                value,
              }))}
              onChange={(index) => {
                const value = dimensions()[index];
                if (mounted && value) chooseDimension(value);
              }}
              onSelect={(_index, option) => {
                if (typeof option?.value === "string") chooseDimension(option.value);
              }}
              onMouseDown={function (event) {
                pointer(this, event, true);
              }}
            />
          </box>
          <box flexGrow={1} minWidth={0} flexDirection="column">
            <text height={1} flexShrink={0} wrapMode="none">
              {dimension()} values
            </text>
            <input
              id="skills-filter-search"
              ref={(target: InputRenderable) => {
                input = target;
                registerSearch(target);
              }}
              placeholder={`Search ${plurals[dimension()] ?? "values"}…`}
              value={search()}
              onInput={setSearch}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                input?.focus();
              }}
            />
            <select
              id="skills-filter-values"
              ref={(target: SelectRenderable) => {
                values = target;
                registerValues(target);
              }}
              height={Math.max(1, Math.min(paneHeight() - 1, choices().length))}
              flexShrink={0}
              showDescription={false}
              selectedIndex={Math.max(0, choices().indexOf(state.filters()[dimension()] ?? ""))}
              options={choices().map((value) => ({
                name: label(value),
                description: value ? "Filter value" : "Clear this filter",
                value,
              }))}
              onSelect={(_index, option) => {
                if (typeof option?.value === "string") apply(option.value);
              }}
              onMouseDown={function (event) {
                pointer(this, event, false);
              }}
            />
          </box>
        </box>
        <ModalCommand
          id="skills-filter-clear-all"
          record={{
            id: "skills-filter.clear-all",
            keys: ["enter"],
            verb: "Clear local filters",
            destination: "Keep query and source context",
            scope: "modal",
            enabled: Object.keys(state.filters()).length > 0,
            danger: false,
          }}
          execute={() => {
            state.clearFilters();
            reconcile();
          }}
        />
        <text id="skills-filter-help" height={1} flexShrink={0} wrapMode="none">
          ←→ category/values · Enter select · Esc close
        </text>
      </box>
    </>
  );
}
