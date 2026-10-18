import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

async function openReaderFromInspector(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
  );
  const currentExposure = setup.renderer.root.findDescendantById(
    "skills-view-tab-current-exposure",
  )!;
  currentExposure.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === currentExposure);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.waitForFrame(
    (frame) =>
      frame.includes("[ All Skills ]") &&
      !!setup.renderer.root.findDescendantById("installed-skill-browser"),
  );
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
  setup.mockInput.pressEnter();
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  const control = setup.renderer.root.findDescendantById("skill-inspector-open-reader")!;
  control.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === control);
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
}

test("RENDER native Raw Reader exposes mouse-dragged selected text through the renderer", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          installed: { load: async () => readerContent },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openReaderFromInspector(setup);
    const raw = setup.renderer.root.findDescendantById("reader-raw");
    expect(raw).toBeDefined();
    raw!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === raw);
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
