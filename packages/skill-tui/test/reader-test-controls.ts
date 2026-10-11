import { expect } from "bun:test";
import type { testRender } from "@opentui/solid";
import { SelectRenderable, type Renderable } from "@opentui/core";

export type ReaderSetup = Awaited<ReturnType<typeof testRender>>;

export function live(setup: ReaderSetup, id: string) {
  if (id === "reader-tabs") return selectedReaderTabRenderable(setup);
  const target = setup.renderer.root.findDescendantById(id);
  if (!target || target.isDestroyed || !target.parent) throw new Error(`Expected mounted ${id}`);
  return target;
}

const readerTabValues = ["skill", "resources", "details"] as const;

export function selectedReaderTab(setup: ReaderSetup): 0 | 1 | 2 {
  const frame = setup.captureCharFrame();
  const labels = ["SKILL.md", "Resources", "Details"];
  const selected = labels.findIndex((label) => frame.includes(`[ ${label} ]`));
  if (selected < 0) throw new Error("No Reader tab is selected");
  return selected as 0 | 1 | 2;
}

export function readerTabId(index: 0 | 1 | 2) {
  return `reader-tabs-tab-${readerTabValues[index]}`;
}

export function readerTab(setup: ReaderSetup, index: 0 | 1 | 2): Renderable {
  const target = setup.renderer.root.findDescendantById(readerTabId(index));
  if (!target || target.isDestroyed || !target.parent)
    throw new Error(`Expected mounted ${readerTabId(index)}`);
  return target;
}

function selectedReaderTabRenderable(setup: ReaderSetup): Renderable {
  const value = readerTabValues[selectedReaderTab(setup)];
  const target = setup.renderer.root.findDescendantById(`reader-tabs-tab-${value}`);
  if (!target || target.isDestroyed || !target.parent)
    throw new Error(`Expected mounted reader-tabs-tab-${value}`);
  return target;
}

export async function parsedEnter(setup: ReaderSetup) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name !== "enter" && event.name !== "return") return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressEnter();
  });
  await setup.renderOnce();
}

export async function parsedEscape(setup: ReaderSetup) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name !== "escape" && event.name !== "esc") return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

export async function focusLive(setup: ReaderSetup, id: string) {
  const target = live(setup, id);
  target.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === target);
  return target;
}

export async function enterLive(setup: ReaderSetup, id: string) {
  await focusLive(setup, id);
  await parsedEnter(setup);
}

export async function clickLive(setup: ReaderSetup, id: string, x = 1, y = 0) {
  const target = live(setup, id);
  await setup.mockMouse.click(target.screenX + x, target.screenY + y);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  return live(setup, id);
}

export async function openAllInstalledSkills(setup: ReaderSetup) {
  // Workspace now opens on All Skills. Wait for its production browser rather
  // than activating the obsolete wide-layout tab as a setup shortcut.
  await setup.waitFor(() => {
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    return !!browser && !browser.isDestroyed && !!browser.parent;
  });
  await setup.renderOnce();
  return (await focusLive(setup, "installed-skill-browser")) as SelectRenderable;
}

export async function openReaderTab(setup: ReaderSetup, index: 0 | 1 | 2) {
  const current = selectedReaderTab(setup);
  expect(Math.abs(index - current)).toBeLessThanOrEqual(2);
  for (let next: number = current; next !== index;) {
    const targetIndex = next + (index > next ? 1 : -1);
    const active = selectedReaderTabRenderable(setup);
    await focusLive(setup, active.id);
    setup.mockInput.pressKey(index > next ? "ARROW_RIGHT" : "ARROW_LEFT");
    const expectedId = readerTabId(targetIndex as 0 | 1 | 2);
    await setup.waitFor(() => {
      const trigger = setup.renderer.root.findDescendantById(expectedId);
      return (
        !!trigger &&
        selectedReaderTab(setup) === targetIndex &&
        setup.renderer.currentFocusedRenderable === trigger
      );
    });
    next = targetIndex;
  }
}

export async function enterInstalledAddress(
  setup: ReaderSetup,
  address: { readonly source: string; readonly path: string },
) {
  let browser = live(setup, "installed-skill-browser") as SelectRenderable;
  const value = JSON.stringify([address.source, address.path]);
  const index = browser.options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  const current = browser.getSelectedIndex();
  expect(Math.abs(index - current)).toBeLessThanOrEqual(browser.options.length);
  await focusLive(setup, "installed-skill-browser");
  const direction = index >= current ? "down" : "up";
  for (let step = 0; step < Math.abs(index - current); step++) {
    setup.mockInput.pressKey(direction === "down" ? "ARROW_DOWN" : "ARROW_UP");
    await setup.waitFor(() => {
      const next = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        next instanceof SelectRenderable &&
        next.getSelectedIndex() === current + (step + 1) * (direction === "down" ? 1 : -1)
      );
    });
    browser = live(setup, "installed-skill-browser") as SelectRenderable;
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
  }
  await setup.waitFor(() => browser.getSelectedOption()?.value === value);
  await focusLive(setup, "installed-skill-browser");
  await parsedEnter(setup);
}

export async function enterReaderDetailsAction(setup: ReaderSetup, actionId: string) {
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("reader-details") &&
      !!setup.renderer.root.findDescendantById(`reader-details-action-${actionId}`),
  );
  await enterLive(setup, `reader-details-action-${actionId}`);
}

export async function enterReaderDetailsRelationship(setup: ReaderSetup, value: string) {
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("reader-details") &&
      !!setup.renderer.root.findDescendantById(`reader-details-relationship-${value}`),
  );
  await enterLive(setup, `reader-details-relationship-${value}`);
}
