/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";

for (const tab of [0, 2] as const) {
  test(`switching from Reader tab ${tab} to Agent access and back retains cached content and view`, async () => {
    let loads = 0;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => {
              loads++;
              return readerContent;
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openAllInstalledSkills(setup);
      await parsedEnter(setup);
      await waitForReaderBody(setup, "needle in prose");
      await openReaderTab(setup, tab);
      await focusLive(setup, "skills-view-tab-all-installed-skills");
      setup.mockInput.pressArrow("left");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "skills-view-tab-current-exposure",
      );
      await setup.waitForFrame((frame) => frame.includes("Organize Skills into a Collection"));
      expect(!!setup.renderer.root.findDescendantById("reader-views")).toBe(false);
      await focusLive(setup, "skills-view-tab-current-exposure");
      setup.mockInput.pressArrow("right");
      await setup.waitForFrame((frame) => frame.includes("SKILL.md"));
      expect(selectedReaderTab(setup)).toBe(tab);
      expect(loads).toBe(1);
      await focusLive(setup, "skills-view-tab-all-installed-skills");
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(!!setup.renderer.root.findDescendantById("reader-views")).toBe(true);
      expect(loads).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });
}
