import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, sourceFilteredReaderProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
async function openSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-sources"));
  await focusLive(setup, "shell-section-tab-sources");
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
}
async function openSourceDetails(setup: Awaited<ReturnType<typeof testRender>>) {
  await openSources(setup);
  const browser = (await focusLive(setup, "source-browser")) as SelectRenderable;
  const sourceIndex = browser.options.findIndex((option) => option.value === "team-main");
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  browser.setSelectedIndex(sourceIndex);
  await setup.flush();
  await focusLive(setup, "source-browser");
  await parsedEnter(setup);
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
  } catch (error) {
    console.error(
      "Source update entry",
      setup.renderer.currentFocusedRenderable?.id,
      setup.captureCharFrame(),
    );
    throw error;
  }
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  const index = choices.options.findIndex(
    (option) => option.value.id === "source-updates.source-details",
  );
  expect(index).toBeGreaterThanOrEqual(0);
  choices.setSelectedIndex(index);
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
  await setup.flush();
}
test("All Skills selection keeps a persistent Reader, loads its exact address, and has no Inspector step", async () => {
  for (const viewport of [
    { width: 120, height: 40 },
    { width: 80, height: 16 },
    { width: 43, height: 30 },
  ]) {
    const reads: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              { address },
            ) => {
              reads.push(`${address.source}/${address.path}`);
              return {
                address,
                name: address.path,
                description: "Loaded from the selected address",
                rawText: `Body ${address.path}`,
                markdownText: `# ${address.path}\n\nBody ${address.path}`,
              };
            },
          })}
          exit={() => {}}
        />
      ),
      viewport,
    );
    try {
      const browser = await openAllInstalledSkills(setup);
      await waitForReaderBody(setup, "Body guide", viewport.width >= 100);
      expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeDefined();
      expect(reads).toEqual(["team-main/guide"]);
      await parsedEnter(setup);
      await waitForReaderBody(setup, "Body guide");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
      await parsedEscape(setup);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      await focusLive(setup, "installed-skill-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(
        () => browser.getSelectedOption()?.value === JSON.stringify(["team-main", "reference"]),
      );
      await waitForReaderBody(setup, "Body reference", viewport.width >= 100);
      expect(reads).toEqual(["team-main/guide", "team-main/reference"]);
      expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
    } finally {
      setup.renderer.destroy();
    }
  }
});
test("Reader Details keeps its action surface reachable and discloses the full address only there", async () => {
  const base = readerProjection();
  const projection = {
    ...base,
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        description: Array.from(
          { length: 80 },
          (_, index) => `Long detail line ${index + 1}.`,
        ).join(" "),
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  try {
    await openAllInstalledSkills(setup);
    expect(setup.captureCharFrame()).not.toContain("team-main/guide");
    await parsedEnter(setup);
    await openReaderTab(setup, 2);
    const details = setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable;
    expect(details).toBeDefined();
    await setup.waitForFrame((frame) => frame.includes("team-main/guide"));
    expect(
      setup.renderer.root.findDescendantById("reader-action-skill-check-updates"),
    ).toBeDefined();
    expect(details.viewport.height).toBeGreaterThan(0);
  } finally {
    setup.renderer.destroy();
  }
});
test("compact Skills defaults to Agent access without mounting an installed browser until All Skills is chosen", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  try {
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    await openAllInstalledSkills(setup);
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeDefined();
    await focusLive(setup, "skills-view-tab-current-exposure");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("agent-access-pane"));
  } finally {
    setup.renderer.destroy();
  }
});
test("Source details disclose management actions and provenance only on request", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openSourceDetails(setup);
    const initial = setup.captureCharFrame();
    expect(initial).toContain("View installed Skills · 2");
    expect(initial).toContain("Check updates");
    expect(initial).not.toContain("Tracked ref");
    expect(initial).not.toContain("Remove Source declaration");
    await focusLive(setup, "source-details-toggle");
    await parsedEnter(setup);
    expect(setup.captureCharFrame()).toContain("Tracked ref");
    await focusLive(setup, "source-actions-toggle");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Remove Source declaration"));
  } finally {
    setup.renderer.destroy();
  }
});
test("Source action/detail disclosures close without losing the selected source", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await openSourceDetails(setup);
    for (const id of [
      "source-actions-toggle",
      "source-actions-toggle",
      "source-details-toggle",
      "source-details-toggle",
    ]) {
      await focusLive(setup, id);
      await parsedEnter(setup);
    }
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-updates-browser",
    );
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    const returned = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(returned.getSelectedOption()?.value).toBe("team-main");
  } finally {
    setup.renderer.destroy();
  }
});
test("Source installed-Skills handoff keeps its source filter and Back returns to that source", async () => {
  const projection = sourceFilteredReaderProjection();
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openSourceDetails(setup);
    await focusLive(setup, "source-command-skills");
    await parsedEnter(setup);
    const browser = (await focusLive(setup, "installed-skill-browser")) as SelectRenderable;
    const expected = projection.installedSkills
      .filter((skill) => skill.address.source === "team-main")
      .map((skill) => JSON.stringify([skill.address.source, skill.address.path]));
    expect(browser.options.map((option) => option.value)).toEqual(expected);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    expect(setup.captureCharFrame()).toContain("team-main");
    expect(setup.renderer.root.findDescendantById("source-command-skills")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
