import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEnter } from "./reader-test-controls";

test("RENDER search results show aligned Skill and Match columns on one line", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 110, height: 36 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-query"));
    const query = setup.renderer.root.findDescendantById("skills-query") as InputRenderable;
    query.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
    for (const key of "distinct") await setup.mockInput.pressKey(key);
    await setup.waitFor(() => {
      const browser = setup.renderer.root.findDescendantById("installed-skill-browser") as
        | SelectRenderable
        | undefined;
      return browser?.options.length === 1 && !browser.showDescription;
    });

    await setup.waitForFrame((frame) => frame.includes("Match") && frame.includes("distinct"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Skill");
    expect(frame).toContain("Match");
    expect(frame).toContain("reference");
    expect(frame).toContain("Matched Description:");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([100, 140])(
  "search rows are adjacent and pointer opens the exact row at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 30 },
    );
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      setup.mockInput.pressKey("/");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-query");
      for (const char of "team-main") {
        setup.mockInput.pressKey(char);
        await setup.renderOnce();
      }
      await setup.waitForFrame(
        (frame) => frame.includes("Match") && frame.includes("Matched Source:"),
      );
      const browser = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      expect(browser.showDescription).toBe(false);
      expect(browser.options).toHaveLength(2);
      const frame = setup.captureCharFrame().split("\n");
      const guideRow = frame.findIndex((line) => line.includes("▶ guide"));
      expect(frame[guideRow + 1]).toContain("reference");
      await setup.mockMouse.click(browser.screenX + 3, browser.screenY + 1);
      await setup.waitFor(
        () => browser.getSelectedOption()?.value === JSON.stringify(["team-main", "reference"]),
      );
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("team-main/reference"));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("skill-inspector-open-reader");
    } finally {
      setup.renderer.destroy();
    }
  },
);
