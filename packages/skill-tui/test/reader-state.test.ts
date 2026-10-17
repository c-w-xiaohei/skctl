import { expect, test } from "bun:test";
import type { ReaderState } from "../src/types";
import { installedContent, pendingReader } from "./reader-owner.fixture";

const alpha = { source: "main", path: "alpha" };
const beta = { source: "main", path: "beta" };

test("Reader state derives the active reader from its structural cache through A-B-A", () => {
  const { owner } = pendingReader();
  owner.select(alpha);
  owner.patch({ find: "alpha", scroll: 3 });
  const alphaReader = owner.current();
  owner.select(beta);
  owner.patch({ find: "beta", scroll: 9 });
  const betaReader = owner.current();
  expect(betaReader).toMatchObject({ address: beta, find: "beta", scroll: 9 });
  expect(owner.cached(alpha)).toBe(alphaReader);
  expect(owner.cached({ source: "main", path: "unvisited" })).toBeUndefined();

  owner.select(alpha);
  expect(owner.current()).toBe(owner.cached(alpha));
  expect(owner.current()).toBe(alphaReader);
  expect(owner.current()).toMatchObject({ address: alpha, find: "alpha", scroll: 3 });
  expect(owner.cached(beta)).toBe(betaReader);
  expect(owner.cached(beta)).toMatchObject({ address: beta, find: "beta", scroll: 9 });

  owner.select(beta);
  expect(owner.current()).toBe(betaReader);
  expect(owner.current()).toMatchObject({ address: beta, find: "beta", scroll: 9 });
  expect(owner.cached(alpha)).toBe(alphaReader);
  expect(owner.cached({ source: "main", path: "unvisited" })).toBeUndefined();
});

test("Reader state accepts a stale completion only for its matching cached address and epoch", async () => {
  const { owner, loads } = pendingReader();
  owner.select(alpha);
  const first = owner.load(alpha);
  owner.select(beta);
  const betaBefore = owner.current();
  // Selection alone does not cancel an inactive address's still-current transport.
  loads[0]!.resolve(installedContent(alpha, "alpha"));
  await first;
  expect(owner.current()).toBe(betaBefore);
  const stale = owner.load(beta);
  const current = owner.load(beta);
  loads[1]!.resolve(installedContent(beta, "stale"));
  await stale;
  expect(owner.current()).toMatchObject({ address: beta, loading: true });
  expect(owner.cached(alpha)).toMatchObject({ text: "alpha", loading: false });
  expect(owner.cached(beta)?.text).toBeUndefined();
  loads[2]!.resolve(installedContent(beta, "current"));
  await current;
  owner.dispose();
});

test("Reader owner allocates epochs per structural address and request kind", async () => {
  const { owner, loads, lists } = pendingReader();
  owner.select(alpha);
  const content = owner.load(alpha);
  const resources = owner.list(alpha);
  loads[0]!.resolve(installedContent(alpha, "old"));
  await content;
  expect(owner.cached(alpha)?.text).toBe("old");
  expect(owner.current()?.resourceLoading).toBe(true);
  expect(loads[0]!.signal?.aborted).toBe(false);
  lists[0]!.resolve({ value: [], diagnostics: [] });
  await resources;
  owner.dispose();
});

test("Reader owner rejects a stale inactive failure without changing the active reader", async () => {
  let notices = 0;
  const { owner, reads } = pendingReader(() => {
    notices++;
  });
  owner.select(alpha);
  const stale = owner.read(alpha, "a.md");
  owner.abandonResource();
  owner.select(beta);
  const current = owner.read(beta, "b.md");
  reads[0]!.reject(new Error("late"));
  await stale;
  expect(notices).toBe(0);
  expect(owner.current()).toMatchObject({ address: beta, selectedResource: "b.md" });
  expect(owner.cached(alpha)?.error).toBeUndefined();
  reads[1]!.resolve({
    value: { kind: "text", path: "b.md", text: "beta", format: "text" },
    diagnostics: [],
  });
  await current;
  owner.dispose();
});

test("Reader owner accepts a current inactive failure only in that cached reader", async () => {
  let notices = 0;
  const { owner, reads } = pendingReader(() => {
    notices++;
  });
  owner.select(alpha);
  const pending = owner.read(alpha, "a.md");
  owner.select(beta);
  const betaRead = owner.read(beta, "b.md");
  reads[0]!.reject(new Error("alpha failed"));
  await pending;
  expect(notices).toBe(0);
  expect(owner.current()).toMatchObject({ address: beta, selectedResource: "b.md" });
  expect(owner.cached(alpha)?.error?.message).toBe("alpha failed");
  reads[1]!.resolve({
    value: { kind: "text", path: "b.md", text: "beta", format: "text" },
    diagnostics: [],
  });
  await betaRead;
  owner.dispose();
});

test("content cancellation retires only the exact request and permits canceled reselection", async () => {
  const { owner, loads } = pendingReader();
  owner.select(alpha);
  const first = owner.load(alpha);
  owner.select(beta);
  let atAbort: ReaderState | undefined;
  loads[0]!.signal!.addEventListener("abort", () => {
    atAbort = owner.cached(alpha);
  });
  owner.cancelContent();
  expect(atAbort?.loading).toBe(false);
  expect(owner.current()?.address).toEqual(beta);
  owner.select(alpha);
  const retry = owner.load(alpha);
  const state = owner.current();
  loads[0]!.resolve(installedContent(alpha, "canceled"));
  expect(await first).toBeUndefined();
  expect(owner.current()).toBe(state);
  expect(owner.current()).toMatchObject({ address: alpha, loading: true });
  loads[1]!.resolve(installedContent(alpha, "retried"));
  await retry;
  expect(owner.current()).toMatchObject({ loading: false, text: "retried" });
  owner.dispose();
});

test("installed-content invalidation preserves reading state and rejects both old payload lanes", async () => {
  const { owner, loads, lists, reads } = pendingReader();
  owner.select(alpha);
  const content = owner.load(alpha);
  const list = owner.list(alpha);
  const resource = owner.read(alpha, "notes.md");
  owner.patch({
    tab: "resources",
    raw: true,
    find: "needle",
    match: 2,
    scroll: 17,
    detailsScroll: 9,
    text: "old installed",
    rawText: "old raw",
    resources: [{ path: "notes.md", kind: "file" }],
    resourcesLoaded: true,
    resource: { kind: "text", path: "notes.md", text: "old notes", format: "text" },
  });
  owner.select(beta);
  owner.patch({ text: "beta", rawText: "beta" });
  owner.invalidate(alpha);
  expect(owner.current()).toMatchObject({ address: beta, text: "beta" });
  const invalidated = owner.cached(alpha);
  expect(invalidated).toMatchObject({
    tab: "resources",
    raw: true,
    find: "needle",
    match: 2,
    scroll: 17,
    detailsScroll: 9,
    selectedResource: "notes.md",
    loading: false,
    resourceLoading: false,
    resources: [],
    resourcesLoaded: false,
  });
  expect(invalidated?.text).toBeUndefined();
  expect(invalidated?.rawText).toBeUndefined();
  expect(invalidated?.resource).toBeUndefined();
  expect(loads[0]!.signal?.aborted).toBe(false);
  expect(reads[0]!.signal?.aborted).toBe(false);
  loads[0]!.resolve({
    ...installedContent(alpha, "late old content"),
    diagnostics: [{ code: "INTERNAL", severity: "warning", message: "late failure" }],
  });
  lists[0]!.resolve({ value: [{ path: "old", kind: "directory" }], diagnostics: [] });
  reads[0]!.resolve({
    value: { kind: "text", path: "notes.md", text: "late notes", format: "text" },
    diagnostics: [],
  });
  await Promise.all([content, list, resource]);
  expect(owner.cached(alpha)).toBe(invalidated);
  const staleList = owner.list(alpha);
  owner.invalidate(alpha);
  const withoutList = owner.cached(alpha);
  lists[1]!.resolve({ value: [{ path: "late-list.md", kind: "file" }], diagnostics: [] });
  await staleList;
  expect(owner.cached(alpha)).toBe(withoutList);
  owner.invalidate();
  expect(owner.current()?.text).toBeUndefined();
  owner.select(alpha);
  const reload = owner.load(alpha);
  loads[1]!.resolve(installedContent(alpha, "new installed"));
  await reload;
  expect(owner.current()).toMatchObject({
    text: "new installed",
    tab: "resources",
    scroll: 17,
    detailsScroll: 9,
    find: "needle",
    raw: true,
  });
  owner.dispose();
});

const capturedReader = (address = alpha): ReaderState => ({
  address,
  tab: "resources",
  raw: true,
  find: "saved query",
  match: 2,
  scroll: 15,
  detailsScroll: 8,
  focus: "reader-resource-content",
  selectedResource: "notes.md",
  resourceLevel: "content",
  text: "old body",
  rawText: "old raw",
  resources: [{ path: "notes.md", kind: "file" }],
  resourcesLoaded: true,
  resource: { kind: "text", path: "notes.md", text: "old notes", format: "text" },
  loading: true,
  resourceLoading: true,
  error: { code: "INTERNAL", severity: "warning", message: "old error" },
});

test("route restoration cannot resurrect invalidated installed payloads from an old frame", () => {
  const { owner } = pendingReader();
  const saved = capturedReader();
  owner.select(alpha);
  owner.patch(saved);
  owner.invalidate(alpha);
  owner.select(beta);
  owner.restore(saved);
  expect(owner.current()).toBe(owner.cached(alpha));
  expect(owner.current()).toMatchObject({
    address: alpha,
    tab: "resources",
    raw: true,
    find: "saved query",
    match: 2,
    scroll: 15,
    detailsScroll: 8,
    focus: "reader-resource-content",
    selectedResource: "notes.md",
    resourceLevel: "list",
    resources: [],
    resourcesLoaded: false,
    loading: false,
    resourceLoading: false,
  });
  expect(owner.current()?.text).toBeUndefined();
  expect(owner.current()?.rawText).toBeUndefined();
  expect(owner.current()?.resource).toBeUndefined();
  expect(owner.current()?.error).toBeUndefined();
});

test("route restoration of a canceled pending frame stays reloadable until a real request starts", async () => {
  const { owner, loads } = pendingReader();
  owner.select(alpha);
  const first = owner.load(alpha);
  const saved = owner.current()!;
  owner.cancelContent();
  owner.select(beta);
  owner.restore(saved);
  expect(owner.current()).toMatchObject({ address: alpha, loading: false });
  expect(owner.current()?.text).toBeUndefined();
  const restored = owner.current();
  loads[0]!.resolve(installedContent(alpha, "canceled body"));
  expect(await first).toBeUndefined();
  expect(owner.current()).toBe(restored);
  const reload = owner.load(alpha);
  expect(owner.current()?.loading).toBe(true);
  loads[1]!.resolve(installedContent(alpha, "current body"));
  await reload;
  expect(owner.current()).toMatchObject({ text: "current body", loading: false });
  owner.dispose();
});

test("route restoration retains updated payloads, current failure, and pending request epochs", async () => {
  const { owner, loads, lists, reads } = pendingReader();
  owner.select(alpha);
  const content = owner.load(alpha);
  loads[0]!.resolve({
    ...installedContent(alpha, "updated body"),
    value: { ...installedContent(alpha, "updated body").value, rawText: "updated raw" },
  });
  await content;
  const resources = owner.list(alpha);
  lists[0]!.resolve({ value: [{ path: "current.md", kind: "file" }], diagnostics: [] });
  await resources;
  const resource = owner.read(alpha, "current.md");
  const pending = owner.load(alpha);
  reads[0]!.resolve({
    value: { kind: "text", path: "current.md", text: "current notes", format: "text" },
    diagnostics: [{ code: "INTERNAL", severity: "warning", message: "current warning" }],
  });
  await resource;
  owner.select(beta);
  const current = owner.cached(alpha)!;
  owner.restore({ ...capturedReader(), loading: false });
  expect(owner.current()).toMatchObject({
    address: alpha,
    text: "updated body",
    rawText: "updated raw",
    loading: true,
    resourceLoading: false,
    resourcesLoaded: true,
    selectedResource: "notes.md",
    resourceLevel: "list",
  });
  expect(owner.current()?.resources).toBe(current.resources);
  expect(owner.current()?.resource).toBe(current.resource);
  expect(owner.current()?.error).toBe(current.error);
  loads[1]!.resolve(installedContent(alpha, "latest body"));
  await pending;
  expect(owner.current()).toMatchObject({ text: "latest body", loading: false });
  owner.dispose();
});

test("route restoration without a cache saves preferences but creates only reloadable initial payload state", async () => {
  const { owner, loads } = pendingReader();
  const saved = capturedReader({ source: "main/alpha", path: "notes" });
  const other = { source: "main", path: "alpha/notes" };
  owner.select(other);
  owner.patch({ text: "other body", rawText: "other raw" });
  owner.restore(saved);
  expect(owner.current()).toBe(owner.cached(saved.address!));
  expect(owner.cached(other)?.text).toBe("other body");
  expect(owner.current()).toMatchObject({
    address: saved.address,
    tab: "resources",
    raw: true,
    find: "saved query",
    match: 2,
    scroll: 15,
    detailsScroll: 8,
    focus: "reader-resource-content",
    selectedResource: "notes.md",
    resourceLevel: "list",
    resources: [],
  });
  const reader = owner.current()!;
  expect(reader.text).toBeUndefined();
  expect(reader.rawText).toBeUndefined();
  expect(reader.resource).toBeUndefined();
  expect(reader.resourcesLoaded).toBeUndefined();
  expect(reader.loading).toBeUndefined();
  expect(reader.resourceLoading).toBeUndefined();
  expect(reader.error).toBeUndefined();
  const read = owner.load(saved.address!);
  loads[0]!.resolve(installedContent(saved.address!, "fresh"));
  await read;
  expect(owner.current()?.text).toBe("fresh");
  owner.dispose();
});

test("route restoration keeps a resource content view only when the current resource matches its saved path", async () => {
  const { owner, reads } = pendingReader();
  owner.select(alpha);
  const request = owner.read(alpha, "notes.md");
  reads[0]!.resolve({
    value: { kind: "text", path: "notes.md", text: "updated notes", format: "text" },
    diagnostics: [],
  });
  await request;
  owner.restore(capturedReader());
  expect(owner.current()).toMatchObject({
    selectedResource: "notes.md",
    resourceLevel: "content",
    resource: { text: "updated notes" },
    resourceLoading: false,
  });
  const state = owner.current();
  owner.restore({ ...capturedReader(), address: undefined });
  expect(owner.current()).toBe(state);
  owner.dispose();
});
