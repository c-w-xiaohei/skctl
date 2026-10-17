import { expect, test } from "bun:test";
import { installedContent, pendingReader } from "./reader-owner.fixture";

const alpha = { source: "main", path: "alpha" };
const beta = { source: "main", path: "beta" };

test("resource Back invalidates a deferred body completion while retaining Reader cache", async () => {
  const { owner, loads, reads } = pendingReader();
  owner.select(alpha);
  owner.patch({
    tab: "resources",
    raw: true,
    find: "needle",
    match: 2,
    scroll: 7,
    detailsScroll: 11,
    resourcesLoaded: true,
    resources: [{ path: "notes.md", kind: "file" }],
  });
  const content = owner.load(alpha);
  const resource = owner.read(alpha, "notes.md");
  owner.abandonResource();
  reads[0]!.resolve({
    value: { kind: "text", path: "notes.md", format: "markdown", text: "late body" },
    diagnostics: [],
  });
  expect(await resource).toMatchObject({ value: { text: "late body" } });
  expect(reads[0]!.signal?.aborted).toBe(false);
  expect(owner.current()).toMatchObject({
    tab: "resources",
    resourceLevel: "list",
    resourceLoading: false,
    selectedResource: "notes.md",
    raw: true,
    find: "needle",
    match: 2,
    scroll: 7,
    detailsScroll: 11,
    loading: true,
    resourcesLoaded: true,
    resources: [{ path: "notes.md", kind: "file" }],
  });
  expect(owner.current()?.resource).toBeUndefined();
  loads[0]!.resolve({
    ...installedContent(alpha, "current prose"),
    value: { ...installedContent(alpha, "current prose").value, rawText: "current raw" },
  });
  await content;
  expect(owner.current()).toMatchObject({
    resourceLevel: "list",
    text: "current prose",
    loading: false,
  });
  owner.dispose();
});

test("tab change rejects a deferred resource failure without overwriting the new view", async () => {
  const { owner, reads } = pendingReader();
  owner.select(alpha);
  const completion = owner.read(alpha, "notes.md");
  owner.abandonResource();
  owner.patch({ tab: "details" });
  reads[0]!.reject(new Error("late failure"));
  expect(await completion).toBeUndefined();
  expect(owner.current()).toMatchObject({
    tab: "details",
    resourceLevel: "list",
    resourceLoading: false,
  });
  expect(owner.current()?.error).toBeUndefined();
  owner.dispose();
});

test("only the newly allocated resource epoch can settle after abandonment", async () => {
  const { owner, reads } = pendingReader();
  owner.select(alpha);
  const abandoned = owner.read(alpha, "old.md");
  owner.abandonResource();
  const current = owner.read(alpha, "current.md");
  const state = owner.current();
  reads[0]!.resolve({
    value: { kind: "text", path: "old.md", format: "text", text: "old" },
    diagnostics: [],
  });
  await abandoned;
  expect(owner.current()).toBe(state);
  reads[1]!.resolve({
    value: { kind: "text", path: "current.md", format: "text", text: "current" },
    diagnostics: [],
  });
  await current;
  expect(owner.current()).toMatchObject({
    resourceLevel: "content",
    resourceLoading: false,
    selectedResource: "current.md",
    resource: { text: "current" },
  });
  owner.dispose();
});

test("abandonment changes only the active address and preserves a cached resource", async () => {
  const { owner, reads } = pendingReader();
  owner.select(alpha);
  const alphaRequest = owner.read(alpha, "a.txt");
  owner.select(beta);
  const betaRequest = owner.read(beta, "b.txt");
  reads[1]!.resolve({
    value: { kind: "text", path: "b.txt", format: "text", text: "cached beta" },
    diagnostics: [],
  });
  await betaRequest;
  const alphaBefore = owner.cached(alpha);
  const cached = owner.current()?.resource;
  owner.abandonResource();
  expect(owner.cached(alpha)).toBe(alphaBefore);
  expect(owner.current()?.resource).toBe(cached);
  expect(owner.current()).toMatchObject({ selectedResource: "b.txt", resourceLevel: "list" });
  // The old transport ignores abort; its address still owns the current epoch.
  reads[0]!.resolve({
    value: { kind: "text", path: "a.txt", format: "text", text: "current alpha" },
    diagnostics: [],
  });
  await alphaRequest;
  expect(owner.current()).toMatchObject({ address: beta, resourceLevel: "list" });
  expect(owner.cached(alpha)?.resource).toMatchObject({ text: "current alpha" });
  owner.dispose();
});

test("abandonment also rejects a deferred list result in the shared resource lane", async () => {
  const { owner, lists } = pendingReader();
  owner.select(alpha);
  const completion = owner.list(alpha);
  owner.abandonResource();
  const state = owner.current();
  lists[0]!.resolve({ value: [{ path: "late.md", kind: "file" }], diagnostics: [] });
  await completion;
  expect(owner.current()).toBe(state);
  expect(owner.current()).toMatchObject({ resourceLoading: false, resources: [] });
  owner.dispose();
});

test("abandonment without an active Reader declines without allocating an epoch", () => {
  const { owner } = pendingReader();
  owner.abandonResource();
  expect(owner.current()).toBeUndefined();
  expect(owner.cached(alpha)).toBeUndefined();
});
