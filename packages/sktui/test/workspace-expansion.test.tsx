import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
import { openMainPage } from "./main-page-controls";
import { openSettingsCategory } from "./settings-test-controls";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";

test("Instructions and Settings omit a menu with no object commands", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    for (const tab of ["description", "settings"]) {
      await enterLive(setup, `collection-tabs-tab-${tab}`);
      expect(!!setup.renderer.root.findDescendantById("collection-more")).toBe(false);
    }
  } catch (error) {
    throw new Error(`${error}\n${setup.captureCharFrame()}`);
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader preserves reading position across pages and resize without a layout return step", async () => {
  let reads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => {
            reads++;
            return {
              ...readerContent,
              markdownText: Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n\n"),
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    const body = (await focusLive(setup, "reader-scrollbox")) as ScrollBoxRenderable;
    setup.mockInput.pressKey("END");
    await setup.flush();
    const scroll = body.scrollTop;
    const width = body.width;
    await openMainPage(setup, "sources");
    await openMainPage(setup, "skills");
    await setup.waitFor(
      () => (live(setup, "reader-scrollbox") as ScrollBoxRenderable).scrollTop === scroll,
    );
    await focusLive(setup, "reader-scrollbox");
    setup.resize(43, 30);
    await setup.flush();
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    setup.resize(120, 30);
    await setup.flush();
    expect(live(setup, "reader-scrollbox").width).toBe(width);
    await focusLive(setup, "reader-scrollbox");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(reads).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader closes its resource first and Actions has no manual layout command", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          listInstalledResources: async () => readerResources,
          readInstalledResource: async (_env, request) => ({
            kind: "text",
            path: request.path,
            format: "text",
            text: "Resource body",
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    const width = live(setup, "reader-pane").width;
    await openReaderTab(setup, 1);
    const resources = (await focusLive(setup, "resource-browser")) as SelectRenderable;
    resources.setSelectedIndex(
      resources.options.findIndex((option) => option.value === "docs/guide.md"),
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Resource body"));
    await focusLive(setup, "resource-content");
    await parsedEscape(setup);
    expect(!!setup.renderer.root.findDescendantById("resource-content")).toBe(false);
    expect(live(setup, "reader-pane").width).toBe(width);
    await enterLive(setup, "shell-more-actions");
    const choices = (await focusLive(setup, "palette-choices")) as SelectRenderable;
    expect(choices.options.some((option) => option.value.id === "workspace.toggle-view")).toBe(
      false,
    );
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  ["sources", "source-browser", "source-details-pane"],
  ["collections", "collection-browser", "collection-detail-pane"],
  ["settings", "config-source-browser", "config-object-pane"],
] as const)(
  "%s automatically adapts and returns to its original browser",
  async (page, browserId, objectId) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
      { width: 120, height: 30 },
    );
    try {
      await openMainPage(setup, page);
      if (page === "settings") {
        await enterLive(setup, "shell-scope-select");
        const scope = (await focusLive(setup, "scope-choices")) as SelectRenderable;
        scope.setSelectedIndex(scope.options.findIndex((option) => option.value === "project"));
        await parsedEnter(setup);
        await openSettingsCategory(setup, "sources");
      }
      await enterLive(setup, browserId);
      const width = live(setup, objectId).width;
      setup.resize(43, 30);
      await setup.flush();
      await enterLive(setup, "route-back");
      if (page === "settings") await focusLive(setup, browserId);
      else await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === browserId);
      await parsedEnter(setup);
      setup.resize(120, 30);
      await setup.flush();
      expect(live(setup, objectId).width).toBe(width);
    } catch (error) {
      throw new Error(`${page}: ${error}\n${setup.captureCharFrame()}`);
    } finally {
      setup.renderer.destroy();
    }
  },
);
