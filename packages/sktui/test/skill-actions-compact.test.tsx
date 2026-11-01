import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, readerAddress } from "./installed-reader.fixture";
import {
  focusLive,
  enterInstalledAddress,
  openAllInstalledSkills,
  openReaderTab,
  openReaderSettings,
} from "./reader-test-controls";

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
    await openReaderTab(setup, 2);
    await openReaderSettings(setup);
    const pane = setup.renderer.root.findDescendantById("reader-pane")!;
    const footer = setup.renderer.root.findDescendantById("command-status")!;
    for (const id of [
      "reader-details-action-skill-add-to-collection",
      "reader-action-skill-check-updates",
      "reader-details-action-skill-uninstall",
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
  } finally {
    setup.renderer.destroy();
  }
});
