import { expect, test } from "bun:test";
import type { NavFacts } from "../../src/tui/navigation";
import { parseNavKey, resolve } from "../../src/tui/navigation";

const base: NavFacts = {
  destination: "workspace",
  section: "skills",
  focus: "browser",
  overlay: undefined,
  task: false,
  narrow: false,
  narrowLevel: "list",
  sourceFilter: false,
  canReturn: false,
  emptyWorkspaceAction: false,
  nativeInput: false,
  tabsPart: false,
  readerActive: false,
  readerTab: "skill",
  readerRetry: false,
  readerResourceLevel: undefined,
  collectionFilterOpen: false,
  collectionFilterDimension: false,
};

const facts = (patch: Partial<NavFacts>): NavFacts => ({ ...base, ...patch });

const key = (name: string, opts: { ctrl?: boolean; shift?: boolean } = {}) =>
  parseNavKey({ name, ...opts });

test("parseNavKey normalizes raw key facts", () => {
  expect(parseNavKey({ name: "ArrowLeft" })).toEqual({
    name: "left",
    char: undefined,
    ctrl: false,
    shift: false,
  });
  expect(parseNavKey({ name: "return" }).name).toBe("enter");
  expect(parseNavKey({ name: "esc" }).name).toBe("escape");
  expect(parseNavKey({ name: "/" }).name).toBe("slash");
  expect(parseNavKey({ name: "p", ctrl: true })).toEqual({
    name: "character",
    char: "p",
    ctrl: true,
    shift: false,
  });
  expect(parseNavKey({ name: "home" }).name).toBe("home");
});

test("focused TUIparts tabs own Left/Right/Home/End", () => {
  const tabs = facts({ focus: "top-nav", tabsPart: true });
  for (const name of ["left", "right", "home", "end"]) expect(resolve(tabs, key(name))).toBeNull();
});

test("empty-workspace action Left/Right keeps destination traversal behavior lock", () => {
  const decision = resolve(
    facts({ destination: "workspace", focus: "browser", emptyWorkspaceAction: true }),
    key("right"),
  );
  expect(decision).toEqual({
    kind: "events",
    events: [
      { type: "destination.select", destination: "global" },
      { type: "focus.request", focus: "top-nav" },
    ],
  });
});

test("browser list owns arrows and Enter natively; policy returns no decision", () => {
  for (const name of ["left", "right", "up", "down", "enter", "pageup", "pagedown"]) {
    expect(resolve(facts({ focus: "browser" }), key(name))).toBeNull();
  }
});

test("focused native input owns Left/Right, printable keys, slash, and Enter", () => {
  const input = facts({ focus: "skills-query", nativeInput: true });
  for (const name of ["left", "right", "up", "down", "enter", "/", "a"]) {
    expect(resolve(input, key(name))).toBeNull();
  }
});

test("focused input Tab still traverses regions on ordinary pages", () => {
  const decision = resolve(
    facts({ focus: "skills-query", nativeInput: true, readerActive: true }),
    key("tab"),
  );
  expect(decision).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
});

test("Tab traverses focus regions forward and Shift+Tab backward, never destinations", () => {
  expect(resolve(facts({ focus: "top-nav" }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
  expect(resolve(facts({ focus: "local-nav" }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
  expect(resolve(facts({ focus: "browser" }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
  expect(resolve(facts({ focus: "browser" }), key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
  expect(resolve(facts({ focus: "top-nav" }), key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
});

test("Tab includes the reader surface region only when the reader is active", () => {
  expect(resolve(facts({ focus: "browser", readerActive: true }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
  expect(resolve(facts({ focus: "reader", readerActive: true }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "input" }],
  });
  expect(
    resolve(facts({ focus: "top-nav", readerActive: true }), key("tab", { shift: true })),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
});

test("Reader Skill controls traverse their typed order and return to surrounding regions at boundaries", () => {
  const controls = [
    "reader",
    "input",
    "reader-raw",
    "reader-find-previous",
    "reader-find-next",
    "open-match-raw",
  ] as const;
  for (let index = 0; index < controls.length; index++) {
    const current = facts({ readerActive: true, readerTab: "skill", focus: controls[index] });
    expect(resolve(current, key("tab"))).toEqual({
      kind: "events",
      events: [
        {
          type: "focus.request",
          focus: index === controls.length - 1 ? "top-nav" : controls[index + 1],
        },
      ],
    });
    expect(resolve(current, key("tab", { shift: true }))).toEqual({
      kind: "events",
      events: [
        {
          type: "focus.request",
          focus: index === 0 ? "browser" : controls[index - 1],
        },
      ],
    });
  }
});

test("Raw match handoff keeps the Raw owner and Escape returns through the Reader browser boundary", () => {
  const raw = facts({ focus: "reader-raw", readerActive: true, readerTab: "skill" });
  expect(resolve(raw, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-find-previous" }],
  });
  expect(resolve(raw, key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
});

test("Tab reaches Skills and Collections filter triggers before moving to another region", () => {
  expect(
    resolve(
      facts({
        focus: "skills-query",
        nativeInput: true,
        readerActive: false,
        skillsFilterAvailable: true,
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "skills-filter-open" }],
  });
  expect(
    resolve(
      facts({
        section: "collections",
        focus: "collections-query",
        nativeInput: true,
        collectionsFilterAvailable: true,
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "collections-filter-open" }],
  });
  expect(
    resolve(
      facts({
        section: "collections",
        focus: "collections-filter-open",
        narrow: true,
        narrowLevel: "list",
        collectionsFilterAvailable: true,
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
});

test("Reader-active Skills navigation omits list filters", () => {
  expect(
    resolve(
      facts({ focus: "browser", readerActive: true, skillsFilterAvailable: true }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
  expect(
    resolve(
      facts({ focus: "skills-query", readerActive: true, skillsFilterAvailable: true }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "skills-filter-open" }],
  });
});

test("narrow Reader Escape returns to the Skills browser landing", () => {
  expect(
    resolve(
      facts({
        focus: "reader",
        readerActive: true,
        narrow: true,
        narrowLevel: "detail",
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" }],
  });
});

test("reader-tabs Left/Right switches Reader tab with wrap", () => {
  const active = facts({ focus: "reader-tabs", readerActive: true, readerTab: "skill" });
  expect(resolve(active, key("right"))).toEqual({
    kind: "events",
    events: [{ type: "reader.patch", value: { tab: "resources" } }],
  });
  expect(resolve(active, key("left"))).toEqual({
    kind: "events",
    events: [{ type: "reader.patch", value: { tab: "details" } }],
  });
  expect(
    resolve(
      facts({ focus: "reader-tabs", readerActive: true, readerTab: "details" }),
      key("right"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "reader.patch", value: { tab: "skill" } }],
  });
});

test("reader-tabs enter active content before Skills filter navigation", () => {
  for (const [tab, focus] of [
    ["skill", "reader"],
    ["resources", "reader-resource-list"],
    ["details", "reader"],
  ] as const) {
    const active = facts({
      focus: "reader-tabs",
      readerActive: true,
      readerTab: tab,
      skillsFilterAvailable: true,
    });
    expect(resolve(active, key("tab"))).toEqual({
      kind: "events",
      events: [{ type: "focus.request", focus }],
    });
    expect(resolve(active, key("tab", { shift: true }))).toEqual({
      kind: "events",
      events: [{ type: "focus.request", focus: "browser" }],
    });
  }
});

test("reader-tabs Tab and Enter enter the reader content surface for the tab", () => {
  const skill = facts({ focus: "reader-tabs", readerActive: true, readerTab: "skill" });
  expect(resolve(skill, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader" }],
  });
  expect(resolve(skill, key("enter"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader" }],
  });
  const resources = facts({ focus: "reader-tabs", readerActive: true, readerTab: "resources" });
  expect(resolve(resources, key("enter"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-resource-list" }],
  });
  expect(resolve(skill, key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
});

test("resource Retry returns to Reader tabs backward and advances to the next region forward", () => {
  const retry = facts({
    focus: "reader-resource-retry",
    readerActive: true,
    readerTab: "resources",
    readerRetry: true,
  });
  expect(resolve(retry, key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
  expect(resolve(retry, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
});

test("resource content ShiftTab returns directly to the Installed Skill browser", () => {
  expect(
    resolve(
      facts({
        focus: "reader-resource-content",
        readerActive: true,
        readerTab: "resources",
        readerResourceLevel: "content",
      }),
      key("tab", { shift: true }),
    ),
  ).toEqual({ kind: "events", events: [{ type: "focus.request", focus: "browser" }] });
});

test("reader content keys are not consumed by navigation", () => {
  const reader = facts({ focus: "reader", readerActive: true });
  for (const name of ["up", "down", "pageup", "pagedown", "home", "left", "right"]) {
    expect(resolve(reader, key(name))).toBeNull();
  }
});

test("Details content reaches its registered Actions owner before leaving the Reader", () => {
  expect(
    resolve(facts({ focus: "reader", readerActive: true, readerTab: "details" }), key("tab")),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "inspector" }],
  });
});

test("overlay surface takes precedence: Escape and Ctrl+C close the surface only", () => {
  const overlay = facts({ overlay: "confirm", focus: "dialog" });
  expect(resolve(overlay, key("escape"))).toEqual({ kind: "effect", effect: "close-surface" });
  expect(resolve(overlay, key("c", { ctrl: true }))).toEqual({
    kind: "effect",
    effect: "close-surface",
  });
  for (const name of ["left", "right", "up", "down", "tab", "enter"]) {
    expect(resolve(overlay, key(name))).toBeNull();
  }
});

test("task surface Escape and Ctrl+C cancel the operation before any exit", () => {
  const task = facts({ task: true, focus: "task" });
  expect(resolve(task, key("escape"))).toEqual({ kind: "effect", effect: "cancel-operation" });
  expect(resolve(task, key("c", { ctrl: true }))).toEqual({
    kind: "effect",
    effect: "cancel-operation",
  });
  expect(resolve(task, key("left"))).toBeNull();
});

test("overlay outranks task in the precedence ladder", () => {
  expect(resolve(facts({ overlay: "form", task: true }), key("escape"))).toEqual({
    kind: "effect",
    effect: "close-surface",
  });
});

test("Escape ladder: either route return frame routes back before any surface close", () => {
  expect(resolve(facts({ canReturn: true, sourceFilter: true }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
});

test("Escape ladder: query inputs return to the browser, collapsing narrow Collections detail", () => {
  expect(resolve(facts({ focus: "skills-query", nativeInput: true }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
  expect(
    resolve(
      facts({
        section: "collections",
        focus: "collections-query",
        nativeInput: true,
        narrow: true,
        narrowLevel: "detail",
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" }],
  });
});

test("Escape ladder: collection filter steps dimension back, then closes", () => {
  expect(
    resolve(
      facts({
        destination: "workspace",
        section: "collections",
        focus: "collections-filter-values",
        collectionFilterOpen: true,
        collectionFilterDimension: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [
      { type: "collections.filter.back" },
      { type: "focus.request", focus: "collections-filter-search" },
    ],
  });
  expect(
    resolve(
      facts({
        destination: "workspace",
        section: "collections",
        focus: "collections-filter-search",
        collectionFilterOpen: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "collections.filter.close" }, { type: "focus.request", focus: "browser" }],
  });
});

test("Escape ladder: reader resource content collapses to the resource list", () => {
  expect(
    resolve(
      facts({
        focus: "reader-resource-content",
        readerActive: true,
        readerTab: "resources",
        readerResourceLevel: "content",
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [
      {
        type: "reader.patch",
        value: { resourceLevel: "list", resource: undefined, loading: false, error: undefined },
      },
      { type: "focus.request", focus: "reader-resource-list" },
    ],
  });
});

test("Escape ladder: reader surfaces return to the browser and reset narrow level", () => {
  expect(
    resolve(
      facts({ focus: "reader", readerActive: true, narrow: true, narrowLevel: "detail" }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" }],
  });
  expect(resolve(facts({ focus: "reader-tabs", readerActive: true }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
});

test("Escape ladder: source filter and narrow detail reduce to their browser landing", () => {
  expect(resolve(facts({ sourceFilter: true }), key("escape"))).toEqual({
    kind: "events",
    events: [
      { type: "workspace.source-filter.clear" },
      { type: "focus.request", focus: "browser" },
    ],
  });
  expect(resolve(facts({ narrow: true, narrowLevel: "detail" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" }],
  });
  expect(
    resolve(
      facts({
        section: "sources",
        focus: "local-nav",
        narrow: true,
        narrowLevel: "detail",
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "narrow.show-list" }, { type: "focus.request", focus: "browser" }],
  });
});

test("Escape ladder: section returns to top-nav, top-nav returns to browser, browser steps up a region", () => {
  expect(resolve(facts({ focus: "local-nav" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
  expect(resolve(facts({ focus: "top-nav" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
  expect(resolve(facts({ focus: "browser" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
});

test("Enter on selectors confirms destination or enters content", () => {
  expect(resolve(facts({ destination: "project", focus: "top-nav" }), key("enter"))).toEqual({
    kind: "events",
    events: [{ type: "destination.select", destination: "project" }],
  });
  expect(resolve(facts({ focus: "local-nav" }), key("enter"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
  expect(
    resolve(
      facts({ destination: "workspace", section: "collections", focus: "inspector" }),
      key("enter"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "collection-relationships" }],
  });
});

test("slash focuses the local filter or Reader find only from allowed non-native surfaces", () => {
  expect(resolve(facts({ focus: "browser", readerActive: true }), key("/"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "skills-query" }],
  });
  expect(resolve(facts({ focus: "reader", readerActive: true }), key("/"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "input" }],
  });
  for (const focus of ["top-nav", "local-nav"] as const) {
    expect(resolve(facts({ focus, readerActive: true }), key("/"))).toEqual({
      kind: "events",
      events: [{ type: "focus.request", focus: "input" }],
    });
  }
  expect(resolve(facts({ destination: "workspace", section: "collections" }), key("/"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "collections-query" }],
  });
  expect(resolve(facts({ focus: "skills-query", nativeInput: true }), key("/"))).toBeNull();
  expect(
    resolve(facts({ focus: "top-nav", readerActive: true, nativeInput: true }), key("/")),
  ).toBeNull();
  expect(
    resolve(facts({ focus: "top-nav", readerActive: true, overlay: "palette" }), key("/")),
  ).toBeNull();
  expect(resolve(facts({ focus: "top-nav", readerActive: true, task: true }), key("/"))).toBeNull();
  expect(resolve(facts({ focus: "top-nav" }), key("/"))).toBeNull();
  expect(resolve(facts({ focus: "browser" }), key("/"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "skills-query" }],
  });
});

test("Ctrl+P opens the palette and Ctrl+C exits, except from input/dialog/palette focus", () => {
  expect(resolve(facts({ focus: "browser" }), key("p", { ctrl: true }))).toEqual({
    kind: "events",
    events: [{ type: "palette.open" }],
  });
  expect(resolve(facts({ focus: "browser" }), key("c", { ctrl: true }))).toEqual({
    kind: "effect",
    effect: "exit",
  });
  for (const focus of ["input", "dialog", "palette"] as const) {
    expect(resolve(facts({ focus }), key("p", { ctrl: true }))).toBeNull();
    expect(resolve(facts({ focus }), key("c", { ctrl: true }))).toBeNull();
  }
});

test("collection filter open owns Tab field traversal; policy stays out", () => {
  expect(
    resolve(
      facts({
        destination: "workspace",
        section: "collections",
        focus: "collections-filter-search",
        collectionFilterOpen: true,
        nativeInput: true,
      }),
      key("tab"),
    ),
  ).toBeNull();
});

test("unhandled keys produce no decision", () => {
  expect(resolve(facts({ focus: "browser" }), key("a"))).toBeNull();
  expect(resolve(facts({ focus: "top-nav" }), key("up"))).toBeNull();
  expect(resolve(facts({ focus: "browser" }), key("x", { ctrl: true }))).toBeNull();
});
