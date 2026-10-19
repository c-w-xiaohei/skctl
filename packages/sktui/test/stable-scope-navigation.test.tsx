/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { parsedEnter, parsedEscape, selectedReaderTab } from "./reader-test-controls";
async function navigateToAgentAccess(setup: Awaited<ReturnType<typeof testRender>>) {
  await focusViewStrip(setup);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable?.id === "skills-view-tab-current-exposure" &&
      !!setup.renderer.root.findDescendantById("agent-access-pane"),
  );
  await setup.renderOnce();
}
async function focusViewStrip(setup: Awaited<ReturnType<typeof testRender>>) {
  for (
    let step = 0;
    step < 6 &&
    setup.renderer.currentFocusedRenderable?.id !== "skills-view-tab-all-installed-skills";
    step++
  ) {
    setup.mockInput.pressTab();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await setup.renderOnce();
  }
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-view-tab-all-installed-skills");
}
test("RENDER changing Skills scope from detail shows Agent access and Back restores the detail", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await navigateToAgentAccess(setup);
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("skill-inspector-open-reader")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Agent access");
    expect(setup.captureCharFrame().split("\n")[2]).not.toContain("/ Details");
    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    expect(setup.captureCharFrame()).toContain("Skill details");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER changing Skills scope from Reader returns to its browser and Back restores cached Reader", async () => {
  let readerLoads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => {
            readerLoads++;
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("const needle = true"));
    expect(selectedReaderTab(setup)).toBe(0);
    await navigateToAgentAccess(setup);
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Agent access");
    expect(setup.captureCharFrame()).not.toContain("Reader · guide");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect(selectedReaderTab(setup)).toBe(0);
    expect(readerLoads).toBe(1);
    await focusViewStrip(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect(readerLoads).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
