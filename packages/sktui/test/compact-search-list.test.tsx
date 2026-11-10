import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openAllInstalledSkills, parsedEnter, waitForReaderBody } from "./reader-test-controls";

test("search results retain the matching text on the Skill row without a redundant heading", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 110, height: 36 },
  );
  try {
    await openAllInstalledSkills(setup);
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
    expect(query.width).toBeGreaterThan(0);

    await setup.waitForFrame((frame) => frame.includes("distinct"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Skill");
    expect(frame).toContain("reference");
    const row = frame.split("\n").find((line) => line.includes("▶ reference"));
    expect(row).toContain("distin");
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
      await openAllInstalledSkills(setup);
      setup.mockInput.pressKey("/");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-query");
      for (const char of "team-main") {
        setup.mockInput.pressKey(char);
        await setup.renderOnce();
      }
      await setup.waitForFrame((frame) => frame.includes("team-m"));
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
      await waitForReaderBody(setup, "reference");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-pane"));
    } finally {
      setup.renderer.destroy();
    }
  },
);
