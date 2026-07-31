import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

test("RENDER compact Reader exposes distinct Raw and match actions through physical Tab and mouse", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("1/3"));

    for (const id of ["reader-raw", "reader-find-previous", "reader-find-next", "open-match-raw"])
      await (async () => {
        setup.mockInput.pressKey("TAB");
        await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
      })();
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find-next");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("2/3"));

    const raw = setup.renderer.root.findDescendantById("reader-raw") as SelectRenderable;
    const next = setup.renderer.root.findDescendantById("reader-find-next") as SelectRenderable;
    expect(raw.screenY).not.toBe(next.screenY);
    await setup.mockMouse.click(next.screenX, next.screenY);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("3/3"));
  } finally {
    setup.renderer.destroy();
  }
});
