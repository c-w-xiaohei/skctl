import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function openFilter(setup: Setup) {
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
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

test("RENDER filter underlay blocks a background destination without stealing filter focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    const navigation = renderable(setup, "top-navigation") as TabSelectRenderable;
    const browser = renderable(setup, "installed-skill-browser") as SelectRenderable;
    const input = renderable(setup, "skills-filter-search") as InputRenderable;
    const stage = renderable(setup, "skills-filter-dimensions");
    const underlay = renderable(setup, "skills-filter-underlay");

    expect(underlay.screenX).toBe(0);
    expect(underlay.screenY).toBe(0);
    expect(underlay.width).toBe(120);
    expect(underlay.height).toBe(40);
    const destination = navigation.getSelectedOption()?.value;
    const selection = browser.getSelectedOption()?.value;
    await setup.mockMouse.click(navigation.screenX + 20, navigation.screenY);
    await setup.renderOnce();

    expect(renderable(setup, "skills-filter-overlay")).toBeDefined();
    expect(navigation.getSelectedOption()?.value).toBe(destination);
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

    expect(browser.screenX).toBeLessThan(overlay.screenX);
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
