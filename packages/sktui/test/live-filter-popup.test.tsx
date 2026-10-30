import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openAllInstalledSkills, parsedEscape } from "./reader-test-controls";

test("live filter popup keeps both panes visible and applies values without closing", async () => {
  const projection = readerProjection();
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 18 },
  );
  const clickOption = async (id: string, value: string) => {
    const select = setup.renderer.root.findDescendantById(id) as SelectRenderable;
    const index = select.options.findIndex((option) => option.value === value);
    expect(index).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(select.screenX + 1, select.screenY + index);
    await setup.renderOnce();
  };
  try {
    await openAllInstalledSkills(setup);
    const query = setup.renderer.root.findDescendantById("skills-query")!;
    query.focus();
    for (const character of "guide") setup.mockInput.pressKey(character);
    await setup.renderOnce();
    const trigger = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(trigger.screenX + 1, trigger.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));

    const popup = setup.renderer.root.findDescendantById("skills-filter-overlay")!;
    const categories = setup.renderer.root.findDescendantById("skills-filter-dimensions")!;
    const values = setup.renderer.root.findDescendantById("skills-filter-values")!;
    expect(categories.screenX).toBeLessThan(values.screenX);
    expect(categories.screenY).toBeLessThan(values.screenY);
    expect(popup.width).toBeLessThanOrEqual(78);
    const initialX = popup.screenX;

    await clickOption("skills-filter-dimensions", "Source");
    await clickOption("skills-filter-values", "team-main");
    expect(popup.screenX).toBe(initialX);
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "guide",
    );
    const appliedX = popup.screenX;

    await clickOption("skills-filter-dimensions", "Config");
    const configValues = setup.renderer.root.findDescendantById(
      "skills-filter-values",
    ) as SelectRenderable;
    if (configValues.options.some((option) => option.value))
      await clickOption(
        "skills-filter-values",
        configValues.options.find((option) => option.value)!.value,
      );
    expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
    expect(popup.screenX).toBe(appliedX);

    await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("skills-filter-overlay")).toBe(false);
    const reopen = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(reopen.screenX + 1, reopen.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-dimensions",
    );
    const reopenedCategory = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    expect(reopenedCategory.getSelectedIndex()).toBe(0);
    expect(
      (setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable).value,
    ).toBe("");
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "guide",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("value search retains its native input and highlighting does not apply a filter", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 100, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    const trigger = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(trigger.screenX + 1, trigger.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-dimensions"));
    const category = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    await setup.mockMouse.click(
      category.screenX + 1,
      category.screenY + category.options.findIndex((option) => option.value === "Source"),
    );
    const search = setup.renderer.root.findDescendantById(
      "skills-filter-search",
    ) as InputRenderable;
    const values = setup.renderer.root.findDescendantById("skills-filter-values");
    await setup.mockMouse.click(search.screenX + 1, search.screenY);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === search);
    for (const char of "team") {
      setup.mockInput.pressKey(char);
      await setup.renderOnce();
      expect(
        setup.renderer.root.findDescendantById("skills-filter-search") === search,
        `Input remounted after ${char}`,
      ).toBe(true);
      expect(
        setup.renderer.currentFocusedRenderable === search,
        `Focus moved after ${char} to ${setup.renderer.currentFocusedRenderable?.id}`,
      ).toBe(true);
      expect(setup.renderer.root.findDescendantById("skills-filter-dimensions") === category).toBe(
        true,
      );
      expect(setup.renderer.root.findDescendantById("skills-filter-values") === values).toBe(true);
    }
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(!!setup.renderer.root.findDescendantById("skills-filter-overlay")).toBe(true);
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-values",
    );
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(!!setup.renderer.root.findDescendantById("clear-skills-filter-source")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("skills-filter-overlay")).toBe(true);
    await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("skills-filter-overlay")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("narrow live filter popup stays bounded and Tab does not leave its controls", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await openAllInstalledSkills(setup);
    const trigger = setup.renderer.root.findDescendantById("open-skills-filter")!;
    await setup.mockMouse.click(trigger.screenX + 1, trigger.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
    const popup = setup.renderer.root.findDescendantById("skills-filter-overlay")!;
    expect(popup.width).toBeLessThanOrEqual(41);
    expect(popup.screenY + popup.height).toBeLessThanOrEqual(13);
    expect(setup.captureCharFrame()).toContain("Search Collections");
    expect(
      setup.renderer.root.findDescendantById("skills-filter-dimensions")!.screenX,
    ).toBeLessThan(setup.renderer.root.findDescendantById("skills-filter-search")!.screenX);
    expect(setup.captureCharFrame()).toContain("2 results");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-filter-search",
    );
  } finally {
    setup.renderer.destroy();
  }
});
