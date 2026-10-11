import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEnter, parsedEscape } from "./reader-test-controls";

test("filter edits a category and its values in one visible popup", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("open-skills-filter"));
    const trigger = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(trigger.screenX + 1, trigger.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-dimensions"));
    await setup.renderOnce();

    const category = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    const values = setup.renderer.root.findDescendantById(
      "skills-filter-values",
    ) as SelectRenderable;
    expect(category).toBeDefined();
    expect(values).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable).toBe(category);
    expect(category.getSelectedOption()?.value).toBe("Collection");
    expect(setup.captureCharFrame()).toContain("matching Skills");

    const sourceIndex = category.options.findIndex((option) => option.value === "Source");
    const direction = sourceIndex >= category.getSelectedIndex() ? "down" : "up";
    for (let index = category.getSelectedIndex(); index !== sourceIndex;) {
      setup.mockInput.pressArrow(direction);
      index += direction === "down" ? 1 : -1;
      await setup.waitFor(() => category.getSelectedIndex() === index);
    }
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Source values"));
    expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBe(values);
    expect(
      (setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable)
        .placeholder,
    ).toBe("Search Sources…");

    const source = values.options.find((option) => option.value === "team-main");
    expect(source).toBeDefined();
    const sourceRow = values.options.findIndex((option) => option.value === "team-main");
    const target = setup.renderer.root.findDescendantById(
      "skills-filter-values",
    ) as SelectRenderable;
    await setup.mockMouse.click(target.screenX + 1, target.screenY + sourceRow);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
    expect(setup.captureCharFrame()).toContain("2 matching Skills");

    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));
    const currentTrigger = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(currentTrigger.screenX + 1, currentTrigger.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-values"));
    const reopened = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    await setup.mockMouse.click(reopened.screenX + 1, reopened.screenY + sourceIndex);
    await setup.renderOnce();
    expect(
      (
        setup.renderer.root.findDescendantById("skills-filter-values") as SelectRenderable
      ).options.find((option) => option.value === "team-main")?.name,
    ).toContain("✓");
  } finally {
    setup.renderer.destroy();
  }
});
