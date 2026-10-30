import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openAllInstalledSkills } from "./reader-test-controls";

test("RENDER search shows a compact named match and Enter opens the result", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 140, height: 40 },
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
      return browser?.options.length === 1;
    });
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "reference"]));
    expect(browser.showDescription).toBe(false);
    await setup.waitForFrame((frame) => frame.includes("Match") && frame.includes("reference"));
    expect(setup.captureCharFrame()).toContain("Skills · 1 / 2");

    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("open-skills-filter");
    expect(setup.renderer.root.findDescendantById("open-skills-filter")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
