import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, readerAddress } from "./installed-reader.fixture";
import {
  focusLive,
  enterInstalledAddress,
  openAllInstalledSkills,
  openInstallation,
  enterLive,
  parsedEscape,
} from "./reader-test-controls";

test.each([43, 100, 144])(
  "checked Skills have a one-row batch menu and explicit clear at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 13 },
    );
    try {
      await openAllInstalledSkills(setup);
      const browser = await focusLive(setup, "installed-skill-browser");
      const height = browser.height;
      await setup.mockInput.typeText(" ");
      await setup.flush();
      const batch = setup.renderer.root.findDescendantById("skills-batch-actions");
      expect(!!batch).toBe(true);
      expect(batch!.height).toBe(1);
      expect(browser.height).toBe(height - 1);
      expect(browser.height).toBeGreaterThanOrEqual(6);
      await enterLive(setup, "skills-selected");
      expect(
        !!setup.renderer.root.findDescendantById(
          "skills-selected-skill-add-selected-to-collection",
        ),
      ).toBe(true);
      expect(
        !!setup.renderer.root.findDescendantById("skills-selected-update-selected-skills"),
      ).toBe(true);
      expect(!!setup.renderer.root.findDescendantById("skills-selected-view")).toBe(false);
      await parsedEscape(setup);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-selected");
      await enterLive(setup, "skills-clear-selection");
      expect(!!setup.renderer.root.findDescendantById("skills-batch-actions")).toBe(false);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      expect(browser.height).toBe(height);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("43-column Skills enters the current Reader directly from its list", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("short Reader keeps routine actions and focused management controls inside its pane", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    {
      width: 80,
      height: 16,
    },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await openInstallation(setup);
    const pane = setup.renderer.root.findDescendantById("reader-pane")!;
    const footer = setup.renderer.root.findDescendantById("command-status")!;
    for (const id of [
      "reader-details-action-skill-add-to-collection",
      "reader-action-skill-check-updates",
      "reader-details-relationship-source",
    ]) {
      const command = await focusLive(setup, id);
      await setup.renderOnce();
      await setup.renderOnce();
      if (command.screenY + command.height >= pane.screenY + pane.height)
        throw new Error(`${id} crosses pane boundary\n${setup.captureCharFrame()}`);
      expect(command.screenY).toBeGreaterThanOrEqual(pane.screenY);
      expect(command.screenY + command.height).toBeLessThanOrEqual(pane.screenY + pane.height);
      expect(command.screenY + command.height).toBeLessThanOrEqual(footer.screenY);
    }
    await enterLive(setup, "reader-more");
    const uninstall = await focusLive(setup, "reader-menu-skill-uninstall");
    expect(uninstall.screenY).toBeGreaterThanOrEqual(0);
    expect(uninstall.screenY + uninstall.height).toBeLessThanOrEqual(16);
    await parsedEscape(setup);
  } finally {
    setup.renderer.destroy();
  }
});
