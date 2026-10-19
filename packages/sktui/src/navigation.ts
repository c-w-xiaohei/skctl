import type {
  CommandRecord,
  Destination,
  DispatchResult,
  FocusOwner,
  NarrowLevel,
  Overlay,
  ReaderState,
  Section,
} from "./types";
import { readerOwnsFocus } from "./types";

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
  readonly alt: boolean;
  readonly meta?: boolean;
  readonly option?: boolean;
  readonly super?: boolean;
  readonly hyper?: boolean;
}

export interface DispatchKeyEvent {
  readonly key: NavKey;
  readonly lifecycle?: () => DispatchResult;
  readonly modal?: () => DispatchResult;
  readonly tab?: () => DispatchResult;
  readonly widget?: () => DispatchResult;
  readonly command?: CommandRecord;
  readonly execute?: (command: CommandRecord) => void;
  readonly route?: () => DispatchResult;
  readonly shell?: () => DispatchResult;
}

export const isPlainNavKey = (key: {
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
  readonly option?: boolean;
  readonly super?: boolean;
  readonly hyper?: boolean;
}): boolean =>
  !key.ctrl && !key.shift && !key.alt && !key.meta && !key.option && !key.super && !key.hyper;

const matchesCommand = (command: CommandRecord, key: NavKey): boolean =>
  command.keys.includes(key.name) || (key.char !== undefined && command.keys.includes(key.char));

export function matchesCommandShortcut(command: CommandRecord, key: NavKey): boolean {
  if (!command.shortcut) return false;
  const parts = command.shortcut.toLowerCase().split("+");
  const name = parts.pop()!;
  const expected = parseNavKey({
    name,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  });
  return (
    key.name === expected.name &&
    key.char === expected.char &&
    key.ctrl === expected.ctrl &&
    key.shift === expected.shift &&
    key.alt === expected.alt &&
    !key.meta &&
    !key.option &&
    !key.super &&
    !key.hyper
  );
}

/**
 * The renderer calls this once per key. A declined layer alone permits the next
 * layer to run; blocked and consumed results stop background delivery.
 */
export function dispatchKeyEvent(input: DispatchKeyEvent): DispatchResult {
  for (const handler of [input.modal, input.tab, input.widget]) {
    const result = handler?.();
    if (result && result !== "declined") return result;
  }
  if (isPlainNavKey(input.key) && input.command && matchesCommand(input.command, input.key)) {
    if (!input.command.enabled)
      return { kind: "blocked", reason: input.command.disabledReason ?? "Unavailable" };
    input.execute?.(input.command);
    return "consumed";
  }
  for (const handler of [input.route, input.shell, input.lifecycle]) {
    const result = handler?.();
    if (result && result !== "declined") return result;
  }
  return "declined";
}

export function parseNavKey(raw: {
  readonly name: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
  readonly option?: boolean;
  readonly super?: boolean;
  readonly hyper?: boolean;
}): NavKey {
  const lowered = raw.name.toLowerCase();
  const base = {
    char: undefined,
    ctrl: raw.ctrl === true,
    shift: raw.shift === true,
    alt: raw.alt === true,
    meta: raw.meta === true,
    option: raw.option === true,
    super: raw.super === true,
    hyper: raw.hyper === true,
  };
  if (lowered === "arrowleft" || lowered === "left") return { ...base, name: "left" };
  if (lowered === "arrowright" || lowered === "right") return { ...base, name: "right" };
  if (lowered === "arrowup" || lowered === "up") return { ...base, name: "up" };
  if (lowered === "arrowdown" || lowered === "down") return { ...base, name: "down" };
  if (lowered === "tab") return { ...base, name: "tab" };
  if (lowered === "enter" || lowered === "return") return { ...base, name: "enter" };
  if (lowered === "escape" || lowered === "esc") return { ...base, name: "escape" };
  if (lowered === "/") return { ...base, name: "slash" };
  if (lowered === "space") return { ...base, name: "character", char: " " };
  if (lowered === "pageup") return { ...base, name: "page-up" };
  if (lowered === "pagedown") return { ...base, name: "page-down" };
  if (lowered === "home") return { ...base, name: "home" };
  if (lowered === "end") return { ...base, name: "end" };
  if (lowered.length === 1) return { ...base, name: "character", char: lowered };
  return { ...base, name: "other" };
}

export type ExposurePathNavigation = "expand" | "collapse";

/** Resolves only the Collection path capability; callers own the focused path state. */
export const resolveExposurePathKey = (
  key: NavKey,
  expanded: boolean,
): ExposurePathNavigation | null =>
  !isPlainNavKey(key)
    ? null
    : key.name === "right" && !expanded
      ? "expand"
      : key.name === "left" && expanded
        ? "collapse"
        : null;

export interface NavFacts {
  readonly destination: Destination;
  readonly section: Section;
  readonly focus: FocusOwner | undefined;
  readonly tabOrder: readonly FocusOwner[];
  readonly overlay?: Overlay;
  readonly task: boolean;
  readonly narrow: boolean;
  readonly narrowLevel: NarrowLevel;
  readonly canReturn: boolean;
  readonly browserAvailable?: boolean;
  readonly activeInput?: boolean;
  readonly readerActive: boolean;
  readonly readerInline?: boolean;
  readonly readerTab: ReaderState["tab"];
  readonly readerResourceLevel?: "list" | "content";
  readonly collectionFilterOpen: boolean;
  readonly collectionFilterDimension: boolean;
  readonly collectionInspectorOpen?: boolean;
  readonly collectionBrowserOpen?: boolean;
  readonly workspaceShell?: boolean;
  readonly configSourceSurface?: boolean;
  readonly configIntegrationSurface?: boolean;
}

export type NavEffect = "exit" | "cancel-operation" | "close-surface";

export type NavDecision =
  | { readonly kind: "events"; readonly events: readonly NavEvent[] }
  | { readonly kind: "effect"; readonly effect: NavEffect }
  | null;

const QUERY_INPUT_OWNERS: readonly FocusOwner[] = ["skills-query", "collections-query"];

const CTRL_GUARD_OWNERS: readonly FocusOwner[] = [
  "input",
  ...QUERY_INPUT_OWNERS,
  "dialog",
  "palette",
];

export type NavEvent =
  | {
      readonly type: "narrow.show-work-area" | "narrow.show-list";
    }
  | { readonly type: "palette.open" }
  | { readonly type: "reader.patch"; readonly value: Partial<ReaderState> }
  | { readonly type: "focus.request"; readonly focus: FocusOwner }
  | { readonly type: "route.back" }
  | { readonly type: "collections.filter.back" }
  | { readonly type: "collections.filter.close" }
  | { readonly type: "collections.inspector.back" }
  | { readonly type: "workspace.collections.close" }
  | { readonly type: "config.surface.back" }
  | { readonly type: "config.integration.back" };

const events = (...list: readonly NavEvent[]): NavDecision => ({ kind: "events", events: list });

const browserLanding = (facts: NavFacts): NavDecision =>
  events(
    ...(facts.narrow
      ? [
          {
            type: facts.narrowLevel === "detail" ? "narrow.show-work-area" : "narrow.show-list",
          } as const,
        ]
      : []),
    {
      type: "focus.request",
      focus: facts.browserAvailable === false ? "local-nav" : "browser",
    },
  );

const resolveTab = (facts: NavFacts, key: NavKey): NavDecision => {
  const order = facts.tabOrder;
  if (!order.length) return null;
  if (!facts.focus)
    return events({ type: "focus.request", focus: key.shift ? order.at(-1)! : order[0]! });
  const index = order.indexOf(facts.focus);
  if (index < 0) return null;
  const next = (index + (key.shift ? -1 : 1) + order.length) % order.length;
  return events({ type: "focus.request", focus: order[next]! });
};

export const resolveEscape = (facts: NavFacts): NavDecision => {
  if (facts.activeInput)
    return events({
      type: "focus.request",
      focus: facts.readerActive && facts.focus === "input" ? "reader" : "browser",
    });
  if (facts.collectionBrowserOpen)
    return events(
      { type: "workspace.collections.close" },
      { type: "focus.request", focus: "browser" },
    );
  if (facts.collectionFilterOpen)
    return facts.collectionFilterDimension
      ? events(
          { type: "collections.filter.back" },
          { type: "focus.request", focus: "collections-filter-search" },
        )
      : events({ type: "collections.filter.close" }, { type: "focus.request", focus: "browser" });
  if (facts.configIntegrationSurface) return events({ type: "config.integration.back" });
  if (facts.configSourceSurface) return events({ type: "config.surface.back" });
  if (facts.collectionInspectorOpen) return events({ type: "collections.inspector.back" });
  if (
    facts.readerActive &&
    facts.focus !== undefined &&
    readerOwnsFocus(facts.focus) &&
    facts.readerTab === "resources" &&
    facts.readerResourceLevel === "content"
  )
    return events(
      {
        type: "reader.patch",
        value: { resourceLevel: "list", resourceLoading: false, error: undefined },
      },
      { type: "focus.request", focus: "reader-resource-list" },
    );
  // A route frame owns its predecessor even while a filtered browser is underneath it.
  if (facts.readerActive && facts.readerInline && facts.focus && readerOwnsFocus(facts.focus))
    return events({ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" });
  if (facts.focus === "collection-tree-issue") return browserLanding(facts);
  if (facts.canReturn) return events({ type: "route.back" });
  if (!facts.focus) return null;
  if (facts.focus === "browser") return events({ type: "focus.request", focus: "local-nav" });
  if (facts.focus === "top-nav") return null;
  if (facts.focus === "config-source-contributions")
    return events({ type: "focus.request", focus: "browser" });
  if (facts.focus === "collections-query") return browserLanding(facts);
  if (QUERY_INPUT_OWNERS.includes(facts.focus))
    return events({ type: "focus.request", focus: "browser" });
  if (facts.readerActive && readerOwnsFocus(facts.focus)) return null;
  if (facts.workspaceShell && facts.narrow && facts.narrowLevel === "detail")
    return events({ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" });
  if (
    facts.workspaceShell &&
    facts.narrowLevel === "detail" &&
    (facts.focus === "inspector" || facts.focus === "collection-relationships")
  )
    return events({ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" });
  if (facts.focus === "skills-views") return browserLanding(facts);
  if (facts.focus === "agent-preview") return browserLanding(facts);
  if (
    !facts.readerActive &&
    (facts.focus === "inspector" || facts.focus === "collection-relationships")
  )
    return events({ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" });
  if (facts.narrow && facts.narrowLevel === "detail")
    return events({ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" });
  if (facts.narrow && facts.narrowLevel === "work-area")
    return events({ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" });
  if (facts.focus === "local-nav") return events({ type: "focus.request", focus: "top-nav" });
  if (facts.focus === "command:shell.more-actions")
    return events({ type: "focus.request", focus: "top-nav" });
  if (facts.focus.startsWith("command:")) return browserLanding(facts);
  if (facts.focus === "work-area" || facts.focus === "problems" || facts.focus === "scope")
    return browserLanding(facts);
  return null;
};

const resolveSlash = (facts: NavFacts): NavDecision => {
  if (!facts.focus) return null;
  if (
    facts.destination === "workspace" &&
    facts.section === "collections" &&
    facts.focus === "browser"
  )
    return events({ type: "focus.request", focus: "collections-query" });
  if (facts.readerActive && facts.readerTab === "skill") {
    if (facts.focus === "browser") return events({ type: "focus.request", focus: "skills-query" });
    if (facts.focus === "top-nav" || facts.focus === "local-nav" || readerOwnsFocus(facts.focus))
      return events({ type: "focus.request", focus: "input" });
  }
  if (facts.destination === "workspace" && facts.section === "skills" && facts.focus === "browser")
    return events({ type: "focus.request", focus: "skills-query" });
  return null;
};

export function resolve(facts: NavFacts, key: NavKey): NavDecision {
  const plain = isPlainNavKey(key);
  const escape = plain && key.name === "escape";
  const ctrlC = key.ctrl && key.char === "c" && isPlainNavKey({ ...key, ctrl: false });
  if (facts.overlay) {
    if (escape || ctrlC) return { kind: "effect", effect: "close-surface" };
    return null;
  }
  if (facts.task) {
    if (escape || ctrlC) return { kind: "effect", effect: "cancel-operation" };
    return null;
  }
  if (
    !plain &&
    !(key.name === "tab" && key.shift && isPlainNavKey({ ...key, shift: false })) &&
    !ctrlC
  )
    return key.ctrl &&
      key.char === "p" &&
      isPlainNavKey({ ...key, ctrl: false }) &&
      !facts.activeInput &&
      (!facts.focus || !CTRL_GUARD_OWNERS.includes(facts.focus))
      ? events({ type: "palette.open" })
      : null;
  if (facts.activeInput) {
    if (
      key.name === "left" ||
      key.name === "right" ||
      key.name === "up" ||
      key.name === "down" ||
      key.name === "enter" ||
      (key.name === "slash" && facts.activeInput) ||
      (key.name === "character" && !key.ctrl)
    )
      return null;
  }
  if (key.name === "left" || escape) return resolveEscape(facts);
  if (key.name === "right") return null;
  if (key.name === "tab") return resolveTab(facts, key);
  if (key.name === "enter" && facts.focus === "route-back") return events({ type: "route.back" });
  if (key.name === "slash") return resolveSlash(facts);
  if (key.ctrl && facts.focus && CTRL_GUARD_OWNERS.includes(facts.focus)) return null;
  if (key.ctrl && key.char === "p") return events({ type: "palette.open" });
  if (ctrlC) return { kind: "effect", effect: "exit" };
  return null;
}
