import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SelectRenderable } from "@opentui/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

test.each([120, 80, 60])(
  "Skills page keeps its header and content origin when opening details at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 30 },
    );
    const geometry = (id: string) => {
      const target = setup.renderer.root.findDescendantById(id);
      if (!target) throw new Error(`Missing ${id}`);
      return [target.screenX, target.screenY, target.width, target.height];
    };
    try {
      await openAllInstalledSkills(setup);
      await setup.renderOnce();
      const scope = geometry("skills-local-views");
      const list = geometry("skills-list-pane");
      const listNode = setup.renderer.root.findDescendantById("installed-skill-browser");
      const title = geometry("section-nav");
      await parsedEnter(setup);
      const detail = geometry("skill-reader-pane");
      if (width >= 100) {
        expect(geometry("skills-local-views")).toEqual(scope);
        expect(geometry("section-nav")).toEqual(title);
        expect(detail[1]).toBe(list[1]);
        expect(geometry("skills-list-pane")).toEqual(list);
        expect(setup.renderer.root.findDescendantById("installed-skill-browser") === listNode).toBe(
          true,
        );
      }
      expect(detail[1]).toBeGreaterThanOrEqual(0);
      expect(detail[3]).toBeGreaterThan(0);
      expect(detail[1]! + detail[3]!).toBeLessThanOrEqual(30);
      await waitForReaderBody(setup, "guide");
      expect(geometry("skill-reader-pane")).toEqual(detail);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(geometry("skills-list-pane")).toEqual(list);
      expect(geometry("skills-local-views")).toEqual(scope);
      expect(geometry("section-nav")).toEqual(title);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("long descriptions do not move the Skill action region", async () => {
  const projection = readerProjection();
  const second = projection.installedSkills[1]!;
  const core = directSourceCore({
    ...projection,
    installedSkills: [
      projection.installedSkills[0]!,
      { ...second, description: "A long description with wrapping. ".repeat(100) },
    ],
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openAllInstalledSkills(setup);
    await setup.renderOnce();
    const actions = setup.renderer.root.findDescendantById("reader-action-skill-check-updates")!;
    const before = [actions.screenY, actions.height];
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
        ).getSelectedOption()?.value === JSON.stringify(["team-main", "reference"]),
    );
    await setup.renderOnce();
    const selectedActions = setup.renderer.root.findDescendantById(
      "reader-action-skill-check-updates",
    )!;
    expect([selectedActions.screenY, selectedActions.height]).toEqual(before);
  } finally {
    setup.renderer.destroy();
  }
});

test("short nonwide terminals bound Reader and restore inventory geometry", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  try {
    await openAllInstalledSkills(setup);
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById("skills-list-pane")!;
    const origin = [list.screenY, list.height];
    const tabs = setup.renderer.root.findDescendantById("skills-local-views")!;
    const tabsGeometry = [tabs.screenY, tabs.height];
    await parsedEnter(setup);
    const detail = setup.renderer.root.findDescendantById("skill-reader-pane")!;
    const detailGeometry = [detail.screenY, detail.height];
    expect(detail.height).toBeGreaterThan(0);
    expect(detail.screenY).toBeGreaterThanOrEqual(0);
    expect(detail.screenY + detail.height).toBeLessThanOrEqual(16);
    await waitForReaderBody(setup, "guide");
    expect([detail.screenY, detail.height]).toEqual(detailGeometry);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    const returned = setup.renderer.root.findDescendantById("skills-list-pane")!;
    expect([returned.screenY, returned.height]).toEqual(origin);
    const returnedTabs = setup.renderer.root.findDescendantById("skills-local-views")!;
    expect([returnedTabs.screenY, returnedTabs.height]).toEqual(tabsGeometry);
  } finally {
    setup.renderer.destroy();
  }
});

test("resizing detail preserves the surface and returns to the same Skill", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    for (const width of [80, 60, 120]) {
      setup.resize(width, 30);
      await setup.flush();
      expect(!!setup.renderer.root.findDescendantById("skill-reader-pane")).toBe(true);
      if (width >= 100)
        expect(setup.renderer.root.findDescendantById("skills-local-views")).toBeDefined();
      expect(setup.captureCharFrame()).toContain("guide");
    }
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(
      (setup.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.value,
    ).toBe('["team-main","guide"]');
    expect(setup.captureCharFrame()).toContain("guide");
  } finally {
    setup.renderer.destroy();
  }
});
