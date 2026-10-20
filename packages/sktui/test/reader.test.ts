import { expect, test } from "bun:test";
import { SkctlError } from "@skctl/core";
import { createReaderOwner, type ReaderAddress } from "../src/reader/state";
import type { TuiCore } from "../src/session";
import { findLiteralMatches, rawOffsetForMarkdownMatch } from "../src/types";
import { directSourceCore, testEffects, workspaceProjection } from "./direct-source.fixture";
import { deferred, installedContent, observeReader, pendingReader } from "./reader-owner.fixture";
const address = { source: "team-main", path: "guide" };
test("Reader restores per-Skill Details disclosure state without replacing cached bytes", () => {
  const { owner } = pendingReader();
  owner.select(address);
  owner.patch({
    tab: "details",
    detailsManagementOpen: true,
    detailsDescriptionOpen: true,
    text: "installed prose",
  });
  const saved = owner.current()!;
  owner.select({ ...address, path: "other" });
  expect(owner.current()?.detailsManagementOpen).not.toBe(true);
  owner.restore({ ...saved, text: "not authoritative" });
  expect(owner.current()).toMatchObject({
    detailsManagementOpen: true,
    detailsDescriptionOpen: true,
    text: "installed prose",
    tab: "details",
  });
});
test("READ-012 finds literal case-sensitive non-overlapping matches with source positions", () => {
  expect(findLiteralMatches("one one\r\nOne\n😀one", "one")).toEqual([
    { offset: 0, line: 0, column: 0 },
    { offset: 4, line: 0, column: 4 },
    { offset: 15, line: 2, column: 2 },
  ]);
  expect(findLiteralMatches("aaaa", "aa")).toEqual([
    { offset: 0, line: 0, column: 0 },
    { offset: 2, line: 0, column: 2 },
  ]);
  expect(findLiteralMatches("one", "")).toEqual([]);
  expect(rawOffsetForMarkdownMatch("---\ntitle: Demo\n---\n# Demo", "# Demo", 0)).toBe(20);
});
test("STATE-014/015 replaces only the Reader lane and suppresses stale content failures", async () => {
  let firstAbort = 0;
  const second = deferred<Awaited<ReturnType<TuiCore["loadInstalledSkill"]>>>();
  const core = directSourceCore(workspaceProjection(), {
    loadInstalledSkill: (_environment: import("@skctl/core").CoreOptions, request, options) =>
      request.address.path === "first"
        ? new Promise((_, reject) =>
            options?.signal?.addEventListener("abort", () => {
              firstAbort++;
              reject(new SkctlError("CANCELLED", "first cancelled"));
            }),
          )
        : second.promise,
  });
  const owner = createReaderOwner(core);
  const observed = observeReader(owner);
  const firstAddress = { ...address, path: "first" };
  const secondAddress = { ...address, path: "second" };
  owner.select(firstAddress);
  const first = owner.load(firstAddress);
  owner.select(secondAddress);
  const current = owner.load(secondAddress);
  second.resolve(installedContent(secondAddress, "second"));
  await Promise.all([first, current]);
  expect(firstAbort).toBe(1);
  expect(owner.current()).toMatchObject({ address: secondAddress, text: "second", loading: false });
  expect(observed.values.every((value) => value.error === undefined)).toBe(true);
  owner.dispose();
  observed.dispose();
});
test("Reader selection does not load and Details selection only changes the selected cache view", () => {
  const { owner, loads, lists, reads } = pendingReader();
  owner.select(address, "details");
  expect(owner.current()).toMatchObject({ address, tab: "details", focus: "reader" });
  owner.patch({ find: "retained", text: "installed" });
  owner.select({ ...address, path: "other" });
  owner.select(address);
  expect(owner.current()).toMatchObject({ tab: "details", find: "retained", text: "installed" });
  expect(loads).toEqual([]);
  expect(lists).toEqual([]);
  expect(reads).toEqual([]);
  owner.dispose();
});
test("Reader cache, epochs, and stale guards keep colliding display shorthands independent", async () => {
  const first = { source: "team", path: "main/guide" };
  const second = { source: "team/main", path: "guide" };
  const { owner, loads } = pendingReader();
  owner.select(first);
  const firstRequest = owner.load(first);
  // An inactive address can settle without transport replacement.
  owner.select(second);
  loads[0]!.resolve(installedContent(first, "first"));
  await firstRequest;
  const secondRequest = owner.load(second);
  loads[1]!.resolve(installedContent(second, "second"));
  await secondRequest;
  expect(owner.current()).toMatchObject({ address: second, text: "second" });
  owner.select(first);
  expect(owner.current()).toMatchObject({ address: first, text: "first" });
  expect(owner.cached(first)).not.toBe(owner.cached(second));
  owner.dispose();
});
test("STATE-014/015 keeps concurrent SKILL.md content and resource-list transports independent", async () => {
  const calls: unknown[] = [];
  const content = deferred<Awaited<ReturnType<TuiCore["loadInstalledSkill"]>>>();
  const resources = deferred<Awaited<ReturnType<TuiCore["listInstalledResources"]>>>();
  let contentSignal: AbortSignal | undefined;
  let resourceSignal: AbortSignal | undefined;
  const core = directSourceCore(workspaceProjection(), {
    loadInstalledSkill: (_environment: import("@skctl/core").CoreOptions, request, options) => {
      calls.push({ type: "content", request });
      contentSignal = options?.signal;
      return content.promise;
    },
    listInstalledResources: (_environment: import("@skctl/core").CoreOptions, request, options) => {
      calls.push({ type: "resources", request });
      resourceSignal = options?.signal;
      return resources.promise;
    },
  });
  const owner = createReaderOwner(core);
  owner.select(address);
  const loading = owner.load(address);
  const listing = owner.list(address);
  expect(calls).toEqual([
    { type: "content", request: { address } },
    { type: "resources", request: { address } },
  ]);
  expect(contentSignal?.aborted).toBe(false);
  expect(resourceSignal?.aborted).toBe(false);
  resources.resolve([{ path: "docs", kind: "directory" }]);
  await listing;
  expect(contentSignal?.aborted).toBe(false);
  expect(owner.current()).toMatchObject({
    loading: true,
    resourceLoading: false,
    resources: [{ path: "docs", kind: "directory" }],
  });
  content.resolve(installedContent(address, "# Guide"));
  await loading;
  expect(resourceSignal?.aborted).toBe(false);
  expect(owner.current()).toMatchObject({
    loading: false,
    resourceLoading: false,
    text: "# Guide",
    rawText: "# Guide",
    resources: [{ path: "docs", kind: "directory" }],
  });
  owner.dispose();
});
test("STATE-014 replaces resource list and read requests in the Reader lane without aborting a Source operation", async () => {
  let listAborts = 0;
  let readAborts = 0;
  let discoveryAborts = 0;
  const core = directSourceCore(workspaceProjection(), {
    listInstalledResources: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          listAborts++;
          reject(new SkctlError("CANCELLED", "list cancelled"));
        }),
      ),
    readInstalledResource: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          readAborts++;
          reject(new SkctlError("CANCELLED", "read cancelled"));
        }),
      ),
    discoverSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          discoveryAborts++;
          reject(new SkctlError("CANCELLED", "discovery cancelled"));
        }),
      ),
  });
  const effects = testEffects(core);
  const owner = createReaderOwner(core);
  owner.select(address);
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const list = owner.list(address);
  const read = owner.read(address, "guide.md");
  await Promise.resolve();
  expect(listAborts).toBe(1);
  expect(readAborts).toBe(0);
  expect(discoveryAborts).toBe(0);
  owner.dispose();
  effects.teardown();
  await Promise.all([source, list, read]);
  expect(readAborts).toBe(1);
  expect(discoveryAborts).toBe(1);
});
test("STATE-014 selecting a Reader target aborts only the prior Reader request while Source observation remains pending", async () => {
  let readerAborts = 0;
  let sourceAborts = 0;
  const core = directSourceCore(workspaceProjection(), {
    loadInstalledSkill: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          readerAborts++;
          reject(new SkctlError("CANCELLED", "reader cancelled"));
        }),
      ),
    discoverSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          sourceAborts++;
          reject(new SkctlError("CANCELLED", "source cancelled"));
        }),
      ),
  });
  const effects = testEffects(core);
  const owner = createReaderOwner(core);
  owner.select({ ...address, path: "first" });
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const first = owner.load({ ...address, path: "first" });
  owner.select({ ...address, path: "second" });
  const second = owner.load({ ...address, path: "second" });
  await Promise.resolve();
  expect(readerAborts).toBe(1);
  expect(sourceAborts).toBe(0);
  owner.dispose();
  effects.teardown();
  await Promise.all([source, first, second]);
  expect(readerAborts).toBe(2);
  expect(sourceAborts).toBe(1);
});
test("STATE-015 stale resource list failure cannot replace a newer resource read", async () => {
  const { owner, lists, reads } = pendingReader();
  owner.select(address);
  const list = owner.list(address);
  const read = owner.read(address, "guide.md");
  reads[0]!.resolve({ kind: "text", path: "guide.md", text: "current", format: "text" });
  await read;
  const state = owner.current();
  lists[0]!.reject(new SkctlError("RESOURCE_NOT_FOUND", "stale list"));
  await list;
  expect(owner.current()).toBe(state);
  expect(owner.current()).toMatchObject({ resource: { path: "guide.md", text: "current" } });
  expect(owner.current()?.error).toBeUndefined();
  owner.dispose();
});
test.each(["resources", "resource"] as const)(
  "Reader %s replacement retains the shared controller after an older request settles",
  async (request) => {
    const { owner, lists, reads } = pendingReader();
    owner.select(address);
    const observed = observeReader(owner);
    const old = request === "resources" ? owner.list(address) : owner.read(address, "guide.md");
    const current = request === "resources" ? owner.read(address, "guide.md") : owner.list(address);
    const oldCall = request === "resources" ? lists[0]! : reads[0]!;
    const currentCall = request === "resources" ? reads[0]! : lists[0]!;
    expect([oldCall.signal?.aborted, currentCall.signal?.aborted]).toEqual([true, false]);
    const settleList = () => lists[0]!.resolve([{ path: "old.md", kind: "file" }]);
    const settleRead = () =>
      reads[0]!.resolve({ kind: "text", path: "guide.md", text: "old", format: "text" });
    (request === "resources" ? settleList : settleRead)();
    expect(await old).toEqual(
      request === "resources"
        ? [{ path: "old.md", kind: "file" }]
        : { kind: "text", path: "guide.md", text: "old", format: "text" },
    );
    expect(owner.current()).toMatchObject({ resourceLoading: true, resources: [] });
    expect(owner.current()?.resource).toBeUndefined();
    expect(owner.current()?.error).toBeUndefined();
    const count = observed.values.length;
    owner.dispose();
    expect(currentCall.signal?.aborted).toBe(true);
    (request === "resources" ? settleRead : settleList)();
    expect(await current).toEqual(
      request === "resources"
        ? { kind: "text", path: "guide.md", text: "old", format: "text" }
        : [{ path: "old.md", kind: "file" }],
    );
    expect(observed.values).toHaveLength(count);
    observed.dispose();
  },
);
test.each(["resources", "resource"] as const)(
  "Reader %s preserves direct success values, failure conversion, and cancellation silence",
  async (request) => {
    let error: unknown;
    const core = directSourceCore(workspaceProjection(), {
      listInstalledResources: async () => {
        if (error) throw error;
        return [{ path: "guide.md", kind: "file" }];
      },
      readInstalledResource: async () => {
        if (error) throw error;
        return { kind: "text", path: "guide.md", text: "current", format: "text" };
      },
    });
    const owner = createReaderOwner(core);
    owner.select(address);
    const observed = observeReader(owner);
    const run = () =>
      request === "resources" ? owner.list(address) : owner.read(address, "guide.md");
    expect(await run()).toEqual(
      request === "resources"
        ? [{ path: "guide.md", kind: "file" }]
        : { kind: "text", path: "guide.md", text: "current", format: "text" },
    );
    expect(
      observed.values.slice(1).map((value) => ({
        loading: value.resourceLoading,
        error: value.error,
      })),
    ).toEqual([
      { loading: true, error: undefined },
      { loading: false, error: undefined },
    ]);
    if (request === "resources") expect(owner.current()?.resourcesLoaded).toBe(true);
    else expect(owner.current()?.resource?.path).toBe("guide.md");
    error = new Error("read failed");
    expect(await run()).toBeUndefined();
    expect(owner.current()?.error).toEqual({
      code: "INTERNAL",
      severity: "warning",
      message: "read failed",
    });
    error = new SkctlError("CANCELLED", "read cancelled");
    const count = observed.values.length;
    expect(await run()).toBeUndefined();
    expect(observed.values).toHaveLength(count + 1);
    expect(owner.current()).toMatchObject({ resourceLoading: true, error: undefined });
    const canceledCount = observed.values.length;
    owner.dispose();
    expect(await run()).toBeUndefined();
    expect(observed.values).toHaveLength(canceledCount);
    observed.dispose();
  },
);
function pendingContentReads() {
  const calls: {
    readonly address: ReaderAddress;
    readonly signal?: AbortSignal;
    readonly resolve: (value: Awaited<ReturnType<TuiCore["loadInstalledSkill"]>>) => void;
    readonly reject: (error: unknown) => void;
  }[] = [];
  const load: TuiCore["loadInstalledSkill"] = (_environment, request, options) =>
    new Promise((resolve, reject) => {
      calls.push({
        address: request.address,
        signal: options?.signal,
        resolve: (value) => resolve(value),
        reject,
      });
    });
  const core = directSourceCore(workspaceProjection(), { loadInstalledSkill: load });
  const owner = createReaderOwner(core);
  return { owner, calls };
}
test("rapid A-B-A clears canceled caches and ignores late canceled successes and diagnostics", async () => {
  const a = { ...address, path: "a" };
  const b = { ...address, path: "b" };
  const { owner, calls } = pendingContentReads();
  const observed = observeReader(owner);
  owner.select(a);
  const firstA = owner.load(a);
  owner.select(b);
  const firstB = owner.load(b);
  expect(owner.cached(a)?.loading).toBe(false);
  owner.select(a);
  const secondA = owner.load(a);
  expect(calls.map((call) => call.address)).toEqual([a, b, a]);
  expect(calls.map((call) => call.signal?.aborted)).toEqual([true, true, false]);
  calls[2]!.resolve(installedContent(a, "current A"));
  await secondA;
  const count = observed.values.length;
  calls[0]!.resolve(installedContent(a, "old A"));
  calls[1]!.resolve(installedContent(b, "canceled B"));
  expect(await firstA).toBeUndefined();
  expect(await firstB).toBeUndefined();
  expect(owner.current()).toMatchObject({ address: a, text: "current A", loading: false });
  expect(owner.current()?.error).toBeUndefined();
  expect(owner.cached(b)).toMatchObject({ address: b, loading: false });
  expect(owner.cached(b)?.text).toBeUndefined();
  expect(observed.values).toHaveLength(count);
  expect(observed.values.filter((value) => value.text !== undefined)).toHaveLength(1);
  owner.dispose();
  observed.dispose();
});
test("switching to a cached Skill can cancel pending content without stranding its loading state", async () => {
  const a = { ...address, path: "a" };
  const b = { ...address, path: "b" };
  const { owner, calls } = pendingContentReads();
  owner.select(a);
  const firstA = owner.load(a);
  calls[0]!.resolve(installedContent(a, "cached A"));
  await firstA;
  owner.select(b);
  const firstB = owner.load(b);
  owner.cancelContent();
  owner.select(a);
  calls[1]!.reject(new Error("late B failure"));
  await firstB;
  expect(owner.current()).toMatchObject({ address: a, text: "cached A", loading: false });
  expect(owner.current()?.error).toBeUndefined();
  expect(owner.cached(b)?.error).toBeUndefined();
  owner.select(b);
  expect(owner.current()).toMatchObject({ address: b, loading: false });
  expect(owner.current()?.text).toBeUndefined();
  const retryB = owner.load(b);
  calls[2]!.resolve(installedContent(b, "retried B"));
  await retryB;
  expect(owner.current()).toMatchObject({ address: b, text: "retried B", loading: false });
  owner.dispose();
});
test("Core content cancellation without a replacement remains reloadable", async () => {
  const { owner, calls } = pendingContentReads();
  owner.select(address);
  const read = owner.load(address);
  calls[0]!.reject(new SkctlError("CANCELLED", "content canceled"));
  await read;
  expect(owner.current()).toMatchObject({ address, loading: false });
  expect(owner.current()?.text).toBeUndefined();
  expect(owner.current()?.error).toBeUndefined();
  const retry = owner.load(address);
  calls[1]!.resolve(installedContent(address, "reloaded"));
  await retry;
  expect(owner.current()).toMatchObject({ loading: false, text: "reloaded" });
  owner.dispose();
});
test("explicit content navigation cancellation does not cancel a pending Source operation", async () => {
  const pending = deferred<Awaited<ReturnType<TuiCore["loadInstalledSkill"]>>>();
  let contentSignal: AbortSignal | undefined;
  let sourceSignal: AbortSignal | undefined;
  const core = directSourceCore(workspaceProjection(), {
    loadInstalledSkill: (_environment: import("@skctl/core").CoreOptions, _request, options) => {
      contentSignal = options?.signal;
      return pending.promise;
    },
    discoverSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
      new Promise((_, reject) => {
        sourceSignal = options?.signal;
        sourceSignal?.addEventListener("abort", () =>
          reject(new SkctlError("CANCELLED", "source canceled on teardown")),
        );
      }),
  });
  const effects = testEffects(core);
  const owner = createReaderOwner(core);
  owner.select(address);
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const read = owner.load(address);
  owner.cancelContent();
  expect(contentSignal?.aborted).toBe(true);
  expect(sourceSignal?.aborted).toBe(false);
  expect(effects.pendingKind()).toBe("observe");
  pending.reject(new SkctlError("CANCELLED", "content canceled"));
  await read;
  owner.dispose();
  effects.teardown();
  await source;
});
test("B failure and explicit retry retain B identity and never reuse A content", async () => {
  const a = { ...address, path: "a" };
  const b = { ...address, path: "b" };
  const { owner, calls } = pendingContentReads();
  owner.select(a);
  const readA = owner.load(a);
  calls[0]!.resolve(installedContent(a, "A only"));
  await readA;
  owner.select(b);
  const readB = owner.load(b);
  calls[1]!.reject(new SkctlError("RESOURCE_NOT_FOUND", "B SKILL.md missing"));
  await readB;
  expect(owner.current()).toMatchObject({
    address: b,
    loading: false,
    error: { code: "RESOURCE_NOT_FOUND", message: "B SKILL.md missing" },
  });
  expect(owner.current()?.text).toBeUndefined();
  const retryB = owner.load(b);
  expect(owner.current()?.error).toBeUndefined();
  expect(calls[2]!.address).toEqual(b);
  calls[2]!.resolve(installedContent(b, "B restored"));
  await retryB;
  expect(owner.current()).toMatchObject({ address: b, text: "B restored", loading: false });
  owner.select(a);
  expect(owner.current()?.text).toBe("A only");
  owner.dispose();
});
test("explicit installed refresh retires in-flight content and reloads without resetting reading preferences", async () => {
  const { owner, calls } = pendingContentReads();
  owner.select(address);
  owner.patch({ tab: "details", raw: true, find: "needle", scroll: 12, detailsScroll: 7 });
  const oldRead = owner.load(address);
  owner.invalidate(address);
  calls[0]!.resolve(installedContent(address, "before refresh"));
  await oldRead;
  expect(owner.current()?.text).toBeUndefined();
  expect(owner.current()?.loading).toBe(false);
  const newRead = owner.load(address);
  calls[1]!.resolve(installedContent(address, "after refresh"));
  await newRead;
  expect(owner.current()).toMatchObject({
    address,
    text: "after refresh",
    tab: "details",
    raw: true,
    find: "needle",
    scroll: 12,
    detailsScroll: 7,
  });
  owner.dispose();
});
test("accepted failure notification follows committed state for either lane only at the active content view", async () => {
  const notified: unknown[] = [];
  const pending: ReturnType<typeof pendingReader> = pendingReader(() =>
    notified.push(pending.owner.current()?.error),
  );
  const { owner, loads, reads } = pending;
  owner.select(address);
  owner.patch({ resourceLevel: "content" });
  const content = owner.load(address);
  loads[0]!.reject(new Error("content failed"));
  await content;
  expect(notified).toEqual([{ code: "INTERNAL", severity: "warning", message: "content failed" }]);
  expect(notified[0]).toBe(owner.current()?.error);
  const body = owner.read(address, "guide.md");
  reads[0]!.reject(new Error("body failed"));
  await body;
  expect(notified).toHaveLength(2);
  expect(notified[1]).toBe(owner.current()?.error);
  owner.patch({ resourceLevel: "list" });
  const listView = owner.load(address);
  loads[1]!.reject(new Error("no content focus"));
  await listView;
  expect(owner.current()?.error?.message).toBe("no content focus");
  expect(notified).toHaveLength(2);
  owner.dispose();
});
test("Reader dispose suppresses late content and resource writes without changing resource promise results", async () => {
  const { owner, loads, reads } = pendingReader();
  owner.select(address);
  const observed = observeReader(owner);
  const content = owner.load(address);
  const resource = owner.read(address, "guide.md");
  owner.dispose();
  const count = observed.values.length;
  expect(loads[0]!.signal?.aborted).toBe(true);
  expect(reads[0]!.signal?.aborted).toBe(true);
  loads[0]!.resolve(installedContent(address, "late prose"));
  reads[0]!.resolve({ kind: "text", path: "guide.md", text: "late body", format: "text" });
  expect(await content).toBeUndefined();
  expect(await resource).toEqual({
    kind: "text",
    path: "guide.md",
    text: "late body",
    format: "text",
  });
  expect(observed.values).toHaveLength(count);
  expect(owner.current()).toMatchObject({ loading: false, resourceLoading: true });
  expect(owner.current()?.text).toBeUndefined();
  expect(owner.current()?.resource).toBeUndefined();
  expect(await owner.load(address)).toBeUndefined();
  expect(await owner.list(address)).toBeUndefined();
  expect(await owner.read(address, "guide.md")).toBeUndefined();
  expect(loads).toHaveLength(1);
  expect(reads).toHaveLength(1);
  observed.dispose();
});
test("an old content finally cannot release a replacement that is still pending", async () => {
  const { owner, calls } = pendingContentReads();
  owner.select(address);
  const old = owner.load(address);
  const replacement = owner.load(address);
  calls[0]!.resolve(installedContent(address, "old"));
  expect(await old).toBeUndefined();
  expect(owner.current()?.loading).toBe(true);
  owner.cancelContent();
  expect(calls[1]!.signal?.aborted).toBe(true);
  expect(owner.current()?.loading).toBe(false);
  calls[1]!.resolve(installedContent(address, "cancelled replacement"));
  expect(await replacement).toBeUndefined();
  expect(owner.current()?.text).toBeUndefined();
  owner.dispose();
});
test("resource list start retains successful body while body start clears it and loaded-empty stays loaded", async () => {
  const { owner, lists, reads } = pendingReader();
  owner.select(address);
  const body = owner.read(address, "guide.md");
  reads[0]!.resolve({ kind: "text", path: "guide.md", text: "cached body", format: "text" });
  await body;
  const cached = owner.current()?.resource;
  const list = owner.list(address);
  expect(owner.current()).toMatchObject({ resourceLevel: "list", resourceLoading: true });
  expect(owner.current()?.resource).toBe(cached);
  lists[0]!.resolve([]);
  await list;
  expect(owner.current()).toMatchObject({
    resources: [],
    resourcesLoaded: true,
    resourceLoading: false,
  });
  expect(owner.current()?.resource).toBe(cached);
  const next = owner.read(address, "next.md");
  expect(owner.current()).toMatchObject({
    selectedResource: "next.md",
    resourceLevel: "content",
    resourceLoading: true,
  });
  expect(owner.current()?.resource).toBeUndefined();
  reads[1]!.resolve({ kind: "text", path: "next.md", text: "next body", format: "text" });
  await next;
  owner.dispose();
});
