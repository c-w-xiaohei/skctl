import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  clearSkillsFilters,
  setSkillsFilter,
  appliedSkillsFilters,
  openAllInstalledSkills,
  parsedEscape,
} from "./reader-test-controls";

test("Filter clears one dimension without clearing search or the other applied condition", async () => {
  const fixture = readerProjection();
  const base = {
    ...fixture,
    installedSkills: fixture.installedSkills.map((skill, index) =>
      index === 0
        ? { ...skill, collections: [{ id: "engineering", entry: "guide", paths: [] }] }
        : skill,
    ),
  };
  const setup = await testRender(() => <App core={directSourceCore(base)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openAllInstalledSkills(setup);
    const query = setup.renderer.root.findDescendantById("skills-query") as InputRenderable;
    expect(query).toBeDefined();
    await setup.mockMouse.click(query.screenX + 1, query.screenY);
    for (const character of "guide") {
      setup.mockInput.pressKey(character);
      await setup.renderOnce();
    }

    const filter = setup.renderer.root.findDescendantById("open-skills-filter");
    expect(filter).toBeDefined();
    await setup.mockMouse.click(filter!.screenX + 1, filter!.screenY);
    await setup.renderOnce();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-search"));
    const dimensions = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    const dimensionIndex = dimensions.options.findIndex((option) => option.value === "Source");
    await setup.mockMouse.click(dimensions.screenX + 1, dimensions.screenY + dimensionIndex);
    await setup.renderOnce();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-values"));
    const values = setup.renderer.root.findDescendantById(
      "skills-filter-values",
    ) as SelectRenderable;
    const valueIndex = values.options.findIndex((option) => option.value === "team-main");
    await setup.mockMouse.click(values.screenX + 1, values.screenY + valueIndex);
    await setup.renderOnce();

    const collectionDimensions = setup.renderer.root.findDescendantById(
      "skills-filter-dimensions",
    ) as SelectRenderable;
    const collectionIndex = collectionDimensions.options.findIndex(
      (option) => option.value === "Collection",
    );
    await setup.mockMouse.click(
      collectionDimensions.screenX + 1,
      collectionDimensions.screenY + collectionIndex,
    );
    await setup.renderOnce();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-values"));
    const collectionValues = setup.renderer.root.findDescendantById(
      "skills-filter-values",
    ) as SelectRenderable;
    const collectionValueIndex = collectionValues.options.findIndex(
      (option) => option.value === "engineering",
    );
    await setup.mockMouse.click(
      collectionValues.screenX + 1,
      collectionValues.screenY + collectionValueIndex,
    );
    await setup.renderOnce();

    await parsedEscape(setup);
    expect(await appliedSkillsFilters(setup)).toEqual(["Collection", "Source"]);
    await setSkillsFilter(setup, "Source", "");
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "guide",
    );
    expect(await appliedSkillsFilters(setup)).toEqual(["Collection"]);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "open-skills-filter");
    await clearSkillsFilters(setup);
    await setup.renderOnce();
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "guide",
    );
    expect(await appliedSkillsFilters(setup)).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
