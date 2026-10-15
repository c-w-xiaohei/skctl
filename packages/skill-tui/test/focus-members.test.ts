import { expect, test } from "bun:test";
import { createFocusRegistry, type FocusTarget } from "../src/focus";
import type { NavKey } from "../src/navigation";

const enter: NavKey = { name: "enter", ctrl: false, shift: false, alt: false };
const target = () => ({
  calls: 0,
  focus() {
    this.calls++;
  },
});

test("members keep one canonical focus target and inherit only their origin mode", () => {
  const registry = createFocusRegistry();
  const root = target();
  const child = target();
  registry.register("browser", root);
  registry.registerMember("browser", child, root);
  let calls = 0;
  registry.registerModeHandler(root, () => {
    calls++;
    return "consumed";
  });

  expect(registry.target("browser")).toBe(root);
  expect(registry.ownerOf(child)).toBe("browser");
  expect(registry.applyFocus("browser")).toBe(true);
  expect(root.calls).toBe(1);
  expect(child.calls).toBe(0);
  expect(registry.dispatchMode(child, enter)).toBe("consumed");
  expect(calls).toBe(1);
  expect(registry.dispatchMode(child, { ...enter, ctrl: true })).toBe("declined");
  expect(calls).toBe(1);
});

test("an explicit member handler wins but dies with its root generation", () => {
  const registry = createFocusRegistry();
  const root = target();
  const child = target();
  registry.register("browser", root);
  registry.registerMember("browser", child, root);
  registry.registerModeHandler(root, () => "consumed");
  let calls = 0;
  registry.registerModeHandler(child, () => {
    calls++;
    return "consumed";
  });
  expect(registry.dispatchMode(child, enter)).toBe("consumed");
  expect(calls).toBe(1);

  // Even the same root object is a new registration generation.
  registry.register("browser", root);
  expect(registry.ownerOf(child)).toBeUndefined();
  expect(registry.dispatchMode(child, enter)).toBe("declined");
  expect(calls).toBe(1);
  registry.registerMember("browser", child, root);
  // A fresh alias inherits the root, but cannot revive a previous member handler.
  expect(registry.dispatchMode(child, enter)).toBe("consumed");
  expect(calls).toBe(1);
});

test("root disposal invalidates ownership and explicit and inherited member handlers", () => {
  const registry = createFocusRegistry();
  const root = target();
  const explicit = target();
  const inherited = target();
  const release = registry.register("browser", root);
  registry.registerMember("browser", explicit, root);
  registry.registerMember("browser", inherited, root);
  registry.registerModeHandler(root, () => "consumed");
  registry.registerModeHandler(explicit, () => "consumed");
  release();
  for (const child of [explicit, inherited]) {
    expect(registry.ownerOf(child)).toBeUndefined();
    expect(registry.dispatchMode(child, enter)).toBe("declined");
  }
});

test("member registration requires the explicit live origin and cleanup is token-safe", () => {
  const registry = createFocusRegistry();
  const root = target();
  const other = target();
  const child = target();
  registry.register("browser", root);
  registry.registerMember("browser", child, other);
  expect(registry.ownerOf(child)).toBeUndefined();
  const stale = registry.registerMember("browser", child, root);
  const fresh = registry.registerMember("browser", child, root);
  stale();
  expect(registry.ownerOf(child)).toBe("browser");
  registry.registerModeHandler(child, () => "consumed");
  fresh();
  expect(registry.ownerOf(child)).toBeUndefined();
  expect(registry.dispatchMode(child, enter)).toBe("declined");
  expect(registry.target("browser")).toBe(root);
});

test("old members do not acquire a replacement root's mode", () => {
  const registry = createFocusRegistry();
  const root = target();
  const next = target();
  const child = target();
  const releaseRoot = registry.register("browser", root);
  const releaseChild = registry.registerMember("browser", child, root);
  registry.register("browser", next);
  registry.registerModeHandler(next, () => "consumed");
  releaseRoot();
  expect(registry.dispatchMode(child, enter)).toBe("declined");
  registry.registerMember("browser", child, next);
  releaseChild();
  expect(registry.ownerOf(child)).toBe("browser");
  expect(registry.dispatchMode(child, enter)).toBe("consumed");
  expect(registry.target("browser")).toBe(next);
});

test("destroyed physical members or origins cannot own a mode", () => {
  const registry = createFocusRegistry();
  const root = { ...target(), isDestroyed: false };
  const child = { ...target(), isDestroyed: false };
  registry.register("browser", root);
  registry.registerMember("browser", child, root);
  registry.registerModeHandler(child, () => "consumed");
  child.isDestroyed = true;
  expect(registry.ownerOf(child)).toBeUndefined();
  expect(registry.dispatchMode(child, enter)).toBe("declined");
  child.isDestroyed = false;
  root.isDestroyed = true;
  expect(registry.ownerOf(child)).toBeUndefined();
  expect(registry.dispatchMode(child, enter)).toBe("declined");
});

test("ordinary exact mode handlers remain independent of member registration", () => {
  const registry = createFocusRegistry();
  const input: FocusTarget = target();
  const release = registry.registerModeHandler(input, () => "consumed");
  expect(registry.dispatchMode(input, enter)).toBe("consumed");
  release();
  expect(registry.dispatchMode(input, enter)).toBe("declined");
});
