import { expect, test } from "bun:test";
import { TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";

test("compact Reader Find/Raw/Next have distinct keyboard and pointer targets, then narrow tabs own Left/Right", async () => {
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
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await waitForReaderBody(setup, "needle in prose");
    const find = live(setup, "reader-find-open");
    await setup.mockMouse.click(find.screenX + 1, find.screenY);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("1/3"));
    const previous = live(setup, "reader-find-previous");
    await setup.mockMouse.click(previous.screenX + 1, previous.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-find-previous",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find-next");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("2/3"));

    const raw = live(setup, "open-match-raw");
    const next = live(setup, "reader-find-next");
    expect(raw.width > 0 && raw.height > 0 && next.width > 0 && next.height > 0).toBe(true);
    expect(
      raw.screenX + raw.width <= next.screenX ||
        next.screenX + next.width <= raw.screenX ||
        raw.screenY + raw.height <= next.screenY ||
        next.screenY + next.height <= raw.screenY,
    ).toBe(true);
    await setup.mockMouse.click(raw.screenX + 1, raw.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-line-0"));
    expect((live(setup, "reader-line-0") as TextRenderable).plainText).toBe("---");
    const reopenFind = live(setup, "reader-find-open");
    await setup.mockMouse.click(reopenFind.screenX + 1, reopenFind.screenY);
    await setup.waitForFrame((frame) => frame.includes("2/3"));
    const currentNext = live(setup, "reader-find-next");
    await setup.mockMouse.click(currentNext.screenX + 1, currentNext.screenY);
    await setup.waitForFrame((frame) => frame.includes("3/3"));

    setup.resize(43, 40);
    await setup.flush();
    await setup.waitForFrame((frame) =>
      ["SKILL.md", "Resources", "Details"].every((label) => frame.includes(label)),
    );
    await openReaderTab(setup, 1);
    for (const [key, index, id] of [
      ["ARROW_RIGHT", 2, "reader-tabs-tab-details"],
      ["ARROW_LEFT", 1, "reader-tabs-tab-resources"],
      ["ARROW_LEFT", 0, "reader-tabs-tab-skill"],
    ] as const) {
      setup.mockInput.pressKey(key);
      await setup.waitFor(() => selectedReaderTab(setup) === index);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
      expect(live(setup, id).focused).toBe(true);
    }
  } finally {
    setup.renderer.destroy();
  }
});
