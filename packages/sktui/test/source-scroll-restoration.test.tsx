import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import { selectScrollOffset } from "../src/select-scroll";

type Setup = Awaited<ReturnType<typeof testRender>>;

function native(id: string, setup: Setup): SelectRenderable {
  const target = setup.renderer.root.findDescendantById(id);
  if (!(target instanceof SelectRenderable)) throw new Error(`${id} is not a SelectRenderable`);
  return target;
}

async function openSources(setup: Setup) {
  await openMainPage(setup, "sources");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
  await focusLive(setup, "source-browser");
}

function sourcesProjection(): WorkspaceView {
  const base = workspaceProjection({ includeContribution: false });
  const sources = Array.from({ length: 14 }, (_, index) => ({
    id: `source-${index}`,
    kind: "github" as const,
    origin: `https://github.com/acme/source-${index}`,
    root: "skills",
    ref: "main",
    provenance: { level: "project" as const },
    selectors: [],
  }));
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              sources: sources.map((source) => ({
                ...source,
                ref: {
                  id: source.id,
                  owner: {
                    level: "project" as const,
                    file: "/workspace/skctl/skctl.jsonc",
                    pointer: `/sources/${source.id}`,
                  },
                },
              })),
            },
          }
        : config,
    ),
    effective: { ...base.effective, sources },
  };
}

test("RENDER Sources restores exact selected source and native offset after Inspector replacement", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(sourcesProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await setup.flush();
    await openSources(setup);
    const selectionListeners = setup.renderer.listenerCount("selection");
    const viewTabs = setup.renderer.root.findDescendantById("source-view-viewport");
    const browser = native("source-browser", setup);
    for (let index = 0; index < 10; index++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      expect(setup.renderer.root.findDescendantById("source-view-viewport") === viewTabs).toBe(
        true,
      );
      expect(setup.renderer.listenerCount("selection")).toBe(selectionListeners);
    }
    const selected = browser.getSelectedOption()?.value;
    await setup.flush();
    expect(setup.renderer.listenerCount("selection")).toBe(selectionListeners);
    const offset = selectScrollOffset(browser);
    expect(selected).toBe("source-10");
    await parsedEnter(setup);
    await setup.flush();
    await enterLive(setup, "source-view-tab-settings");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await setup.waitForFrame((frame) => frame.includes("https://github.com/acme/source-10"));
    const detailFrame = setup.captureCharFrame();
    expect(detailFrame).toContain("source-10");
    expect(detailFrame).toContain("https://github.com/acme/source-10");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-view-tab-settings");
    let escapeCount = 0;
    const onEscape = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") escapeCount += 1;
    };
    setup.renderer.keyInput.prependListener("keypress", onEscape);
    await parsedEscape(setup);
    setup.renderer.keyInput.off("keypress", onEscape);
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(native("source-browser", setup).getSelectedOption()?.value).toBe(selected);
    expect(selectScrollOffset(native("source-browser", setup))).toBe(offset);
    expect(escapeCount).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
