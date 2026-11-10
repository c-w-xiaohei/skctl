import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { enterLive, openAllInstalledSkills, parsedEnter } from "./reader-test-controls";
test("RENDER native Raw Reader exposes mouse-dragged selected text through the renderer", async () => {
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
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-raw");
    await setup.waitForFrame((frame) => frame.includes("title: Guide"));
    const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
    expect(reader).toBeDefined();
    await setup.mockMouse.drag(
      reader!.screenX + 1,
      reader!.screenY + 1,
      reader!.screenX + 14,
      reader!.screenY + 1,
    );
    await setup.flush();
    const selection = setup.renderer.getSelection();
    expect(selection).not.toBeNull();
    expect(selection!.getSelectedText()).toContain("itle: Guide");
  } finally {
    setup.renderer.destroy();
  }
});
