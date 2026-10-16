import { InputRenderable, SelectRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import {
  batch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  Show,
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
import { Input } from "./ui/input";
import { DataList } from "./ui/data-list";
import { Dialog, DialogContent } from "./ui/dialog";
import { Form, FormField } from "./ui/form";
import { fitColumn, formatColumns } from "./ui/list-text";
import { useTheme } from "./ui/use-theme";

const plurals: Record<string, string> = {
  Collection: "Collections",
  Source: "Sources",
  Config: "Configs",
  Problems: "Problems",
  Severity: "Severities",
  Code: "Codes",
};

/** Applied conditions belong to workspace; this editor owns only facet search and cursor. */
export function SkillsFilterPopup(props: {
  workspace: WorkspaceState;
  projection: Accessor<ManagementProjection | undefined>;
  onClose: () => void;
}) {
  const state = props.workspace;
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const controls = useModalControls()!;
  const tokens = useTheme();
  const problems = () => state.skillsView() === "problems";
  const dimensions = () => (problems() ? problemFilterDimensions : filterDimensions("skills"));
  const [dimension, setDimension] = createSignal(untrack(() => dimensions()[0] ?? "Collection"));
  const [search, setSearch] = createSignal("");
  const [cursor, setCursor] = createSignal(untrack(() => state.filters()[dimension()] ?? ""));
  const [valueWidth, setValueWidth] = createSignal(0);
  let categories: SelectRenderable | undefined;
  let values: SelectRenderable | undefined;
  let input: InputRenderable | undefined;
  let mounted = false;
  const trigger = renderer.root.findDescendantById(
    untrack(problems) ? "open-problems-filter" : "open-skills-filter",
  );
  const anchor = { x: trigger?.screenX ?? 1, y: trigger?.screenY ?? 1 };
  const width = () => Math.min(78, terminal().width - 2);
  const height = () => Math.min(18, terminal().height - 2);
  const categoryWidth = () => (width() < 60 ? 13 : 20);
  const countsVisible = () => width() >= 60;
  const collectionViews = createMemo(() => {
    const effective = props.projection()?.effective;
    return effective?.status === "complete" ? effective.collectionsView : undefined;
  });
  const facetFilters = (excluded: string) =>
    Object.fromEntries(Object.entries(state.filters()).filter(([key]) => key !== excluded));
  const skillFacet = createMemo(() => {
    const projection = props.projection();
    return projection
      ? filterSkills(
          state.skillsView() === "unassigned"
            ? unassignedSkills(projection)
            : projection.installedSkills,
          {
            query: state.query(),
            source: state.sourceFilter(),
            filters: facetFilters(dimension()),
            agentStatus: projection.effective.agent.status,
            collectionViews: collectionViews(),
          },
        )
      : [];
  });
  const problemFacet = createMemo(() =>
    props.projection()
      ? filterProblemRows(
          problemRows(props.projection()!),
          state.query(),
          facetFilters(dimension()),
        )
      : [],
  );
  const resultCount = createMemo(() => {
    const projection = props.projection();
    if (!projection) return 0;
    return problems()
      ? filterProblemRows(problemRows(projection), state.query(), state.filters()).length
      : filterSkills(
          state.skillsView() === "unassigned"
            ? unassignedSkills(projection)
            : projection.installedSkills,
          {
            query: state.query(),
            source: state.sourceFilter(),
            filters: state.filters(),
            agentStatus: projection.effective.agent.status,
            collectionViews: collectionViews(),
          },
        ).length;
  });
  const available = createMemo(() =>
    problems()
      ? problemFilterValues(problemFacet(), dimension())
      : filterValues(skillFacet(), dimension(), props.projection()?.effective.agent.status, {
          collectionViews: collectionViews(),
          filters: state.filters(),
        }),
  );
  const choices = createMemo(() => [
    "",
    ...available().filter((value) =>
      value.toLocaleLowerCase().includes(search().toLocaleLowerCase()),
    ),
  ]);
  const counts = createMemo(
    () =>
      new Map(
        available()
          .concat("")
          .map((value) => [
            value,
            problems()
              ? filterProblemRows(problemFacet(), "", value ? { [dimension()]: value } : {}).length
              : filterSkills(skillFacet(), {
                  filters: value ? { [dimension()]: value } : {},
                  agentStatus: props.projection()?.effective.agent.status,
                  collectionViews: collectionViews(),
                }).length,
          ]),
      ),
  );
  const selectedIndex = createMemo(() => Math.max(0, choices().indexOf(cursor())));
  const appliedMessage = createMemo(() => {
    const applied = state.filters()[dimension()];
    const hidden =
      applied && !choices().includes(applied) ? `Applied: ${applied} (hidden by search).` : "";
    const empty = search() && choices().length === 1 ? "No matching values." : "";
    return [hidden, empty].filter(Boolean).join(" ") || undefined;
  });
  const label = (value: string) => {
    const name = value || `All ${plurals[dimension()] ?? dimension()}`;
    const checked = (state.filters()[dimension()] ?? "") === value ? "✓ " : "  ";
    const availableWidth = Math.max(1, valueWidth() - 5);
    return countsVisible()
      ? formatColumns(
          `${checked}${name}`,
          String(counts().get(value) ?? 0),
          availableWidth,
          Math.max(1, availableWidth - 7),
        )
      : fitColumn(`${checked}${name}`, availableWidth);
  };
  const reconcile = () => {
    const projection = props.projection();
    if (projection) state.reconcile(projection, projection);
  };
  const chooseDimension = (value: string) =>
    batch(() => {
      setDimension(value);
      setSearch("");
      setCursor(state.filters()[value] ?? "");
    });
  const apply = (value: string) => {
    state.setFilter(dimension(), value || undefined);
    reconcile();
  };
  const registerCategories = useModalControl("skills-filter-dimensions", controls, 10);
  const registerSearch = useModalControl("skills-filter-search", controls, 20);
  const registerValues = useModalControl("skills-filter-values", controls, 30);
  const measure = () => setValueWidth(values?.width ?? 0);
  renderer.on("frame", measure);
  onCleanup(() => renderer.off("frame", measure));
  onCleanup(
    controls.intercept((event, current) => {
      const key = event.name.toLowerCase().replace(/^arrow[_-]?/, "");
      if (hasModalKeyModifier(event, key === "tab") || key === "tab") return false;
      if (key === "escape" && current === input) {
        values?.focus();
        return true;
      }
      if ((key === "/" || key === "slash") && current !== input) {
        input?.focus();
        return true;
      }
      if (key === "up" || key === "down") {
        if (current instanceof SelectRenderable) {
          if (key === "up") current.moveUp();
          else current.moveDown();
        }
        return true;
      }
      if ((key === "left" || key === "right") && !(current instanceof InputRenderable)) return true;
      if ((key === "return" || key === "enter") && (current === categories || current === input)) {
        values?.focus();
        return true;
      }
      return false;
    }),
  );
  onMount(() =>
    queueMicrotask(() => {
      mounted = true;
      categories?.focus();
      measure();
    }),
  );
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape" && renderer.currentFocusedRenderable === input) {
          details.preventDefault();
          values?.focus();
        } else props.onClose();
      }}
    >
      <DialogContent
        id="skills-filter-overlay"
        position="absolute"
        top={Math.max(0, Math.min(anchor.y + 1, terminal().height - height() - 1))}
        left={Math.max(0, Math.min(anchor.x, terminal().width - width()))}
        width={width()}
        maxWidth={78}
        height={height()}
        backdropColor="transparent"
      >
        <Form
          height="100%"
          header={
            <box flexDirection="column" flexShrink={0}>
              <box height={1} flexDirection="row" gap={1}>
                <text flexGrow={1} minWidth={0} wrapMode="none">
                  <strong>{problems() ? "Filter Problems" : "Filter Skills"}</strong>
                </text>
                <text flexShrink={0} fg={tokens().colors.mutedForeground}>
                  {resultCount()} results
                </text>
                <ModalCommand
                  id="skills-filter-close"
                  order={50}
                  record={{
                    id: "skills-filter.close",
                    verb: "Close",
                    keys: ["enter"],
                    destination: "Keep applied filters",
                    scope: "modal",
                    enabled: true,
                    danger: false,
                  }}
                  execute={props.onClose}
                />
              </box>
              <Show when={state.query()}>
                <text
                  height={1}
                  wrapMode="none"
                  fg={tokens().colors.mutedForeground}
                >{`Skill search: ${state.query()}`}</text>
              </Show>
            </box>
          }
          actions={
            <box height={1} flexDirection="row" gap={1}>
              <ModalCommand
                id="skills-filter-clear-all"
                order={40}
                record={{
                  id: "skills-filter.clear-all",
                  keys: ["enter"],
                  verb: "Clear filters",
                  destination: "Keep Skill search and Source context",
                  scope: "modal",
                  enabled: Object.values(state.filters()).some(Boolean),
                  disabledReason: "No filters applied",
                  danger: false,
                }}
                execute={() => {
                  state.clearFilters();
                  reconcile();
                }}
              />
              <Show when={search()}>
                <ModalCommand
                  id="skills-filter-clear-search"
                  order={45}
                  record={{
                    id: "skills-filter.clear-search",
                    keys: ["enter"],
                    verb: "Clear search",
                    destination: "Show all values; keep applied filters",
                    scope: "modal",
                    enabled: true,
                    danger: false,
                  }}
                  execute={() => {
                    setSearch("");
                    values?.focus();
                  }}
                />
              </Show>
            </box>
          }
        >
          <box flexDirection="row" flexGrow={1} minWidth={0} minHeight={0}>
            <FormField width={categoryWidth()} flexShrink={0}>
              <DataList
                id="skills-filter-dimensions"
                ref={(target) => {
                  categories = target;
                  registerCategories(target);
                }}
                height={dimensions().length}
                showDescription={false}
                options={dimensions().map((value) => ({
                  name: state.filters()[value] ? `${value} · ${state.filters()[value]}` : value,
                  description: "Choose filter dimension",
                  value,
                }))}
                onChange={(index) => {
                  const value = dimensions()[index];
                  if (mounted && value) chooseDimension(value);
                }}
                onSelect={() => values?.focus()}
                onRowPress={(_event, hit) => {
                  categories?.setSelectedIndex(hit.index);
                  categories?.focus();
                  return true;
                }}
              />
            </FormField>
            <FormField flexGrow={1} minWidth={0} minHeight={0} help={appliedMessage()}>
              <Input
                id="skills-filter-search"
                ref={(target) => {
                  input = target;
                  registerSearch(target);
                }}
                placeholder={`Search ${plurals[dimension()] ?? "values"}…`}
                value={search()}
                onInput={setSearch}
                onSubmit={() => values?.focus()}
              />
              <Show when={countsVisible()}>
                <box height={1} flexShrink={0} flexDirection="row">
                  <box flexGrow={1} />
                  <text
                    id="skills-filter-count-heading"
                    flexShrink={0}
                    wrapMode="none"
                    fg={tokens().colors.mutedForeground}
                  >
                    {problems() ? "Problems" : "Skills"}
                  </text>
                  <box width={2} flexShrink={0} />
                </box>
              </Show>
              <DataList
                id="skills-filter-values"
                ref={(target) => {
                  values = target;
                  registerValues(target);
                  measure();
                }}
                flexGrow={1}
                minHeight={1}
                showDescription={false}
                showScrollIndicator
                options={choices().map((value) => ({
                  name: label(value),
                  description: value ? "Apply this value" : "Clear only this dimension",
                  value,
                }))}
                selectedIndex={selectedIndex()}
                onChange={(_index, option) => {
                  if (typeof option?.value === "string") setCursor(option.value);
                }}
                onSelect={(_index, option) => {
                  if (typeof option?.value === "string") apply(option.value);
                }}
                onRowPress={(_event, hit) => {
                  const value = values?.options[hit.index]?.value;
                  if (typeof value !== "string") return false;
                  values?.setSelectedIndex(hit.index);
                  values?.focus();
                  apply(value);
                  return true;
                }}
              />
            </FormField>
          </box>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
