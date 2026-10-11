import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import { focusLive, openAllInstalledSkills } from "./reader-test-controls";

test.each([
  [120, 40],
  [80, 24],
  [43, 30],
] as const)(
  "Tab and Shift+Tab are inverse cycles through live controls at %ix%i",
  async (width, height) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      await openAllInstalledSkills(setup);
      expect(setup.renderer.root.findDescendantById("skills-local-views")?.height).toBe(1);
      const ids = [setup.renderer.currentFocusedRenderable!.id];
      for (let step = 0; step < 20; step++) {
        setup.mockInput.pressKey("TAB");
        await setup.renderOnce();
        const target = setup.renderer.currentFocusedRenderable;
        expect(!!target && !!target.parent && !target.isDestroyed && target.focusable).toBe(true);
        if (target!.id === ids[0]) break;
        expect(ids.includes(target!.id)).toBe(false);
        ids.push(target!.id);
      }
      expect(ids.length).toBeGreaterThanOrEqual(5);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(ids[0]);
      for (let index = ids.length - 1; index >= 0; index--) {
        setup.mockInput.pressKey("TAB", { shift: true });
        await setup.renderOnce();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(ids[index]);
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Reader tab pointer activation changes the surface immediately with a monochrome focus cue", async () => {
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
    await openReaderFromInspector(setup);
    const details = setup.renderer.root.findDescendantById("reader-tabs-tab-details")!;
    await setup.mockMouse.click(details.screenX + 1, details.screenY);
    await setup.waitForFrame(
      (frame) => frame.includes("Reader / Details") && frame.includes("› [Details]"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs-tab-details");
    setup.mockInput.pressArrow("left");
    await setup.waitForFrame(
      (frame) => frame.includes("Reader / Resources") && frame.includes("› [Resources]"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs-tab-resources");
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader Raw reverses to Find instead of jumping to another pane's command", async () => {
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
    await openReaderFromInspector(setup);
    await focusLive(setup, "reader-find");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
  } finally {
    setup.renderer.destroy();
  }
});

test("slash from the installed list focuses search without changing its view", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-query");
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
  } finally {
    setup.renderer.destroy();
  }
});
