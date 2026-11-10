import { expect, test } from "bun:test";
import { SelectRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import { openSettingsCategory } from "./settings-test-controls";

function countById(root: BaseRenderable, id: string): number {
  const visit = (node: BaseRenderable): number =>
    Number(node.id === id) + node.getChildren().reduce((count, child) => count + visit(child), 0);
  return visit(root);
}

async function openConfig(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.flush();
  await openMainPage(setup, "settings");
  await enterLive(setup, "shell-scope-select");
  const choices = (await focusLive(setup, "scope-choices")) as SelectRenderable;
  choices.setSelectedIndex(choices.options.findIndex((option) => option.value === "global"));
  await parsedEnter(setup);
  await openSettingsCategory(setup, "sources");
}

async function openConfigSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await openSettingsCategory(setup, "config-sources");
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("config-config-source-browser") ||
      setup.captureCharFrame().includes("No Config Sources yet"),
  );
}

test("RENDER compact Global Sources shows selection/list and reveals every source action inside its pane", async () => {
  const base = workspaceProjection();
  const template = base.effective.sources[0]!;
  const effectiveSources = Array.from({ length: 8 }, (_, index) => ({
    ...template,
    id: `global-source-${index}`,
    ref: `branch-${index}`,
  }));
  const declaredSources = effectiveSources.map((source, index) => ({
    ...source,
    trackedRef: source.ref,
    ref: {
      id: source.id,
      owner: {
        level: "global" as const,
        file: base.configs[0]!.file.file,
        pointer: `/sources/${index}`,
      },
    },
  }));
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? { ...config, direct: { ...config.direct, sources: declaredSources } }
        : config,
    ),
    effective: { ...base.effective, sources: effectiveSources },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    {
      width: 80,
      height: 16,
    },
  );
  try {
    await openConfig(setup);
    const browser = (await focusLive(setup, "config-source-browser")) as SelectRenderable;
    await setup.mockInput.pressArrow("down");
    await setup.waitFor(() => browser.getSelectedOption()?.value === "global-source-1");
    await parsedEnter(setup);
    const pane = setup.renderer.root.findDescendantById("config-object-pane")!;
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-command-check-updates",
    );
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-add-skills");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-remove-source");
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("global-source-1");
    for (const id of ["check-updates", "add-skills", "remove-source"]) {
      const control = await focusLive(setup, `config-command-${id}`);
      await setup.renderOnce();
      expect(control.screenY).toBeGreaterThan(pane.screenY);
      expect(control.screenY + control.height).toBeLessThanOrEqual(pane.screenY + pane.height);
      expect(setup.captureCharFrame()).toContain(
        control.id === "config-command-check-updates"
          ? "Check updates"
          : id === "add-skills"
            ? "Find and install"
            : "Remove Source",
      );
    }
    await parsedEscape(setup);
    const browserPane = setup.renderer.root.findDescendantById("config-browser-pane")!;
    const add = await focusLive(setup, "config-command-add-source");
    await setup.renderOnce();
    expect(add.screenY).toBeGreaterThanOrEqual(browserPane.screenY);
    expect(add.screenY + add.height).toBeLessThanOrEqual(browserPane.screenY + browserPane.height);
    const returnedBrowser = (await focusLive(setup, "config-source-browser")) as SelectRenderable;
    await setup.renderOnce();
    expect(returnedBrowser.screenY).toBeGreaterThanOrEqual(browserPane.screenY);
    expect(returnedBrowser.screenY + returnedBrowser.height).toBeLessThanOrEqual(
      browserPane.screenY + browserPane.height,
    );
    expect(setup.captureCharFrame()).toContain("global-source-1");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER compact empty Config Sources keeps the add action in the bounded work area", async () => {
  const base = workspaceProjection();
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? { ...config, direct: { ...config.direct, configSources: [] } }
        : config,
    ),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    {
      width: 80,
      height: 16,
    },
  );
  try {
    await openConfig(setup);
    await openConfigSources(setup);
    const pane = setup.renderer.root.findDescendantById("config-browser-pane")!;
    const command = await focusLive(setup, "config-command-add-config-source");
    await setup.renderOnce();
    expect(command.screenY).toBeGreaterThan(pane.screenY);
    expect(command.screenY + command.height).toBeLessThan(pane.screenY + pane.height);
    expect(setup.captureCharFrame()).toContain("No Config Sources yet");
    expect(setup.captureCharFrame()).toContain("Add Config Source");
    expect(countById(setup.renderer.root, "config-command-add-config-source")).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-add-config-source");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER compact populated Config Sources has one list action owner and keeps inspector actions bounded", async () => {
  const base = workspaceProjection();
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            direct: {
              ...config.direct,
              configSources: config.direct.configSources.map((source) => ({
                ...source,
                binding: {
                  kind: "github" as const,
                  origin: "https://github.com/acme/config",
                  root: ".",
                  ref: "main",
                },
                adoption: { status: "not-adopted" as const },
              })),
            },
          }
        : config,
    ),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    {
      width: 80,
      height: 16,
    },
  );
  try {
    await openConfig(setup);
    await openConfigSources(setup);
    const browser = (await focusLive(setup, "config-config-source-browser")) as SelectRenderable;
    await setup.waitFor(() => browser.getSelectedOption()?.value === "/configSources/team-config");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("team-config");
    expect(countById(setup.renderer.root, "config-command-add-config-source")).toBe(1);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    const pane = setup.renderer.root.findDescendantById("config-object-pane")!;
    const labels: Record<string, string> = {
      "config-observe": "Review update",
      "config-remove": "Remove Config Source",
    };
    for (const id of Object.keys(labels)) {
      const control = await focusLive(setup, `config-command-${id}`);
      await setup.renderOnce();
      expect(control.screenY).toBeGreaterThan(pane.screenY);
      expect(control.screenY + control.height).toBeLessThanOrEqual(pane.screenY + pane.height);
      expect(setup.captureCharFrame().split("\n")[control.screenY]).toContain(labels[id]!);
    }
    expect(countById(setup.renderer.root, "config-command-config-observe")).toBe(1);
    expect(countById(setup.renderer.root, "config-command-config-adopt")).toBe(0);
    expect(countById(setup.renderer.root, "config-command-add-config-source")).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
