import { expect, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createModalControlRegistry } from "../src/modal-controls";

test("mounted modal keyboard ownership survives stale cleanup and releases on close", () => {
  const registry = createModalControlRegistry();
  const event = { name: "left" } as KeyEvent;
  const closeFirst = registry.intercept(() => true);
  const closeSecond = registry.intercept(() => false);
  closeFirst();
  expect(registry.handleKey(event, null)).toBe(false);
  closeSecond();
  expect(registry.handleKey(event, null)).toBe(false);
  const closeThird = registry.intercept(() => true);
  expect(registry.handleKey(event, null)).toBe(true);
  closeThird();
  expect(registry.handleKey(event, null)).toBe(false);
});
