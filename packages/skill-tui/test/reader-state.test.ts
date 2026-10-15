import { expect, test } from "bun:test";
import { skillAddressKey } from "@skill-cli/core";
import type { ReaderState } from "../src/types";
import {
  activeReader,
  beginReaderRequest,
  createReaderState,
  reduceReaderEvent,
  reduceReaderState,
} from "../src/reader/state";

const alpha = { source: "main", path: "alpha" };
const beta = { source: "main", path: "beta" };

test("Reader state derives the active reader from its structural cache through A-B-A", () => {
  let state = createReaderState();
  state = reduceReaderState(state, { type: "select", address: alpha });
  state = reduceReaderState(state, { type: "patch", value: { find: "alpha", scroll: 3 } });
  state = reduceReaderState(state, { type: "select", address: beta });
  state = reduceReaderState(state, { type: "select", address: alpha });

  expect(state.activeKey).toBe(skillAddressKey(alpha));
  expect(activeReader(state)).toMatchObject({ address: alpha, find: "alpha", scroll: 3 });
  expect(Object.keys(state.cache).sort()).toEqual([skillAddressKey(alpha), skillAddressKey(beta)]);
});

test("Reader state accepts a stale completion only for its matching cached address and epoch", () => {
  let state = createReaderState();
  state = reduceReaderState(state, { type: "select", address: alpha });
  state = reduceReaderState(state, { type: "content.start", address: alpha, epoch: 1 });
  state = reduceReaderState(state, { type: "select", address: beta });
  state = reduceReaderState(state, { type: "content.start", address: beta, epoch: 2 });
  state = reduceReaderState(state, {
    type: "content.settle",
    address: alpha,
    epoch: 1,
    value: { markdownText: "alpha", rawText: "raw alpha" },
  });
  state = reduceReaderState(state, {
    type: "content.settle",
    address: beta,
    epoch: 1,
    value: { markdownText: "stale", rawText: "stale" },
  });

  expect(activeReader(state)).toMatchObject({ address: beta, loading: true });
  expect(state.cache[skillAddressKey(alpha)]).toMatchObject({ text: "alpha", loading: false });
  expect(state.cache[skillAddressKey(beta)]?.text).toBeUndefined();
});

test("Reader owner allocates epochs per structural address and request kind", () => {
  let state = createReaderState();
  state = reduceReaderState(state, { type: "select", address: alpha });
  state = reduceReaderState(state, { type: "content.start", address: alpha, epoch: 1 });
  state = reduceReaderState(state, { type: "resources.start", address: alpha, epoch: 1 });
  state = reduceReaderState(state, {
    type: "content.settle",
    address: alpha,
    epoch: 1,
    value: { markdownText: "old", rawText: "old" },
  });
  expect(state.cache[skillAddressKey(alpha)]?.text).toBe("old");
});

test("Reader owner rejects a stale inactive failure without changing the active reader", () => {
  let state = createReaderState();
  state = reduceReaderState(state, { type: "select", address: alpha });
  state = reduceReaderState(state, {
    type: "resource.start",
    address: alpha,
    epoch: 1,
    path: "a.md",
  });
  state = reduceReaderState(state, { type: "select", address: beta });
  state = reduceReaderState(state, {
    type: "resource.start",
    address: beta,
    epoch: 2,
    path: "b.md",
  });

  const reduced = reduceReaderEvent(state, {
    type: "failure",
    address: alpha,
    epoch: 2,
    request: "resource",
    diagnostic: { code: "INTERNAL", severity: "warning", message: "late" },
  });

  expect(reduced.accepted).toBe(false);
  expect(activeReader(reduced.state)).toMatchObject({ address: beta, selectedResource: "b.md" });
  expect(reduced.state.cache[skillAddressKey(alpha)]?.error).toBeUndefined();
});

test("Reader owner accepts a current inactive failure only in that cached reader", () => {
  let state = createReaderState();
  state = reduceReaderState(state, { type: "select", address: alpha });
  state = reduceReaderState(state, {
    type: "resource.start",
    address: alpha,
    epoch: 1,
    path: "a.md",
  });
  state = reduceReaderState(state, { type: "select", address: beta });
  state = reduceReaderState(state, {
    type: "resource.start",
    address: beta,
    epoch: 1,
    path: "b.md",
  });

  const reduced = reduceReaderEvent(state, {
    type: "failure",
    address: alpha,
    epoch: 1,
    request: "resource",
    diagnostic: { code: "INTERNAL", severity: "warning", message: "alpha failed" },
  });

  expect(reduced.accepted).toBe(true);
  expect(activeReader(reduced.state)).toMatchObject({ address: beta, selectedResource: "b.md" });
  expect(reduced.state.cache[skillAddressKey(alpha)]?.error?.message).toBe("alpha failed");
});

test("content cancellation retires only the exact request and permits canceled reselection", () => {
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const first = beginReaderRequest(state, alpha, "content");
  state = reduceReaderState(first.state, { type: "select", address: beta });
  state = reduceReaderState(state, {
    type: "content.cancel",
    address: alpha,
    epoch: first.event.epoch,
  });
  expect(state.cache[skillAddressKey(alpha)]?.loading).toBe(false);
  expect(activeReader(state)?.address).toEqual(beta);

  state = reduceReaderState(state, { type: "select", address: alpha });
  const retry = beginReaderRequest(state, alpha, "content");
  state = retry.state;
  for (const event of [
    { type: "content.cancel", address: alpha, epoch: first.event.epoch } as const,
    {
      type: "content.settle",
      address: alpha,
      epoch: first.event.epoch,
      value: { markdownText: "canceled", rawText: "canceled" },
    } as const,
  ]) {
    const reduced = reduceReaderEvent(state, event);
    expect(reduced.accepted).toBe(false);
    expect(reduced.state).toBe(state);
  }
  expect(activeReader(state)).toMatchObject({ address: alpha, loading: true });
  state = reduceReaderState(state, {
    type: "content.settle",
    address: alpha,
    epoch: retry.event.epoch,
    value: { markdownText: "retried", rawText: "raw retried" },
  });
  expect(activeReader(state)).toMatchObject({ loading: false, text: "retried" });
});

test("installed-content invalidation preserves reading state and rejects both old payload lanes", () => {
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const content = beginReaderRequest(state, alpha, "content");
  const resource = beginReaderRequest(content.state, alpha, "resource", "notes.md");
  state = reduceReaderState(resource.state, {
    type: "patch",
    value: {
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
    },
  });
  state = reduceReaderState(state, { type: "select", address: beta });
  state = reduceReaderState(state, { type: "patch", value: { text: "beta", rawText: "beta" } });
  state = reduceReaderState(state, { type: "content.invalidate", address: alpha });

  expect(activeReader(state)).toMatchObject({ address: beta, text: "beta" });
  const invalidated = state.cache[skillAddressKey(alpha)];
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
  for (const event of [
    {
      type: "content.settle",
      address: alpha,
      epoch: content.event.epoch,
      value: { markdownText: "late old content", rawText: "late old raw" },
    } as const,
    {
      type: "resources.settle",
      address: alpha,
      epoch: resource.event.epoch,
      resources: [{ path: "old", kind: "directory" }],
    } as const,
    {
      type: "resource.settle",
      address: alpha,
      epoch: resource.event.epoch,
      value: { kind: "text", path: "notes.md", text: "late notes", format: "text" },
    } as const,
    {
      type: "failure",
      address: alpha,
      epoch: content.event.epoch,
      request: "content",
      diagnostic: { code: "INTERNAL", severity: "warning", message: "late failure" },
    } as const,
  ]) {
    expect(reduceReaderEvent(state, event).accepted).toBe(false);
  }

  state = reduceReaderState(state, { type: "content.invalidate" });
  expect(activeReader(state)?.text).toBeUndefined();
  state = reduceReaderState(state, { type: "select", address: alpha });
  const reload = beginReaderRequest(state, alpha, "content");
  state = reduceReaderState(reload.state, {
    type: "content.settle",
    address: alpha,
    epoch: reload.event.epoch,
    value: { markdownText: "new installed", rawText: "new raw" },
  });
  expect(activeReader(state)).toMatchObject({
    text: "new installed",
    tab: "resources",
    scroll: 17,
    detailsScroll: 9,
    find: "needle",
    raw: true,
  });
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
  const saved = capturedReader();
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  state = reduceReaderState(state, { type: "patch", value: saved });
  state = reduceReaderState(state, { type: "content.invalidate", address: alpha });
  state = reduceReaderState(state, { type: "select", address: beta });
  const epochs = state.epochs;
  state = reduceReaderState(state, { type: "restore", value: saved });

  expect(state.activeKey).toBe(skillAddressKey(alpha));
  expect(state.epochs).toBe(epochs);
  expect(activeReader(state)).toMatchObject({
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
  expect(activeReader(state)?.text).toBeUndefined();
  expect(activeReader(state)?.rawText).toBeUndefined();
  expect(activeReader(state)?.resource).toBeUndefined();
  expect(activeReader(state)?.error).toBeUndefined();
});

test("route restoration of a canceled pending frame stays reloadable until a real request starts", () => {
  const selected = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const first = beginReaderRequest(selected, alpha, "content");
  const saved = activeReader(first.state)!;
  let state = reduceReaderState(first.state, {
    type: "content.cancel",
    address: alpha,
    epoch: first.event.epoch,
  });
  state = reduceReaderState(state, { type: "select", address: beta });
  const epochs = state.epochs;
  state = reduceReaderState(state, { type: "restore", value: saved });
  expect(activeReader(state)).toMatchObject({ address: alpha, loading: false });
  expect(activeReader(state)?.text).toBeUndefined();
  expect(state.epochs).toBe(epochs);
  expect(
    reduceReaderEvent(state, {
      type: "content.settle",
      address: alpha,
      epoch: first.event.epoch,
      value: { markdownText: "canceled body", rawText: "canceled raw" },
    }).accepted,
  ).toBe(false);
  const reload = beginReaderRequest(state, alpha, "content");
  expect(activeReader(reload.state)?.loading).toBe(true);
  state = reduceReaderState(reload.state, {
    type: "content.settle",
    address: alpha,
    epoch: reload.event.epoch,
    value: { markdownText: "current body", rawText: "current raw" },
  });
  expect(activeReader(state)).toMatchObject({ text: "current body", loading: false });
});

test("route restoration retains updated payloads, current failure, and pending request epochs", () => {
  const saved = capturedReader();
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const content = beginReaderRequest(state, alpha, "content");
  state = reduceReaderState(content.state, {
    type: "content.settle",
    address: alpha,
    epoch: content.event.epoch,
    value: { markdownText: "updated body", rawText: "updated raw" },
  });
  const resources = beginReaderRequest(state, alpha, "resources");
  state = reduceReaderState(resources.state, {
    type: "resources.settle",
    address: alpha,
    epoch: resources.event.epoch,
    resources: [{ path: "current.md", kind: "file" }],
  });
  const resource = beginReaderRequest(state, alpha, "resource", "current.md");
  state = reduceReaderState(resource.state, {
    type: "resource.settle",
    address: alpha,
    epoch: resource.event.epoch,
    value: { kind: "text", path: "current.md", text: "current notes", format: "text" },
  });
  const pending = beginReaderRequest(state, alpha, "content");
  state = reduceReaderState(pending.state, {
    type: "failure",
    address: alpha,
    epoch: resource.event.epoch,
    request: "resource",
    diagnostic: { code: "INTERNAL", severity: "warning", message: "current warning" },
  });
  state = reduceReaderState(state, { type: "select", address: beta });
  const epochs = state.epochs;
  const current = state.cache[skillAddressKey(alpha)]!;
  state = reduceReaderState(state, { type: "restore", value: { ...saved, loading: false } });
  expect(state.epochs).toBe(epochs);
  expect(activeReader(state)).toMatchObject({
    address: alpha,
    text: "updated body",
    rawText: "updated raw",
    loading: true,
    resourceLoading: false,
    resourcesLoaded: true,
    selectedResource: "notes.md",
    resourceLevel: "list",
  });
  expect(activeReader(state)?.resources).toBe(current.resources);
  expect(activeReader(state)?.resource).toBe(current.resource);
  expect(activeReader(state)?.error).toBe(current.error);
  state = reduceReaderState(state, {
    type: "content.settle",
    address: alpha,
    epoch: pending.event.epoch,
    value: { markdownText: "latest body", rawText: "latest raw" },
  });
  expect(activeReader(state)).toMatchObject({ text: "latest body", loading: false });
});

test("route restoration without a cache saves preferences but creates only reloadable initial payload state", () => {
  const saved = capturedReader({ source: "main/alpha", path: "notes" });
  const other = { source: "main", path: "alpha/notes" };
  let state = reduceReaderState(createReaderState(), { type: "select", address: other });
  state = reduceReaderState(state, {
    type: "patch",
    value: { text: "other body", rawText: "other raw" },
  });
  const epochs = state.epochs;
  state = reduceReaderState(state, { type: "restore", value: saved });
  expect(state.activeKey).toBe(skillAddressKey(saved.address!));
  expect(state.epochs).toBe(epochs);
  expect(state.cache[skillAddressKey(other)]?.text).toBe("other body");
  expect(activeReader(state)).toMatchObject({
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
  const reader = activeReader(state)!;
  expect(reader.text).toBeUndefined();
  expect(reader.rawText).toBeUndefined();
  expect(reader.resource).toBeUndefined();
  expect(reader.resourcesLoaded).toBeUndefined();
  expect(reader.loading).toBeUndefined();
  expect(reader.resourceLoading).toBeUndefined();
  expect(reader.error).toBeUndefined();
  expect(beginReaderRequest(state, saved.address!, "content").event.epoch).toBe(1);
});

test("route restoration keeps a resource content view only when the current resource matches its saved path", () => {
  let state = reduceReaderState(createReaderState(), { type: "select", address: alpha });
  const request = beginReaderRequest(state, alpha, "resource", "notes.md");
  state = reduceReaderState(request.state, {
    type: "resource.settle",
    address: alpha,
    epoch: request.event.epoch,
    value: { kind: "text", path: "notes.md", text: "updated notes", format: "text" },
  });
  state = reduceReaderState(state, { type: "restore", value: capturedReader() });
  expect(activeReader(state)).toMatchObject({
    selectedResource: "notes.md",
    resourceLevel: "content",
    resource: { text: "updated notes" },
    resourceLoading: false,
  });
  const reduced = reduceReaderEvent(state, {
    type: "restore",
    value: { ...capturedReader(), address: undefined },
  });
  expect(reduced.accepted).toBe(false);
  expect(reduced.state).toBe(state);
});
