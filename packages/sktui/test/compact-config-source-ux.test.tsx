import { expect, test } from "bun:test";
import { SelectRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { focusLive, parsedEnter } from "./reader-test-controls";

function countById(root: BaseRenderable, id: string): number {
  const visit = (node: BaseRenderable): number =>
    Number(node.id === id) + node.getChildren().reduce((count, child) => count + visit(child), 0);
  return visit(root);
}

async function openConfig(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
  );
  const tab = setup.renderer.root.findDescendantById("top-navigation-tab-global")!;
  await setup.mockMouse.click(tab.screenX + 1, tab.screenY);
  await setup.waitForFrame((frame) => frame.includes("Global Config / Sources"));
}

async function openConfigSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await focusLive(setup, "shell-section-tab-sources");
  await setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Global Config / Config Sources"));
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
    const pane = setup.renderer.root.findDescendantById("config-work-area")!;
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("global-source-1");
    expect(frame).toContain("Selected Source");
    for (const label of ["Check / update", "Find and install"]) expect(frame).toContain(label);
    for (const id of ["check-updates", "add-skills", "remove-source"]) {
      const control = await focusLive(setup, `config-command-${id}`);
      await setup.renderOnce();
      expect(control.screenY).toBeGreaterThan(pane.screenY);
      expect(control.screenY + control.height).toBeLessThan(pane.screenY + pane.height);
      expect(setup.captureCharFrame()).toContain(
        control.id === "config-command-check-updates"
          ? "Check / update"
          : id === "add-skills"
            ? "Find and install"
            : "Remove Source",
      );
    }
    const add = await focusLive(setup, "config-command-add-source");
    await setup.renderOnce();
    expect(add.screenY).toBeGreaterThanOrEqual(pane.screenY);
    expect(add.screenY + add.height).toBeLessThanOrEqual(pane.screenY + pane.height);
    const returnedBrowser = (await focusLive(setup, "config-source-browser")) as SelectRenderable;
    await setup.renderOnce();
    expect(returnedBrowser.screenY).toBeGreaterThanOrEqual(pane.screenY);
    expect(returnedBrowser.screenY + returnedBrowser.height).toBeLessThanOrEqual(
      pane.screenY + pane.height,
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
    const pane = setup.renderer.root.findDescendantById("config-work-area")!;
    const command = await focusLive(setup, "config-command-add-config-source");
    await setup.renderOnce();
    expect(command.screenY).toBeGreaterThan(pane.screenY);
    expect(command.screenY + command.height).toBeLessThan(pane.screenY + pane.height);
    expect(setup.captureCharFrame()).toContain("Register a reusable Config Source");
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
    const pane = setup.renderer.root.findDescendantById("config-work-area")!;
    const browser = (await focusLive(setup, "config-config-source-browser")) as SelectRenderable;
    await setup.waitFor(() => browser.getSelectedOption()?.value === "/configSources/team-config");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("team-config");
    expect(countById(setup.renderer.root, "config-command-add-config-source")).toBe(1);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    const labels: Record<string, string> = {
      "config-observe": "Check / review Config update",
      "config-remove": "Remove Config Source",
      "config.source.back": "Back to Config Sources",
    };
    for (const id of Object.keys(labels)) {
      const control = await focusLive(setup, `config-command-${id}`);
      await setup.renderOnce();
      expect(control.screenY).toBeGreaterThan(pane.screenY);
      expect(control.screenY + control.height).toBeLessThan(pane.screenY + pane.height);
      expect(setup.captureCharFrame().split("\n")[control.screenY]).toContain(labels[id]!);
    }
    expect(countById(setup.renderer.root, "config-command-config-observe")).toBe(1);
    expect(countById(setup.renderer.root, "config-command-config-adopt")).toBe(0);
    expect(countById(setup.renderer.root, "config-command-add-config-source")).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
