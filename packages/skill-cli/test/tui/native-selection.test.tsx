import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

test("RENDER native Raw Reader exposes mouse-dragged selected text through the renderer", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 2/2"));
    setup.mockInput.pressKeys(["TAB", "TAB", "TAB", "TAB", "TAB", "TAB"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-raw");
    setup.mockInput.pressEnter();
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
