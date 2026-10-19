import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { parsedEnter } from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
async function boot(width = 120) {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width, height: 24 },
  );
  await openReaderFromInspector(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
  return setup;
}
async function openRawMatch(setup: Setup) {
  setup.renderer.root.findDescendantById("reader-scrollbox")!.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
  await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
  await setup.renderOnce();
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("open-match-raw"));
  const next = setup.renderer.root.findDescendantById("reader-find-next")!;
  next.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === next);
  await parsedEnter(setup);
  await setup.waitForFrame((frame) => frame.includes("2/3"));
  const openRaw = setup.renderer.root.findDescendantById("open-match-raw")!;
  openRaw.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === openRaw);
  await parsedEnter(setup);
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("open-match-raw"));
  const raw = setup.renderer.root.findDescendantById("reader-raw")!;
  raw.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === raw);
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find-previous");
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
}
test("RENDER raw match handoff keeps typed Raw order after Open Raw removes its action", async () => {
  const setup = await boot();
  try {
    await openRawMatch(setup);
    expect(setup.captureCharFrame()).toContain("2/3");
    const previous = setup.renderer.root.findDescendantById("reader-find-previous")!;
    previous.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === previous);
    const raw = setup.renderer.root.findDescendantById("reader-raw")!;
    raw.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === raw);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER raw match handoff keeps the surviving Raw control through 120 79 43 80 120", async () => {
  const setup = await boot();
  try {
    await openRawMatch(setup);
    for (const width of [79, 43] as const) {
      setup.resize(width, 24);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    }
    for (const width of [80, 120] as const) {
      setup.resize(width, 24);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-raw"));
      expect(setup.renderer.root.findDescendantById("open-match-raw")).toBeUndefined();
    }
  } finally {
    setup.renderer.destroy();
  }
});
