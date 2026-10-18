import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  readerTab,
  selectedReaderTab,
} from "./reader-test-controls";
test("RENDER Skills browser owns slash query and updates its local result count", async () => {
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
    await setup.renderOnce();
    await openAllInstalledSkills(setup);
    await setup.waitForFrame((frame) => /Skills ·/.test(frame));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
    expect(browser.options.map((option) => option.value)).toHaveLength(2);
    const query = setup.renderer.root.findDescendantById("skills-query")!;
    query.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    await setup.mockInput.pressKey("f");
    await setup.waitFor(() => browser.options.length === 1);
    await setup.waitForFrame((frame) => /Skills.*1\s*\/\s*2/.test(frame));
    expect(browser.options.map((option) => option.value)).toHaveLength(1);
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "f",
    );
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER filtering selected A reconciles Reader and Details Actions to visible B", async () => {
  const loads: string[] = [];
  const checks: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (
            _environment: import("@skill-cli/core").CoreOptions,
            { address },
          ) => {
            loads.push(address.path);
            return { ...readerContent, address, name: address.path };
          },
          checkUpdate: async (_environment: import("@skill-cli/core").CoreOptions, { source }) => {
            checks.push(source);
            return {
              value: {
                source,
                kind: "github",
                exactRevision: "a".repeat(40),
                changed: [{ path: "reference", name: "reference", description: "reference" }],
                added: [],
                removed: [],
                unchanged: [],
              },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openAllInstalledSkills(setup);
    await setup.waitForFrame((frame) => frame.includes("guide") && frame.includes("reference"));
    const query = setup.renderer.root.findDescendantById("skills-query")!;
    query.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
    for (const key of ["r", "e", "f"]) {
      await setup.mockInput.pressKey(key);
      await setup.renderOnce();
    }
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
    await setup.waitFor(() => browser.options.length === 1);
    await setup.waitForFrame((frame) => /Skills.*1\s*\/\s*2/.test(frame));
    expect(browser.options.map((option) => option.value)).toEqual(['["team-main","reference"]']);
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    expect(loads.at(-1)).toBe("reference");
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
    await openReaderTab(setup, 2);
    const detailsTab = readerTab(setup, 2);
    expect(selectedReaderTab(setup)).toBe(2);
    expect(setup.renderer.currentFocusedRenderable).toBe(detailsTab);
    expect(setup.captureCharFrame()).toContain("reference");
    await enterLive(setup, "reader-action-skill-check-updates");
    await setup.waitFor(() => checks.length === 1);
    expect(loads).toEqual(["guide", "reference"]);
    expect(checks).toEqual(["team-main"]);
  } finally {
    setup.renderer.destroy();
  }
});
