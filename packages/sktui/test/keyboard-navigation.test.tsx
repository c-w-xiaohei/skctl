import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";
test.each([
  [120, 40],
  [80, 24],
  [43, 30],
] as const)(
  "Tab and Shift+Tab are inverse cycles through live workspace regions at %ix%i",
  async (width, height) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      await openAllInstalledSkills(setup);
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("skills-local-views")?.height).toBe(1);
      const ids = [setup.renderer.currentFocusedRenderable!.id];
      const pressTab = async (shift = false) => {
        setup.mockInput.pressKey("TAB", { shift });
        await new Promise<void>((resolve) => setImmediate(resolve));
        await setup.renderOnce();
        const target = setup.renderer.currentFocusedRenderable;
        expect(
          !!target && !!target.parent && !target.isDestroyed && target.focusable,
          `Tab sequence: ${[...ids, target?.id ?? "<no focus>"].join(" → ")}`,
        ).toBe(true);
        return target!.id;
      };
      for (let step = 0; step < 20; step++) {
        const id = await pressTab();
        if (id === ids[0]) break;
        expect(ids.includes(id), `Tab sequence: ${[...ids, id].join(" → ")}`).toBe(false);
        ids.push(id);
      }
      for (const region of [
        "section-nav",
        "shell-context-panel",
        "skills-local-views",
        "skills-list-pane",
        ...(width >= 100 ? ["reader-pane"] : []),
      ]) {
        const pane = live(setup, region);
        expect(
          ids.some((id) => !!pane.findDescendantById(id)),
          `Region ${region}; observed ${ids.join(" → ")}`,
        ).toBe(true);
      }
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(ids[0]);
      for (let index = ids.length - 1; index >= 0; index--) {
        // Returning to the inventory dismisses the Reader's contextual Back.
        // Only the currently mounted panels participate in the reverse cycle.
        if (ids[index] === "route-back" && !setup.renderer.root.findDescendantById("route-back"))
          continue;
        expect(await pressTab(true)).toBe(ids[index]);
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);
test("Reader pointer tabs retain monochrome cues and Find/Raw tools own reversible arrows, not editing input", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await waitForReaderBody(setup, "needle in prose");
    const details = setup.renderer.root.findDescendantById("reader-tabs-tab-details")!;
    await setup.mockMouse.click(details.screenX + 1, details.screenY);
    await setup.waitForFrame((frame) => frame.includes("team-main/guide"));
    expect(live(setup, "reader-details-summary").height).toBeGreaterThan(0);
    const detailsPaint = setup.captureSpans().lines[details.screenY]!.spans;
    expect(selectedReaderTab(setup)).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs-tab-details");
    setup.mockInput.pressArrow("left");
    await setup.waitForFrame((frame) => frame.includes("No supporting resources"));
    const resourcesPaint = setup.captureSpans().lines[details.screenY]!.spans;
    expect(selectedReaderTab(setup)).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs-tab-resources");
    await openReaderTab(setup, 0);
    await focusLive(setup, "reader-find-open");
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-raw");
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find-open");
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-find");
    await setup.mockInput.pressKeys(["n", "e", "ARROW_LEFT", "x", "ARROW_RIGHT", "y"]);
    await setup.waitFor(() => (live(setup, "reader-find") as InputRenderable).value === "nxey");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
    for (const [spans, name] of [
      [detailsPaint, "Details"],
      [resourcesPaint, "Resources"],
    ] as const) {
      const focused = spans.find((span) => span.text.includes(name))!;
      const other = spans.find((span) => span.text.includes("SKILL.md"))!;
      const luminance = ({ r, g, b }: typeof focused.bg) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(luminance(focused.fg)).not.toBe(luminance(focused.bg));
      expect(luminance(focused.bg)).not.toBe(luminance(other.bg));
    }
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
    expect(
      (live(setup, "skills-view-tab-all-installed-skills") as TabsTabRenderable).getState()
        .selected,
    ).toBe(true);
    expect(live(setup, "installed-skill-browser").height).toBeGreaterThan(0);
  } finally {
    setup.renderer.destroy();
  }
});
