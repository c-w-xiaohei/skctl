import { expect, test } from "bun:test";
import { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { enterLive, live, parsedEnter, waitForReaderBody } from "./reader-test-controls";

async function enterFirstSkill(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  const browser = live(setup, "installed-skill-browser");
  await setup.mockMouse.click(browser.screenX + 1, browser.screenY);
  await parsedEnter(setup);
}

test("Reader exposes Content and Resources tabs with target-local maintenance in More", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await enterFirstSkill(setup);
    await waitForReaderBody(setup, "needle in prose");
    const frame = setup.captureCharFrame();
    for (const label of ["Content", "Resources", "More"]) expect(frame).toContain(label);

    // Native tab navigation switches reading views; maintenance has its own menu.
    const content = live(setup, "reader-tabs-tab-skill");
    await setup.mockMouse.click(content.screenX + 1, content.screenY);
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    await enterLive(setup, "reader-more");
    await setup.renderOnce();
    const settings = setup.captureCharFrame();
    expect(settings).toContain("Change Source");
    expect(settings).toContain("Uninstall");
    expect(settings).toContain("Reread installed files");
    expect(settings).not.toContain("Manage Skill");
    expect(!!setup.renderer.root.findDescendantById("reader-details-manage")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("compact Reader retains a useful reading viewport at 43 by 13", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await enterFirstSkill(setup);
    await waitForReaderBody(setup, "needle in prose");
    setup.resize(43, 13);
    await setup.flush();
    const body = live(setup, "reader-scrollbox");
    expect(body).toBeInstanceOf(ScrollBoxRenderable);
    expect((body as ScrollBoxRenderable).viewport.height).toBeGreaterThanOrEqual(7);
    const frame = setup.captureCharFrame();
    for (const label of ["Content", "Resources", "More"]) expect(frame).toContain(label);
    expect(frame).toContain("needle in prose");
  } finally {
    setup.renderer.destroy();
  }
});
