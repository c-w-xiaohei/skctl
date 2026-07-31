import { batch, createSignal } from "solid-js";
import type { ManagementProjection } from "../../core/api";
import { skillKey, type NarrowLevel, type WorkspaceSection } from "../types";
import { filterSkills } from "../skills-filter";

export interface WorkspaceSnapshot {
  readonly section: WorkspaceSection;
  readonly selectedSource?: string;
  readonly selectedSkill?: string;
  readonly query: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly sourceFilter?: string;
}

const nearest = (
  selected: string | undefined,
  values: readonly string[],
  previous: readonly string[],
) => {
  if (selected && values.includes(selected)) return selected;
  const index = selected ? previous.indexOf(selected) : -1;
  return values[Math.min(values.length - 1, Math.max(0, index))];
};

/** Durable Workspace browser state. Reader activation remains legacy-owned. */
export function createWorkspaceState(onReconciledSkill?: (selectedSkill: string) => void) {
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>({
    section: "skills",
    query: "",
    filters: {},
  });
  const [narrowLevel, setNarrowLevel] = createSignal<NarrowLevel>("list");
  const update = (change: (current: WorkspaceSnapshot) => WorkspaceSnapshot) =>
    setSnapshot((current) => {
      const next = change(current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  return {
    snapshot,
    section: () => snapshot().section,
    selectedSource: () => snapshot().selectedSource,
    selectedSkill: () => snapshot().selectedSkill,
    query: () => snapshot().query,
    filters: () => snapshot().filters,
    sourceFilter: () => snapshot().sourceFilter,
    narrowLevel,
    openDetail() {
      setNarrowLevel("detail");
    },
    openTask() {
      setNarrowLevel("task");
    },
    showList() {
      setNarrowLevel("list");
    },
    selectSection(section: WorkspaceSection) {
      update((current) => ({ ...current, section }));
    },
    land(section: WorkspaceSection, selection?: string) {
      update((current) => ({
        ...current,
        section,
        ...(section === "sources" ? { selectedSource: selection } : {}),
        ...(section === "skills" ? { selectedSkill: selection } : {}),
      }));
    },
    selectSource(selectedSource?: string) {
      update((current) => ({ ...current, selectedSource }));
    },
    selectSkill(selectedSkill?: string) {
      const current = snapshot();
      if (current.selectedSkill !== selectedSkill) setSnapshot({ ...current, selectedSkill });
    },
    setQuery(query: string) {
      update((current) => ({ ...current, query }));
    },
    setFilter(dimension: string, value?: string) {
      update((current) => ({
        ...current,
        filters: value
          ? { ...current.filters, [dimension]: value }
          : Object.fromEntries(
              Object.entries(current.filters).filter(([key]) => key !== dimension),
            ),
      }));
    },
    clearFilter(dimension: string) {
      update((current) => ({
        ...current,
        filters: Object.fromEntries(
          Object.entries(current.filters).filter(([key]) => key !== dimension),
        ),
      }));
    },
    clearFilters() {
      update((current) => ({ ...current, query: "", filters: {} }));
    },
    showInstalledSkillsFromSource(source: string) {
      update((current) => ({ ...current, sourceFilter: source }));
    },
    clearSourceFilter() {
      update((current) => ({ ...current, sourceFilter: undefined, section: "sources" }));
    },
    reconcile(previous: ManagementProjection | undefined, current: ManagementProjection) {
      let reconciledSkill: string | undefined;
      batch(() =>
        update((state) => {
          const options = {
            query: state.query,
            filters: state.filters,
            source: state.sourceFilter,
          };
          const values = filterSkills(current.installedSkills, {
            ...options,
            agentStatus: current.effective.agent.status,
          }).map((skill) => skillKey(skill.address));
          const prior = filterSkills(previous?.installedSkills ?? [], {
            ...options,
            agentStatus: previous?.effective.agent.status,
          }).map((skill) => skillKey(skill.address));
          const next = {
            ...state,
            selectedSource: nearest(
              state.selectedSource,
              current.effective.sources.map((source) => source.id),
              previous?.effective.sources.map((source) => source.id) ?? [],
            ),
            selectedSkill: nearest(state.selectedSkill, values, prior),
          };
          if (next.selectedSkill !== state.selectedSkill) reconciledSkill = next.selectedSkill;
          return next;
        }),
      );
      if (reconciledSkill) onReconciledSkill?.(reconciledSkill);
    },
  };
}

export type WorkspaceState = ReturnType<typeof createWorkspaceState>;
export type WorkspaceReadonly = Pick<
  WorkspaceState,
  | "snapshot"
  | "section"
  | "selectedSource"
  | "selectedSkill"
  | "query"
  | "filters"
  | "sourceFilter"
  | "narrowLevel"
>;

export type WorkspaceCommands = Pick<
  WorkspaceState,
  | "openDetail"
  | "openTask"
  | "showList"
  | "selectSection"
  | "land"
  | "selectSource"
  | "selectSkill"
  | "setQuery"
  | "setFilter"
  | "clearFilter"
  | "clearFilters"
  | "showInstalledSkillsFromSource"
  | "clearSourceFilter"
  | "reconcile"
>;
