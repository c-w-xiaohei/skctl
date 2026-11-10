import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  openInstallation,
  parsedEscape,
  parsedEnter,
} from "./reader-test-controls";
async function mount(width: number, height = 30) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/keyboard-guidance-");
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  let loads = 0;
  let updates = 0;
  const core = directSourceCore(readerProjection(), {
    loadInstalledSkill: async () => {
      loads++;
      return readerContent;
    },
    listInstalledResources: async () => readerResources,
    updateSkills: async () => {
      updates++;
      return { value: undefined, diagnostics: [] };
    },
  });
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  const dispose = async () => {
    setup?.renderer.destroy();
    if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
    await rm(cache, { recursive: true, force: true });
  };
  try {
    setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("reader-scrollbox"));
    return { setup, loads: () => loads, updates: () => updates, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
test("Skill controls expose their actual Enter action and Tab moves without executing", async () => {
  const mounted = await mount(100);
  const { setup } = mounted;
  try {
    const loadsAfterOpen = mounted.loads();
    await focusLive(setup, "reader-more");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("More");
    expect(setup.captureCharFrame()).toContain("Tab panels");
    setup.mockInput.pressTab();
    await setup.flush();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-skills",
    );
    setup.mockInput.pressTab();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-more-actions");
    await setup.waitForFrame((frame) => frame.includes("Actions"));
    expect(setup.renderer.root.findDescendantById("scope-choices")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-tabs-tab-skill")).toBeDefined();
    expect(mounted.loads()).toBe(loadsAfterOpen);
    expect(mounted.updates()).toBe(0);
    setup.mockInput.pressTab({ shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-skills",
    );
    setup.mockInput.pressTab({ shift: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-more");
    await parsedEnter(setup);
    await enterLive(setup, "reader-menu-raw");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-line-0"));
    await enterLive(setup, "reader-more");
    await setup.waitForFrame((frame) => frame.includes("Show formatted text"));
    await parsedEscape(setup);
    expect(mounted.loads()).toBe(loadsAfterOpen);
    await focusLive(setup, "reader-tabs-tab-skill");
    await setup.waitForFrame((frame) => frame.includes("←→ move"));
    await openReaderTab(setup, 1);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
    await openInstallation(setup);
    await focusLive(setup, "reader-details-action-skill-add-to-collection");
    await setup.waitForFrame((frame) => frame.includes("Add to Collection"));
    expect(mounted.updates()).toBe(0);
  } finally {
    await mounted.dispose();
  }
});
test("narrow Reader retains specific Enter guidance and native tab selection", async () => {
  const mounted = await mount(43);
  const { setup } = mounted;
  try {
    const loadsAfterOpen = mounted.loads();
    await focusLive(setup, "reader-details-action-skill-add-to-collection");
    await setup.waitForFrame((frame) => frame.includes("Add to Collection"));
    expect(setup.renderer.root.findDescendantById("command-status")?.height).toBe(1);
    expect(setup.captureCharFrame()).not.toContain("Enter details");
    expect(mounted.loads()).toBe(loadsAfterOpen);
    expect(mounted.updates()).toBe(0);
    await focusLive(setup, "reader-tabs-tab-skill");
    await openReaderTab(setup, 1);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
    expect(mounted.loads()).toBe(loadsAfterOpen);
    expect(mounted.updates()).toBe(0);
  } finally {
    await mounted.dispose();
  }
});
