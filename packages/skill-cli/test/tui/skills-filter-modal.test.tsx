import { expect, test } from "bun:test";
import { BoxRenderable, InputRenderable, parseColor, SelectRenderable } from "@opentui/core";
import { TabsRootRenderable } from "@tuiparts/core/tabs";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { theme } from "../../src/tui/ui/theme";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function openFilter(setup: Setup) {
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  setup.mockInput.pressKey("/");
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-skills-filter");
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
}

function renderable(setup: Setup, id: string) {
  const value = setup.renderer.root.findDescendantById(id);
  expect(value).toBeDefined();
  return value!;
}

function findTopNavigation(setup: Setup) {
  const tab = renderable(setup, "top-navigation-tab-workspace");
  let ancestor = tab.parent;
  while (ancestor && !(ancestor instanceof TabsRootRenderable)) {
    ancestor = ancestor.parent;
  }
  expect(ancestor).toBeDefined();
  return ancestor as TabsRootRenderable;
}

test("RENDER filter underlay blocks a background destination without stealing filter focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    const navigation = findTopNavigation(setup);
    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    const input = renderable(setup, "skills-filter-search") as InputRenderable;
    const stage = renderable(setup, "skills-filter-dimensions");
    const underlay = renderable(setup, "skills-filter-underlay") as BoxRenderable;

    expect(underlay.screenX).toBe(0);
    expect(underlay.screenY).toBe(0);
    expect(underlay.width).toBe(120);
    expect(underlay.height).toBe(40);
    const destination = navigation.value;
    const selection = browser.getSelectedOption()?.value;
    await setup.mockMouse.click(navigation.screenX + 20, navigation.screenY);
    await setup.renderOnce();

    expect(renderable(setup, "skills-filter-overlay")).toBeDefined();
    expect(navigation.value).toBe(destination);
    expect(browser.getSelectedOption()?.value).toBe(selection);
    expect(renderable(setup, "skills-filter-dimensions")).toBe(stage);
    expect(setup.renderer.currentFocusedRenderable).toBe(input);

    const row = renderable(setup, "skills-filter-dimension-Collection");
    await setup.mockMouse.click(row.screenX + 1, row.screenY);
    await setup.renderOnce();
    expect(renderable(setup, "skills-filter-values")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER filter underlay follows the active surface theme token", async () => {
  const surface = "#123456";
  theme.override({ colors: { surface } });
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    const underlay = renderable(setup, "skills-filter-underlay") as BoxRenderable;
    expect(parseColor(underlay.backgroundColor).equals(parseColor(surface))).toBe(true);
  } finally {
    setup.renderer.destroy();
    theme.override(undefined);
  }
});

test("RENDER filter underlay blocks background Installed rows while filter rows remain clickable", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    const input = renderable(setup, "skills-filter-search") as InputRenderable;
    const stage = renderable(setup, "skills-filter-dimensions");
    const overlay = renderable(setup, "skills-filter-overlay");
    const selection = browser.getSelectedOption()?.value;

    expect(browser.screenX).not.toBe(overlay.screenX);
    await setup.mockMouse.click(browser.screenX, browser.screenY + 1);
    await setup.renderOnce();

    expect(renderable(setup, "skills-filter-overlay")).toBeDefined();
    expect(browser.getSelectedOption()?.value).toBe(selection);
    expect(renderable(setup, "skills-filter-dimensions")).toBe(stage);
    expect(setup.renderer.currentFocusedRenderable).toBe(input);

    const row = renderable(setup, "skills-filter-dimension-Source");
    await setup.mockMouse.click(row.screenX + 1, row.screenY);
    await setup.renderOnce();
    expect(renderable(setup, "skills-filter-values")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER query shortcut reaches the Skills filter trigger and Enter opens its modal", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-skills-filter");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER applied Skills filter focus yields to same-turn navigation", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    const dimension = renderable(setup, "skills-filter-dimension-Collection");
    await setup.mockMouse.click(dimension.screenX + 1, dimension.screenY);
    await setup.renderOnce();
    const value = renderable(setup, "skills-filter-value-Collection-any");
    await setup.mockMouse.click(value.screenX + 1, value.screenY);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs");
  } finally {
    setup.renderer.destroy();
  }
});
