import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function boot(width = 120) {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width, height: 24 },
  );
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  return setup;
}

async function openRawMatch(setup: Setup) {
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
  setup.mockInput.pressKey("/");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
  await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("open-match-raw"));
  for (const id of ["reader-raw", "reader-find-previous", "reader-find-next", "open-match-raw"]) {
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  }
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find-next");
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("2/3"));
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "open-match-raw");
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("open-match-raw"));
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
}

test("RENDER raw match handoff keeps typed Raw order after Open Raw removes its action", async () => {
  const setup = await boot();
  try {
    await openRawMatch(setup);
    expect(setup.captureCharFrame()).toContain("2/3");

    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-find-previous",
    );
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER raw match handoff restores the surviving owner through 120 79 43 80 120", async () => {
  const setup = await boot();
  try {
    await openRawMatch(setup);
    for (const width of [79, 43] as const) {
      setup.resize(width, 24);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
    }
    for (const width of [80, 120] as const) {
      setup.resize(width, 24);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
      expect(setup.renderer.root.findDescendantById("open-match-raw")).toBeUndefined();
    }
  } finally {
    setup.renderer.destroy();
  }
});
