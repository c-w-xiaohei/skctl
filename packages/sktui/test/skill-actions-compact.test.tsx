import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, parsedEnter } from "./reader-test-controls";

test("short Skill details keeps arrow-menu commands inside its pane", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    {
      width: 80,
      height: 16,
    },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await focusLive(setup, "installed-skill-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skill-inspector-actions"));
    const pane = setup.renderer.root.findDescendantById("skill-inspector")!;
    const footer = setup.renderer.root.findDescendantById("command-status")!;
    for (const id of [
      "skill-inspector-open-reader",
      "workspace-action-skill-check-updates",
      "workspace-action-skill-uninstall",
      "skill-inspector-relationship-source",
    ]) {
      const command = await focusLive(setup, id);
      await setup.renderOnce();
      await setup.renderOnce();
      if (command.screenY + command.height >= pane.screenY + pane.height)
        throw new Error(`${id} crosses pane boundary\n${setup.captureCharFrame()}`);
      expect(command.screenY).toBeGreaterThan(pane.screenY);
      expect(command.screenY + command.height).toBeLessThan(pane.screenY + pane.height);
      expect(command.screenY + command.height).toBeLessThanOrEqual(footer.screenY);
      expect(setup.captureCharFrame().split("\n")[command.screenY]).toContain("[");
    }
  } finally {
    setup.renderer.destroy();
  }
});
