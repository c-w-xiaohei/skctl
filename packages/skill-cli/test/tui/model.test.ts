import { expect, test } from "bun:test";
import { createTuiState, rawLineForMarkdownMatch, reduceTui } from "../../src/tui/model";
import { workspaceProjection } from "./direct-source.fixture";

test("STATE-004 source refresh uses stable IDs and nearest semantic reselection", () => {
  let state = reduceTui(createTuiState(), {
    type: "section.select",
    section: "sources",
  });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: workspaceProjection(),
  });
  state = reduceTui(state, {
    type: "selection.set",
    key: "sources",
    value: "team-main",
  });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: workspaceProjection({ includeDirect: false }),
  });
  expect(state.memory.workspace.selection.sources).toBe("team-config/lark");
});

test("STATE Collections refresh retains a surviving ID and selects the nearest replacement", () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const collection = (id: string) => ({
    id,
    declared: [],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  });
  let state = reduceTui(createTuiState(), {
    type: "workspace.replace",
    workspace: {
      ...projection,
      effective: { ...projection.effective, collectionsView: [collection("a"), collection("b")] },
    },
  });
  state = reduceTui(state, { type: "selection.set", key: "collections", value: "b" });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: {
      ...projection,
      effective: { ...projection.effective, collectionsView: [collection("a"), collection("c")] },
    },
  });
  expect(state.memory.workspace.selection.collections).toBe("c");
});

test("STATE Collections retain independent tabs across A B A and clear an empty filtered refresh", () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const collection = (id: string) => ({
    id,
    declared: [],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  });
  let state = reduceTui(createTuiState(), {
    type: "workspace.replace",
    workspace: {
      ...projection,
      effective: { ...projection.effective, collectionsView: [collection("a"), collection("b")] },
    },
  });
  state = reduceTui(state, { type: "selection.set", key: "collections", value: "a" });
  state = reduceTui(state, { type: "collection.tab.set", collection: "a", tab: "references" });
  state = reduceTui(state, { type: "selection.set", key: "collections", value: "b" });
  state = reduceTui(state, { type: "collection.tab.set", collection: "b", tab: "links" });
  state = reduceTui(state, { type: "selection.set", key: "collections", value: "a" });
  expect(state.memory.workspace.collectionTab).toEqual({ a: "references", b: "links" });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: { ...projection, effective: { ...projection.effective, collectionsView: [] } },
  });
  expect(state.memory.workspace.selection.collections).toBeUndefined();
});

test("STATE-004/024 restores overlay focus and never leaves settled focus on task", () => {
  let state = reduceTui(createTuiState(), {
    type: "focus.set",
    focus: "browser",
  });
  state = reduceTui(state, { type: "overlay.open", overlay: "confirm" });
  state = reduceTui(state, { type: "overlay.close" });
  expect(state.focus).toBe("browser");
  state = reduceTui(state, {
    type: "task.start",
    task: { id: "1", title: "Remove", cancellationRequested: false },
  });
  state = reduceTui(state, {
    type: "task.settle",
    id: "1",
    status: "cancelled",
  });
  expect(state.focus).toBe("browser");
});

test("STATE-024 nested overlays retain the original browser focus", () => {
  let state = reduceTui(createTuiState(), {
    type: "focus.set",
    focus: "browser",
  });
  state = reduceTui(state, { type: "overlay.open", overlay: "actions" });
  state = reduceTui(state, { type: "overlay.open", overlay: "confirm" });
  state = reduceTui(state, { type: "overlay.close" });
  expect(state.focus).toBe("browser");
});

test("STATE-004 retains each Installed Skill Reader presentation and restores it on selection", () => {
  const first = { source: "team-main", path: "first" };
  const second = { source: "team-main", path: "second" };
  let state = reduceTui(createTuiState(), { type: "reader.activate", address: first });
  state = reduceTui(state, {
    type: "reader.patch",
    value: { tab: "resources", raw: true, find: "needle", match: 2, scroll: 18 },
  });
  state = reduceTui(state, { type: "reader.activate", address: second });
  state = reduceTui(state, { type: "reader.patch", value: { tab: "details", scroll: 4 } });
  state = reduceTui(state, { type: "reader.activate", address: first });
  expect(state.reader).toMatchObject({
    address: first,
    tab: "resources",
    raw: true,
    find: "needle",
    match: 2,
    scroll: 18,
  });
});

test("STATE Reader activation retains independent find, match, raw, tab, and native scroll state", () => {
  const first = { source: "team-main", path: "first" };
  const second = { source: "team-main", path: "second" };
  let state = reduceTui(createTuiState(), { type: "reader.activate", address: first });
  state = reduceTui(state, {
    type: "reader.patch",
    value: { tab: "skill", raw: true, find: "needle", match: 1, scroll: 9 },
  });
  state = reduceTui(state, { type: "reader.activate", address: second });
  state = reduceTui(state, {
    type: "reader.patch",
    value: { tab: "details", raw: false, find: "other", match: 0, scroll: 3 },
  });
  state = reduceTui(state, { type: "reader.activate", address: first });
  expect(state.reader).toMatchObject({
    tab: "skill",
    raw: true,
    find: "needle",
    match: 1,
    scroll: 9,
  });
});

test("STATE-004 refresh reconciles filtered Problems membership to the visible Skill", () => {
  const first = { source: "team-main", path: "first" };
  const second = { source: "team-main", path: "second" };
  const skill = (
    address: { readonly source: string; readonly path: string },
    problems: readonly {
      readonly code: string;
      readonly severity: "warning";
      readonly message: string;
    }[],
  ) => ({
    address,
    name: address.path,
    description: address.path,
    owner: { source: address.source, health: "healthy" as const },
    collections: [],
    selectors: [],
    selectorViews: { status: "unavailable" as const },
    aliases: [],
    problems,
  });
  const problem = [{ code: "SOURCE_MISSING", severity: "warning" as const, message: "Missing" }];
  let state = reduceTui(createTuiState(), {
    type: "workspace.replace",
    workspace: {
      ...workspaceProjection(),
      installedSkills: [skill(first, problem), skill(second, [])],
    },
  });
  state = reduceTui(state, {
    type: "filter.set",
    key: "skills",
    dimension: "Problems",
    value: "Has problems",
  });
  state = reduceTui(state, { type: "selection.set", key: "skills", value: "team-main/first" });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: {
      ...workspaceProjection(),
      installedSkills: [skill(first, []), skill(second, problem)],
    },
  });
  expect(state.memory.workspace.selection.skills).toBe("team-main/second");
});

test("STATE-004 empty filtered refresh clears semantic selection and Reader focus", () => {
  const first = { source: "team-main", path: "first" };
  const problem = [{ code: "SOURCE_MISSING", severity: "warning" as const, message: "Missing" }];
  const installed = {
    address: first,
    name: "first",
    description: "first",
    owner: { source: "team-main", health: "healthy" as const },
    collections: [],
    selectors: [],
    selectorViews: { status: "unavailable" as const },
    aliases: [],
    problems: problem,
  };
  let state = reduceTui(createTuiState(), {
    type: "workspace.replace",
    workspace: { ...workspaceProjection(), installedSkills: [installed] },
  });
  state = reduceTui(state, {
    type: "filter.set",
    key: "skills",
    dimension: "Problems",
    value: "Has problems",
  });
  state = reduceTui(state, { type: "selection.set", key: "skills", value: "team-main/first" });
  state = reduceTui(state, { type: "reader.activate", address: first });
  state = reduceTui(state, { type: "focus.set", focus: "reader" });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: { ...workspaceProjection(), installedSkills: [{ ...installed, problems: [] }] },
  });
  expect(state.memory.workspace.selection.skills).toBeUndefined();
  expect(state.focus).toBe("browser");
  expect(state.narrowLevel).toBe("list");
});

test("STATE-015 keeps stale Reader resource results out of the active Skill", () => {
  const first = { source: "team-main", path: "first" };
  const second = { source: "team-main", path: "second" };
  let state = reduceTui(createTuiState(), { type: "reader.activate", address: second });
  state = reduceTui(state, { type: "reader.resources", address: first, resources: [] });
  expect(state.reader.address).toEqual(second);
  expect(state.reader.resources).toEqual([]);
});

test("STATE Resources retain selected content independently for each structural Installed Skill", () => {
  const first = { source: "team-main", path: "first" };
  const second = { source: "team-main", path: "second" };
  let state = reduceTui(createTuiState(), { type: "reader.activate", address: first });
  state = reduceTui(state, {
    type: "reader.resources",
    address: first,
    resources: [{ path: "docs/guide.md", kind: "file", size: 12 }],
  });
  state = reduceTui(state, {
    type: "reader.resource.loaded",
    address: first,
    value: { kind: "text", path: "docs/guide.md", text: "guide", format: "markdown" },
  });
  state = reduceTui(state, { type: "reader.activate", address: second });
  state = reduceTui(state, {
    type: "reader.resources",
    address: second,
    resources: [{ path: "notes.txt", kind: "file" }],
  });
  state = reduceTui(state, { type: "reader.activate", address: first });
  expect(state.reader).toMatchObject({
    selectedResource: "docs/guide.md",
    resourceLevel: "content",
    resource: { kind: "text", text: "guide" },
  });
});

test("STATE Reader refresh keeps the nearest Installed Skill and reader activation never contaminates a new Skill", () => {
  const first = { source: "team-main", path: "first" };
  const second = { source: "team-main", path: "second" };
  let state = reduceTui(createTuiState(), {
    type: "workspace.replace",
    workspace: {
      ...workspaceProjection(),
      installedSkills: [
        {
          address: first,
          name: "first",
          description: "First",
          owner: { source: "team-main", health: "healthy" },
          collections: [],
          selectors: [],
          selectorViews: { status: "unavailable" as const },
          aliases: [],
          problems: [],
        },
        {
          address: second,
          name: "second",
          description: "Second",
          owner: { source: "team-main", health: "healthy" },
          collections: [],
          selectors: [],
          selectorViews: { status: "unavailable" as const },
          aliases: [],
          problems: [],
        },
      ],
    },
  });
  state = reduceTui(state, { type: "selection.set", key: "skills", value: "team-main/second" });
  state = reduceTui(state, { type: "reader.activate", address: second });
  state = reduceTui(state, { type: "reader.patch", value: { find: "second", scroll: 12 } });
  state = reduceTui(state, {
    type: "workspace.replace",
    workspace: {
      ...workspaceProjection(),
      installedSkills: [
        {
          address: first,
          name: "first",
          description: "First",
          owner: { source: "team-main", health: "healthy" },
          collections: [],
          selectors: [],
          selectorViews: { status: "unavailable" as const },
          aliases: [],
          problems: [],
        },
      ],
    },
  });
  expect(state.memory.workspace.selection.skills).toBe("team-main/first");
  state = reduceTui(state, { type: "reader.activate", address: first });
  expect(state.reader.find).toBe("");
  expect(state.reader.scroll).toBe(0);
});

test("READ Open current Markdown match targets its raw source line rather than a character offset", () => {
  expect(
    rawLineForMarkdownMatch("---\ntitle: Guide\n---\n# Guide\nneedle", "# Guide\nneedle", 8),
  ).toBe(4);
});
