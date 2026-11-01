import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";

test("Reader has no Find mode and narrow tabs retain keyboard navigation", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await waitForReaderBody(setup, "needle in prose");
    await focusLive(setup, "reader-scrollbox");
    await setup.mockInput.pressKeys(["/"]);
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("reader-find")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    setup.resize(43, 16);
    await setup.flush();
    await openReaderTab(setup, 1);
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => selectedReaderTab(setup) === 0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs-tab-skill");
  } finally {
    setup.renderer.destroy();
  }
});
