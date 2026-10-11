import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { openReaderTab, parsedEnter } from "./reader-test-controls";

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
    await openReaderFromInspector(setup);
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
    await setup.renderOnce();
    await parsedEnter(setup);
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("1/3"));

    const next = setup.renderer.root.findDescendantById("reader-find-next")!;
    next.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === next);
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("2/3"));

    const raw = setup.renderer.root.findDescendantById("reader-raw")!;
    const remountedNext = setup.renderer.root.findDescendantById("reader-find-next")!;
    expect(raw.screenY).not.toBe(next.screenY);
    await setup.mockMouse.click(remountedNext.screenX, remountedNext.screenY);
    await setup.waitForFrame((frame) => frame.includes("3/3"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER narrow Reader keeps every view label visible while its physical selector owns Left and Right", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 43, height: 40 },
  );
  try {
    await openReaderFromInspector(setup);
    await setup.waitForFrame((frame) =>
      ["SKILL.md", "Resources", "Details"].every((label) => frame.includes(label)),
    );
    await openReaderTab(setup, 1);
  } finally {
    setup.renderer.destroy();
  }
});
