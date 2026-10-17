import { expect, test } from "bun:test";
import { createConfigState } from "../src/config/state";
import { createRoute } from "../src/route";
import type { RouteHandoff } from "../src/types";
import { createUpdatesState } from "../src/updates/state";
import { createWorkspaceState } from "../src/workspace/state";

const updateScope = {
  entry: { kind: "collection" as const, collection: "team" },
  addresses: [
    { source: "team-main", path: "guide" },
    { source: "team-main", path: "reference" },
  ],
  sources: ["team-main"],
  includesReferences: false,
  observed: [],
};

test("ROUTE-REENTRY identical semantic push is a no-op that preserves its predecessor", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const focus: string[] = [];
  let dismissed = 0;
  const route = createRoute(
    { workspace, config },
    (owner) => focus.push(owner),
    () => {
      dismissed += 1;
    },
  );
  const target = {
    destination: "project" as const,
    section: "sources" as const,
    selection: "origin",
    surface: "inspector" as const,
    focus: "inspector" as const,
  };

  route.push(target);
  const entered = route.snapshot();
  workspace.setQuery("not-route-identity");
  workspace.setScroll("skills:all-installed-skills", 4);
  route.push({ ...target, region: "section", focus: "local-nav" });

  expect(route.snapshot()).toBe(entered);
  expect(route.snapshot().stack).toHaveLength(1);
  expect(route.snapshot().stack[0]).toMatchObject({
    context: "workspace",
    section: "skills",
  });
  expect(focus).toEqual(["inspector"]);
  expect(dismissed).toBe(1);
});

test("ROUTE-REENTRY same object with a different surface or handoff remains a new route", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const address = { source: "team-main", path: "guide" };

  route.activate({
    destination: "workspace",
    section: "skills",
    selection: address,
    surface: "browser",
    focus: "browser",
  });
  const browser = route.snapshot();
  route.activate({
    destination: "workspace",
    section: "skills",
    selection: { ...address },
    surface: "reader",
    focus: "reader",
  });

  expect(route.snapshot()).not.toBe(browser);
  expect(route.snapshot().current).toMatchObject({ surface: "reader", focus: "reader" });
  expect(route.snapshot().stack).toHaveLength(2);

  const reader = route.snapshot();
  route.activate({
    destination: "workspace",
    section: "skills",
    selection: { ...address },
    surface: "reader",
    focus: "reader",
    handoff: { kind: "agent-producer", address },
  });

  expect(route.snapshot()).not.toBe(reader);
  expect(route.snapshot().current.handoff).toEqual({ kind: "agent-producer", address });
  expect(route.snapshot().stack).toHaveLength(3);
});

test("ROUTE-REENTRY identical ordinary transition skips its landing", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const target = {
    destination: "project" as const,
    section: "sources" as const,
    selection: "origin",
  };
  route.transition(target, () => config.land("project", "sources", "origin"));
  const entered = route.snapshot();
  let landed = false;
  route.transition({ ...target, focus: "local-nav" }, () => {
    landed = true;
  });

  expect(route.snapshot()).toBe(entered);
  expect(landed).toBe(false);
});

test("ROUTE-REENTRY Updates Source is distinct despite ordinary target equality and Back restores its bounded draft", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const updates = createUpdatesState(updateScope);
  const restored: unknown[] = [];
  const route = createRoute(
    { workspace, config },
    () => {},
    () => {},
    () => undefined,
    () => {},
    undefined,
    undefined,
    () => updates,
    (state) => restored.push(state),
  );

  route.transition(
    { destination: "workspace", section: "updates", surface: "browser", focus: "browser" },
    () => workspace.land("updates"),
  );
  updates.setQuery("changed");
  updates.setFocusedRowKey("group:team-main");
  updates.setSourcePosition("team-main", { currentKey: "team-main\u0000reference", scrollTop: 9 });

  // This is the same ordinary RouteTarget as its Updates parent. The actual
  // production landing establishes the bounded Source sublocation.
  route.transition(
    { destination: "workspace", section: "updates", surface: "browser", focus: "browser" },
    () => workspace.showSourceUpdates("team-main"),
  );
  expect(route.snapshot().stack).toHaveLength(2);
  expect(workspace.sourceUpdatesView()).toEqual({
    source: "team-main",
    query: "",
    filter: "updates",
  });

  route.transition({ destination: "project", section: "sources", selection: "origin" }, () =>
    config.land("project", "sources", "origin"),
  );
  workspace.clearSourceUpdatesView();
  updates.setQuery("mutated-away");
  route.back();

  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "updates",
    surface: "browser",
  });
  expect(workspace.sourceUpdatesView()).toEqual({
    source: "team-main",
    query: "",
    filter: "updates",
  });
  expect(restored).toEqual([updates]);
  expect(updates.query()).toBe("mutated-away");
  expect(updates.sourcePosition("team-main")).toEqual({
    currentKey: "team-main\u0000reference",
    scrollTop: 9,
  });
});

test("ROUTE-REENTRY a preselected Source does not replace the predecessor Source identity", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const target = (source: string) => ({
    destination: "workspace" as const,
    section: "updates" as const,
    sublocation: { kind: "updates" as const, entry: updateScope.entry, source },
  });
  route.transition(target("alpha"), () => workspace.showSourceUpdates("alpha"));
  workspace.setSourceUpdatesQuery("alpha-latest");
  workspace.setSourceUpdatesFilter("all");
  // A caller may establish the destination before the route captures its predecessor.
  workspace.showSourceUpdates("beta");
  workspace.setSourceUpdatesQuery("beta-latest");
  route.push(target("beta"));
  route.back();
  expect(route.snapshot().current.sublocation).toMatchObject({ kind: "updates", source: "alpha" });
  expect(workspace.sourceUpdatesView()).toEqual({
    source: "alpha",
    query: "alpha-latest",
    filter: "all",
  });
  workspace.showSourceUpdates("beta");
  expect(workspace.sourceUpdatesView()?.query).toBe("beta-latest");
});

test("ROUTE-REENTRY Problems diagnostic keys are distinct despite identical ordinary targets", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const target = {
    destination: "workspace" as const,
    section: "skills" as const,
    surface: "inspector" as const,
    focus: "browser" as const,
  };

  workspace.selectProblem("problem:first");
  workspace.openDiagnosticDetail("problem:first");
  route.push(target);
  workspace.selectProblem("problem:second");
  workspace.openDiagnosticDetail("problem:second");
  workspace.setQuery("live-query");
  workspace.setScroll("skills:problems", 7);
  // Focus bookkeeping may also happen between the caller mutation and push.
  route.syncCurrent({ focus: "local-nav" });
  route.push({ ...target });

  expect(route.snapshot().current.workspace).toMatchObject({
    selectedProblem: "problem:second",
    diagnosticDetail: "problem:second",
  });
  expect(route.snapshot().stack).toHaveLength(2);

  route.back();
  expect(workspace.snapshot()).toMatchObject({
    selectedProblem: "problem:first",
    diagnosticDetail: "problem:first",
    query: "live-query",
    scrolls: { "skills:problems": 7 },
  });
});

test("ROUTE-REENTRY Problems repeated key is a no-op and its first Back reaches the list", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  workspace.selectSkillsView("problems");
  const route = createRoute({ workspace, config });
  workspace.selectProblem("problem:first");
  workspace.openDiagnosticDetail("problem:first");
  const target = {
    destination: "workspace" as const,
    section: "skills" as const,
    surface: "inspector" as const,
  };
  route.push(target);
  const entered = route.snapshot();
  route.push(target);
  expect(route.snapshot()).toBe(entered);

  route.back();
  expect(workspace.diagnosticDetail()).toBeUndefined();
  expect(workspace.selectedProblem()).toBe("problem:first");
  expect(route.canReturn()).toBe(false);
});

test("ROUTE-REENTRY handoff identity follows exact owners but not descriptions", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  const handoff: RouteHandoff = {
    kind: "collection-reference",
    collection: "team",
    name: "docs",
    target: "docs",
    description: "old description",
    owner: { level: "project", file: "/workspace/skill-cli.jsonc", pointer: "/collections/team" },
  };
  const target = {
    destination: "project" as const,
    section: "collections" as const,
    selection: "team",
    handoff,
  };
  route.push(target);
  const entered = route.snapshot();
  route.contribution({ ...target, handoff: { ...handoff, description: "new description" } });
  expect(route.snapshot()).toBe(entered);

  route.source({
    ...target,
    handoff: { ...handoff, owner: { ...handoff.owner, file: "/other/skill-cli.jsonc" } },
  });
  expect(route.snapshot().stack).toHaveLength(2);
  route.back();
  route.back();
  expect(route.snapshot().handoff).toBeUndefined();
});

test("ROUTE-REENTRY explicit bounded Updates identity deduplicates before landing", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const first = createUpdatesState(updateScope);
  let updates = first;
  const route = createRoute(
    { workspace, config },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => updates,
    (state) => {
      updates = state;
    },
  );
  const target = {
    destination: "workspace" as const,
    section: "updates" as const,
    sublocation: { kind: "updates" as const, entry: updateScope.entry, source: "team-main" },
  };
  route.transition(target, () => workspace.showSourceUpdates("team-main"));
  const entered = route.snapshot();
  let landed = false;
  first.setQuery("not-identity");
  route.transition({ ...target, focus: "local-nav" }, () => {
    landed = true;
  });
  expect(route.snapshot()).toBe(entered);
  expect(landed).toBe(false);

  updates = createUpdatesState({ ...updateScope, entry: { kind: "workspace" } });
  workspace.clearSourceUpdatesView();
  route.syncCurrent({ focus: "local-nav" });
  route.push({ destination: "workspace", section: "updates" });
  expect(route.snapshot().stack).toHaveLength(2);
  route.back();
  expect(updates).toBe(first);
  expect(workspace.sourceUpdatesView()?.source).toBe("team-main");
  expect(first.query()).toBe("not-identity");
});

test("ROUTE-REENTRY Updates Skill scopes retain colliding structural addresses as distinct entries", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const firstAddress = { source: "team", path: "main/guide" };
  const secondAddress = { source: "team/main", path: "guide" };
  const first = createUpdatesState({
    ...updateScope,
    entry: { kind: "skill", address: firstAddress },
    addresses: [firstAddress],
    sources: [firstAddress.source],
  });
  let updates = first;
  const route = createRoute(
    { workspace, config },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => updates,
    (state) => {
      updates = state;
    },
  );
  const target = { destination: "workspace" as const, section: "updates" as const };
  route.push(target);
  const entered = route.snapshot();
  route.push(target);
  expect(route.snapshot()).toBe(entered);

  updates = createUpdatesState({
    ...updateScope,
    entry: { kind: "skill", address: secondAddress },
    addresses: [secondAddress],
    sources: [secondAddress.source],
  });
  route.push(target);
  expect(route.snapshot().stack).toHaveLength(2);
  route.back();
  expect(updates).toBe(first);
  expect(updates.scope.entry).toEqual({ kind: "skill", address: firstAddress });
});

test("ROUTE-REENTRY root switches clear transient source drilldowns while preserving browser preferences", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });

  workspace.land("updates");
  workspace.setQuery("keep-me");
  workspace.setScroll("updates", 6);
  workspace.showSourceUpdates("team-main");
  route.syncCurrent({ section: "updates", focus: "browser" });
  route.push({
    destination: "workspace",
    section: "updates",
    surface: "inspector",
    focus: "inspector",
  });

  route.switchSection("sources", "local-nav");

  expect(route.snapshot().stack).toEqual([]);
  expect(route.snapshot().current).toMatchObject({
    context: "workspace",
    section: "sources",
    surface: "browser",
    focus: "local-nav",
  });
  expect(workspace.sourceUpdatesView()).toBeUndefined();
  expect(workspace.snapshot()).toMatchObject({
    query: "keep-me",
    scrolls: { updates: 6 },
  });
});

test("ROUTE-REENTRY selecting the current root context exits a Source subview without losing preferences", () => {
  const workspace = createWorkspaceState();
  const config = createConfigState();
  const route = createRoute({ workspace, config });
  workspace.land("updates");
  workspace.showSourceUpdates("team-main");
  workspace.setSourceUpdatesQuery("retained-source-query");
  workspace.setQuery("retained-query");
  workspace.setScroll("updates", 5);
  route.syncCurrent({ section: "updates" });

  route.switchContext("workspace", "top-nav");

  expect(workspace.sourceUpdatesView()).toBeUndefined();
  expect(route.snapshot().stack).toEqual([]);
  expect(route.snapshot().current.focus).toBe("top-nav");
  expect(workspace.query()).toBe("retained-query");
  expect(workspace.scroll("updates")).toBe(5);
  workspace.showSourceUpdates("team-main");
  expect(workspace.sourceUpdatesView()?.query).toBe("retained-source-query");
});
