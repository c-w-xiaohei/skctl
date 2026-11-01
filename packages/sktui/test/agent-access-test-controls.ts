import { expect } from "bun:test";
import {
  BoxRenderable,
  CodeRenderable,
  ScrollBoxRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { live } from "./reader-test-controls";
import { openMainPage } from "./main-page-controls";

export type Setup = Awaited<ReturnType<typeof testRender>>;

export async function openAgentAccess(setup: Setup) {
  if (!setup.renderer.root.findDescendantById("current-exposure-browser")) {
    await openMainPage(setup, "agent");
  }
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
  await setup.flush();
  const tree = live(setup, "current-exposure-browser");
  expect(tree).toBeInstanceOf(ScrollBoxRenderable);
  return tree as ScrollBoxRenderable;
}

export const rowId = (key: string) => `current-exposure-browser-row-${encodeURIComponent(key)}`;
export const selected = (setup: Setup, key: string) =>
  (live(setup, rowId(key)) as BoxRenderable).backgroundColor.a > 0;

export async function press(setup: Setup, key: string) {
  await new Promise<void>((resolve) => {
    const observed = () => {
      setup.renderer.keyInput.off("keypress", observed);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", observed);
    setup.mockInput.pressKey(key);
  });
  await setup.flush();
}

export async function settleHighlighting(node: BaseRenderable): Promise<void> {
  if (node instanceof CodeRenderable) await node.highlightingDone;
  for (const child of node.getChildren()) await settleHighlighting(child);
}

export async function waitForBody(setup: Setup, text: string) {
  const contains = (node: BaseRenderable): boolean =>
    (node instanceof CodeRenderable && node.plainText.includes(text)) ||
    node.getChildren().some(contains);
  await setup.waitFor(() => contains(setup.renderer.root));
  await setup.renderOnce();
  await settleHighlighting(setup.renderer.root);
  await setup.flush();
  expect(setup.captureCharFrame()).toContain(text);
}
