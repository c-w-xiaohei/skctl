import type {
  ContentCapability,
  Diagnostic,
  ManagementProjection,
  ResourceDescriptor,
} from "../core/api";
import { filterSkills } from "./skills-filter";
import { filterCollections } from "./collections-filter";

export type InstalledSkill = ManagementProjection["installedSkills"][number];
export type LoadedInstalledSkill = Awaited<ReturnType<ContentCapability["loadInstalled"]>>["value"];
export type InstalledResource = ResourceDescriptor;
export type ReadInstalledResource = Awaited<
  ReturnType<ContentCapability["readInstalled"]>
>["value"];

export const destinations = ["workspace", "global", "project", "local"] as const;
export type Destination = (typeof destinations)[number];
export type WorkspaceSection = "skills" | "collections" | "sources";
export type ConfigSection =
  | "sources"
  | "config-sources"
  | "collections"
  | "for-agents"
  | "integrations";
export type Section = WorkspaceSection | ConfigSection;
export type FocusOwner =
  | "top-nav"
  | "local-nav"
  | "browser"
  | "reader"
  | "reader-tabs"
  | "reader-raw"
  | "reader-find-previous"
  | "reader-find-next"
  | "open-match-raw"
  | "reader-resource-list"
  | "reader-resource-content"
  | "reader-resource-retry"
  | "inspector"
  | "details-relationships"
  | "dialog"
  | "task"
  | "problems"
  | "palette"
  | "input"
  | "skills-query"
  | "skills-filter-open"
  | "skills-filter-clear"
  | "skills-filter-clear-all"
  | "collections-query"
  | "collections-filter-search"
  | "collections-filter-open"
  | "collections-filter-clear"
  | "collections-filter-clear-all"
  | "collections-filter-dimensions"
  | "collections-filter-values"
  | "collection-relationships"
  | "config-source-contributions";
export type NarrowLevel = "list" | "detail" | "task";
export type CollectionTab = "members" | "references" | "links";
export type Overlay =
  | "actions"
  | "filter"
  | "help"
  | "palette"
  | "problems"
  | "confirm"
  | "form"
  | "selection";

export interface ReaderState {
  readonly tab: "skill" | "resources" | "details";
  readonly raw: boolean;
  readonly find: string;
  readonly match: number;
  readonly scroll: number;
  readonly detailsScroll: number;
  readonly focus?: FocusOwner;
  readonly text?: string;
  readonly rawText?: string;
  readonly resources: readonly InstalledResource[];
  readonly resourcesLoaded?: boolean;
  readonly error?: Diagnostic;
  readonly address?: { readonly source: string; readonly path: string };
  readonly loading?: boolean;
  readonly selectedResource?: string;
  readonly resource?: ReadInstalledResource;
  readonly resourceLevel?: "list" | "content";
}
export interface Memory {
  readonly section: Section;
  readonly selection: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string>>;
  readonly filters: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly scroll: Readonly<Record<string, number>>;
  readonly detailTab: Readonly<Record<string, ReaderState["tab"]>>;
  readonly collectionTab: Readonly<Record<string, CollectionTab>>;
  readonly collectionFilter?: {
    readonly open: boolean;
    readonly dimension?: string;
    readonly search: string;
  };
}
export interface TaskState {
  readonly id: string;
  readonly title: string;
  readonly cancellationRequested: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly semanticOwner?: string;
  readonly repair?: {
    readonly action: "rebind" | "uninstall";
    readonly source: string;
    readonly path: string;
  };
}
export interface TuiState {
  readonly destination: Destination;
  readonly memory: Readonly<Record<Destination, Memory>>;
  readonly workspace?: ManagementProjection;
  readonly refresh: "idle" | "loading" | "stale";
  readonly focus: FocusOwner;
  readonly narrow: boolean;
  readonly tooSmall: boolean;
  readonly narrowLevel: NarrowLevel;
  readonly reader: ReaderState;
  readonly readers: Readonly<Record<string, ReaderState | undefined>>;
  readonly overlay?: Overlay;
  readonly task?: TaskState;
  readonly operationProblem?: Diagnostic;
  readonly status: string;
  readonly sourceFilter?: string;
  readonly history: readonly Destination[];
  readonly relationshipReturn?: {
    readonly destination: "workspace";
    readonly section: "skills";
    readonly selection: string;
    readonly focus: "inspector" | "details-relationships";
    readonly address: { readonly source: string; readonly path: string };
    readonly tab: "details";
  };
  readonly restoreFocus?: FocusOwner;
  readonly handoff?:
    | {
        readonly kind: "collection-membership";
        readonly address: { readonly source: string; readonly path: string };
        readonly collection: string;
        readonly entry?: string;
        readonly owner: import("../core/api").ConfigDeclarationOwner;
      }
    | {
        readonly kind: "agent-membership" | "agent-link" | "agent-use";
        readonly collection: string;
        readonly entry?: string;
        readonly owner: import("../core/api").ConfigDeclarationOwner;
        readonly linkedCollection?: string;
      }
    | {
        readonly kind: "collection-reference";
        readonly collection: string;
        readonly name: string;
        readonly target: string;
        readonly description: string;
        readonly owner: import("../core/api").ConfigDeclarationOwner;
      }
    | {
        readonly kind: "source-declaration" | "source-contribution";
        readonly source: import("../core/api").SourceBindingView;
        readonly owner: import("../core/api").ConfigDeclarationOwner;
      }
    | {
        readonly kind: "agent-producer";
        readonly address: { readonly source: string; readonly path: string };
      }
    | {
        readonly kind: "uninstall-membership";
        readonly address: { readonly source: string; readonly path: string };
        readonly owner: import("../core/api").ConfigDeclarationOwner;
        readonly collection?: string;
        readonly entry?: string;
      };
}

const workspaceMemory = (): Memory => ({
  section: "skills",
  selection: {},
  query: {},
  filters: {},
  scroll: {},
  detailTab: {},
  collectionTab: {},
  collectionFilter: { open: false, search: "" },
});
const configMemory = (): Memory => ({
  section: "sources",
  selection: {},
  query: {},
  filters: {},
  scroll: {},
  detailTab: {},
  collectionTab: {},
  collectionFilter: { open: false, search: "" },
});
export const sectionFor = (destination: Destination): Section =>
  destination === "workspace" ? "skills" : "sources";
export const validSections = (destination: Destination): readonly Section[] =>
  destination === "workspace"
    ? ["skills", "collections", "sources"]
    : ["sources", "config-sources", "collections", "for-agents", "integrations"];

export type TuiEvent =
  | { readonly type: "destination.select"; readonly destination: Destination }
  | { readonly type: "section.select"; readonly section: Section }
  | {
      readonly type: "selection.set";
      readonly key: string;
      readonly value?: string;
    }
  | { readonly type: "query.set"; readonly key: string; readonly value: string }
  | { readonly type: "collection.filter.open" }
  | { readonly type: "collection.filter.dimension"; readonly dimension?: string }
  | { readonly type: "collection.filter.search"; readonly value: string }
  | { readonly type: "collection.filter.close" }
  | {
      readonly type: "collection.tab.set";
      readonly collection: string;
      readonly tab: CollectionTab;
    }
  | {
      readonly type: "filter.set";
      readonly key: string;
      readonly dimension: string;
      readonly value?: string;
    }
  | {
      readonly type: "filter.clear";
      readonly key: string;
      readonly dimension: string;
    }
  | { readonly type: "filter.clear-all"; readonly key: string }
  | {
      readonly type: "scroll.set";
      readonly key: string;
      readonly value: number;
    }
  | {
      readonly type: "selection.reconcile";
      readonly key: string;
      readonly values: readonly string[];
      readonly previous?: readonly string[];
    }
  | { readonly type: "reader.patch"; readonly value: Partial<ReaderState> }
  | {
      readonly type: "reader.activate";
      readonly address: { readonly source: string; readonly path: string };
      readonly surface?: "details";
    }
  | {
      readonly type: "reader.loaded";
      readonly address: { readonly source: string; readonly path: string };
      readonly value: LoadedInstalledSkill;
    }
  | {
      readonly type: "reader.resources";
      readonly address: { readonly source: string; readonly path: string };
      readonly resources: readonly InstalledResource[];
    }
  | {
      readonly type: "reader.resource.loaded";
      readonly address: { readonly source: string; readonly path: string };
      readonly value: ReadInstalledResource;
    }
  | {
      readonly type: "reader.failure";
      readonly diagnostic: Diagnostic;
      readonly address?: { readonly source: string; readonly path: string };
    }
  | { readonly type: "overlay.open"; readonly overlay: Overlay }
  | { readonly type: "overlay.close" }
  | {
      readonly type: "route.source";
      readonly destination: Destination;
      readonly section: Section;
      readonly selection: string;
    }
  | {
      readonly type: "route.relationship";
      readonly destination: Destination;
      readonly section: Section;
      readonly selection: string;
      readonly returnFocus: "inspector" | "details-relationships";
    }
  | { readonly type: "focus.set"; readonly focus: FocusOwner }
  | { readonly type: "handoff.set"; readonly handoff?: TuiState["handoff"] }
  | { readonly type: "route.back" }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "narrow.level"; readonly level: NarrowLevel }
  | { readonly type: "workspace.loading" }
  | {
      readonly type: "workspace.replace";
      readonly workspace: ManagementProjection;
    }
  | { readonly type: "workspace.failure"; readonly diagnostic: Diagnostic }
  | { readonly type: "operation.failure"; readonly diagnostic: Diagnostic }
  | { readonly type: "operation.failure.clear" }
  | { readonly type: "source.filter.set"; readonly source?: string }
  | { readonly type: "operation.owner.missing"; readonly owner: string }
  | { readonly type: "task.start"; readonly task: TaskState }
  | { readonly type: "task.cancel.request"; readonly id: string }
  | {
      readonly type: "task.settle";
      readonly id: string;
      readonly status: string;
      readonly error?: Diagnostic;
    };

export function createTuiState(): TuiState {
  return {
    destination: "workspace",
    memory: {
      workspace: workspaceMemory(),
      global: configMemory(),
      project: configMemory(),
      local: configMemory(),
    },
    refresh: "idle",
    focus: "browser",
    narrow: false,
    tooSmall: false,
    narrowLevel: "list",
    reader: {
      tab: "skill",
      raw: false,
      find: "",
      match: 0,
      scroll: 0,
      detailsScroll: 0,
      resources: [],
    },
    readers: {},
    status: "Loading workspace",
    history: [],
  };
}

function updateMemory(state: TuiState, update: (memory: Memory) => Memory): TuiState {
  return {
    ...state,
    memory: {
      ...state.memory,
      [state.destination]: update(state.memory[state.destination]),
    },
  };
}
export function reduceTui(state: TuiState, event: TuiEvent): TuiState {
  if (event.type === "destination.select")
    return {
      ...state,
      destination: event.destination,
      history:
        state.destination === event.destination
          ? state.history
          : [...state.history, state.destination],
      focus: "browser",
      narrowLevel: state.memory[event.destination].selection[
        state.memory[event.destination].section
      ]
        ? state.narrowLevel
        : "list",
      overlay: undefined,
    };
  if (event.type === "route.back") {
    if (state.relationshipReturn) {
      const target = state.relationshipReturn;
      const reader = {
        ...state.reader,
        address: target.address,
        tab: target.tab,
        focus: target.focus,
      };
      return {
        ...state,
        destination: target.destination,
        memory: {
          ...state.memory,
          workspace: {
            ...state.memory.workspace,
            section: target.section,
            selection: { ...state.memory.workspace.selection, skills: target.selection },
          },
        },
        reader,
        readers: { ...state.readers, [skillKey(target.address)]: reader },
        focus: target.focus,
        overlay: undefined,
        relationshipReturn: undefined,
      };
    }
    const destination = state.history.at(-1);
    return destination
      ? {
          ...state,
          destination,
          history: state.history.slice(0, -1),
          focus: "browser",
          overlay: undefined,
        }
      : state;
  }
  if (event.type === "section.select") {
    if (!validSections(state.destination).includes(event.section)) return state;
    return updateMemory(state, (memory) => ({
      ...memory,
      section: event.section,
    }));
  }
  if (event.type === "selection.set")
    return updateMemory(state, (memory) => ({
      ...memory,
      selection: { ...memory.selection, [event.key]: event.value },
    }));
  if (event.type === "query.set")
    return updateMemory(state, (memory) => ({
      ...memory,
      query: { ...memory.query, [event.key]: event.value },
    }));
  if (event.type === "collection.filter.open")
    return updateMemory(state, (memory) => ({
      ...memory,
      collectionFilter: { open: true, dimension: undefined, search: "" },
    }));
  if (event.type === "collection.filter.dimension")
    return updateMemory(state, (memory) => ({
      ...memory,
      collectionFilter: { open: true, dimension: event.dimension, search: "" },
    }));
  if (event.type === "collection.filter.search")
    return updateMemory(state, (memory) => ({
      ...memory,
      collectionFilter: {
        ...(memory.collectionFilter ?? { open: true, search: "" }),
        search: event.value,
      },
    }));
  if (event.type === "collection.filter.close")
    return updateMemory(state, (memory) => ({
      ...memory,
      collectionFilter: { open: false, search: "" },
    }));
  if (event.type === "collection.tab.set")
    return updateMemory(state, (memory) => ({
      ...memory,
      collectionTab: { ...memory.collectionTab, [event.collection]: event.tab },
    }));
  if (event.type === "filter.set")
    return updateMemory(state, (memory) => ({
      ...memory,
      filters: {
        ...memory.filters,
        [event.key]: event.value
          ? { ...memory.filters[event.key], [event.dimension]: event.value }
          : Object.fromEntries(
              Object.entries(memory.filters[event.key] ?? {}).filter(
                ([key]) => key !== event.dimension,
              ),
            ),
      },
    }));
  if (event.type === "filter.clear")
    return updateMemory(state, (memory) => {
      const filters = { ...memory.filters[event.key] };
      delete filters[event.dimension];
      return {
        ...memory,
        filters: { ...memory.filters, [event.key]: filters },
      };
    });
  if (event.type === "filter.clear-all")
    return updateMemory(state, (memory) => ({
      ...memory,
      query: { ...memory.query, [event.key]: "" },
      filters: { ...memory.filters, [event.key]: {} },
    }));
  if (event.type === "scroll.set")
    return updateMemory(state, (memory) => ({
      ...memory,
      scroll: { ...memory.scroll, [event.key]: event.value },
    }));
  if (event.type === "selection.reconcile")
    return updateMemory(state, (memory) => {
      const selected = memory.selection[event.key];
      const index = selected ? event.values.indexOf(selected) : -1;
      const previousIndex = selected ? (event.previous?.indexOf(selected) ?? -1) : -1;
      const value =
        index >= 0
          ? selected
          : event.values[Math.min(event.values.length - 1, Math.max(0, previousIndex))];
      return {
        ...memory,
        selection: { ...memory.selection, [event.key]: value },
      };
    });
  if (event.type === "reader.patch") {
    const reader = { ...state.reader, ...event.value };
    const key = reader.address ? skillKey(reader.address) : undefined;
    return { ...state, reader, readers: key ? { ...state.readers, [key]: reader } : state.readers };
  }
  if (event.type === "reader.activate") {
    const key = skillKey(event.address);
    const cached = state.readers[key];
    const reader = {
      ...(cached ?? {
        ...createTuiState().reader,
        address: event.address,
      }),
      ...(event.surface === "details"
        ? { tab: "details" as const, focus: "inspector" as const }
        : {}),
    };
    return {
      ...state,
      ...(event.surface === "details" ? { focus: "inspector" as const } : {}),
      reader,
      readers: { ...state.readers, [key]: reader },
    };
  }
  if (event.type === "reader.loaded") {
    const key = skillKey(event.address);
    const prior = state.readers[key] ?? state.reader;
    const reader: ReaderState = {
      ...prior,
      address: event.address,
      text: event.value.markdownText,
      rawText: event.value.rawText,
      loading: false,
      error: undefined,
    };
    return { ...state, reader, readers: { ...state.readers, [key]: reader } };
  }
  if (event.type === "reader.resources") {
    const key = skillKey(event.address);
    const reader: ReaderState = {
      ...(state.readers[key] ?? state.reader),
      address: event.address,
      resources: event.resources,
      resourcesLoaded: true,
      loading: false,
      error: undefined,
    };
    return {
      ...state,
      reader:
        state.reader.address && skillKey(state.reader.address) === key ? reader : state.reader,
      readers: { ...state.readers, [key]: reader },
    };
  }
  if (event.type === "reader.resource.loaded") {
    const key = skillKey(event.address);
    const reader: ReaderState = {
      ...(state.readers[key] ?? state.reader),
      address: event.address,
      selectedResource: event.value.path,
      resource: event.value,
      resourceLevel: "content",
      loading: false,
      error: undefined,
    };
    return {
      ...state,
      reader:
        state.reader.address && skillKey(state.reader.address) === key ? reader : state.reader,
      readers: { ...state.readers, [key]: reader },
    };
  }
  if (event.type === "reader.failure") {
    if (
      event.address &&
      (!state.reader.address || skillKey(state.reader.address) !== skillKey(event.address))
    )
      return state;
    const reader = { ...state.reader, loading: false, error: event.diagnostic };
    const key = reader.address ? skillKey(reader.address) : undefined;
    return {
      ...state,
      reader,
      readers: key ? { ...state.readers, [key]: reader } : state.readers,
      focus:
        reader.tab === "resources" && reader.resourceLevel === "content"
          ? "reader-tabs"
          : state.focus,
    };
  }
  if (event.type === "overlay.open")
    return {
      ...state,
      overlay: event.overlay,
      restoreFocus: state.overlay ? state.restoreFocus : state.focus,
      focus: event.overlay === "palette" ? "palette" : "dialog",
    };
  if (event.type === "overlay.close")
    return {
      ...state,
      overlay: undefined,
      focus: state.restoreFocus ?? "browser",
      restoreFocus: undefined,
    };
  if (event.type === "route.source")
    return {
      ...state,
      destination: event.destination,
      history:
        state.destination === event.destination
          ? state.history
          : [...state.history, state.destination],
      memory: {
        ...state.memory,
        [event.destination]: {
          ...state.memory[event.destination],
          section: event.section,
          selection: {
            ...state.memory[event.destination].selection,
            [event.section]: event.selection,
          },
        },
      },
      focus: "browser",
      overlay: undefined,
      restoreFocus: undefined,
    };
  if (event.type === "route.relationship") {
    const address = state.reader.address;
    const selection = state.memory.workspace.selection.skills;
    if (
      state.destination !== "workspace" ||
      state.memory.workspace.section !== "skills" ||
      !address ||
      !selection ||
      state.reader.tab !== "details"
    )
      return state;
    return {
      ...state,
      destination: event.destination,
      memory: {
        ...state.memory,
        [event.destination]: {
          ...state.memory[event.destination],
          section: event.section,
          selection: {
            ...state.memory[event.destination].selection,
            [event.section]: event.selection,
          },
        },
      },
      focus: "browser",
      overlay: undefined,
      restoreFocus: undefined,
      relationshipReturn: {
        destination: "workspace",
        section: "skills",
        selection,
        focus: event.returnFocus,
        address,
        tab: "details",
      },
    };
  }
  if (event.type === "focus.set") {
    const readerFocus = [
      "reader",
      "reader-tabs",
      "reader-raw",
      "reader-find-previous",
      "reader-find-next",
      "open-match-raw",
      "reader-resource-list",
      "reader-resource-content",
      "reader-resource-retry",
      "inspector",
      "details-relationships",
      "input",
    ].includes(event.focus);
    if (!readerFocus || !state.reader.address) return { ...state, focus: event.focus };
    const reader = { ...state.reader, focus: event.focus };
    return {
      ...state,
      focus: event.focus,
      reader,
      readers: { ...state.readers, [skillKey(state.reader.address)]: reader },
    };
  }
  if (event.type === "handoff.set") return { ...state, handoff: event.handoff };
  if (event.type === "resize")
    return {
      ...state,
      narrow: event.width < 80,
      tooSmall: event.width < 43 || event.height < 12,
    };
  if (event.type === "narrow.level") return { ...state, narrowLevel: event.level };
  if (event.type === "workspace.loading")
    return { ...state, refresh: "loading", status: "Refreshing workspace" };
  if (event.type === "workspace.replace") {
    const sourceValues = event.workspace.effective.sources.map((source) => source.id);
    const previousSources = state.workspace?.effective.sources.map((source) => source.id);
    const memory = state.memory.workspace;
    const selected = memory.selection.sources;
    const previousIndex = selected ? (previousSources?.indexOf(selected) ?? -1) : -1;
    const sourceSelection =
      selected && sourceValues.includes(selected)
        ? selected
        : sourceValues[Math.min(sourceValues.length - 1, Math.max(0, previousIndex))];
    const skillFilter = {
      query: memory.query.skills,
      filters: memory.filters.skills,
      source: state.sourceFilter,
    };
    const skillValues = filterSkills(event.workspace.installedSkills, {
      ...skillFilter,
      agentStatus: event.workspace.effective.agent.status,
    }).map((skill) => skillKey(skill.address));
    const selectedSkill = memory.selection.skills;
    const previousSkills = filterSkills(state.workspace?.installedSkills ?? [], {
      ...skillFilter,
      agentStatus: state.workspace?.effective.agent.status,
    }).map((skill) => skillKey(skill.address));
    const previousSkillIndex = selectedSkill ? (previousSkills?.indexOf(selectedSkill) ?? -1) : -1;
    const skillSelection =
      selectedSkill && skillValues.includes(selectedSkill)
        ? selectedSkill
        : skillValues[Math.min(skillValues.length - 1, Math.max(0, previousSkillIndex))];
    const collectionValues =
      event.workspace.effective.status === "complete"
        ? filterCollections(event.workspace.effective.collectionsView, {
            query: memory.query.collections,
            filters: memory.filters.collections ?? {},
            agentUse: event.workspace.effective.use,
            installedSkills: event.workspace.installedSkills,
          }).map((collection) => collection.id)
        : [];
    const previousCollections =
      state.workspace?.effective.status === "complete"
        ? filterCollections(state.workspace.effective.collectionsView, {
            query: memory.query.collections,
            filters: memory.filters.collections ?? {},
            agentUse: state.workspace.effective.use,
            installedSkills: state.workspace.installedSkills,
          }).map((collection) => collection.id)
        : [];
    const selectedCollection = memory.selection.collections;
    const previousCollectionIndex = selectedCollection
      ? previousCollections.indexOf(selectedCollection)
      : -1;
    const collectionSelection =
      selectedCollection && collectionValues.includes(selectedCollection)
        ? selectedCollection
        : collectionValues[
            Math.min(collectionValues.length - 1, Math.max(0, previousCollectionIndex))
          ];
    const readerOwnedFocus = [
      "reader",
      "reader-tabs",
      "reader-raw",
      "reader-find-previous",
      "reader-find-next",
      "open-match-raw",
      "reader-resource-list",
      "reader-resource-content",
      "reader-resource-retry",
      "inspector",
      "details-relationships",
      "input",
    ].includes(state.focus);
    return {
      ...state,
      workspace: event.workspace,
      memory: {
        ...state.memory,
        workspace: {
          ...memory,
          selection: {
            ...memory.selection,
            sources: sourceSelection,
            skills: skillSelection,
            collections: collectionSelection,
          },
        },
      },
      ...((memory.section === "collections" ? collectionSelection : skillSelection)
        ? {}
        : {
            focus: readerOwnedFocus ? "browser" : state.focus,
            narrowLevel: "list" as const,
          }),
      refresh: "idle",
      status: "Workspace refreshed",
    };
  }
  if (event.type === "workspace.failure")
    return {
      ...state,
      refresh: "stale",
      status: event.diagnostic.message,
    };
  if (event.type === "operation.failure")
    return {
      ...state,
      operationProblem: event.diagnostic,
      status: `${event.diagnostic.code}: ${event.diagnostic.message}`,
    };
  if (event.type === "operation.failure.clear") return { ...state, operationProblem: undefined };
  if (event.type === "source.filter.set") return { ...state, sourceFilter: event.source };
  if (event.type === "operation.owner.missing" && state.task?.semanticOwner === event.owner)
    return {
      ...state,
      task: undefined,
      overlay: undefined,
      focus: state.restoreFocus ?? "browser",
      status: "Operation target is no longer available",
    };
  if (event.type === "task.start")
    return {
      ...state,
      task: event.task,
      focus: "task",
      status: event.task.title,
    };
  if (event.type === "task.cancel.request" && state.task?.id === event.id)
    return {
      ...state,
      task: { ...state.task, cancellationRequested: true },
      status: "Cancelling operation",
    };
  if (event.type === "task.settle" && state.task?.id === event.id)
    return {
      ...state,
      task: undefined,
      focus: state.overlay ? "dialog" : state.focus === "task" ? "browser" : state.focus,
      status: event.status,
      ...(event.error ? { operationProblem: event.error } : { operationProblem: undefined }),
    };
  return state;
}

export const filterDimensions = (section: Section): readonly string[] =>
  section === "skills"
    ? ["Collection", "Source", "Config", "For agents", "Problems"]
    : section === "collections"
      ? ["Contains Skill", "Config", "For agents", "Problems"]
      : section === "sources"
        ? ["Type", "Config", "Updates", "Problems"]
        : [];

export const filterCount = (memory: Memory, key: string): number =>
  Object.values(memory.filters[key] ?? {}).filter(Boolean).length;

export const problems = (state: TuiState): readonly Diagnostic[] => [
  ...(state.workspace?.diagnostics ?? []),
  ...(state.operationProblem ? [state.operationProblem] : []),
];

export const skillKey = (address: { readonly source: string; readonly path: string }) =>
  `${address.source}/${address.path}`;

export interface SourceMatch {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export function findLiteralMatches(source: string, query: string): readonly SourceMatch[] {
  if (!query) return [];
  const matches: SourceMatch[] = [];
  for (
    let offset = source.indexOf(query);
    offset >= 0;
    offset = source.indexOf(query, offset + query.length)
  ) {
    const before = source.slice(0, offset);
    const line = (before.match(/\n/g) ?? []).length;
    matches.push({ offset, line, column: offset - (before.lastIndexOf("\n") + 1) });
  }
  return matches;
}

export function rawOffsetForMarkdownMatch(
  rawText: string,
  markdownText: string,
  offset: number,
): number {
  return rawText.length - markdownText.length + offset;
}

/** Maps a rendered Markdown match back to the complete raw SKILL.md line. */
export function rawLineForMarkdownMatch(
  rawText: string,
  markdownText: string,
  markdownOffset: number,
): number {
  const rawOffset = rawOffsetForMarkdownMatch(rawText, markdownText, markdownOffset);
  return (rawText.slice(0, Math.max(0, rawOffset)).match(/\n/g) ?? []).length;
}
