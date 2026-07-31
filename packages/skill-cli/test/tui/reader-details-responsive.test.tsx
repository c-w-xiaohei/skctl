import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable, TabSelectRenderable } from "@opentui/core";
import { TabsRootRenderable } from "@tuiparts/core/tabs";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

function selectedSkillIs(setup: Setup, value: string) {
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
  return browser instanceof SelectRenderable && browser.getSelectedOption()?.value === value;
}

function detailsAreReady(setup: Setup, skill: string) {
  const tabs = setup.renderer.root.findDescendantById("reader-tabs");
  return (
    selectedSkillIs(setup, skill) &&
    tabs instanceof TabSelectRenderable &&
    tabs.getSelectedIndex() === 2 &&
    !!setup.renderer.root.findDescendantById("reader-details") &&
    setup.captureCharFrame().includes(`Address  ${skill}`)
  );
}

async function openDetails(setup: Setup, skill: string) {
  await setup.waitFor(
    () =>
      selectedSkillIs(setup, skill) &&
      setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.waitFor(
    () =>
      selectedSkillIs(setup, skill) &&
      readerTabs(setup).getSelectedIndex() === 1 &&
      !!setup.renderer.root.findDescendantById("resource-browser"),
  );
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.waitFor(() => detailsAreReady(setup, skill));
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(
    () =>
      detailsAreReady(setup, skill) &&
      setup.renderer.currentFocusedRenderable ===
        setup.renderer.root.findDescendantById("reader-details"),
  );
}

async function awaitParsedEscape(setup: Setup) {
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

function readerTabs(setup: Setup) {
  const tabs = setup.renderer.root.findDescendantById("reader-tabs");
  expect(tabs).toBeInstanceOf(TabSelectRenderable);
  return tabs as TabSelectRenderable;
}

function topNavigation(setup: Setup) {
  const tab = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
  expect(tab).toBeDefined();
  let ancestor = tab!.parent;
  while (ancestor && !(ancestor instanceof TabsRootRenderable)) {
    ancestor = ancestor.parent;
  }
  expect(ancestor).toBeDefined();
  return ancestor as TabsRootRenderable;
}

test("RENDER Details Tab traversal never retains an unmounted relationship focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetails(setup, "team-main/guide");
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
  const loads: string[] = [];
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
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return {
              value:
                request.address.path === readerSecondAddress.path
                  ? readerSecondContent
                  : readerContent,
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    await setup.waitForFrame((frame) => frame.includes("const needle = true;"));
    await setup.waitFor(() => selectedSkillIs(setup, "team-main/guide") && loads.includes("guide"));
    await openDetails(setup, "team-main/guide");
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
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () =>
        selectedSkillIs(setup, "team-main/reference") &&
        loads.includes("reference") &&
        readerTabs(setup).getSelectedIndex() === 0 &&
        !setup.renderer.root.findDescendantById("reader-details") &&
        setup.captureCharFrame().includes("other needle"),
    );
    await openDetails(setup, "team-main/reference");
    await setup.waitFor(() => detailsAreReady(setup, "team-main/reference"));
    expect(setup.captureCharFrame()).toContain("Address  team-main/reference");
    const bDetails = setup.renderer.root.findDescendantById(
      "reader-details",
    ) as ScrollBoxRenderable;
    bDetails.scrollTop = 3;
    await setup.mockMouse.scroll(bDetails.screenX, bDetails.screenY, "down");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    expect(applied).toContain(3);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () =>
        selectedSkillIs(setup, "team-main/guide") &&
        loads.filter((path) => path === "guide").length === 2 &&
        detailsAreReady(setup, "team-main/guide"),
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () =>
        detailsAreReady(setup, "team-main/guide") &&
        setup.renderer.currentFocusedRenderable ===
          setup.renderer.root.findDescendantById("reader-details-actions"),
    );
    expect(setup.captureCharFrame()).toContain("Address  team-main/guide");
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-actions");
    expect(setup.renderer.currentFocusedRenderable).toBe(
      setup.renderer.root.findDescendantById("reader-details-actions")!,
    );
    expect(applied).toContain(7);

    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(
      () =>
        topNavigation(setup).value === "global" &&
        setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-global",
    );
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(
      () =>
        topNavigation(setup).value === "project" &&
        setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-project",
    );
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.waitFor(
      () =>
        topNavigation(setup).value === "global" &&
        setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-global",
    );
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.waitFor(
      () =>
        topNavigation(setup).value === "workspace" &&
        setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace" &&
        detailsAreReady(setup, "team-main/guide"),
    );
    expect(setup.captureCharFrame()).toContain("Address  team-main/guide");
    expect(readerTabs(setup).getSelectedIndex()).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-workspace");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () =>
        detailsAreReady(setup, "team-main/guide") &&
        setup.renderer.currentFocusedRenderable ===
          setup.renderer.root.findDescendantById("reader-details-actions"),
    );

    for (const [width, height] of [
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.waitFor(
        () =>
          selectedSkillIs(setup, "team-main/guide") &&
          !setup.renderer.root.findDescendantById("reader-details") &&
          setup.renderer.currentFocusedRenderable ===
            setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
    }
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeUndefined();

    for (const width of [80, 120] as const) {
      setup.resize(width, 40);
      await setup.waitFor(
        () =>
          detailsAreReady(setup, "team-main/guide") &&
          (setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable)
            .scrollTop === 7 &&
          setup.renderer.currentFocusedRenderable ===
            setup.renderer.root.findDescendantById("reader-details-actions"),
      );
    }
  } finally {
    setup.renderer.destroy();
    Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", scrollTop);
  }
});
