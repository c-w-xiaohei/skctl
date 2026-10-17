import { expect, test } from "bun:test";
import { restoreSelectState, selectScrollOffset } from "../src/select-scroll";

type Listener = () => void;

const target = (scrollOffset: number, options = 20, height = 5) => {
  const listeners = new Map<string, Listener>();
  return {
    parent: {} as unknown,
    options: Array.from({ length: options }),
    height,
    scrollOffset,
    rendered: 0,
    once(event: string, listener: Listener) {
      const onceListener = () => {
        if (listeners.get(event) !== onceListener) return;
        listeners.delete(event);
        listener();
      };
      listeners.set(event, onceListener);
    },
    on(event: string, listener: Listener) {
      listeners.set(event, listener);
    },
    off(event: string) {
      listeners.delete(event);
    },
    requestRender() {
      this.rendered++;
    },
    setSelectedIndex(_index: number) {},
    emit(event: string) {
      listeners.get(event)?.();
    },
    hasListener(event: string) {
      return listeners.has(event);
    },
  };
};

const rendererFixture = () => {
  const frames = new Set<Listener>();
  return {
    frames,
    renderer: {
      once(_event: "frame", listener: Listener) {
        frames.add(listener);
      },
      off(_event: "frame", listener: Listener) {
        frames.delete(listener);
      },
      requestRender() {},
    },
    flushFrame() {
      const pending = [...frames];
      frames.clear();
      pending.forEach((listener) => listener());
    },
  };
};

test("Select scroll facade rejects an incompatible runtime", () => {
  expect(() => selectScrollOffset({} as never)).toThrow("scrollOffset is unavailable");
});

test.each([
  { name: "maximum", saved: 15, expected: 15 },
  { name: "zero", saved: 0, expected: 0 },
])("Select state restores a valid $name viewport after selection", async ({ saved, expected }) => {
  const { frames, renderer, flushFrame } = rendererFixture();
  const select = target(4);
  let selected = -1;
  select.setSelectedIndex = (index: number) => {
    selected = index;
    select.scrollOffset = 4;
    select.emit("selectionChanged");
  };
  let saves = 0;

  restoreSelectState(
    renderer,
    select as never,
    19,
    saved,
    () => saves++,
    () => true,
  );
  await Promise.resolve();
  expect(selected).toBe(19);
  expect(frames.size).toBe(1);
  flushFrame();
  expect(select.scrollOffset).toBe(expected);
  expect(select.rendered).toBe(1);
  expect(saves).toBe(0);
});

test("Select state preserves the native viewport for an invalid saved offset", async () => {
  const { renderer, flushFrame } = rendererFixture();
  const select = target(2);
  select.setSelectedIndex = () => {
    select.scrollOffset = 6;
    select.emit("selectionChanged");
  };

  restoreSelectState(
    renderer,
    select as never,
    19,
    99,
    () => {},
    () => true,
  );
  await Promise.resolve();
  flushFrame();
  expect(select.scrollOffset).toBe(6);
});

test("Select state refuses a detached target before semantic selection", async () => {
  const { frames, renderer } = rendererFixture();
  const select = target(0);
  let selected = -1;
  let saves = 0;
  select.setSelectedIndex = (index: number) => (selected = index);

  restoreSelectState(
    renderer,
    select as never,
    7,
    3,
    () => saves++,
    () => true,
  );
  select.parent = undefined;
  await Promise.resolve();
  expect(selected).toBe(-1);
  expect(frames.size).toBe(0);
  expect(select.rendered).toBe(0);
  expect(saves).toBe(0);
});

test("Select state cancels a scheduled viewport replay when the target is destroyed", async () => {
  const { frames, renderer } = rendererFixture();
  const select = target(0);
  let saves = 0;
  select.setSelectedIndex = () => {
    select.scrollOffset = 6;
  };

  restoreSelectState(
    renderer,
    select as never,
    7,
    3,
    () => saves++,
    () => true,
  );
  await Promise.resolve();
  const staleFrame = [...frames][0];
  expect(frames.size).toBe(1);
  expect(select.hasListener("selectionChanged")).toBe(true);
  select.emit("destroyed");
  expect(frames.size).toBe(0);
  expect(select.hasListener("selectionChanged")).toBe(false);
  staleFrame();
  await Promise.resolve();
  expect(select.scrollOffset).toBe(6);
  expect(select.rendered).toBe(0);
  expect(saves).toBe(0);
});

test("Select state replacement is guarded by mount identity, not target singleton", async () => {
  const { frames, renderer, flushFrame } = rendererFixture();
  const oldTarget = target(0);
  const newTarget = target(0);
  let current = oldTarget;
  let oldSaves = 0;
  let newSaves = 0;
  oldTarget.setSelectedIndex = () => {
    oldTarget.scrollOffset = 2;
  };
  newTarget.setSelectedIndex = () => {
    newTarget.scrollOffset = 4;
  };

  const cancelOld = restoreSelectState(
    renderer,
    oldTarget as never,
    7,
    5,
    () => oldSaves++,
    () => current === oldTarget,
  );
  await Promise.resolve();
  const oldFrame = [...frames][0];
  current = newTarget;
  oldFrame();
  expect(frames.size).toBe(0);
  expect(oldTarget.scrollOffset).toBe(2);
  expect(oldTarget.rendered).toBe(0);
  expect(oldSaves).toBe(0);
  restoreSelectState(
    renderer,
    newTarget as never,
    8,
    6,
    () => newSaves++,
    () => current === newTarget,
  );
  await Promise.resolve();
  expect(frames.size).toBe(1);
  oldFrame();
  flushFrame();
  expect(oldTarget.scrollOffset).toBe(2);
  expect(newTarget.scrollOffset).toBe(6);
  expect(oldTarget.rendered).toBe(0);
  expect(newTarget.rendered).toBe(1);
  expect(oldSaves).toBe(0);
  expect(newSaves).toBe(0);
  cancelOld();
});

test("Select state defers semantic restoration one microtask and suppresses restoration telemetry", async () => {
  const { frames, renderer } = rendererFixture();
  const select = target(0);
  let selected = -1;
  let saves = 0;
  select.setSelectedIndex = (index: number) => {
    selected = index;
    select.emit("selectionChanged");
  };

  const restore = restoreSelectState(
    renderer,
    select as never,
    7,
    3,
    () => saves++,
    () => true,
  );
  expect(selected).toBe(-1);
  await Promise.resolve();
  expect(selected).toBe(7);
  expect(saves).toBe(0);
  expect(frames.size).toBe(1);
  const first = [...frames];
  frames.clear();
  first.forEach((listener) => listener());
  await Promise.resolve();
  expect(select.scrollOffset).toBe(3);
  expect(restore.isApplyingSelection()).toBe(false);
});

test("Select state cancels an obsolete viewport replay when the user selects first", async () => {
  const { frames, renderer } = rendererFixture();
  const select = target(0);
  let saves = 0;
  let selected = -1;
  select.setSelectedIndex = (index: number) => {
    selected = index;
    select.emit("selectionChanged");
  };

  restoreSelectState(
    renderer,
    select as never,
    7,
    3,
    () => saves++,
    () => true,
  );
  await Promise.resolve();
  expect(selected).toBe(7);
  select.setSelectedIndex(9);
  expect(saves).toBe(0);
  expect(frames.size).toBe(0);
  await Promise.resolve();
  expect(saves).toBe(1);
  expect(select.scrollOffset).toBe(0);
});

test("Select state ignores a stale mount before selection or frame replay", async () => {
  const { frames, renderer } = rendererFixture();
  const select = target(0);
  let current = true;
  let selected = -1;
  select.setSelectedIndex = (index: number) => {
    selected = index;
  };

  const restore = restoreSelectState(
    renderer,
    select as never,
    7,
    3,
    () => {},
    () => current,
  );
  current = false;
  await Promise.resolve();
  expect(selected).toBe(-1);
  expect(frames.size).toBe(0);
  restore.cancel();
});
