import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerSecondContent } from "./installed-reader.fixture";
import {
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

test("pointer reads the exact Skill directly and Back retains selection without reloading", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment, request) => {
            loads.push(request.address.path);
            return request.address.path === "reference" ? readerSecondContent : readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    const browser = await openAllInstalledSkills(setup);
    await waitForReaderBody(setup, "needle in prose");
    const index = browser.options.findIndex(
      (option) => option.value === '["team-main","reference"]',
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(browser.screenX + 1, browser.screenY + index);
    await waitForReaderBody(setup, "reference needle");
    expect(loads).toEqual(["guide", "reference"]);
    expect(!!setup.renderer.root.findDescendantById("skill-inspector-open-reader")).toBe(false);
    await parsedEnter(setup);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    const restored = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(restored.getSelectedOption()?.value).toBe('["team-main","reference"]');
    expect(loads).toEqual(["guide", "reference"]);
  } finally {
    setup.renderer.destroy();
  }
});
