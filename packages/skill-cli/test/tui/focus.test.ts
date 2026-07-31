import { expect, test } from "bun:test";
import type { FocusTarget } from "../../src/tui/focus";
import { createFocus, createFocusRegistry } from "../../src/tui/focus";

test("desired focus is owned independently of mounted registry bindings", () => {
  const focus = createFocus("browser");
  expect(focus.desired()).toBe("browser");
  focus.request("reader");
  expect(focus.desired()).toBe("reader");
  expect(focus.apply()).toBe(false);
  const target = stub();
  focus.registry.register("reader", target);
  expect(focus.apply()).toBe(true);
  expect(target.calls).toBe(1);
  focus.clear();
  expect(focus.desired()).toBeUndefined();
});

const stub = (): FocusTarget & { readonly calls: number } => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    focus() {
      calls += 1;
    },
  };
};

test("register makes an owner resolvable and applyFocus focuses exactly once", () => {
  const registry = createFocusRegistry();
  const target = stub();
  registry.register("browser", target);
  expect(registry.target("browser")).toBe(target);
  expect(registry.applyFocus("browser")).toBe(true);
  expect(target.calls).toBe(1);
});

test("applyFocus on an unregistered owner is a no-op", () => {
  const registry = createFocusRegistry();
  expect(registry.applyFocus("reader")).toBe(false);
  expect(registry.target("reader")).toBeUndefined();
});

test("unregister removes the binding so no stale ref can be focused", () => {
  const registry = createFocusRegistry();
  const target = stub();
  const unregister = registry.register("reader-tabs", target);
  unregister();
  expect(registry.target("reader-tabs")).toBeUndefined();
  expect(registry.applyFocus("reader-tabs")).toBe(false);
  expect(target.calls).toBe(0);
});

test("re-register replaces the binding and the stale target is never focused again", () => {
  const registry = createFocusRegistry();
  const stale = stub();
  const fresh = stub();
  registry.register("reader", stale);
  registry.register("reader", fresh);
  expect(registry.applyFocus("reader")).toBe(true);
  expect(stale.calls).toBe(0);
  expect(fresh.calls).toBe(1);
});

test("a stale unmount disposer cannot remove a newer registration", () => {
  const registry = createFocusRegistry();
  const stale = stub();
  const fresh = stub();
  const unregisterStale = registry.register("reader", stale);
  registry.register("reader", fresh);
  unregisterStale();
  expect(registry.target("reader")).toBe(fresh);
  expect(registry.applyFocus("reader")).toBe(true);
  expect(fresh.calls).toBe(1);
});

test("same-turn A to B replacement retains only the live browser target", () => {
  const registry = createFocusRegistry();
  const stale = stub();
  const live = stub();
  const unregisterA = registry.register("browser", stale);
  const unregisterB = registry.register("browser", live);
  unregisterA();

  expect(registry.target("browser")).toBe(live);
  expect(registry.applyFocus("browser")).toBe(true);
  expect(stale.calls).toBe(0);
  expect(live.calls).toBe(1);
  unregisterB();
});

test("register and unregister bump the version and notify listeners", () => {
  const registry = createFocusRegistry();
  const seen: number[] = [];
  const unsubscribe = registry.subscribe((version) => seen.push(version));
  const unregister = registry.register("browser", stub());
  registry.register("reader", stub());
  unregister();
  expect(registry.version()).toBe(3);
  expect(seen).toEqual([1, 2, 3]);
  unsubscribe();
  registry.register("inspector", stub());
  expect(seen).toEqual([1, 2, 3]);
});

test("late mount replay: a pending owner focuses once it registers", () => {
  const registry = createFocusRegistry();
  let pending: "reader" | undefined = "reader";
  let applied = 0;
  const tryApply = () => {
    if (pending && registry.applyFocus(pending)) {
      applied += 1;
      pending = undefined;
    }
  };
  registry.subscribe(tryApply);
  tryApply();
  expect(applied).toBe(0);
  const target = stub();
  registry.register("reader", target);
  expect(applied).toBe(1);
  expect(target.calls).toBe(1);
  registry.register("browser", stub());
  expect(target.calls).toBe(1);
});

test("exactly-once application: repeated applyFocus calls are explicit consumer choices", () => {
  const registry = createFocusRegistry();
  const target = stub();
  registry.register("browser", target);
  registry.applyFocus("browser");
  registry.applyFocus("browser");
  expect(target.calls).toBe(2);
});
