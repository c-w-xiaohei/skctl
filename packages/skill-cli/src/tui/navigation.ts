import type { Destination, FocusOwner, NarrowLevel, Overlay, ReaderState, Section } from "./types";
import { destinations, readerOwnsFocus } from "./types";

export type NavKeyName =
  | "left"
  | "right"
  | "up"
  | "down"
  | "tab"
  | "enter"
  | "escape"
  | "slash"
  | "page-up"
  | "page-down"
  | "home"
  | "end"
  | "character"
  | "other";

export interface NavKey {
  readonly name: NavKeyName;
  readonly char?: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
}

export function parseNavKey(raw: {
  readonly name: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
}): NavKey {
  const lowered = raw.name.toLowerCase();
  const base = { char: undefined, ctrl: raw.ctrl === true, shift: raw.shift === true };
  if (lowered === "arrowleft" || lowered === "left") return { ...base, name: "left" };
  if (lowered === "arrowright" || lowered === "right") return { ...base, name: "right" };
  if (lowered === "arrowup" || lowered === "up") return { ...base, name: "up" };
  if (lowered === "arrowdown" || lowered === "down") return { ...base, name: "down" };
  if (lowered === "tab") return { ...base, name: "tab" };
  if (lowered === "enter" || lowered === "return") return { ...base, name: "enter" };
  if (lowered === "escape" || lowered === "esc") return { ...base, name: "escape" };
  if (lowered === "/") return { ...base, name: "slash" };
  if (lowered === "pageup") return { ...base, name: "page-up" };
  if (lowered === "pagedown") return { ...base, name: "page-down" };
  if (lowered === "home") return { ...base, name: "home" };
  if (lowered === "end") return { ...base, name: "end" };
  if (lowered.length === 1) return { ...base, name: "character", char: lowered };
  return { ...base, name: "other" };
}

export interface NavFacts {
  readonly destination: Destination;
  readonly section: Section;
  readonly focus: FocusOwner;
  readonly overlay?: Overlay;
  readonly task: boolean;
  readonly narrow: boolean;
  readonly narrowLevel: NarrowLevel;
  readonly sourceFilter: boolean;
  readonly canReturn: boolean;
  readonly emptyWorkspaceAction: boolean;
  readonly nativeInput: boolean;
  readonly tabsPart?: boolean;
  readonly readerActive: boolean;
  readonly readerTab: ReaderState["tab"];
  readonly readerRetry?: boolean;
  readonly readerResourceLevel?: "list" | "content";
  readonly detailsRelationships?: boolean;
  readonly collectionFilterOpen: boolean;
  readonly collectionFilterDimension: boolean;
  readonly skillsFilterAvailable?: boolean;
  readonly collectionsFilterAvailable?: boolean;
}

export type NavEffect = "exit" | "cancel-operation" | "close-surface";

export type NavDecision =
  | { readonly kind: "events"; readonly events: readonly NavEvent[] }
  | { readonly kind: "effect"; readonly effect: NavEffect }
  | null;

const READER_TABS: readonly ReaderState["tab"][] = ["skill", "resources", "details"];
const READER_SKILL_CONTROLS: readonly FocusOwner[] = [
  "reader",
  "input",
  "reader-raw",
  "reader-find-previous",
  "reader-find-next",
  "open-match-raw",
];

const QUERY_INPUT_OWNERS: readonly FocusOwner[] = ["skills-query", "collections-query"];

const CTRL_GUARD_OWNERS: readonly FocusOwner[] = ["input", "dialog", "palette"];

type NavRegion = "top-nav" | "local-nav" | "browser" | "reader";

export type NavEvent =
  | { readonly type: "narrow.open-detail" | "narrow.show-list" }
  | { readonly type: "palette.open" }
  | { readonly type: "reader.patch"; readonly value: Partial<ReaderState> }
  | { readonly type: "focus.request"; readonly focus: FocusOwner }
  | { readonly type: "destination.select"; readonly destination: Destination }
  | { readonly type: "route.back" }
  | { readonly type: "collections.filter.back" }
  | { readonly type: "collections.filter.close" }
  | { readonly type: "workspace.source-filter.clear" };

const events = (...list: readonly NavEvent[]): NavDecision => ({ kind: "events", events: list });

const readerContentOwner = (tab: ReaderState["tab"]): FocusOwner =>
  tab === "resources" ? "reader-resource-list" : "reader";

const regionOf = (facts: NavFacts): NavRegion => {
  if (facts.focus === "top-nav") return "top-nav";
  if (facts.focus === "local-nav") return "local-nav";
  if (facts.readerActive && readerOwnsFocus(facts.focus)) return "reader";
  return "browser";
};

const regionTarget = (region: NavRegion): FocusOwner =>
  region === "reader" ? "reader-tabs" : region;

const browserLanding = (facts: NavFacts): NavDecision =>
  events(...(facts.narrow ? [{ type: "narrow.show-list" } as const] : []), {
    type: "focus.request",
    focus: "browser",
  });

const resolveLeftRight = (facts: NavFacts, key: NavKey): NavDecision => {
  const step = key.name === "left" ? -1 : 1;
  if (facts.emptyWorkspaceAction) {
    const index = destinations.indexOf(facts.destination);
    const destination = destinations[(index + step + destinations.length) % destinations.length]!;
    return events(
      { type: "destination.select", destination },
      { type: "focus.request", focus: "top-nav" },
    );
  }
  if (facts.focus === "browser" && facts.destination !== "workspace") {
    const index = destinations.indexOf(facts.destination);
    const destination = destinations[(index + step + destinations.length) % destinations.length]!;
    return events(
      { type: "destination.select", destination },
      { type: "focus.request", focus: "top-nav" },
    );
  }
  if (facts.focus === "browser" && facts.readerActive) {
    const index = READER_TABS.indexOf(facts.readerTab);
    const tab = READER_TABS[(index + step + READER_TABS.length) % READER_TABS.length]!;
    return events({ type: "reader.patch", value: { tab } });
  }
  if (facts.focus === "reader-tabs" && facts.readerActive) {
    const index = READER_TABS.indexOf(facts.readerTab);
    const tab = READER_TABS[(index + step + READER_TABS.length) % READER_TABS.length]!;
    return events({ type: "reader.patch", value: { tab } });
  }
  return null;
};

const resolveTab = (facts: NavFacts, key: NavKey): NavDecision => {
  if (facts.collectionFilterOpen) return null;
  if (facts.readerActive && facts.readerTab === "skill") {
    const index = READER_SKILL_CONTROLS.indexOf(facts.focus);
    if (index >= 0) {
      const next = index + (key.shift ? -1 : 1);
      if (next >= 0 && next < READER_SKILL_CONTROLS.length)
        return events({ type: "focus.request", focus: READER_SKILL_CONTROLS[next]! });
      return events({ type: "focus.request", focus: key.shift ? "browser" : "top-nav" });
    }
  }
  if (facts.readerActive && facts.focus === "reader-resource-retry" && key.shift)
    return events({ type: "focus.request", focus: "reader-tabs" });
  if (facts.readerActive && facts.focus === "reader-resource-content" && key.shift)
    return events({ type: "focus.request", focus: "browser" });
  if (facts.focus === "reader-tabs" && facts.readerActive)
    return events({
      type: "focus.request",
      focus: key.shift
        ? "browser"
        : facts.readerTab === "resources" && facts.readerRetry
          ? "reader-resource-retry"
          : readerContentOwner(facts.readerTab),
    });
  if (facts.readerActive && facts.focus === "reader" && facts.readerTab === "details")
    return events({ type: "focus.request", focus: key.shift ? "browser" : "inspector" });
  if (facts.readerActive && facts.focus === "inspector")
    return events({
      type: "focus.request",
      focus: key.shift
        ? "reader"
        : facts.detailsRelationships
          ? "details-relationships"
          : "details-metadata",
    });
  if (facts.readerActive && facts.focus === "details-relationships")
    return events({ type: "focus.request", focus: key.shift ? "inspector" : "details-metadata" });
  if (facts.readerActive && facts.focus === "details-metadata")
    return events({
      type: "focus.request",
      focus: key.shift
        ? facts.detailsRelationships
          ? "details-relationships"
          : "inspector"
        : "browser",
    });
  if (facts.readerActive && facts.focus === "browser")
    return events({ type: "focus.request", focus: "reader-tabs" });
  if (
    facts.readerActive &&
    facts.destination === "workspace" &&
    facts.section === "skills" &&
    facts.skillsFilterAvailable &&
    (facts.focus === "skills-query" || facts.focus === "skills-filter-open")
  )
    return events({
      type: "focus.request",
      focus: facts.focus === "skills-query" ? "skills-filter-open" : "skills-query",
    });
  const skillsFilterOrder: readonly FocusOwner[] | undefined =
    !facts.readerActive &&
    facts.destination === "workspace" &&
    facts.section === "skills" &&
    facts.skillsFilterAvailable
      ? ["top-nav", "local-nav", "browser", "skills-query", "skills-filter-open", "reader-tabs"]
      : undefined;
  const collectionsFilterOrder: readonly FocusOwner[] | undefined =
    facts.destination === "workspace" &&
    facts.section === "collections" &&
    facts.collectionsFilterAvailable
      ? facts.narrow
        ? facts.narrowLevel === "list"
          ? ["top-nav", "local-nav", "browser", "collections-query", "collections-filter-open"]
          : ["inspector", "collection-relationships"]
        : [
            "top-nav",
            "local-nav",
            "browser",
            "collections-query",
            "collections-filter-open",
            "inspector",
            "collection-relationships",
          ]
      : undefined;
  const filterOrder = skillsFilterOrder ?? collectionsFilterOrder;
  if (filterOrder) {
    const current = readerOwnsFocus(facts.focus) ? "reader-tabs" : facts.focus;
    const index = filterOrder.indexOf(current);
    if (index >= 0) {
      const next =
        filterOrder[(index + (key.shift ? -1 : 1) + filterOrder.length) % filterOrder.length]!;
      return events({ type: "focus.request", focus: next as FocusOwner });
    }
  }
  const regions: readonly NavRegion[] = facts.readerActive
    ? ["top-nav", "local-nav", "browser", "reader"]
    : ["top-nav", "local-nav", "browser"];
  const index = regions.indexOf(regionOf(facts));
  const next = regions[(index + (key.shift ? -1 : 1) + regions.length) % regions.length]!;
  return events({ type: "focus.request", focus: regionTarget(next) });
};

const resolveEnter = (facts: NavFacts): NavDecision => {
  if (facts.focus === "top-nav")
    return events({ type: "destination.select", destination: facts.destination });
  if (facts.focus === "local-nav") return events({ type: "focus.request", focus: "browser" });
  if (
    facts.destination === "workspace" &&
    facts.section === "collections" &&
    facts.focus === "inspector"
  )
    return events({ type: "focus.request", focus: "collection-relationships" });
  if (facts.focus === "reader-tabs" && facts.readerActive)
    return events({ type: "focus.request", focus: readerContentOwner(facts.readerTab) });
  return null;
};

const resolveEscape = (facts: NavFacts): NavDecision => {
  if (facts.canReturn) return events({ type: "route.back" });
  if (facts.focus === "config-source-contributions")
    return events({ type: "focus.request", focus: "browser" });
  if (facts.collectionFilterOpen)
    return facts.collectionFilterDimension
      ? events(
          { type: "collections.filter.back" },
          { type: "focus.request", focus: "collections-filter-search" },
        )
      : events({ type: "collections.filter.close" }, { type: "focus.request", focus: "browser" });
  if (facts.focus === "collections-query") return browserLanding(facts);
  if (QUERY_INPUT_OWNERS.includes(facts.focus))
    return events({ type: "focus.request", focus: "browser" });
  if (facts.readerActive && readerOwnsFocus(facts.focus)) {
    if (facts.readerTab === "resources" && facts.readerResourceLevel === "content")
      return events(
        {
          type: "reader.patch",
          value: { resourceLevel: "list", resource: undefined, loading: false, error: undefined },
        },
        { type: "focus.request", focus: "reader-resource-list" },
      );
    return browserLanding(facts);
  }
  if (facts.sourceFilter)
    return events(
      { type: "workspace.source-filter.clear" },
      { type: "focus.request", focus: "browser" },
    );
  if (
    !facts.readerActive &&
    (facts.focus === "inspector" || facts.focus === "collection-relationships")
  )
    return browserLanding(facts);
  if (
    facts.destination === "workspace" &&
    facts.section === "sources" &&
    facts.narrow &&
    facts.narrowLevel === "detail" &&
    facts.focus === "local-nav"
  )
    return browserLanding(facts);
  if (facts.narrow && facts.narrowLevel !== "list")
    return events({ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" });
  if (facts.focus === "local-nav") return events({ type: "focus.request", focus: "top-nav" });
  if (facts.focus === "top-nav") return events({ type: "focus.request", focus: "browser" });
  if (facts.focus === "browser") return events({ type: "focus.request", focus: "local-nav" });
  return null;
};

const resolveSlash = (facts: NavFacts): NavDecision => {
  if (
    facts.destination === "workspace" &&
    facts.section === "collections" &&
    facts.focus === "browser"
  )
    return events({ type: "focus.request", focus: "collections-query" });
  if (facts.readerActive) {
    if (facts.focus === "browser") return events({ type: "focus.request", focus: "skills-query" });
    if (facts.focus === "top-nav" || facts.focus === "local-nav" || readerOwnsFocus(facts.focus))
      return events({ type: "focus.request", focus: "input" });
  }
  if (facts.destination === "workspace" && facts.section === "skills" && facts.focus === "browser")
    return events({ type: "focus.request", focus: "skills-query" });
  return null;
};

export function resolve(facts: NavFacts, key: NavKey): NavDecision {
  const escape = key.name === "escape";
  const ctrlC = key.ctrl && key.char === "c";
  if (facts.overlay) {
    if (escape || ctrlC) return { kind: "effect", effect: "close-surface" };
    return null;
  }
  if (facts.task) {
    if (escape || ctrlC) return { kind: "effect", effect: "cancel-operation" };
    return null;
  }
  if (facts.nativeInput) {
    if (
      key.name === "left" ||
      key.name === "right" ||
      key.name === "up" ||
      key.name === "down" ||
      key.name === "enter" ||
      key.name === "slash" ||
      (key.name === "character" && !key.ctrl)
    )
      return null;
  }
  if (
    facts.tabsPart &&
    (key.name === "left" || key.name === "right" || key.name === "home" || key.name === "end")
  )
    return null;
  if (key.name === "left" || key.name === "right") return resolveLeftRight(facts, key);
  if (key.name === "tab") return resolveTab(facts, key);
  if (key.name === "enter") return resolveEnter(facts);
  if (escape) return resolveEscape(facts);
  if (key.name === "slash") return resolveSlash(facts);
  if (key.ctrl && CTRL_GUARD_OWNERS.includes(facts.focus)) return null;
  if (key.ctrl && key.char === "p") return events({ type: "palette.open" });
  if (ctrlC) return { kind: "effect", effect: "exit" };
  return null;
}
