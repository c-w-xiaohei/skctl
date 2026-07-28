import { expect, test } from "bun:test";
import { type BaseRenderable, ScrollBoxRenderable, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

async function openDetails(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  await Promise.resolve();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-tabs"));
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.renderOnce();
  setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.renderOnce();
  setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
}

async function awaitParsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
}

function readerTabs(setup: Awaited<ReturnType<typeof testRender>>) {
  const tabs = setup.renderer.root.findDescendantById("reader-tabs");
  expect(tabs).toBeInstanceOf(TabSelectRenderable);
  return tabs as TabSelectRenderable;
}

function topNavigation(setup: Awaited<ReturnType<typeof testRender>>) {
  const visit = (node: BaseRenderable): TabSelectRenderable | undefined => {
    if (
      node instanceof TabSelectRenderable &&
      node.options.some((option) => option.value === "workspace")
    )
      return node;
    for (const child of node.getChildren()) {
      const result = visit(child);
      if (result) return result;
    }
  };
  const navigation = visit(setup.renderer.root);
  expect(navigation).toBeDefined();
  return navigation!;
}

test("RENDER Details Tab traversal never retains an unmounted relationship focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details");

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-actions");

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-relationships");

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    expect(setup.renderer.currentFocusedRenderable).toBe(
      setup.renderer.root.findDescendantById("installed-skill-browser")!,
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details retains per-Skill scroll, native tab, mounted focus, destinations, and responsive levels", async () => {
  const scrollTop = Object.getOwnPropertyDescriptor(ScrollBoxRenderable.prototype, "scrollTop")!;
  const applied: number[] = [];
  const positions = new WeakMap<ScrollBoxRenderable, number>();
  Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", {
    configurable: true,
    get() {
      return this.id === "reader-details"
        ? (positions.get(this) ?? scrollTop.get!.call(this))
        : scrollTop.get!.call(this);
    },
    set(value: number) {
      if (this.id === "reader-details") {
        positions.set(this, value);
        applied.push(value);
      }
      scrollTop.set!.call(this, value);
    },
  });
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup);
    const aDetails = setup.renderer.root.findDescendantById(
      "reader-details",
    ) as ScrollBoxRenderable;
    aDetails.scrollTop = 7;
    setup.mockInput.pressKey("PAGEDOWN");
    await Promise.resolve();
    await setup.mockMouse.scroll(aDetails.screenX, aDetails.screenY, "down");
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    const aActions = setup.renderer.root.findDescendantById("reader-details-actions")!;
    expect(aDetails.screenX + aDetails.width).toBeLessThanOrEqual(120);
    expect(aActions.screenX + aActions.width).toBeLessThanOrEqual(120);
    expect(setup.renderer.currentFocusedRenderable).toBe(aActions);
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await openDetails(setup);
    expect(setup.captureCharFrame()).toContain("Address  team-main/reference");
    const bDetails = setup.renderer.root.findDescendantById(
      "reader-details",
    ) as ScrollBoxRenderable;
    bDetails.scrollTop = 3;
    await setup.mockMouse.scroll(bDetails.screenX, bDetails.screenY, "down");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-actions");
    expect(applied).toContain(3);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("ARROW_UP");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Address  team-main/guide");
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-actions");
    expect(setup.renderer.currentFocusedRenderable).toBe(
      setup.renderer.root.findDescendantById("reader-details-actions")!,
    );
    expect(applied).toContain(7);

    topNavigation(setup).focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
    topNavigation(setup).focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expect(topNavigation(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
    topNavigation(setup).focus();
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
    topNavigation(setup).focus();
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Address  team-main/guide");
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-actions");

    for (const [width, height] of [
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.renderOnce();
      expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
      expect(setup.renderer.currentFocusedRenderable).toBe(
        setup.renderer.root.findDescendantById("reader-details-actions")!,
      );
    }
    expect(
      (setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable).scrollTop,
    ).toBe(7);
    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeUndefined();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-actions");

    setup.resize(120, 40);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeDefined();
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable).toBe(
      setup.renderer.root.findDescendantById("reader-details-actions")!,
    );
  } finally {
    setup.renderer.destroy();
    Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", scrollTop);
  }
});
