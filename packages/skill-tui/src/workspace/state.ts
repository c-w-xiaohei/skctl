import { batch, createSignal } from "solid-js";
import type { ManagementProjection } from "@skill-cli/core";
import {
  skillAddressKey,
  sameSkillAddress,
  type ConfigSection,
  type NarrowLevel,
  type WorkspaceScope,
  type WorkspaceSection,
} from "../types";
import { filterSkills } from "../skills-filter";
import {
  exposureHierarchy,
  exposurePathKey,
  unassignedSkills,
  type ExposurePath,
} from "../collections/state";
import type { ConfigDeclarationOwner, Diagnostic } from "@skill-cli/core";
import type { SkillAddress } from "@skill-cli/core";

export interface WorkspaceSnapshot {
  readonly scope: WorkspaceScope;
  readonly section: WorkspaceSection;
  readonly selectedSource?: string;
  readonly selectedSourceRelationship?: string;
  readonly selectedSkillRelationship?: string;
  readonly selectedSkill?: SkillAddress;
  readonly selectedProblem?: string;
  readonly diagnosticDetail?: string;
  readonly selectedSkills: readonly SkillAddress[];
  readonly selectedExposurePath?: string;
  readonly expandedExposurePaths: Readonly<Record<string, boolean>>;
  readonly readerOpen: boolean;
  readonly query: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly sourceFilter?: string;
  readonly scrolls: Readonly<Record<string, number>>;
}

export interface ProblemRow {
  readonly subject: string;
  readonly message: string;
  readonly severity: Diagnostic["severity"];
  readonly code: string;
  readonly location?: { readonly file: string; readonly pointer?: string };
  readonly related?: readonly {
    readonly message: string;
    readonly file?: string;
    readonly pointer?: string;
  }[];
  readonly suggestion?: string;
  readonly context?: string;
  readonly diagnosticSubject?: Diagnostic["subject"];
  readonly diagnosticSkill?: string;
  readonly intent?:
    | {
        readonly kind: "installed-skill";
        readonly address: { readonly source: string; readonly path: string };
      }
    | {
        readonly kind: "config-route";
        readonly destination: ConfigDeclarationOwner["level"];
        readonly section: ConfigSection;
        readonly selection?: string;
        readonly owner: ConfigDeclarationOwner;
      }
    | { readonly kind: "diagnostic-detail" };
}

export const problemRowKey = (row: ProblemRow) =>
  JSON.stringify({
    code: row.code,
    severity: row.severity,
    message: row.message,
    location: row.location,
    related: row.related,
    suggestion: row.suggestion,
    diagnosticSubject: row.diagnosticSubject,
    diagnosticSkill: row.diagnosticSkill,
    intent: row.intent,
  });

export const filterProblemRows = (
  rows: readonly ProblemRow[],
  query: string,
  filters: Readonly<Record<string, string>> = {},
) => {
  const needle = query.toLocaleLowerCase();
  return rows.filter((row) => {
    const facts = `${row.subject} ${row.message} ${row.context ?? ""}`.toLocaleLowerCase();
    return (
      (!needle || facts.includes(needle)) &&
      (!filters.Severity || row.severity === filters.Severity) &&
      (!filters.Code || row.code === filters.Code)
    );
  });
};

export const problemFilterDimensions = ["Severity", "Code"] as const;
export const problemFilterValues = (rows: readonly ProblemRow[], dimension: string) =>
  [...new Set(rows.map((row) => (dimension === "Severity" ? row.severity : row.code)))].sort();

export const problemRows = (projection: ManagementProjection): readonly ProblemRow[] => {
  const ownerKey = (owner: ConfigDeclarationOwner) =>
    `${owner.level}\u0000${owner.file}\u0000${owner.pointer}`;
  const configRoute = (owner: ConfigDeclarationOwner): ProblemRow["intent"] => {
    const direct = projection.configs.find((config) => config.level === owner.level)?.direct;
    if (!direct) return undefined;
    const source = direct.sources.find((item) => ownerKey(item.ref.owner) === ownerKey(owner));
    if (source)
      return {
        kind: "config-route",
        destination: owner.level,
        section: "sources",
        selection: source.id,
        owner,
      };
    const configSource = direct.configSources.find(
      (item) => ownerKey(item.owner) === ownerKey(owner),
    );
    if (configSource)
      return {
        kind: "config-route",
        destination: owner.level,
        section: "config-sources",
        selection: configSource.owner.pointer,
        owner,
      };
    const collection = direct.collections.find((item) => ownerKey(item.owner) === ownerKey(owner));
    if (collection)
      return {
        kind: "config-route",
        destination: owner.level,
        section: "collections",
        selection: collection.id,
        owner,
      };
    const use = direct.collectionUse.find((item) => ownerKey(item.owner) === ownerKey(owner));
    if (use)
      return {
        kind: "config-route",
        destination: owner.level,
        section: "collections",
        selection: use.collection,
        owner,
      };
    if (direct.integrations.some((item) => ownerKey(item.owner) === ownerKey(owner)))
      return { kind: "config-route", destination: owner.level, section: "integrations", owner };
    if (owner.contribution) {
      const host = projection.configs
        .find((config) => config.level === owner.contribution!.configSource.level)
        ?.direct.configSources.find(
          (item) => ownerKey(item.owner) === ownerKey(owner.contribution!.configSource),
        );
      if (host)
        return {
          kind: "config-route",
          destination: host.owner.level,
          section: "config-sources",
          selection: host.owner.pointer,
          owner,
        };
    }
    return undefined;
  };
  const row = (fallback: string, problem: Diagnostic, skill?: string): ProblemRow => {
    const routedIntent =
      problem.subject?.kind === "installed-skill"
        ? { kind: "installed-skill" as const, address: problem.subject.address }
        : problem.subject?.kind === "config"
          ? configRoute(problem.subject.owner)
          : undefined;
    const intent =
      routedIntent ??
      (problem.subject?.kind === "config" ? ({ kind: "diagnostic-detail" } as const) : undefined);
    const subject =
      intent?.kind === "installed-skill"
        ? `Installed Skill ${intent.address.source}/${intent.address.path}`
        : intent?.kind === "config-route"
          ? `${intent.section} ${intent.selection ?? ""}`.trim()
          : fallback;
    const context = [
      problem.severity,
      problem.code,
      problem.location && `${problem.location.file}${problem.location.pointer ?? ""}`,
      ...(problem.related?.map(
        (related) =>
          `${related.message}${related.file ? ` ${related.file}${related.pointer ?? ""}` : ""}`,
      ) ?? []),
      problem.suggestion,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      subject,
      message: problem.message,
      severity: problem.severity,
      code: problem.code,
      ...(context ? { context } : {}),
      ...(problem.location ? { location: problem.location } : {}),
      ...(problem.related ? { related: problem.related } : {}),
      ...(problem.suggestion ? { suggestion: problem.suggestion } : {}),
      ...(problem.subject ? { diagnosticSubject: problem.subject } : {}),
      ...(!problem.subject && skill ? { diagnosticSkill: skill } : {}),
      ...(intent ? { intent } : {}),
    };
  };
  const candidates: readonly {
    readonly fallback: string;
    readonly problem: Diagnostic;
    readonly skill?: string;
  }[] = [
    ...projection.installedSkills.flatMap((skill) =>
      skill.problems.map((problem) => ({
        fallback: `Installed Skill ${skill.address.source}/${skill.address.path}`,
        problem,
        skill: skillAddressKey(skill.address),
      })),
    ),
    ...projection.diagnostics.map((problem) => ({ fallback: "Workspace", problem })),
    ...(projection.effective.status === "unavailable"
      ? projection.effective.reasons.map((problem) => ({
          fallback: "Effective projection",
          problem,
        }))
      : []),
    ...projection.effective.agent.reasons.map((problem) => ({
      fallback: "Managed OpenCode",
      problem,
    })),
  ];
  const canonical = (candidate: (typeof candidates)[number]) =>
    JSON.stringify({
      code: candidate.problem.code,
      severity: candidate.problem.severity,
      message: candidate.problem.message,
      location: candidate.problem.location,
      related: candidate.problem.related,
      suggestion: candidate.problem.suggestion,
      subject: candidate.problem.subject,
      ...(candidate.problem.subject ? {} : candidate.skill ? { skill: candidate.skill } : {}),
    });
  return [
    ...new Map(
      candidates.map((candidate) => [
        canonical(candidate),
        row(candidate.fallback, candidate.problem, candidate.skill),
      ]),
    ).values(),
  ];
};

const nearestSkill = (
  selected: SkillAddress | undefined,
  values: readonly SkillAddress[],
  previous: readonly SkillAddress[],
) => {
  if (selected && values.some((value) => sameSkillAddress(value, selected))) return selected;
  const index = selected ? previous.findIndex((value) => sameSkillAddress(value, selected)) : -1;
  return values[Math.min(values.length - 1, Math.max(0, index))];
};

const nearest = (
  selected: string | undefined,
  values: readonly string[],
  previous: readonly string[],
) => {
  if (selected && values.includes(selected)) return selected;
  const index = selected ? previous.indexOf(selected) : -1;
  return values[Math.min(values.length - 1, Math.max(0, index))];
};

const skillScopes = new Set<WorkspaceScope>(["all-installed-skills", "unassigned", "problems"]);

const scopeForSection = (current: WorkspaceSnapshot, section: WorkspaceSection): WorkspaceScope => {
  if (section === "skills")
    return skillScopes.has(current.scope) || current.scope === "current-exposure"
      ? current.scope
      : "all-installed-skills";
  if (section === "collections") return "collections";
  return "sources";
};

/** Durable Workspace browser state captured and restored by the route owner. */
export function createWorkspaceState(
  onReconciledSkill?: (selectedSkill: SkillAddress | undefined) => void,
) {
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>({
    scope: "all-installed-skills",
    section: "skills",
    readerOpen: false,
    selectedSkills: [],
    query: "",
    filters: {},
    scrolls: {},
    expandedExposurePaths: {},
  });
  const [narrowLevel, setNarrowLevel] = createSignal<NarrowLevel>("list");
  const update = (change: (current: WorkspaceSnapshot) => WorkspaceSnapshot) =>
    setSnapshot((current) => {
      const next = change(current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  return {
    snapshot,
    restore(next: WorkspaceSnapshot) {
      setSnapshot(structuredClone(next));
    },
    scope: () => snapshot().scope,
    section: () => snapshot().section,
    selectedSource: () => snapshot().selectedSource,
    selectedSourceRelationship: () => snapshot().selectedSourceRelationship,
    selectedSkillRelationship: () => snapshot().selectedSkillRelationship,
    selectedSkill: () => snapshot().selectedSkill,
    selectedProblem: () => snapshot().selectedProblem,
    diagnosticDetail: () => snapshot().diagnosticDetail,
    selectedSkills: () => snapshot().selectedSkills,
    selectedExposurePath: () => snapshot().selectedExposurePath,
    expandedExposurePaths: () => snapshot().expandedExposurePaths,
    readerOpen: () => snapshot().readerOpen,
    query: () => snapshot().query,
    filters: () => snapshot().filters,
    sourceFilter: () => snapshot().sourceFilter,
    scroll: (surface: string) => snapshot().scrolls[surface] ?? 0,
    narrowLevel,
    openWorkArea() {
      setNarrowLevel("work-area");
    },
    openDetail() {
      setNarrowLevel("detail");
    },
    openReader() {
      update((current) => ({ ...current, readerOpen: true }));
    },
    closeReader() {
      update((current) => ({ ...current, readerOpen: false }));
    },
    openTask() {
      setNarrowLevel("task");
    },
    showList() {
      setNarrowLevel("list");
    },
    showWorkArea() {
      setNarrowLevel("work-area");
    },
    selectSection(section: WorkspaceSection) {
      update((current) => ({
        ...current,
        scope: scopeForSection(current, section),
        section,
        sourceFilter: section === "skills" ? current.sourceFilter : undefined,
        readerOpen: false,
      }));
    },
    selectScope(scope: WorkspaceScope) {
      update((current) => ({
        ...current,
        scope,
        section:
          scope === "collections" ? "collections" : scope === "sources" ? "sources" : "skills",
        sourceFilter: scope === "all-installed-skills" ? current.sourceFilter : undefined,
        filters:
          scope === "problems"
            ? Object.fromEntries(
                Object.entries(current.filters).filter(([dimension]) =>
                  ["Severity", "Code"].includes(dimension),
                ),
              )
            : Object.fromEntries(
                Object.entries(current.filters).filter(
                  ([dimension]) => !["Severity", "Code"].includes(dimension),
                ),
              ),
        readerOpen: false,
      }));
    },
    land(section: WorkspaceSection, selection?: string | SkillAddress) {
      update((current) => ({
        ...current,
        scope: scopeForSection(current, section),
        section,
        readerOpen: section === "skills" && selection !== undefined ? current.readerOpen : false,
        sourceFilter: section === "skills" ? current.sourceFilter : undefined,
        ...(section === "sources" && typeof selection === "string"
          ? { selectedSource: selection }
          : {}),
        ...(section === "skills" && selection && typeof selection !== "string"
          ? { selectedSkill: selection }
          : {}),
      }));
    },
    selectSource(selectedSource?: string) {
      update((current) => ({ ...current, selectedSource }));
    },
    selectSourceRelationship(selectedSourceRelationship?: string) {
      update((current) => ({ ...current, selectedSourceRelationship }));
    },
    selectSkillRelationship(selectedSkillRelationship?: string) {
      update((current) => ({ ...current, selectedSkillRelationship }));
    },
    selectSkill(selectedSkill?: SkillAddress) {
      const current = snapshot();
      if (
        !sameSkillAddress(
          current.selectedSkill ?? { source: "", path: "" },
          selectedSkill ?? { source: "", path: "" },
        )
      )
        setSnapshot({ ...current, selectedSkill });
    },
    selectProblem(selectedProblem?: string) {
      update((current) => ({ ...current, selectedProblem }));
    },
    openDiagnosticDetail(key: string) {
      update((current) => ({ ...current, diagnosticDetail: key }));
    },
    closeDiagnosticDetail() {
      update((current) => ({ ...current, diagnosticDetail: undefined }));
    },
    selectExposurePath(selectedExposurePath?: string) {
      update((current) => ({ ...current, selectedExposurePath }));
    },
    toggleExposurePath(path: ExposurePath) {
      const key = exposurePathKey(path);
      update((current) => {
        const defaultExpanded = path.segments.length === 1;
        const expanded = current.expandedExposurePaths[key] ?? defaultExpanded;
        const next = { ...current.expandedExposurePaths };
        if (expanded) next[key] = false;
        else next[key] = true;
        return { ...current, expandedExposurePaths: next };
      });
    },
    expandExposurePath(path: ExposurePath) {
      const key = exposurePathKey(path);
      update((current) => ({
        ...current,
        expandedExposurePaths: { ...current.expandedExposurePaths, [key]: true },
      }));
    },
    isExposurePathExpanded(path: ExposurePath) {
      return snapshot().expandedExposurePaths[exposurePathKey(path)] ?? path.segments.length === 1;
    },
    toggleSkill(address: SkillAddress) {
      update((current) => ({
        ...current,
        selectedSkills: current.selectedSkills.some(
          (value) => value.source === address.source && value.path === address.path,
        )
          ? current.selectedSkills.filter(
              (value) => value.source !== address.source || value.path !== address.path,
            )
          : [...current.selectedSkills, address],
      }));
    },
    clearSelectedSkills() {
      update((current) =>
        current.selectedSkills.length ? { ...current, selectedSkills: [] } : current,
      );
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
      update((current) => ({ ...current, filters: {} }));
    },
    showInstalledSkillsFromSource(source: string) {
      update((current) => ({
        ...current,
        scope: "all-installed-skills",
        section: "skills",
        sourceFilter: source,
        readerOpen: false,
      }));
    },
    clearSourceFilter() {
      update((current) => ({
        ...current,
        scope: "sources",
        section: "sources",
        sourceFilter: undefined,
        readerOpen: false,
      }));
    },
    setScroll(surface: string, scroll: number) {
      const value = Math.max(0, Math.floor(scroll));
      update((current) =>
        current.scrolls[surface] === value
          ? current
          : { ...current, scrolls: { ...current.scrolls, [surface]: value } },
      );
    },
    reconcile(previous: ManagementProjection | undefined, current: ManagementProjection) {
      let reconciledSkill: SkillAddress | undefined;
      let reconciled = false;
      batch(() =>
        update((state) => {
          const options = {
            query: state.query,
            filters: state.filters,
            source: state.sourceFilter,
          };
          const currentSkills =
            state.scope === "unassigned" ? unassignedSkills(current) : current.installedSkills;
          const previousSkills =
            state.scope === "unassigned"
              ? previous
                ? unassignedSkills(previous)
                : []
              : (previous?.installedSkills ?? []);
          const values = filterSkills(currentSkills, {
            ...options,
            agentStatus: current.effective.agent.status,
          }).map((skill) => skill.address);
          const prior = filterSkills(previousSkills, {
            ...options,
            agentStatus: previous?.effective.agent.status,
          }).map((skill) => skill.address);
          const problemOptions = filterProblemRows(
            problemRows(current),
            state.query,
            state.filters,
          ).map(problemRowKey);
          const priorProblems = previous
            ? filterProblemRows(problemRows(previous), state.query, state.filters).map(
                problemRowKey,
              )
            : [];
          const nextProblem = nearest(state.selectedProblem, problemOptions, priorProblems);
          const nextProblemRow = problemRows(current).find(
            (problem) => problemRowKey(problem) === nextProblem,
          );
          const problemSkill =
            nextProblemRow?.intent?.kind === "installed-skill"
              ? nextProblemRow.intent.address
              : undefined;
          const nextSkill =
            state.scope === "problems"
              ? problemSkill &&
                state.selectedSkill &&
                sameSkillAddress(state.selectedSkill, problemSkill)
                ? state.selectedSkill
                : problemSkill
              : nearestSkill(state.selectedSkill, values, prior);
          const next = {
            ...state,
            selectedSource: nearest(
              state.selectedSource,
              current.effective.sources.map((source) => source.id),
              previous?.effective.sources.map((source) => source.id) ?? [],
            ),
            selectedSkill: nextSkill,
            selectedProblem: nextProblem,
            readerOpen:
              state.readerOpen && (state.scope !== "problems" || problemSkill !== undefined),
            selectedSkills: state.selectedSkills.filter((selected) =>
              currentSkills.some((skill) => sameSkillAddress(skill.address, selected)),
            ),
            expandedExposurePaths: Object.fromEntries(
              Object.entries(state.expandedExposurePaths).filter(([key]) =>
                exposureHierarchy(current).some((row) => row.key === key),
              ),
            ),
          };
          if (
            !sameSkillAddress(
              next.selectedSkill ?? { source: "", path: "" },
              state.selectedSkill ?? { source: "", path: "" },
            )
          ) {
            reconciledSkill = next.selectedSkill;
            reconciled = true;
          }
          return next;
        }),
      );
      if (reconciled) onReconciledSkill?.(reconciledSkill);
    },
  };
}

export type WorkspaceState = ReturnType<typeof createWorkspaceState>;
export type WorkspaceReadonly = Pick<
  WorkspaceState,
  | "snapshot"
  | "scope"
  | "section"
  | "selectedSource"
  | "selectedSourceRelationship"
  | "selectedSkillRelationship"
  | "selectedSkill"
  | "selectedProblem"
  | "diagnosticDetail"
  | "selectedSkills"
  | "selectedExposurePath"
  | "expandedExposurePaths"
  | "isExposurePathExpanded"
  | "expandExposurePath"
  | "toggleExposurePath"
  | "readerOpen"
  | "query"
  | "filters"
  | "sourceFilter"
  | "scroll"
  | "narrowLevel"
>;

export type WorkspaceCommands = Pick<
  WorkspaceState,
  | "openDetail"
  | "openWorkArea"
  | "openReader"
  | "closeReader"
  | "openTask"
  | "showList"
  | "showWorkArea"
  | "selectSection"
  | "selectScope"
  | "selectProblem"
  | "openDiagnosticDetail"
  | "closeDiagnosticDetail"
  | "land"
  | "selectSource"
  | "selectSourceRelationship"
  | "selectSkillRelationship"
  | "selectSkill"
  | "selectExposurePath"
  | "toggleSkill"
  | "clearSelectedSkills"
  | "setQuery"
  | "setFilter"
  | "clearFilter"
  | "clearFilters"
  | "showInstalledSkillsFromSource"
  | "clearSourceFilter"
  | "setScroll"
  | "reconcile"
>;
