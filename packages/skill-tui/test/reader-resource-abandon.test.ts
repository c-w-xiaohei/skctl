import { expect, test } from "bun:test";
import { skillAddressKey } from "../src/types";
import type { ReadInstalledResource } from "../src/types";
import {
  activeReader,
  beginReaderRequest,
  createReaderState,
  reduceReaderEvent,
  reduceReaderState,
} from "../src/reader/state";

const alpha = { source: "main", path: "alpha" };
const beta = { source: "main", path: "beta" };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

test("resource Back invalidates a deferred body completion while retaining Reader cache", async () => {
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  state = reduceReaderState(state, {
    type: "patch",
    value: {
      tab: "resources",
      raw: true,
      find: "needle",
      match: 2,
      scroll: 7,
      detailsScroll: 11,
      resourcesLoaded: true,
      resources: [{ path: "notes.md", kind: "file" }],
    },
  });
  const content = beginReaderRequest(state, alpha, "content");
  const resource = beginReaderRequest(content.state, alpha, "resource", "notes.md");
  state = resource.state;
  const pending = deferred<ReadInstalledResource>();
  const completion = pending.promise.then((value) => {
    const result = reduceReaderEvent(state, {
      type: "resource.settle",
      address: alpha,
      epoch: resource.event.epoch,
      value,
    });
    state = result.state;
    return result.accepted;
  });
  state = reduceReaderState(state, { type: "resource-abandon" });
  pending.resolve({ kind: "text", path: "notes.md", format: "markdown", text: "late body" });

  expect(await completion).toBe(false);
  expect(activeReader(state)).toMatchObject({
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
  expect(activeReader(state)?.resource).toBeUndefined();
  const settledContent = reduceReaderEvent(state, {
    type: "content.settle",
    address: alpha,
    epoch: content.event.epoch,
    value: { markdownText: "current prose", rawText: "current raw" },
  });
  expect(settledContent.accepted).toBe(true);
  expect(activeReader(settledContent.state)).toMatchObject({
    resourceLevel: "list",
    text: "current prose",
    loading: false,
  });
});

test("tab change rejects a deferred resource failure without overwriting the new view", async () => {
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const resource = beginReaderRequest(state, alpha, "resource", "notes.md");
  state = resource.state;
  const pending = deferred<void>();
  const completion = pending.promise.then(() => {
    const result = reduceReaderEvent(state, {
      type: "failure",
      request: "resource",
      address: alpha,
      epoch: resource.event.epoch,
      diagnostic: { code: "INTERNAL", severity: "warning", message: "late failure" },
    });
    state = result.state;
    return result.accepted;
  });
  state = reduceReaderState(state, { type: "resource-abandon" });
  state = reduceReaderState(state, { type: "patch", value: { tab: "details" } });
  pending.resolve();

  expect(await completion).toBe(false);
  expect(activeReader(state)).toMatchObject({
    tab: "details",
    resourceLevel: "list",
    resourceLoading: false,
  });
  expect(activeReader(state)?.error).toBeUndefined();
});

test("only the newly allocated resource epoch can settle after abandonment", () => {
  const selected = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const abandoned = beginReaderRequest(selected, alpha, "resource", "old.md");
  const back = reduceReaderState(abandoned.state, { type: "resource-abandon" });
  const current = beginReaderRequest(back, alpha, "resource", "current.md");
  expect(current.event.epoch).toBeGreaterThan(abandoned.event.epoch);
  const stale = reduceReaderEvent(current.state, {
    type: "resource.settle",
    address: alpha,
    epoch: abandoned.event.epoch,
    value: { kind: "text", path: "old.md", format: "text", text: "old" },
  });
  expect(stale.accepted).toBe(false);
  expect(stale.state).toBe(current.state);
  const settled = reduceReaderEvent(stale.state, {
    type: "resource.settle",
    address: alpha,
    epoch: current.event.epoch,
    value: { kind: "text", path: "current.md", format: "text", text: "current" },
  });
  expect(settled.accepted).toBe(true);
  expect(activeReader(settled.state)).toMatchObject({
    resourceLevel: "content",
    resourceLoading: false,
    selectedResource: "current.md",
    resource: { text: "current" },
  });
});

test("abandonment changes only the active address and preserves a cached resource", () => {
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const alphaRequest = beginReaderRequest(state, alpha, "resource", "a.txt");
  state = reduceReaderState(alphaRequest.state, { type: "select", address: beta });
  const betaRequest = beginReaderRequest(state, beta, "resource", "b.txt");
  state = reduceReaderState(betaRequest.state, {
    type: "resource.settle",
    address: beta,
    epoch: betaRequest.event.epoch,
    value: { kind: "text", path: "b.txt", format: "text", text: "cached beta" },
  });
  const alphaBefore = state.cache[skillAddressKey(alpha)];
  const cached = activeReader(state)?.resource;
  state = reduceReaderState(state, { type: "resource-abandon" });
  expect(state.cache[skillAddressKey(alpha)]).toBe(alphaBefore);
  expect(activeReader(state)?.resource).toBe(cached);
  expect(activeReader(state)).toMatchObject({ selectedResource: "b.txt", resourceLevel: "list" });
  const settledAlpha = reduceReaderEvent(state, {
    type: "resource.settle",
    address: alpha,
    epoch: alphaRequest.event.epoch,
    value: { kind: "text", path: "a.txt", format: "text", text: "current alpha" },
  });
  expect(settledAlpha.accepted).toBe(true);
  expect(activeReader(settledAlpha.state)).toMatchObject({ address: beta, resourceLevel: "list" });
  expect(settledAlpha.state.cache[skillAddressKey(alpha)]?.resource).toMatchObject({
    text: "current alpha",
  });
});

test("abandonment also rejects a deferred list result in the shared resource lane", async () => {
  const selected = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const request = beginReaderRequest(selected, alpha, "resources");
  let state = request.state;
  const pending = deferred<void>();
  const completion = pending.promise.then(() => {
    const result = reduceReaderEvent(state, {
      type: "resources.settle",
      address: alpha,
      epoch: request.event.epoch,
      resources: [{ path: "late.md", kind: "file" }],
    });
    state = result.state;
    return result.accepted;
  });
  state = reduceReaderState(state, { type: "resource-abandon" });
  pending.resolve();
  expect(await completion).toBe(false);
  expect(activeReader(state)).toMatchObject({ resourceLoading: false, resources: [] });
});

test("abandonment without an active Reader declines without allocating an epoch", () => {
  const state = createReaderState();
  const result = reduceReaderEvent(state, { type: "resource-abandon" });
  expect(result.accepted).toBe(false);
  expect(result.state).toBe(state);
});
