import { expect, test } from "bun:test";
import { BoxRenderable, InputRenderable, parseColor, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
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
  select.focus();
  select.setSelectedIndex(index);
  await setup.renderOnce();
  await parsedEnter(setup);
  if (id === "skills-filter-dimensions") {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-values",
    );
  }
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
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-dimensions",
  );
  // Focus is assigned on mount, before native layout and its pointer hit grid.
  // Outside clicks exercise the displayed popup, not the preceding page frame.
  await setup.renderOnce();
  await setup.waitForFrame((frame) => frame.includes("Filter Skills"));
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
  return renderable(setup, "shell-section-tab-settings");
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
    const selection = browser.getSelectedOption()?.value;
    await setup.mockMouse.click(navigation.screenX + 1, navigation.screenY);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeUndefined();
    expect(renderable(setup, "installed-skill-browser") === browser).toBe(true);
    await openMainPage(setup, "settings");
    await focusLive(setup, "shell-scope-select");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("scope-choices"));
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "shell-scope-select");
    expect(setup.renderer.root.findDescendantById("scope-choices")).toBeUndefined();
    await openMainPage(setup, "skills");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(
      (renderable(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
    ).toBe(selection);
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
    const selection = browser.getSelectedOption()?.value;
    await parsedEscape(setup);
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
    expect(setup.renderer.root.findDescendantById("skills-filter-search")).toBeDefined();
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
    const search = renderable(setup, "skills-filter-search") as InputRenderable;
    search.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === search);
    await setup.mockInput.pressKey("x");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-values",
    );
    expect(search.value).toBe("x");
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));

    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
  } finally {
    setup.renderer.destroy();
  }
});
