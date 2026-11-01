import { expect, test } from "bun:test";
import { TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerResources,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
import {
  focusLive,
  enterLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  readerPublicDiagnostic,
  readerTab,
  selectedReaderTab,
} from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
function readerIdentity(setup: Setup) {
  const identity = setup.renderer.root.findDescendantById("reader-identity");
  return identity instanceof TextRenderable ? identity.plainText : undefined;
}
async function boot() {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) =>
            request.address.path === readerSecondAddress.path ? readerSecondContent : readerContent,
          listInstalledResources: async () => readerResources,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  await openAllInstalledSkills(setup);
  await setup.renderOnce();
  await Promise.resolve();
  await openReaderFromInspector(setup);
  await setup.waitFor(() => readerIdentity(setup) === "guide");
  return setup;
}
function expectFocused(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  try {
    expect(target).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
    expect(setup.renderer.currentFocusedRenderable).toBe(target!);
    expect(target!.focused).toBe(true);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : error}\n${readerPublicDiagnostic(setup)}`,
    );
  }
}
test("RENDER Reader tabs own Left/Right, forward Tab enters content, Shift+Tab returns to browser", async () => {
  const setup = await boot();
  try {
    await openReaderTab(setup, 1);
    const resourcesTab = readerTab(setup, 1);
    expect(selectedReaderTab(setup)).toBe(1);
    expect(setup.renderer.currentFocusedRenderable).toBe(resourcesTab);
    await focusLive(setup, "resource-browser");
    expectFocused(setup, "resource-browser");
    await openReaderTab(setup, 0);
    expect(selectedReaderTab(setup)).toBe(0);
    await focusLive(setup, "reader-scrollbox");
    expectFocused(setup, "reader-scrollbox");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-section-tab-skills");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader description expands without replacing instructions", async () => {
  const setup = await boot();
  try {
    const body = setup.renderer.root.findDescendantById("reader-scrollbox");
    expect(setup.renderer.root.findDescendantById("reader-description")).toBeUndefined();
    await enterLive(setup, "reader-description-toggle");
    expect(setup.captureCharFrame()).toContain("A rich Installed Skill");
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
    await enterLive(setup, "reader-description-toggle");
    expect(setup.renderer.root.findDescendantById("reader-description")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader remembers description disclosure for each Skill", async () => {
  const setup = await boot();
  try {
    await enterLive(setup, "reader-description-toggle");
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => readerIdentity(setup) === "reference");
    expect(selectedReaderTab(setup)).toBe(0);
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("reader-description")).toBeUndefined();
    setup.mockInput.pressArrow("up");
    await setup.waitFor(() => readerIdentity(setup) === "guide");
    expect(selectedReaderTab(setup)).toBe(0);
    expect(!!setup.renderer.root.findDescendantById("reader-description")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader Escape returns to the list without unmounting the Reader", async () => {
  const setup = await boot();
  try {
    await focusLive(setup, "reader-scrollbox");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
    await parsedEnter(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader stays mounted across narrow resize and preserves reading focus", async () => {
  const setup = await boot();
  try {
    await focusLive(setup, "reader-scrollbox");
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    const body = setup.renderer.root.findDescendantById("reader-scrollbox");
    setup.resize(79, 40);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser") === browser).toBe(
      true,
    );
    expect(setup.renderer.root.findDescendantById("reader-scrollbox") === body).toBe(true);
    expect(setup.captureCharFrame()).not.toContain("Skills (2)");
    expect(setup.captureCharFrame()).toContain("guide");
    setup.resize(120, 40);
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable).toBe(body!);
    expect(body!.focused).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
