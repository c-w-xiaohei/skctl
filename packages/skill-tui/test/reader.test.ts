import { expect, test } from "bun:test";
import { SkillCliError } from "@skill-cli/core";
import { createTuiEffects as createRealTuiEffects } from "../src/effects";
import type { TuiCore } from "../src/effects";
import { createOperationState } from "../src/operation-state";
import { createProjection } from "../src/projection";
import { findLiteralMatches, rawOffsetForMarkdownMatch, skillAddressKey } from "../src/types";
import {
  activeReader,
  beginReaderRequest,
  createReaderState,
  reduceReaderState,
  type ReaderAddress,
  type ReaderEvent,
  type ReaderOwnerState,
} from "../src/reader/state";
import { createWorkspaceState } from "../src/workspace/state";
import { createCollectionsState } from "../src/collections/state";
import { createConfigState } from "../src/config/state";
import {
  directSourceCore,
  testEffects as createTuiEffects,
  workspaceProjection,
} from "./direct-source.fixture";

test("Reader restores per-Skill Details disclosure state without replacing cached bytes", () => {
  const address = { source: "team-main", path: "guide" };
  let state = reduceReaderState(createReaderState(), { type: "select", address });
  state = reduceReaderState(state, {
    type: "patch",
    value: {
      tab: "details",
      detailsManagementOpen: true,
      detailsDescriptionOpen: true,
      text: "installed prose",
    },
  });
  const saved = activeReader(state)!;
  state = reduceReaderState(state, { type: "select", address: { ...address, path: "other" } });
  expect(activeReader(state)?.detailsManagementOpen).not.toBe(true);
  state = reduceReaderState(state, {
    type: "restore",
    value: { ...saved, text: "not authoritative" },
  });
  expect(activeReader(state)).toMatchObject({
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
  let resolveSecond:
    | ((value: {
        value: {
          address: { source: string; path: string };
          name: string;
          description: string;
          rawText: string;
          markdownText: string;
        };
        diagnostics: [];
      }) => void)
    | undefined;
  const events: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: (request, options) =>
        request.address.path === "first"
          ? new Promise((_, reject) =>
              options?.signal?.addEventListener("abort", () => {
                firstAbort++;
                reject(new SkillCliError("CANCELLED", "first cancelled"));
              }),
            )
          : new Promise((resolve) => {
              resolveSecond = resolve;
            }),
    }),
    (event) => events.push(event),
  );
  const first = effects.loadReader({ source: "team-main", path: "first" });
  const second = effects.loadReader({ source: "team-main", path: "second" });
  resolveSecond!({
    value: {
      address: { source: "team-main", path: "second" },
      name: "second",
      description: "Second",
      rawText: "---\n---\nsecond",
      markdownText: "second",
    },
    diagnostics: [],
  });
  await Promise.all([first, second]);
  expect(firstAbort).toBe(1);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "content.settle",
      address: { source: "team-main", path: "second" },
      value: expect.objectContaining({ markdownText: "second" }),
    }),
  );
  expect(events).not.toContainEqual(expect.objectContaining({ type: "failure" }));
});

test("Reader cache, epochs, and stale guards keep colliding display shorthands independent", () => {
  const first = { source: "team", path: "main/guide" };
  const second = { source: "team/main", path: "guide" };
  let reader = reduceReaderState(createReaderState(), { type: "select", address: first });
  const firstRequest = beginReaderRequest(reader, first, "content");
  reader = firstRequest.state;
  reader = reduceReaderState(reader, { type: "select", address: second });
  const secondRequest = beginReaderRequest(reader, second, "content");
  reader = secondRequest.state;

  reader = reduceReaderState(reader, {
    type: "content.settle",
    address: first,
    epoch: firstRequest.event.epoch,
    value: { markdownText: "first", rawText: "first" },
  });
  reader = reduceReaderState(reader, {
    type: "content.settle",
    address: second,
    epoch: secondRequest.event.epoch,
    value: { markdownText: "second", rawText: "second" },
  });

  expect(activeReader(reader)).toMatchObject({ address: second, text: "second" });
  reader = reduceReaderState(reader, { type: "select", address: first });
  expect(activeReader(reader)).toMatchObject({ address: first, text: "first" });
  expect(Object.values(reader.cache)).toHaveLength(2);
});

test("STATE-014/015 keeps concurrent SKILL.md content and resource-list transports independent", async () => {
  const address = { source: "team-main", path: "guide" };
  const calls: unknown[] = [];
  let contentSignal: AbortSignal | undefined;
  let resourceSignal: AbortSignal | undefined;
  let resolveContent:
    | ((value: {
        value: {
          address: typeof address;
          name: string;
          description: string;
          rawText: string;
          markdownText: string;
        };
        diagnostics: [];
      }) => void)
    | undefined;
  let resolveResources:
    | ((value: { value: readonly [{ path: "docs"; kind: "directory" }]; diagnostics: [] }) => void)
    | undefined;
  let reader: ReaderOwnerState = reduceReaderState(createReaderState(), {
    type: "select",
    address,
  });
  const operation = createOperationState();
  const projection = createProjection(operation, {
    workspace: createWorkspaceState(),
    collections: createCollectionsState(),
    config: createConfigState(),
  });
  const effects = createRealTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: (request, options) => {
        calls.push({ type: "content", request });
        contentSignal = options?.signal;
        return new Promise((resolve) => {
          resolveContent = resolve;
        });
      },
      listInstalledResources: (request, options) => {
        calls.push({ type: "resources", request });
        resourceSignal = options?.signal;
        return new Promise((resolve) => {
          resolveResources = resolve;
        });
      },
    }),
    operation,
    projection.outcomes,
    (event) => {
      reader = reduceReaderState(reader, event);
    },
    (target, request, path) => {
      const begun = beginReaderRequest(reader, target, request, path);
      reader = begun.state;
      return begun.event;
    },
  );

  const content = effects.loadReader(address);
  const resources = effects.listResources(address);

  expect(calls).toEqual([
    { type: "content", request: { address } },
    { type: "resources", request: { address } },
  ]);
  expect(contentSignal?.aborted).toBe(false);
  expect(resourceSignal?.aborted).toBe(false);

  resolveResources!({ value: [{ path: "docs", kind: "directory" }], diagnostics: [] });
  await resources;
  expect(contentSignal?.aborted).toBe(false);
  expect(activeReader(reader)).toMatchObject({
    loading: true,
    resourceLoading: false,
    resources: [{ path: "docs", kind: "directory" }],
  });

  resolveContent!({
    value: {
      address,
      name: "guide",
      description: "Guide",
      rawText: "# Guide",
      markdownText: "# Guide",
    },
    diagnostics: [],
  });
  await content;

  expect(resourceSignal?.aborted).toBe(false);
  expect(activeReader(reader)).toMatchObject({
    loading: false,
    resourceLoading: false,
    text: "# Guide",
    rawText: "# Guide",
    resources: [{ path: "docs", kind: "directory" }],
  });
});

test("STATE-014 replaces resource list and read requests in the Reader lane without aborting a Source operation", async () => {
  let listAborts = 0;
  let readAborts = 0;
  let discoveryAborts = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      listInstalledResources: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            listAborts++;
            reject(new SkillCliError("CANCELLED", "list cancelled"));
          }),
        ),
      readInstalled: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            readAborts++;
            reject(new SkillCliError("CANCELLED", "read cancelled"));
          }),
        ),
      discover: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            discoveryAborts++;
            reject(new SkillCliError("CANCELLED", "discovery cancelled"));
          }),
        ),
    }),
  );
  const address = { source: "team-main", path: "first" };
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const list = effects.listResources(address);
  const read = effects.readResource(address, "guide.md");
  await Promise.resolve();
  expect(listAborts).toBe(1);
  expect(readAborts).toBe(0);
  expect(discoveryAborts).toBe(0);
  effects.teardown();
  await Promise.all([source, list, read]);
  expect(readAborts).toBe(1);
  expect(discoveryAborts).toBe(1);
});

test("STATE-014 selecting a Reader target aborts only the prior Reader request while Source observation remains pending", async () => {
  let readerAborts = 0;
  let sourceAborts = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            readerAborts++;
            reject(new SkillCliError("CANCELLED", "reader cancelled"));
          }),
        ),
      discover: (_request, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            sourceAborts++;
            reject(new SkillCliError("CANCELLED", "source cancelled"));
          }),
        ),
    }),
  );
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const first = effects.loadReader({ source: "team-main", path: "first" });
  const second = effects.loadReader({ source: "team-main", path: "second" });
  await Promise.resolve();
  expect(readerAborts).toBe(1);
  expect(sourceAborts).toBe(0);
  effects.teardown();
  await Promise.all([source, first, second]);
  expect(readerAborts).toBe(2);
  expect(sourceAborts).toBe(1);
});

test("STATE-015 stale resource list failure cannot replace a newer resource read", async () => {
  let rejectList: ((error: SkillCliError) => void) | undefined;
  const events: unknown[] = [];
  let reader = createReaderState();
  const address = { source: "team-main", path: "guide" };
  reader = reduceReaderState(reader, { type: "select", address });
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      listInstalledResources: (_request, options) =>
        new Promise((_, reject) => {
          rejectList = reject;
          options?.signal?.addEventListener("abort", () => {});
        }),
      readInstalled: async (_request) => ({
        value: { kind: "text", path: "guide.md", text: "current", format: "text" },
        diagnostics: [],
      }),
    }),
    (event) => {
      reader = reduceReaderState(reader, event);
      events.push(event);
    },
  );
  const list = effects.listResources(address);
  const read = effects.readResource(address, "guide.md");
  await read;
  rejectList!(new SkillCliError("RESOURCE_NOT_FOUND", "stale list"));
  await list;
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "resource.settle",
      address,
      value: { kind: "text", path: "guide.md", text: "current", format: "text" },
    }),
  );
  expect(activeReader(reader)).toMatchObject({ resource: { path: "guide.md", text: "current" } });
  expect(activeReader(reader)?.error).toBeUndefined();
});

test.each(["resources", "resource"] as const)(
  "Reader %s replacement retains the shared controller after an older request settles",
  async (request) => {
    const address = { source: "team-main", path: "guide" };
    let reader = reduceReaderState(createReaderState(), { type: "select", address });
    const events: ReaderEvent[] = [];
    const signals: AbortSignal[] = [];
    const completions: (() => void)[] = [];
    const pending = (signal: AbortSignal | undefined) => {
      signals.push(signal!);
      return new Promise<void>((resolve) => completions.push(resolve));
    };
    const warning = { code: "INTERNAL", severity: "warning" as const, message: "old warning" };
    const effects = createTuiEffects(
      directSourceCore(workspaceProjection(), {
        listInstalledResources: async (_request, options) => {
          await pending(options?.signal);
          return { value: [{ path: "old.md", kind: "file" }], diagnostics: [warning] };
        },
        readInstalled: async (_request, options) => {
          await pending(options?.signal);
          return {
            value: { kind: "text", path: "guide.md", text: "old", format: "text" },
            diagnostics: [warning],
          };
        },
      }),
      (event) => {
        reader = reduceReaderState(reader, event);
        events.push(event);
      },
    );
    const old =
      request === "resources"
        ? effects.listResources(address)
        : effects.readResource(address, "guide.md");
    const current =
      request === "resources"
        ? effects.readResource(address, "guide.md")
        : effects.listResources(address);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);

    // Ignore abort deliberately: real epochs, not a transport fake, reject the old result.
    completions[0]!();
    expect(await old).toMatchObject({ diagnostics: [warning] });
    expect(activeReader(reader)).toMatchObject({ resourceLoading: true, resources: [] });
    expect(activeReader(reader)?.resource).toBeUndefined();
    expect(activeReader(reader)?.error).toBeUndefined();
    const count = events.length;
    effects.teardown();
    expect(signals[1]!.aborted).toBe(true);
    completions[1]!();
    expect(await current).toMatchObject({ diagnostics: [warning] });
    expect(events).toHaveLength(count);
  },
);

test.each(["resources", "resource"] as const)(
  "Reader %s preserves success diagnostics, failure conversion, and cancellation silence",
  async (request) => {
    const address = { source: "team-main", path: "guide" };
    const warning = { code: "INTERNAL", severity: "warning" as const, message: "read warning" };
    let error: unknown;
    const events: ReaderEvent[] = [];
    const effects = createTuiEffects(
      directSourceCore(workspaceProjection(), {
        listInstalledResources: async () => {
          if (error) throw error;
          return { value: [{ path: "guide.md", kind: "file" }], diagnostics: [warning] };
        },
        readInstalled: async () => {
          if (error) throw error;
          return {
            value: { kind: "text", path: "guide.md", text: "current", format: "text" },
            diagnostics: [warning],
          };
        },
      }),
      (event) => events.push(event),
    );
    const run = () =>
      request === "resources"
        ? effects.listResources(address)
        : effects.readResource(address, "guide.md");
    expect(await run()).toMatchObject({ diagnostics: [warning] });
    expect(events[0]).toMatchObject({ type: `${request}.start`, address, epoch: 1 });
    expect(events[1]).toMatchObject({ type: `${request}.settle`, address, epoch: 1 });
    expect(events[2]).toEqual({ type: "failure", address, epoch: 1, request, diagnostic: warning });

    error = new Error("read failed");
    expect(await run()).toBeUndefined();
    expect(events.at(-1)).toEqual({
      type: "failure",
      address,
      epoch: 2,
      request,
      diagnostic: { code: "INTERNAL", severity: "warning", message: "read failed" },
    });
    error = new SkillCliError("CANCELLED", "read cancelled");
    const count = events.length;
    expect(await run()).toBeUndefined();
    expect(events).toHaveLength(count + 1);
    expect(events.at(-1)).toMatchObject({ type: `${request}.start`, address, epoch: 3 });
    effects.teardown();
    expect(await run()).toBeUndefined();
    expect(events).toHaveLength(count + 1);
  },
);

type ContentResult = Awaited<ReturnType<TuiCore["content"]["loadInstalled"]>>;

const installedContent = (address: ReaderAddress, text: string): ContentResult => ({
  value: {
    address,
    name: address.path,
    description: address.path,
    markdownText: text,
    rawText: text,
  },
  diagnostics: [],
});

function pendingContentReads() {
  const calls: {
    readonly address: ReaderAddress;
    readonly signal?: AbortSignal;
    readonly resolve: (value: ContentResult) => void;
    readonly reject: (error: unknown) => void;
  }[] = [];
  const loadInstalled: TuiCore["content"]["loadInstalled"] = (request, options) =>
    new Promise((resolve, reject) => {
      // Deliberately ignore abort: the owner must reject late success and failure too.
      calls.push({ address: request.address, signal: options?.signal, resolve, reject });
    });
  return { calls, loadInstalled };
}

function ownedReaderEffects(loadInstalled: TuiCore["content"]["loadInstalled"]) {
  let state = createReaderState();
  const events: ReaderEvent[] = [];
  const dispatch = (event: ReaderEvent) => {
    state = reduceReaderState(state, event);
    events.push(event);
  };
  const operation = createOperationState();
  const projection = createProjection(operation, {
    workspace: createWorkspaceState(),
    collections: createCollectionsState(),
    config: createConfigState(),
  });
  const effects = createRealTuiEffects(
    directSourceCore(workspaceProjection(), { loadInstalled }),
    operation,
    projection.outcomes,
    dispatch,
    (address, request, path) => {
      const begun = beginReaderRequest(state, address, request, path);
      state = begun.state;
      return begun.event;
    },
  );
  return { effects, dispatch, events, state: () => state, reader: () => activeReader(state) };
}

test("rapid A-B-A clears canceled caches and ignores late canceled successes and diagnostics", async () => {
  const a = { source: "team-main", path: "a" };
  const b = { source: "team-main", path: "b" };
  const pending = pendingContentReads();
  const owner = ownedReaderEffects(pending.loadInstalled);
  owner.dispatch({ type: "select", address: a });
  const firstA = owner.effects.loadReader(a);
  owner.dispatch({ type: "select", address: b });
  const firstB = owner.effects.loadReader(b);
  expect(owner.state().cache[skillAddressKey(a)]?.loading).toBe(false);
  owner.dispatch({ type: "select", address: a });
  const secondA = owner.effects.loadReader(a);

  expect(pending.calls.map((call) => call.address)).toEqual([a, b, a]);
  expect(pending.calls.map((call) => call.signal?.aborted)).toEqual([true, true, false]);
  pending.calls[2]!.resolve(installedContent(a, "current A"));
  await secondA;
  pending.calls[0]!.resolve({
    ...installedContent(a, "old A"),
    diagnostics: [{ code: "INTERNAL", severity: "warning", message: "old A warning" }],
  });
  pending.calls[1]!.resolve(installedContent(b, "canceled B"));
  expect(await firstA).toBeUndefined();
  expect(await firstB).toBeUndefined();
  expect(owner.reader()).toMatchObject({ address: a, text: "current A", loading: false });
  expect(owner.reader()?.error).toBeUndefined();
  expect(owner.state().cache[skillAddressKey(b)]).toMatchObject({
    address: b,
    loading: false,
  });
  expect(owner.state().cache[skillAddressKey(b)]?.text).toBeUndefined();
  expect(owner.events.filter((event) => event.type === "content.settle")).toHaveLength(1);
  owner.effects.teardown();
});

test("switching to a cached Skill can cancel pending content without stranding its loading state", async () => {
  const a = { source: "team-main", path: "a" };
  const b = { source: "team-main", path: "b" };
  const pending = pendingContentReads();
  const owner = ownedReaderEffects(pending.loadInstalled);
  owner.dispatch({ type: "select", address: a });
  const firstA = owner.effects.loadReader(a);
  pending.calls[0]!.resolve(installedContent(a, "cached A"));
  await firstA;
  owner.dispatch({ type: "select", address: b });
  const firstB = owner.effects.loadReader(b);
  owner.effects.cancelReaderContent();
  owner.dispatch({ type: "select", address: a });
  pending.calls[1]!.reject(new Error("late B failure"));
  await firstB;
  expect(owner.reader()).toMatchObject({ address: a, text: "cached A", loading: false });
  expect(owner.events.filter((event) => event.type === "failure")).toEqual([]);

  owner.dispatch({ type: "select", address: b });
  expect(owner.reader()).toMatchObject({ address: b, loading: false });
  expect(owner.reader()?.text).toBeUndefined();
  const retryB = owner.effects.loadReader(b);
  pending.calls[2]!.resolve(installedContent(b, "retried B"));
  await retryB;
  expect(owner.reader()).toMatchObject({ address: b, text: "retried B", loading: false });
  owner.effects.teardown();
});

test("Core content cancellation without a replacement remains reloadable", async () => {
  const address = { source: "team-main", path: "a" };
  const pending = pendingContentReads();
  const owner = ownedReaderEffects(pending.loadInstalled);
  owner.dispatch({ type: "select", address });
  const read = owner.effects.loadReader(address);
  pending.calls[0]!.reject(new SkillCliError("CANCELLED", "content canceled"));
  await read;
  expect(owner.reader()).toMatchObject({ address, loading: false });
  expect(owner.reader()?.text).toBeUndefined();
  expect(owner.reader()?.error).toBeUndefined();
  const retry = owner.effects.loadReader(address);
  pending.calls[1]!.resolve(installedContent(address, "reloaded"));
  await retry;
  expect(owner.reader()).toMatchObject({ loading: false, text: "reloaded" });
  owner.effects.teardown();
});

test("explicit content navigation cancellation does not cancel a pending Source operation", async () => {
  const pending = pendingContentReads();
  let sourceSignal: AbortSignal | undefined;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      loadInstalled: pending.loadInstalled,
      discover: (_request, options) =>
        new Promise((_, reject) => {
          sourceSignal = options?.signal;
          sourceSignal?.addEventListener("abort", () => {
            reject(new SkillCliError("CANCELLED", "source canceled on teardown"));
          });
        }),
    }),
  );
  const source = effects.discover({ kind: "source-discovery", source: "team-main" });
  const read = effects.loadReader({ source: "team-main", path: "guide" });
  effects.cancelReaderContent();
  expect(pending.calls[0]!.signal?.aborted).toBe(true);
  expect(sourceSignal?.aborted).toBe(false);
  expect(effects.pendingKind()).toBe("observe");
  pending.calls[0]!.reject(new SkillCliError("CANCELLED", "content canceled"));
  await read;
  effects.teardown();
  await source;
});

test("B failure and explicit retry retain B identity and never reuse A content", async () => {
  const a = { source: "team-main", path: "a" };
  const b = { source: "team-main", path: "b" };
  const pending = pendingContentReads();
  const owner = ownedReaderEffects(pending.loadInstalled);
  owner.dispatch({ type: "select", address: a });
  const readA = owner.effects.loadReader(a);
  pending.calls[0]!.resolve(installedContent(a, "A only"));
  await readA;
  owner.dispatch({ type: "select", address: b });
  const readB = owner.effects.loadReader(b);
  pending.calls[1]!.reject(new SkillCliError("RESOURCE_NOT_FOUND", "B SKILL.md missing"));
  await readB;
  expect(owner.reader()).toMatchObject({
    address: b,
    loading: false,
    error: { code: "RESOURCE_NOT_FOUND", message: "B SKILL.md missing" },
  });
  expect(owner.reader()?.text).toBeUndefined();
  const retryB = owner.effects.loadReader(b);
  expect(owner.reader()?.error).toBeUndefined();
  expect(pending.calls[2]!.address).toEqual(b);
  pending.calls[2]!.resolve(installedContent(b, "B restored"));
  await retryB;
  expect(owner.reader()).toMatchObject({ address: b, text: "B restored", loading: false });
  owner.dispatch({ type: "select", address: a });
  expect(owner.reader()?.text).toBe("A only");
  owner.effects.teardown();
});

test("explicit installed refresh retires in-flight content and reloads without resetting reading preferences", async () => {
  const address = { source: "team-main", path: "guide" };
  const pending = pendingContentReads();
  const owner = ownedReaderEffects(pending.loadInstalled);
  owner.dispatch({ type: "select", address });
  owner.dispatch({
    type: "patch",
    value: { tab: "details", raw: true, find: "needle", scroll: 12, detailsScroll: 7 },
  });
  const oldRead = owner.effects.loadReader(address);
  owner.dispatch({ type: "content.invalidate", address });
  pending.calls[0]!.resolve(installedContent(address, "before refresh"));
  await oldRead;
  expect(owner.reader()?.text).toBeUndefined();
  expect(owner.reader()?.loading).toBe(false);

  const newRead = owner.effects.loadReader(address);
  pending.calls[1]!.resolve(installedContent(address, "after refresh"));
  await newRead;
  expect(owner.reader()).toMatchObject({
    address,
    text: "after refresh",
    tab: "details",
    raw: true,
    find: "needle",
    scroll: 12,
    detailsScroll: 7,
  });
  owner.effects.teardown();
});
