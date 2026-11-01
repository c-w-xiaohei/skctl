import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { skillAddressKey } from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerProjection,
  readerSecondAddress,
  sourceFilteredAddress,
  sourceFilteredReaderProjection,
} from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  enterLive,
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

test("current Skill reads directly and exposes Collection and update commands", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment, { address }) => {
            loads.push(skillAddressKey(address));
            return {
              address,
              name: address.path,
              description: "",
              rawText: `Body ${address.path}`,
              markdownText: `Body ${address.path}`,
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerSecondAddress);
    await waitForReaderBody(setup, "Body reference");
    expect(loads.at(-1)).toBe(skillAddressKey(readerSecondAddress));
    for (const id of [
      "reader-details-action-skill-add-to-collection",
      "reader-action-skill-check-updates",
    ]) {
      const command = await focusLive(setup, id);
      expect(command.focusable).toBe(true);
      expect(command.height).toBeGreaterThan(0);
    }
    expect(!!setup.renderer.root.findDescendantById("skill-inspector-open-reader")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

for (const returnBy of ["escape", "button"] as const) {
  test(`Source inventory retains its selected Skill through Reader and ${returnBy} returns to the Sources list`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(sourceFilteredReaderProjection())} exit={() => {}} />,
      { width: 120, height: 40 },
    );
    try {
      await setup.flush();
      await openMainPage(setup, "sources");
      const sources = (await focusLive(setup, "source-browser")) as SelectRenderable;
      sources.setSelectedIndex(sources.options.findIndex((option) => option.value === "team-main"));
      await setup.flush();
      await enterLive(setup, "source-browser");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("source-installed-skills"),
      );
      const rowId = `source-installed-skills-row-${encodeURIComponent(skillAddressKey(sourceFilteredAddress))}`;
      const row = setup.renderer.root.findDescendantById(rowId)!;
      expect(row).toBeDefined();
      const other = `source-installed-skills-row-${encodeURIComponent(skillAddressKey({ source: "other", path: "review" }))}`;
      expect(setup.renderer.root.findDescendantById(other)).toBeUndefined();
      await setup.mockMouse.click(row.screenX + 1, row.screenY);
      await parsedEnter(setup);
      await waitForReaderBody(setup, sourceFilteredAddress.path);
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("source-installed-skills"),
      );
      expect(setup.renderer.root.findDescendantById(rowId)).toBeDefined();
      if (returnBy === "escape") await parsedEscape(setup);
      else await enterLive(setup, "route-back");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(rowId));
    } finally {
      setup.renderer.destroy();
    }
  });
}
