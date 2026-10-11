import { expect, test } from "bun:test";
import { BoxRenderable, parseColor, Renderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEscape } from "./reader-test-controls";
import { theme } from "../src/ui/theme";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function clickFilterOption(
  setup: Setup,
  id: "skills-filter-dimensions" | "skills-filter-values",
  value: string,
) {
  const select = setup.renderer.root.findDescendantById(id) as SelectRenderable;
  const index = select.options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(select.height).toBeGreaterThan(index);
  await setup.waitForFrame((frame) => frame.includes(select.options[index]!.name));
  const target = Renderable.renderablesByNumber.get(
    setup.renderer.hitTest(select.screenX + 1, select.screenY + index),
  );
  expect(target === select || target?.parent === select).toBe(true);
  await setup.mockMouse.click(select.screenX + 1, select.screenY + index);
  await setup.renderOnce();
}

async function openAllInstalledSkills(setup: Setup) {
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
  await setup.waitFor(() => !!browser);
  await setup.waitFor(() => browser.width > 0 && browser.height > 0);
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}

async function openFilter(setup: Setup) {
  const query = setup.renderer.root.findDescendantById("skills-query")!;
  query.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
  const filter = setup.renderer.root.findDescendantById("open-skills-filter")!;
  filter.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === filter);
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
  await setup.renderOnce();
  const dimensions = setup.renderer.root.findDescendantById("skills-filter-dimensions")!;
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === dimensions);
}

function renderable(setup: Setup, id: string) {
  const value = setup.renderer.root.findDescendantById(id);
  if (!value)
    throw new Error(
      `Missing ${id}; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
    );
  return value!;
}

function findTopNavigation(setup: Setup) {
  return renderable(setup, "top-navigation-tab-global");
}

test("RENDER outside click closes filter and consumes destination click", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openAllInstalledSkills(setup);
    await openFilter(setup);
    const navigation = findTopNavigation(setup);
    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    const underlay = renderable(setup, "skills-filter-underlay") as BoxRenderable;
    expect(underlay.screenX).toBe(0);
    expect(underlay.screenY).toBe(0);
    await setup.waitFor(() => underlay.width === 120 && underlay.height === 40);
    const selection = browser.getSelectedOption()?.value;
    await setup.mockMouse.click(navigation.screenX + 1, navigation.screenY);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("[ Workspace ]");
    expect(browser.getSelectedOption()?.value).toBe(selection);
    await openFilter(setup);
    await clickFilterOption(setup, "skills-filter-dimensions", "Source");
    await setup.renderOnce();
    expect(renderable(setup, "skills-filter-overlay")).toBeDefined();
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
    await openAllInstalledSkills(setup);
    await openFilter(setup);
    const underlay = renderable(setup, "skills-filter-underlay") as BoxRenderable;
    expect(parseColor(underlay.backgroundColor).equals(parseColor("transparent"))).toBe(true);
    const overlay = renderable(setup, "skills-filter-overlay") as BoxRenderable;
    expect(parseColor(overlay.backgroundColor).equals(parseColor(surface))).toBe(true);
  } finally {
    setup.renderer.destroy();
    theme.override(undefined);
  }
});

test("RENDER outside click on Installed surface closes popup without changing selection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openAllInstalledSkills(setup);
    await openFilter(setup);
    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    const overlay = renderable(setup, "skills-filter-overlay");
    const selection = browser.getSelectedOption()?.value;
    expect(browser.screenX).toBeLessThan(overlay.screenX);
    await setup.mockMouse.click(browser.screenX, browser.screenY + 10);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeUndefined();
    expect(browser.getSelectedOption()?.value).toBe(selection);
    await openFilter(setup);
    await clickFilterOption(setup, "skills-filter-dimensions", "Source");
    expect(renderable(setup, "skills-filter-overlay")).toBeDefined();
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
    await openAllInstalledSkills(setup);
    const query = setup.renderer.root.findDescendantById("skills-query")!;
    query.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    const filter = setup.renderer.root.findDescendantById("open-skills-filter")!;
    filter.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === filter);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
    expect(setup.renderer.root.findDescendantById("skills-filter-dimensions")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER plain Tab stays in the open filter after applying a value", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openAllInstalledSkills(setup);
    await openFilter(setup);
    await clickFilterOption(setup, "skills-filter-dimensions", "Collection");
    await setup.renderOnce();
    await clickFilterOption(setup, "skills-filter-values", "");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(renderable(setup, "skills-filter-overlay")).toBeDefined();
    expect(renderable(setup, "skills-filter-values")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));

    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await openReaderFromInspector(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
  } finally {
    setup.renderer.destroy();
  }
});
