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
  openInstallation,
  parsedEnter,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";

for (const view of ["content", "resources", "installation"] as const) {
  test(`switching from Reader ${view} to Agent access and back retains cached content and view`, async () => {
    const tab = view === "resources" ? 1 : 0;
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
      if (view === "installation") await openInstallation(setup);
      await focusLive(setup, "shell-section-tab-agent");
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("Organize Skills into a Collection"));
      expect(!!setup.renderer.root.findDescendantById("reader-views")).toBe(false);
      await focusLive(setup, "shell-section-tab-skills");
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      if (view !== "installation") expect(selectedReaderTab(setup)).toBe(tab);
      expect(!!setup.renderer.root.findDescendantById("reader-details")).toBe(
        view === "installation",
      );
      expect(loads).toBe(1);
      await focusLive(setup, "installed-skill-browser");
      await parsedEnter(setup);
      if (view === "installation") {
        expect(!!setup.renderer.root.findDescendantById("reader-details")).toBe(true);
      } else {
        expect(!!setup.renderer.root.findDescendantById("reader-views")).toBe(true);
        expect(selectedReaderTab(setup)).toBe(tab);
      }
      expect(loads).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });
}
