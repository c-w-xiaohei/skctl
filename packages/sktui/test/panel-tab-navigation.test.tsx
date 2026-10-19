import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEnter } from "./reader-test-controls";

async function pressTab(setup: Awaited<ReturnType<typeof testRender>>, shift = false) {
  setup.mockInput.pressTab({ shift });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
  return setup.renderer.currentFocusedRenderable?.id;
}

test("Tab cycles visible workspace panels, never controls inside them", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(await pressTab(setup)).toBe("skill-inspector-open-reader");
    expect(await pressTab(setup)).toBe("top-navigation-tab-workspace");
    expect(await pressTab(setup)).toBe("shell-section-navigation");
    expect(await pressTab(setup)).toBe("skills-view-tab-all-installed-skills");
    expect(await pressTab(setup)).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("Shift+Tab leaves skill details for Browser even after arrow navigation", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await pressTab(setup);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    const lastAction = setup.renderer.currentFocusedRenderable?.id;
    expect(await pressTab(setup, true)).toBe("installed-skill-browser");
    expect(await pressTab(setup)).toBe(lastAction);
  } finally {
    setup.renderer.destroy();
  }
});

test("narrow detail does not tab to its unmounted Browser pane", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 60, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    expect(await pressTab(setup)).toBe("top-navigation-tab-workspace");
    expect(await pressTab(setup)).toBe("shell-section-tab-skills");
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader toolbar and view tabs are internal to the single Reader panel", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    const internal = setup.renderer.currentFocusedRenderable?.id;
    expect(internal).not.toBe("reader-scrollbox");
    expect(await pressTab(setup)).toBe("top-navigation-tab-workspace");
    expect(await pressTab(setup, true)).toBe(internal);
  } finally {
    setup.renderer.destroy();
  }
});
