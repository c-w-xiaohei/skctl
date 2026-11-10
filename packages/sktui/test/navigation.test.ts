import { expect, test } from "bun:test";
import type { NavFacts } from "../src/navigation";
import { dispatchKeyEvent, parseNavKey, resolve, resolveExposurePathKey } from "../src/navigation";
import type { CommandRecord, DispatchResult } from "../src/types";

const base: NavFacts = {
  destination: "workspace",
  section: "skills",
  focus: "browser",
  tabOrder: ["top-nav", "local-nav", "browser"],
  overlay: undefined,
  task: false,
  narrow: false,
  narrowLevel: "list",
  canReturn: false,
  readerActive: false,
  readerTab: "skill",
  readerResourceLevel: undefined,
  collectionFilterOpen: false,
  collectionFilterDimension: false,
};

const facts = (patch: Partial<NavFacts>): NavFacts => ({ ...base, ...patch });

const command: CommandRecord = {
  id: "route.back",
  keys: ["escape", "enter"],
  verb: "Back",
  destination: "Skills",
  scope: "route",
  enabled: true,
  danger: false,
};

test("dispatcher applies modal, widget, command, route, shell, then lifecycle", () => {
  const calls: string[] = [];
  const handler = (name: string, result: DispatchResult) => () => {
    calls.push(name);
    return result;
  };
  const result = dispatchKeyEvent({
    key: key("enter"),
    lifecycle: handler("lifecycle", "declined"),
    modal: handler("modal", "declined"),
    widget: handler("widget", "declined"),
    command,
    execute: () => calls.push("command"),
    route: handler("route", "declined"),
    shell: handler("shell", "consumed"),
  });
  expect(result).toBe("consumed");
  expect(calls).toEqual(["modal", "widget", "command"]);

  calls.length = 0;
  expect(
    dispatchKeyEvent({
      key: key("enter"),
      modal: handler("modal", "declined"),
      widget: handler("widget", "declined"),
      route: handler("route", "declined"),
      shell: handler("shell", "declined"),
      lifecycle: handler("lifecycle", "consumed"),
    }),
  ).toBe("consumed");
  expect(calls).toEqual(["modal", "widget", "route", "shell", "lifecycle"]);
});

test("dispatcher stops at a modal block and never delivers the key to background route", () => {
  let routeCalled = false;
  expect(
    dispatchKeyEvent({
      key: key("enter"),
      modal: () => ({ kind: "blocked", reason: "Review removal is open" }),
      route: () => {
        routeCalled = true;
        return "consumed";
      },
    }),
  ).toEqual({ kind: "blocked", reason: "Review removal is open" });
  expect(routeCalled).toBe(false);
});

test("dispatcher blocks a disabled visible command with its declared reason", () => {
  const disabled = { ...command, enabled: false, disabledReason: "Contributed config" };
  expect(dispatchKeyEvent({ key: key("enter"), command: disabled })).toEqual({
    kind: "blocked",
    reason: "Contributed config",
  });
});

test("dispatcher declines ordinary list navigation and does not invent generic Enter", () => {
  expect(dispatchKeyEvent({ key: key("left") })).toBe("declined");
  expect(dispatchKeyEvent({ key: key("enter") })).toBe("declined");
});

test("dispatcher leaves Backspace and Alt+Left unbound outside a widget", () => {
  expect(dispatchKeyEvent({ key: key("backspace") })).toBe("declined");
  expect(dispatchKeyEvent({ key: parseNavKey({ name: "ArrowLeft", alt: true }) })).toBe("declined");
});

test("Tab traverses only the declared mounted zones and reverses at each boundary", () => {
  const shell = {
    workspaceShell: true,
    tabOrder: ["top-nav", "agent-views", "work-area"] as const,
  };
  expect(resolve(facts({ ...shell, focus: "top-nav" }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "agent-views" }],
  });
  expect(resolve(facts({ ...shell, focus: "agent-views" }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "work-area" }],
  });
  expect(resolve(facts({ ...shell, focus: "work-area" }), key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
  expect(resolve(facts({ ...shell, focus: "top-nav" }), key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "work-area" }],
  });
  expect(resolve(facts({ ...shell, focus: "work-area" }), key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "agent-views" }],
  });
  expect(resolve(facts({ ...shell, focus: "agent-views" }), key("tab", { shift: true }))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
});

test("Workspace Reader Tab enters Reader controls from either physical browser owner", () => {
  const shellReader = { workspaceShell: true, readerActive: true };
  for (const focus of ["browser", "work-area"] as const) {
    expect(
      resolve(facts({ ...shellReader, focus, tabOrder: [focus, "reader-tabs"] }), key("tab")),
    ).toEqual({
      kind: "events",
      events: [{ type: "focus.request", focus: "reader-tabs" }],
    });
  }
  expect(
    resolve(
      facts({ ...shellReader, focus: "reader-tabs", tabOrder: ["browser", "reader-tabs"] }),
      key("tab", { shift: true }),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
});

test("Workspace resolver leaves native top navigation Left/Right to SectionTabs", () => {
  expect(resolve(facts({ workspaceShell: true, focus: "scope" }), key("right"))).toBeNull();
  expect(resolve(facts({ workspaceShell: true, focus: "top-nav" }), key("right"))).toBeNull();
});

test("Collection exposure Left/Right exposes only the focused path expansion capability", () => {
  expect(resolveExposurePathKey(key("right"), false)).toBe("expand");
  expect(resolveExposurePathKey(key("right"), true)).toBeNull();
  expect(resolveExposurePathKey(key("left"), true)).toBe("collapse");
  expect(resolveExposurePathKey(key("left"), false)).toBeNull();
  expect(resolveExposurePathKey(key("up"), false)).toBeNull();
});

test("Config Source inspector Back wins over a return route from the browser", () => {
  expect(
    resolve(
      facts({
        destination: "project",
        focus: "browser",
        canReturn: true,
        configSourceSurface: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "config.surface.back" }],
  });
});

test("host integrations return through their originating route", () => {
  expect(
    resolve(
      facts({
        destination: "project",
        focus: "browser",
        canReturn: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
});

const key = (name: string, opts: { ctrl?: boolean; shift?: boolean } = {}) =>
  parseNavKey({ name, ...opts });

test("parseNavKey normalizes raw key facts", () => {
  expect(parseNavKey({ name: "ArrowLeft" })).toEqual({
    name: "left",
    char: undefined,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    option: false,
    super: false,
    hyper: false,
  });
  expect(parseNavKey({ name: "return" }).name).toBe("enter");
  expect(parseNavKey({ name: "esc" }).name).toBe("escape");
  expect(parseNavKey({ name: "/" }).name).toBe("slash");
  expect(parseNavKey({ name: "p", ctrl: true })).toEqual({
    name: "character",
    char: "p",
    ctrl: true,
    shift: false,
    alt: false,
    meta: false,
    option: false,
    super: false,
    hyper: false,
  });
  expect(parseNavKey({ name: "ArrowLeft", alt: true }).alt).toBe(true);
  expect(parseNavKey({ name: "home" }).name).toBe("home");
});

test("a page command cannot infer a Context switch from arrows", () => {
  const decision = resolve(
    facts({ destination: "workspace", focus: "command:add-source" }),
    key("right"),
  );
  expect(decision).toBeNull();
});

test("browser list owns arrows and Enter natively; policy returns no decision", () => {
  for (const name of ["right", "up", "down", "enter", "pageup", "pagedown"]) {
    expect(resolve(facts({ focus: "browser" }), key(name))).toBeNull();
  }
});

test("browser Left and Escape return the same route frame when a predecessor exists", () => {
  expect(resolve(facts({ focus: "browser", canReturn: true }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
  expect(resolve(facts({ focus: "browser", canReturn: true }), key("left"))).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
  expect(resolve(facts({ focus: "browser" }), key("left"))).toEqual(
    resolve(facts({ focus: "browser" }), key("escape")),
  );
});

test("focused native input owns Left/Right, printable keys, slash, and Enter", () => {
  const input = facts({ focus: "skills-query", activeInput: true });
  for (const name of ["left", "right", "up", "down", "enter", "/", "a"]) {
    expect(resolve(input, key(name))).toBeNull();
  }
});

test("focused input Tab still traverses regions on ordinary pages", () => {
  const decision = resolve(
    facts({
      focus: "skills-query",
      activeInput: true,
      readerActive: true,
      tabOrder: ["skills-query", "reader-tabs"],
    }),
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
  expect(
    resolve(
      facts({
        focus: "browser",
        readerActive: true,
        tabOrder: ["top-nav", "browser", "reader-tabs", "reader", "input"],
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
  expect(
    resolve(
      facts({
        focus: "reader",
        readerActive: true,
        tabOrder: ["top-nav", "browser", "reader-tabs", "reader", "input"],
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "input" }],
  });
  expect(
    resolve(
      facts({
        focus: "top-nav",
        readerActive: true,
        tabOrder: ["top-nav", "browser", "reader-tabs", "reader", "input"],
      }),
      key("tab", { shift: true }),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "input" }],
  });
});

test("Reader Skill controls traverse their typed order and return to surrounding regions at boundaries", () => {
  const controls = [
    "reader",
    "reader-tabs",
    "command:reader.more",
    "command:reader.add-to-collection",
  ] as const;
  for (let index = 0; index < controls.length; index++) {
    const current = facts({
      readerActive: true,
      readerTab: "skill",
      focus: controls[index],
      tabOrder: ["top-nav", "browser", ...controls],
    });
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

test("Reader menu command traversal returns through the frame on Escape", () => {
  const raw = facts({
    focus: "command:reader.more",
    readerActive: true,
    readerTab: "skill",
    canReturn: true,
    tabOrder: ["command:reader.more", "reader-tabs"],
  });
  expect(resolve(raw, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
  expect(resolve(raw, key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
});

test("Tab reaches Skills and Collections filter triggers before moving to another region", () => {
  expect(
    resolve(
      facts({
        focus: "skills-query",
        activeInput: true,
        readerActive: false,
        tabOrder: ["skills-query", "skills-filter-open"],
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
        activeInput: true,
        tabOrder: ["collections-query", "collections-filter-open"],
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
        tabOrder: ["top-nav", "collections-filter-open"],
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
});

test("Tab reaches Problems query and filter controls before returning to the top navigation", () => {
  const problemFacts = facts({
    section: "skills",
    focus: "skills-query",
    activeInput: true,
    tabOrder: ["skills-query", "skills-filter-open"],
  });
  expect(resolve(problemFacts, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "skills-filter-open" }],
  });
});

test("Reader-active Skills navigation omits list filters", () => {
  expect(
    resolve(
      facts({ focus: "browser", readerActive: true, tabOrder: ["browser", "reader-tabs"] }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader-tabs" }],
  });
  expect(
    resolve(
      facts({
        focus: "skills-query",
        readerActive: true,
        tabOrder: ["skills-query", "skills-filter-open"],
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "skills-filter-open" }],
  });
});

test("narrow Reader Escape returns through its frame", () => {
  expect(
    resolve(
      facts({
        focus: "reader",
        readerActive: true,
        narrow: true,
        narrowLevel: "detail",
        canReturn: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
  expect(
    resolve(
      facts({ focus: "inspector", readerActive: false, narrow: true, narrowLevel: "detail" }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" }],
  });
});

test("reader-tabs enter active content before Skills filter navigation", () => {
  for (const [tab, focus] of [
    ["skill", "reader"],
    ["resources", "reader-resource-list"],
  ] as const) {
    const active = facts({
      focus: "reader-tabs",
      readerActive: true,
      readerTab: tab,
      tabOrder: ["browser", "reader-tabs", focus],
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

test("Reader Tab enters content while Enter on a tab remains unbound", () => {
  const skill = facts({
    focus: "reader-tabs",
    readerActive: true,
    readerTab: "skill",
    tabOrder: ["browser", "reader-tabs", "reader"],
  });
  expect(resolve(skill, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "reader" }],
  });
  expect(resolve(skill, key("enter"))).toBeNull();
  const resources = facts({ focus: "reader-tabs", readerActive: true, readerTab: "resources" });
  expect(resolve(resources, key("enter"))).toBeNull();
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
    tabOrder: ["top-nav", "reader-tabs", "reader-resource-retry"],
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
        tabOrder: ["browser", "reader-resource-content"],
      }),
      key("tab", { shift: true }),
    ),
  ).toEqual({ kind: "events", events: [{ type: "focus.request", focus: "browser" }] });
});

test("reader content scrolling keys are not consumed by navigation", () => {
  const reader = facts({ focus: "reader", readerActive: true });
  for (const name of ["up", "down", "pageup", "pagedown", "home"]) {
    expect(resolve(reader, key(name))).toBeNull();
  }
});

test("Details content reaches its first exact command owner before metadata", () => {
  expect(
    resolve(
      facts({
        focus: "reader",
        readerActive: true,
        readerTab: "skill",
        tabOrder: ["reader", "command:skill-add-to-collection", "details-metadata"],
      }),
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "command:skill-add-to-collection" }],
  });
});

test("Details traversal uses exact commands, skips absent relationships, and reverses", () => {
  const withRelationships = facts({
    focus: "command:skill-add-to-collection",
    readerActive: true,
    readerTab: "skill",
    tabOrder: [
      "reader",
      "command:skill-add-to-collection",
      "command:reader.relationship.source",
      "details-metadata",
    ],
  });
  expect(resolve(withRelationships, key("tab"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "command:reader.relationship.source" }],
  });
  expect(
    resolve({ ...withRelationships, focus: "command:reader.relationship.source" }, key("tab")),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "details-metadata" }],
  });
  expect(
    resolve(
      { ...withRelationships, focus: "command:reader.relationship.source" },
      key("tab", { shift: true }),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "command:skill-add-to-collection" }],
  });
  expect(
    resolve(
      {
        ...withRelationships,
        focus: "reader",
        tabOrder: ["reader", "command:skill-add-to-collection", "details-metadata"],
      },
      key("tab"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "command:skill-add-to-collection" }],
  });
  expect(
    resolve(
      {
        ...withRelationships,
        focus: "details-metadata",
      },
      key("tab", { shift: true }),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "command:reader.relationship.source" }],
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
  expect(resolve(facts({ canReturn: true }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
  expect(resolve(facts({ canReturn: true, focus: "inspector" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
});

test("root Escape returns to pages and never quits", () => {
  expect(resolve(facts({ focus: "browser", canReturn: false }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
  expect(resolve(facts({ focus: "top-nav", canReturn: false }), key("escape"))).toBeNull();
});

test("narrow Workspace work area Escape returns to Scope before browser root handling", () => {
  expect(
    resolve(
      facts({
        workspaceShell: true,
        narrow: true,
        narrowLevel: "work-area",
        focus: "browser",
      }),
      key("escape"),
    ),
  ).toEqual({ kind: "events", events: [{ type: "focus.request", focus: "local-nav" }] });
  expect(resolve(facts({ focus: "browser", narrow: false }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
});

test("narrow Workspace browser Escape returns one route frame before collapsing to Scope", () => {
  expect(
    resolve(
      facts({
        workspaceShell: true,
        narrow: true,
        narrowLevel: "work-area",
        focus: "browser",
        canReturn: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
});

test("Escape ladder: query inputs return to the browser, collapsing narrow Collections detail to Work Area", () => {
  expect(resolve(facts({ focus: "skills-query", activeInput: true }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
  });
  expect(
    resolve(
      facts({
        section: "collections",
        focus: "collections-query",
        activeInput: true,
        narrow: true,
        narrowLevel: "detail",
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "browser" }],
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
        value: { resourceLevel: "list", resourceLoading: false, error: undefined },
      },
      { type: "focus.request", focus: "reader-resource-list" },
    ],
  });
});

test("Escape ladder: Reader and Inspector return through their frames", () => {
  expect(
    resolve(
      facts({
        focus: "reader",
        readerActive: true,
        narrow: true,
        narrowLevel: "detail",
        canReturn: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
  expect(
    resolve(facts({ focus: "reader-tabs", readerActive: true, canReturn: true }), key("escape")),
  ).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
  expect(
    resolve(
      facts({
        focus: "inspector",
        readerActive: false,
        narrow: true,
        narrowLevel: "detail",
        canReturn: true,
      }),
      key("escape"),
    ),
  ).toEqual({
    kind: "events",
    events: [{ type: "route.back" }],
  });
});

test("Escape from a narrow Source Work Area returns to the browser", () => {
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
    events: [{ type: "narrow.show-work-area" }, { type: "focus.request", focus: "browser" }],
  });
});

test("Escape only relinquishes an active Section input; root regions remain unchanged", () => {
  expect(resolve(facts({ focus: "local-nav" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "top-nav" }],
  });
  expect(resolve(facts({ focus: "top-nav" }), key("escape"))).toBeNull();
  expect(resolve(facts({ focus: "browser" }), key("escape"))).toEqual({
    kind: "events",
    events: [{ type: "focus.request", focus: "local-nav" }],
  });
});

test("Enter is unbound for immediate Context and Section peer tabs", () => {
  expect(resolve(facts({ destination: "project", focus: "top-nav" }), key("enter"))).toBeNull();
  expect(resolve(facts({ focus: "local-nav" }), key("enter"))).toBeNull();
  expect(
    resolve(
      facts({ destination: "workspace", section: "collections", focus: "inspector" }),
      key("enter"),
    ),
  ).toBeNull();
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
  expect(resolve(facts({ focus: "skills-query", activeInput: true }), key("/"))).toBeNull();
  expect(
    resolve(facts({ focus: "input", readerActive: true, activeInput: true }), key("/")),
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

test("navigation treats every Core 0.5 modifier as non-plain", () => {
  for (const modifier of ["ctrl", "shift", "alt", "meta", "option", "super", "hyper"] as const) {
    const key = parseNavKey({ name: "ArrowLeft", [modifier]: true });
    expect(resolve(facts({ focus: "browser", canReturn: true }), key)).toBeNull();
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
        activeInput: true,
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
