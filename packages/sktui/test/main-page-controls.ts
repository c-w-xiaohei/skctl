import { expect } from "bun:test";
import { SelectRenderable, type Renderable } from "@opentui/core";
import type { testRender } from "@opentui/solid";
import type { MainPage } from "../src/types";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function parsedEnter(setup: Setup) {
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

/** Navigate through the mounted, visible main-page control at the current width. */
export async function openMainPage(setup: Setup, page: MainPage): Promise<void> {
  await setup.waitFor(() => {
    const chooser = setup.renderer.root.findDescendantById("shell-pages-select");
    const tab = setup.renderer.root.findDescendantById(`shell-section-tab-${page}`);
    return !!chooser || !!tab;
  });
  const click = async (target: Renderable) => {
    expect(target.visible && !target.isDestroyed && !!target.parent).toBe(true);
    expect(target.width).toBeGreaterThan(0);
    expect(target.height).toBeGreaterThan(0);
    expect(target.screenX).toBeGreaterThanOrEqual(0);
    expect(target.screenX + target.width).toBeLessThanOrEqual(setup.renderer.width);
    await setup.mockMouse.click(target.screenX + 1, target.screenY);
    await setup.flush();
  };
  const chooser = setup.renderer.root.findDescendantById("shell-pages-select");
  if (chooser) {
    await click(chooser);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-choices",
    );
    const choices = setup.renderer.currentFocusedRenderable;
    expect(choices).toBeInstanceOf(SelectRenderable);
    const list = choices as SelectRenderable;
    const index = list.options.findIndex((option) => option.value === page);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let current = list.getSelectedIndex(); current !== index;) {
      const direction = current < index ? "down" : "up";
      setup.mockInput.pressArrow(direction);
      current += direction === "down" ? 1 : -1;
      await setup.waitFor(() => list.getSelectedIndex() === current);
    }
    await parsedEnter(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("shell-pages-choices"));
    return;
  }
  const tab = setup.renderer.root.findDescendantById(`shell-section-tab-${page}`);
  if (!tab) throw new Error(`Main page ${page} is not visible`);
  await click(tab);
}
