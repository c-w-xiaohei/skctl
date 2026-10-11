import { expect, test } from "bun:test";
import { skillAddressKey } from "@skill-cli/core";
import {
  activeReader,
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
