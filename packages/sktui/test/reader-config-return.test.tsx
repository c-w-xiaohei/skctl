/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { ConfigPage } from "../src/config-page";
import { createConfigState } from "../src/config/state";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";
import {
  enterLive,
  expectSharedReturn,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
async function tabToSharedReturn(setup: Setup) {
  let reached = false;
  for (let index = 0; index < 12; index++) {
    setup.mockInput.pressTab();
    await setup.flush();
    if (setup.renderer.currentFocusedRenderable?.id === "route-back") {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
}
async function openResourceContent(setup: Setup) {
  await openAllInstalledSkills(setup);
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
  await openReaderTab(setup, 1);
  const browser = (await focusLive(setup, "resource-browser")) as SelectRenderable;
  const index = browser.options.findIndex((option) => option.value === "docs/guide.md");
  expect(index).toBeGreaterThanOrEqual(0);
  browser.setSelectedIndex(index);
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
}
function configProjection(): WorkspaceView {
  const base = workspaceProjection({ includeContribution: false });
  const integrationOwner = { ...directOwner, pointer: "/agents/opencode" };
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level !== "project"
        ? config
        : {
            ...config,
            direct: {
              ...config.direct,
              configSources: [
                {
                  id: "shared",
                  owner: { ...directOwner, pointer: "/configSources/shared" },
                  binding: {
                    kind: "github",
                    origin: "https://github.com/acme/config",
                    root: ".",
                    ref: "main",
                  },
                  adoption: { status: "adopted", commit: "a".repeat(40) },
                  contributed: { sources: [], collections: [] },
                },
              ],
              integrations: [{ kind: "opencode", owner: integrationOwner }],
            },
          },
    ),
    effective: {
      ...base.effective,
      agent: {
        status: "available",
        integration: [integrationOwner],
        use: [],
        reasons: [],
        catalog: ["team/alpha", "team/beta"].map((selector) => ({
          selector,
          name: selector,
          description: "Read-only catalog entry",
          aliases: [],
        })),
      },
    },
  };
}
async function chooseProject(setup: Setup) {
  await openMainPage(setup, "settings");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-scope-select"));
  await enterLive(setup, "shell-scope-select");
  await setup.waitFor(() => {
    const choices = setup.renderer.root.findDescendantById("scope-choices");
    return (
      choices instanceof SelectRenderable &&
      choices.options.some((option) => option.value === "project") &&
      setup.renderer.currentFocusedRenderable === choices
    );
  });
  await setup.flush();
  const choices = setup.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
  const project = choices.options.findIndex((option) => option.value === "project");
  expect(project).toBeGreaterThanOrEqual(0);
  choices.setSelectedIndex(project);
  await parsedEnter(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("settings-section-tab-sources"),
  );
}
async function openProjectIntegrations(setup: Setup) {
  await openMainPage(setup, "agent");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("agent-view-tab-project"));
  await enterLive(setup, "agent-view-tab-project");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-hosts"));
}
async function openProjectConfigSource(setup: Setup) {
  await chooseProject(setup);
  await enterLive(setup, "settings-section-tab-config-sources");
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("config-config-source-browser"),
  );
  await focusLive(setup, "config-config-source-browser");
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
}
test("RENDER Reader resource uses shared Back without a route predecessor and preserves resource-list recovery", async () => {
  let settleRead:
    | ((value: { kind: "text"; path: string; format: "markdown"; text: string }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
          listInstalledResources: async () => readerResources,
          readInstalledResource: (_environment: import("@skctl/core").CoreOptions, request) =>
            new Promise((resolve) => {
              settleRead = resolve;
              expect(request.path).toBe("docs/guide.md");
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openResourceContent(setup);
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("reader-resource-back")).toBe(false);
    await expectSharedReturn(setup, "Back to Resources");
    for (const [width, height] of [
      [144, 40],
      [100, 24],
      [80, 24],
      [43, 13],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      const path = setup.renderer.root.findDescendantById("reader-resource-path")!;
      const content = setup.renderer.root.findDescendantById("resource-content")!;
      expect(path.screenX + path.width).toBeLessThanOrEqual(width);
      expect(content.height).toBeGreaterThan(0);
      expect(content.screenY + content.height).toBeLessThanOrEqual(height - 1);
    }
    setup.resize(120, 40);
    await setup.flush();
    await focusLive(setup, "resource-content");
    await tabToSharedReturn(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("palette-choices"));
    const actions = setup.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
    expect(actions.options.some((option) => option.value.id === "reader.resource.back")).toBe(true);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "route-back");
    await parsedEnter(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("resource-content"));
    const browser = setup.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe("docs/guide.md");
    settleRead!({ kind: "text", path: "docs/guide.md", format: "markdown", text: "late resource" });
    await setup.renderOnce();
    expect(!!setup.renderer.root.findDescendantById("resource-content")).toBe(false);
    expect(setup.captureCharFrame()).not.toContain("late resource");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Integrations keeps host entries reachable across resize and returns to Config Sources", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(configProjection())}
        integrations={{
          inspect: async (target) => ({
            target,
            recommended: "codex-hooks",
            selectionReason: "Host entries",
            cli: "/bin/skctl",
            revision: "1",
            candidates: [],
            diagnostics: [],
            nextSteps: [],
            entries: [
              {
                mechanism: "codex-hooks",
                file: "/project/.codex/hooks.json",
                inherited: false,
                status: "current",
                selected: "unknown",
              },
            ],
          }),
          connect: async () => {
            throw new Error("Navigation must not connect");
          },
          disconnect: async () => {
            throw new Error("Navigation must not disconnect");
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 80, height: 30 },
  );
  try {
    await openProjectIntegrations(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    for (const [width, height] of [
      [144, 40],
      [100, 24],
      [80, 24],
      [43, 13],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      await focusLive(setup, "integration-entries");
      const entries = setup.renderer.root.findDescendantById(
        "integration-entries",
      ) as SelectRenderable;
      expect(entries.getSelectedOption()?.value).toBe("/project/.codex/hooks.json");
      expect(entries.width).toBeGreaterThan(0);
      expect(entries.screenX + entries.width).toBeLessThanOrEqual(width);
    }
    setup.resize(80, 30);
    await setup.flush();
    await chooseProject(setup);
    await enterLive(setup, "settings-section-tab-config-sources");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-config-source-browser"),
    );
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config Source inspector returns through the shared header to its selected list", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 80, height: 30 },
  );
  try {
    await openProjectConfigSource(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("route-back");
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("config-command-config.source.back")).toBe(
      false,
    );
    await expectSharedReturn(setup, "Back to Config Sources");
    const normal = setup.renderer.root.findDescendantById("config-source-update-actions")!;
    const danger = setup.renderer.root.findDescendantById("config-source-danger-actions")!;
    expect(danger.screenY).toBeGreaterThan(normal.screenY);
    for (const id of ["config-command-config-forget", "config-command-config-remove"]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenX).toBeGreaterThanOrEqual(danger.screenX);
      expect(control.screenX + control.width).toBeLessThanOrEqual(danger.screenX + danger.width);
    }
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("config-source-inspector"));
    const browser = setup.renderer.root.findDescendantById(
      "config-config-source-browser",
    ) as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe("/configSources/shared");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("config-source-inspector"));
    expect(browser.getSelectedOption()?.value).toBe("/configSources/shared");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER compact Collection tree keeps its path readable while shared Back returns to Skills", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "open-collection-browser");
    // This Tree is retained while hidden. Node presence is not activation:
    // its native frame measures the viewport, enables/registers the region,
    // then App's pending collection-tree focus can land automatically.
    await setup.waitFor(() => {
      const tree = setup.renderer.root.findDescendantById("collection-filter-tree");
      return (
        tree instanceof ScrollBoxRenderable &&
        tree.focusable &&
        tree.viewport.width > 0 &&
        tree.viewport.height > 0 &&
        setup.renderer.currentFocusedRenderable === tree
      );
    });
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("close-collection-browser")).toBe(false);
    const tree = setup.renderer.root.findDescendantById(
      "collection-filter-tree",
    ) as ScrollBoxRenderable;
    const pane = setup.renderer.root.findDescendantById("collection-filter-pane")!;
    const title = setup.renderer.root.findDescendantById("route-back-slot");
    expect(!!title).toBe(true);
    const back = setup.renderer.root.findDescendantById("route-back")!;
    expect(title!.height).toBeGreaterThan(0);
    expect(back.height).toBeGreaterThan(0);
    expect(back.screenY).toBeGreaterThanOrEqual(title!.screenY);
    expect(back.screenY + back.height).toBeLessThanOrEqual(title!.screenY + title!.height);
    expect(back.screenX + back.width).toBeLessThanOrEqual(80);
    expect(tree.viewport.width).toBeGreaterThanOrEqual(pane.width - 8);
    expect(tree.viewport.height).toBeGreaterThan(0);
    await expectSharedReturn(setup, "Back to Skills");
    expect(setup.captureCharFrame()).toContain("All installed");
    expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
    await tabToSharedReturn(setup);
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER standalone Config keeps explicit nested Back controls without a page-navigation provider", async () => {
  const projection = configProjection();
  const config = createConfigState();
  config.land("project", "config-sources", "/configSources/shared");
  config.openConfigSourceInspector("project");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={config}
        projection={() => projection}
        destination="project"
        actions={[]}
        onSelect={(value) => config.select("project", value)}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 80, height: 30 },
  );
  try {
    await setup.renderOnce();
    await enterLive(setup, "config-command-config.source.back");
    expect(config.configSourceSurface("project")).toBe("list");
    expect(config.selection("project", "config-sources")).toBe("/configSources/shared");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Reader management groups stay inside the actual pane and keep danger separate", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await openReaderTab(setup, 2);
    for (const [width, height] of [
      [144, 40],
      [100, 24],
      [80, 24],
      [43, 13],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      const normal = setup.renderer.root.findDescendantById("reader-settings-actions")!;
      const danger = setup.renderer.root.findDescendantById("reader-danger-actions")!;
      expect(danger.screenY).toBeGreaterThanOrEqual(normal.screenY + normal.height);
      for (const id of ["reader-reload", "reader-details-action-skill-uninstall"]) {
        const control = setup.renderer.root.findDescendantById(id)!;
        const group = id === "reader-reload" ? normal : danger;
        expect(control.screenX).toBeGreaterThanOrEqual(group.screenX);
        expect(control.screenX + control.width).toBeLessThanOrEqual(group.screenX + group.width);
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});
