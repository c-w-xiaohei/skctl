import { expect } from "bun:test";
import type { testRender } from "@opentui/solid";
import {
  CodeRenderable,
  SelectRenderable,
  type BaseRenderable,
  type Renderable,
} from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { openMainPage } from "./main-page-controls";

export type ReaderSetup = Awaited<ReturnType<typeof testRender>>;

export function readerPublicDiagnostic(setup: ReaderSetup) {
  const ids = (node: Renderable): string[] => [
    ...(node.id ? [node.id] : []),
    ...node
      .getChildren()
      .flatMap((child) => ("getChildren" in child ? ids(child as Renderable) : [])),
  ];
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
  return JSON.stringify({
    frame: setup.captureCharFrame(),
    focused: setup.renderer.currentFocusedRenderable?.id,
    readerTabIds: ["skill", "resources", "details"].map((value) => ({
      id: `reader-tabs-tab-${value}`,
      mounted: !!setup.renderer.root.findDescendantById(`reader-tabs-tab-${value}`),
    })),
    readerControls: ids(setup.renderer.root).filter(
      (id) => id.startsWith("reader-") || id === "resource-browser",
    ),
    browser:
      browser instanceof SelectRenderable
        ? { selectedOption: browser.getSelectedOption()?.value }
        : undefined,
  });
}

export function live(setup: ReaderSetup, id: string) {
  if (id === "reader-tabs") return selectedReaderTabRenderable(setup);
  const target = setup.renderer.root.findDescendantById(id);
  if (!target || target.isDestroyed || !target.parent) throw new Error(`Expected mounted ${id}`);
  return target;
}

const readerTabValues = ["skill", "resources", "details"] as const;

export function selectedReaderTab(setup: ReaderSetup): 0 | 1 | 2 {
  const selected = readerTabValues.findIndex((value) => {
    const tab = setup.renderer.root.findDescendantById(`reader-tabs-tab-${value}`);
    return tab instanceof TabsTabRenderable && tab.getState().selected;
  });
  if (selected < 0) throw new Error(`No Reader tab is selected\n${readerPublicDiagnostic(setup)}`);
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

/** The compact Back exposes its full owned command in the focus-aware footer. */
export async function expectSharedReturn(setup: ReaderSetup, verb: string) {
  const origin = setup.renderer.currentFocusedRenderable;
  await focusLive(setup, "route-back");
  await setup.waitForFrame((frame) => frame.includes(verb));
  expect(setup.captureCharFrame()).toContain(verb);
  if (origin && !origin.isDestroyed && origin.parent) {
    origin.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === origin);
  }
}

/** Native Markdown highlighting settles independently of the installed-content read. */
export async function waitForReaderBody(setup: ReaderSetup, text: string, visible = true) {
  const descendants = (node: BaseRenderable): BaseRenderable[] => [
    node,
    ...node.getChildren().flatMap(descendants),
  ];
  await setup.waitFor(() =>
    descendants(setup.renderer.root).some(
      (node) => node instanceof CodeRenderable && node.plainText.includes(text),
    ),
  );
  for (const node of descendants(setup.renderer.root))
    if (node instanceof CodeRenderable) await node.highlightingDone;
  await setup.flush();
  if (visible) {
    if (!setup.captureCharFrame().includes(text))
      console.error(
        "Reader native body geometry",
        descendants(setup.renderer.root)
          .filter((node): node is CodeRenderable => node instanceof CodeRenderable)
          .map((node) => ({
            id: node.id,
            width: node.width,
            height: node.height,
            y: node.screenY,
            text: node.plainText,
          })),
      );
    expect(setup.captureCharFrame()).toContain(text);
  }
}

export async function clickLive(setup: ReaderSetup, id: string, x = 1, y = 0) {
  const target = live(setup, id);
  await setup.mockMouse.click(target.screenX + x, target.screenY + y);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  return live(setup, id);
}

export async function openAllInstalledSkills(setup: ReaderSetup) {
  const installedTab = () =>
    setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills");
  const installedSelected = () => {
    const tab = installedTab();
    return tab instanceof TabsTabRenderable && tab.getState().selected;
  };
  if (!installedSelected()) {
    if (!installedTab()) await openMainPage(setup, "skills");
    await setup.waitFor(() => !!installedTab());
    if (!installedSelected()) {
      const tab = installedTab()!;
      expect(tab.visible && tab.width > 0 && tab.height > 0).toBe(true);
      await setup.mockMouse.click(tab.screenX + 1, tab.screenY);
      await setup.waitFor(installedSelected);
    }
  }
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
  await openReaderSettings(setup);
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("reader-details") &&
      !!setup.renderer.root.findDescendantById(`reader-details-action-${actionId}`),
  );
  await enterLive(setup, `reader-details-action-${actionId}`);
}

export async function openReaderSettings(setup: ReaderSetup) {
  if (selectedReaderTab(setup) !== 2) await openReaderTab(setup, 2);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("reader-details-action-skill-uninstall"),
  );
}

export async function enterReaderDetailsRelationship(setup: ReaderSetup, value: string) {
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("reader-details") &&
      !!setup.renderer.root.findDescendantById(`reader-details-relationship-${value}`),
  );
  await enterLive(setup, `reader-details-relationship-${value}`);
}
