import type {
  ContentCapability,
  Diagnostic,
  ManagementProjection,
  ResourceDescriptor,
} from "@skill-cli/core";
import { sameSkillAddress, skillAddressKey, type SkillAddress } from "@skill-cli/core";

export type InstalledSkill = ManagementProjection["installedSkills"][number];
export type LoadedInstalledSkill = Awaited<ReturnType<ContentCapability["loadInstalled"]>>["value"];
export type InstalledResource = ResourceDescriptor;
export type ReadInstalledResource = Awaited<
  ReturnType<ContentCapability["readInstalled"]>
>["value"];

export const destinations = ["workspace", "global", "project", "local"] as const;
export type Destination = (typeof destinations)[number];
export type WorkspaceSection = "skills" | "collections" | "sources" | "updates";
export type SkillsView = "current-exposure" | "all-installed-skills" | "unassigned" | "problems";
export type ConfigSection = "sources" | "config-sources" | "collections" | "integrations";
export type Section = WorkspaceSection | ConfigSection;
export type NavigationContext = Destination;
export type NavigationSurface = "browser" | "inspector" | "reader";
export type LayoutMode = "wide" | "medium" | "narrow" | "too-small";
export type NavigationRegion = "context" | "section" | "content";
export type FocusOwner =
  | "top-nav"
  | "scope"
  | "work-area"
  | "local-nav"
  | "skills-views"
  | "browser"
  | "collection-tree"
  | "agent-preview"
  | "reader"
  | "reader-tabs"
  | "reader-raw"
  | "reader-find-previous"
  | "reader-find-next"
  | "open-match-raw"
  | "reader-resource-list"
  | "reader-resource-content"
  | "reader-resource-back"
  | "reader-resource-retry"
  | "inspector"
  | "details-relationships"
  | "details-metadata"
  | "dialog"
  | "task"
  | "problems"
  | "palette"
  | "input"
  | "skills-query"
  | "source-updates-query"
  | "source-installed-skills"
  | "collection-tree-issue"
  | "updates-query"
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
  | "config-source-contributions"
  | "route-back"
  | `command:${string}`;

/** The sole source for a visible command label and its dispatch eligibility. */
export interface CommandRecord {
  readonly id: string;
  readonly keys: readonly string[];
  /** Direct page binding, shared by dispatch, buttons and the Actions list. */
  readonly shortcut?: string;
  readonly verb: string;
  readonly destination: string;
  readonly scope: "lifecycle" | "modal" | "widget" | "route" | "shell" | "page" | "task";
  /** Hide an inline alias when its authoritative task command is already discoverable. */
  readonly palette?: boolean;
  /** Discovery order within the same scope; lower values are shown first. */
  readonly priority?: number;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly danger: boolean;
}

export type CommandRegistration = (
  record: CommandRecord,
  owner: FocusOwner,
  controlId: string,
  execute: () => void,
) => () => void;

export type CommandExecution = (id: string) => void;

export type DispatchResult =
  | "consumed"
  | "declined"
  | { readonly kind: "blocked"; readonly reason: string };

export const readerOwnsFocus = (focus: FocusOwner): boolean =>
  [
    "reader",
    "reader-tabs",
    "reader-raw",
    "reader-find-previous",
    "reader-find-next",
    "open-match-raw",
    "reader-resource-list",
    "reader-resource-content",
    "reader-resource-back",
    "reader-resource-retry",
    "inspector",
    "details-relationships",
    "details-metadata",
    "input",
  ].includes(focus) ||
  focus.startsWith("command:reader.") ||
  focus.startsWith("command:skill-") ||
  focus.startsWith("command:skill.");
export type NarrowLevel = "list" | "work-area" | "detail" | "task";
export type CollectionTab = "entries" | "relations";
export type Overlay =
  | "filter"
  | "help"
  | "palette"
  | "problems"
  | "confirm"
  | "form"
  | "selection"
  | "source-observation"
  | "installed-preview";

export interface ReaderState {
  readonly tab: "skill" | "resources" | "details";
  readonly raw: boolean;
  readonly find: string;
  readonly match: number;
  readonly scroll: number;
  readonly detailsScroll: number;
  readonly detailsManagementOpen?: boolean;
  readonly detailsDescriptionOpen?: boolean;
  readonly detailsMetadataOpen?: boolean;
  readonly focus?: FocusOwner;
  readonly text?: string;
  readonly rawText?: string;
  readonly resources: readonly InstalledResource[];
  readonly resourcesLoaded?: boolean;
  readonly error?: Diagnostic;
  readonly address?: { readonly source: string; readonly path: string };
  readonly loading?: boolean;
  readonly resourceLoading?: boolean;
  readonly selectedResource?: string;
  readonly resource?: ReadInstalledResource;
  readonly resourceLevel?: "list" | "content";
}
export interface TaskState {
  readonly id: string;
  readonly title: string;
  readonly cancellationRequested: boolean;
  readonly error?: { readonly code: string; readonly message: string };
  readonly semanticOwner?: ProjectionOwner;
  readonly details?: readonly string[];
  readonly dismissible?: boolean;
  readonly repair?: {
    readonly action: "rebind" | "uninstall";
    readonly source: string;
    readonly path: string;
  };
}

export type ProjectionOwner =
  | { readonly kind: "source"; readonly id: string }
  | {
      readonly kind: "installed-skill";
      readonly address: { readonly source: string; readonly path: string };
    }
  | { readonly kind: "config"; readonly level: "global" | "project" | "local" }
  | { readonly kind: "config-source"; readonly id: string }
  | { readonly kind: "collection"; readonly id: string };
export type RouteHandoff =
  | {
      readonly kind: "collection-membership";
      readonly address: { readonly source: string; readonly path: string };
      readonly collection: string;
      readonly entry?: string;
      readonly owner: import("@skill-cli/core").ConfigDeclarationOwner;
    }
  | {
      readonly kind: "agent-membership" | "agent-link" | "agent-use";
      readonly collection: string;
      readonly entry?: string;
      readonly owner: import("@skill-cli/core").ConfigDeclarationOwner;
      readonly linkedCollection?: string;
      readonly exposurePath?: import("./collections/state").ExposurePath;
    }
  | {
      readonly kind: "collection-reference";
      readonly collection: string;
      readonly name: string;
      readonly target: string;
      readonly description: string;
      readonly owner: import("@skill-cli/core").ConfigDeclarationOwner;
    }
  | {
      readonly kind: "source-declaration" | "source-contribution";
      readonly source: import("@skill-cli/core").SourceBindingView;
      readonly owner: import("@skill-cli/core").ConfigDeclarationOwner;
    }
  | {
      readonly kind: "agent-producer";
      readonly address: { readonly source: string; readonly path: string };
    }
  | {
      readonly kind: "uninstall-membership";
      readonly address: { readonly source: string; readonly path: string };
      readonly owner: import("@skill-cli/core").ConfigDeclarationOwner;
      readonly collection?: string;
      readonly entry?: string;
    }
  | {
      readonly kind: "config-integration";
      readonly owner: import("@skill-cli/core").ConfigDeclarationOwner;
    };

export const sectionFor = (destination: Destination): Section =>
  destination === "workspace" ? "skills" : "sources";
export const validSections = (destination: Destination): readonly Section[] =>
  destination === "workspace"
    ? ["skills", "collections", "sources", "updates"]
    : ["sources", "config-sources", "collections", "integrations"];

export const projectionOwnerExists = (
  snapshot: ManagementProjection,
  owner: ProjectionOwner,
): boolean =>
  owner.kind === "source"
    ? snapshot.effective.sources.some((source) => source.id === owner.id)
    : owner.kind === "installed-skill"
      ? snapshot.installedSkills.some(
          (skill) =>
            skill.address.source === owner.address.source &&
            skill.address.path === owner.address.path,
        )
      : owner.kind === "config"
        ? snapshot.configs.some((config) => config.level === owner.level)
        : owner.kind === "config-source"
          ? snapshot.configs.some((config) =>
              config.direct.configSources.some((source) => source.id === owner.id),
            )
          : snapshot.configs.some((config) =>
              config.direct.collections.some((collection) => collection.id === owner.id),
            ) ||
            (snapshot.effective.status === "complete" &&
              snapshot.effective.collectionsView.some((collection) => collection.id === owner.id));

export const filterDimensions = (section: Section): readonly string[] =>
  section === "skills"
    ? ["Collection", "Source", "Config", "Problems"]
    : section === "collections"
      ? ["Contains Skill", "Config", "Problems"]
      : section === "sources"
        ? ["Type", "Config", "Updates", "Problems"]
        : [];

export { sameSkillAddress, skillAddressKey };
export type { SkillAddress };

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
    matches.push({
      offset,
      line,
      column: offset - (before.lastIndexOf("\n") + 1),
    });
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
