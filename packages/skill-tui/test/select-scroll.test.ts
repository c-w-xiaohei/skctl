import { expect, test } from "bun:test";
import { restoreSelectScroll, restoreSelectState, selectScrollOffset } from "../src/select-scroll";

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
      listeners.set(event, listener);
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
  };
};

test("Select scroll adapter clamps on FRAME and rejects an incompatible runtime", async () => {
  const listeners = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      listeners.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      listeners.delete(listener);
    },
    requestRender() {},
  };
  const select = target(0);
  restoreSelectScroll(renderer, select as never, 99);
  await Promise.resolve();
  expect(listeners.size).toBe(1);
  [...listeners].forEach((listener) => listener());
  await Promise.resolve();
  expect(select.scrollOffset).toBe(15);
  expect(select.rendered).toBe(1);
  expect(() => selectScrollOffset({} as never)).toThrow("scrollOffset is unavailable");
});

test("Select scroll adapter ignores a FRAME callback after its target unmounts", async () => {
  const listeners = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      listeners.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      listeners.delete(listener);
    },
    requestRender() {},
  };
  const select = target(0);
  restoreSelectScroll(renderer, select as never, 4);
  await Promise.resolve();
  select.parent = undefined;
  [...listeners].forEach((listener) => listener());
  await Promise.resolve();
  expect(select.scrollOffset).toBe(0);
  expect(select.rendered).toBe(0);
});

test("Select scroll adapter leaves no listener for zero offset or destroyed target", async () => {
  const listeners = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      listeners.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      listeners.delete(listener);
    },
    requestRender() {},
  };
  const zero = target(0);
  restoreSelectScroll(renderer, zero as never, 0);
  await Promise.resolve();
  expect(listeners.size).toBe(0);

  const select = target(0);
  restoreSelectScroll(renderer, select as never, 4);
  await Promise.resolve();
  expect(listeners.size).toBe(1);
  select.emit("destroyed");
  expect(listeners.size).toBe(0);
});

test("Select scroll adapter only restores the current target after replacement", async () => {
  const listeners = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      listeners.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      listeners.delete(listener);
    },
    requestRender() {},
  };
  const select = target(0);
  restoreSelectScroll(renderer, select as never, 2);
  restoreSelectScroll(renderer, select as never, 7);
  await Promise.resolve();
  expect(listeners.size).toBe(1);
  [...listeners].forEach((listener) => listener());
  await Promise.resolve();
  expect(select.scrollOffset).toBe(7);
});

test("Select state defers semantic restoration one microtask and suppresses restoration telemetry", async () => {
  const frames = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      frames.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      frames.delete(listener);
    },
    requestRender() {},
  };
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
  const frames = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      frames.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      frames.delete(listener);
    },
    requestRender() {},
  };
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
  const frames = new Set<Listener>();
  const renderer = {
    once(_event: "frame", listener: Listener) {
      frames.add(listener);
    },
    off(_event: "frame", listener: Listener) {
      frames.delete(listener);
    },
    requestRender() {},
  };
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
