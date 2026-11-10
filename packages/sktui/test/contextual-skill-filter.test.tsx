import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openAllInstalledSkills, parsedEscape } from "./reader-test-controls";

test.each([120, 60])(
  "filter stays contextual and applies exact Source with visible counts at %i columns",
  async (width) => {
    const p = readerProjection();
    const second = p.installedSkills[1]!;
    const projection = {
      ...p,
      installedSkills: [
        p.installedSkills[0]!,
        {
          ...second,
          address: { ...second.address, source: "other" },
          owner: { ...second.owner, source: "other" },
        },
      ],
    };
    const setup = await testRender(
      () => <App core={directSourceCore(projection)} exit={() => {}} />,
      { width, height: width === 60 ? 16 : 30 },
    );
    const click = async (id: string, row = 0) => {
      const target = setup.renderer.root.findDescendantById(id)!;
      expect(target).toBeDefined();
      await setup.mockMouse.click(target.screenX + 2, target.screenY + row);
      await setup.renderOnce();
    };
    try {
      await openAllInstalledSkills(setup);
      await click("open-skills-filter");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skills-filter-dimensions"),
      );
      await setup.renderOnce();
      const popup = setup.renderer.root.findDescendantById("skills-filter-overlay")!;
      expect(popup.width).toBeLessThanOrEqual(Math.min(78, width - 2));
      expect(popup.screenY + popup.height).toBeLessThanOrEqual(width === 60 ? 16 : 30);
      expect(setup.renderer.root.findDescendantById("skills-filter-search")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("skills-list-pane")).toBeDefined();
      setup.mockInput.pressTab();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id.startsWith("skills-filter-")).toBe(true);
      const dims = setup.renderer.root.findDescendantById(
        "skills-filter-dimensions",
      ) as SelectRenderable;
      await click(
        "skills-filter-dimensions",
        dims.options.findIndex((option) => option.value === "Source"),
      );
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-values"));
      const values = setup.renderer.root.findDescendantById(
        "skills-filter-values",
      ) as SelectRenderable;
      if (width >= 62)
        expect(values.options.find((option) => option.value === "team-main")?.name).toContain("1");
      expect(setup.captureCharFrame()).toContain("2 results");
      expect(setup.captureCharFrame()).toContain("Source");
      await click(
        "skills-filter-values",
        values.options.findIndex((option) => option.value === "team-main"),
      );
      expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
      expect(setup.captureCharFrame()).toContain("Applied: team-main");
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "open-skills-filter",
      );
      await setup.renderOnce();
      expect(!!setup.renderer.root.findDescendantById("skills-filter-overlay")).toBe(false);
      const results = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      expect(results.options).toHaveLength(1);
      expect(results.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "guide"]));
      expect(setup.captureCharFrame()).toContain("Filter (1)");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("minimum terminal keeps clear and close inside the popover even with a long query", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await openAllInstalledSkills(setup);
    const query = setup.renderer.root.findDescendantById("skills-query")!;
    await setup.mockMouse.click(query.screenX + 1, query.screenY);
    for (const char of "very-long-query-that-does-not-match-any-source-or-description") {
      setup.mockInput.pressKey(char);
      await setup.renderOnce();
    }
    const trigger = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(trigger.screenX + 1, trigger.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
    await setup.renderOnce();
    const popup = setup.renderer.root.findDescendantById("skills-filter-overlay")!;
    for (const id of ["skills-filter-clear-all", "skills-filter-close"]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY).toBeGreaterThan(popup.screenY);
      expect(control.screenY + control.height).toBeLessThan(popup.screenY + popup.height);
    }
    expect(popup.screenY + popup.height).toBeLessThanOrEqual(13);
    const dimensions = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    const sourceIndex = dimensions.options.findIndex((option) => option.value === "Source");
    await setup.mockMouse.click(dimensions.screenX + 2, dimensions.screenY + sourceIndex);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-values"));
    await setup.renderOnce();
    const valuePanel = setup.renderer.root.findDescendantById("skills-filter-overlay")!;
    expect(setup.renderer.root.findDescendantById("skills-filter-search")).toBeDefined();
    for (const id of ["skills-filter-clear-all", "skills-filter-close"]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY + control.height).toBeLessThan(valuePanel.screenY + valuePanel.height);
    }
  } finally {
    setup.renderer.destroy();
  }
});
