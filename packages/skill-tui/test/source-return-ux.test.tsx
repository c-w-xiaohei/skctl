import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";

test("RENDER Source detail return restores the selected object and list viewport", async () => {
  const projection = workspaceProjection();
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...projection.effective.sources[0]!,
    id: `source-${index}`,
  }));
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...projection,
          effective: { ...projection.effective, sources },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 16 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    await focusLive(setup, "shell-section-tab-skills");
    for (const section of ["collections", "sources"]) {
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(`shell-section-tab-${section}`);
    }
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    const browser = (await focusLive(setup, "source-browser")) as SelectRenderable;
    for (let index = 1; index < 8; index++) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === index);
    }
    expect(browser.getSelectedOption()?.value).toBe("source-7");
    const savedOffset = selectScrollOffset(browser);

    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await parsedEscape(setup);
    await setup.waitFor(() => {
      const returned = setup.renderer.root.findDescendantById("source-browser");
      return (
        returned instanceof SelectRenderable && returned.getSelectedOption()?.value === "source-7"
      );
    });

    const returned = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(returned).not.toBe(browser);
    expect(returned.getSelectedOption()?.value).toBe("source-7");
    expect(selectScrollOffset(returned)).toBe(savedOffset);
  } finally {
    setup.renderer.destroy();
  }
});
