import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { focusLive, parsedEscape } from "./reader-test-controls";

async function openSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await focusLive(setup, "shell-section-tab-skills");
  for (const section of ["collections", "sources"]) {
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === `shell-section-tab-${section}`,
    );
  }
  return (await focusLive(setup, "source-browser")) as SelectRenderable;
}

function assertInsidePane(
  target: { screenY: number; height: number },
  pane: { screenY: number; height: number },
) {
  expect(target.screenY).toBeGreaterThan(pane.screenY);
  expect(target.screenY + target.height).toBeLessThan(pane.screenY + pane.height);
}

test("RENDER compact Sources keeps native rows, source identity, and every detail action inside the pane", async () => {
  const projection = workspaceProjection();
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...projection.effective.sources[0]!,
    id: `source-${index}`,
  }));
  const compactProjection = {
    ...projection,
    configs: projection.configs.map((config) =>
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
                    file: "/workspace/skill-cli/skill-cli.jsonc",
                    pointer: `/sources/${source.id}`,
                  },
                },
              })),
            },
          }
        : config,
    ),
    effective: { ...projection.effective, sources },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(compactProjection)} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  try {
    const browser = await openSources(setup);
    await setup.waitFor(() => browser.height >= 2);
    expect(setup.captureCharFrame()).toContain("source-0");

    const first = setup.renderer.hitTest(browser.screenX + 1, browser.screenY);
    expect(first).toBe(browser.num);
    await setup.mockMouse.click(browser.screenX + 1, browser.screenY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await parsedEscape(setup);
    const returned = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(returned.getSelectedOption()?.value).toBe("source-0");

    await focusLive(setup, "source-browser");
    for (let index = 1; index < 8; index++) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => returned.getSelectedIndex() === index);
    }
    expect(returned.getSelectedOption()?.value).toBe("source-7");
    const offset = selectScrollOffset(returned);
    expect(offset).toBeGreaterThan(0);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("source-7");

    const lastY = returned.screenY + returned.height - 1;
    await setup.mockMouse.click(returned.screenX + 1, lastY);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("source-7");
    expect(setup.captureCharFrame()).toContain("Check / update installed Skills");
    expect(setup.captureCharFrame()).toContain("Find and install Skills");

    const pane = setup.renderer.root.findDescendantById("source-details-pane")!;
    const footer = setup.renderer.root.findDescendantById("command-status")!;
    const commands = [
      "workspace-action-check-updates",
      "workspace-action-add-skills",
      "workspace-action-remove-source",
      "source-command-skills",
      "source-command-config",
    ];
    const labels: Record<string, string> = {
      "workspace-action-check-updates": "Check / update installed Skills",
      "workspace-action-add-skills": "Find and install Skills",
      "workspace-action-remove-source": "Remove Source declaration",
      "source-command-skills": "Browse installed Skills",
      "source-command-config": "View owning Config",
    };
    for (const id of commands) {
      const command = await focusLive(setup, id);
      await setup.renderOnce();
      assertInsidePane(command, pane);
      expect(command.screenY + command.height).toBeLessThanOrEqual(footer.screenY);
      const lines = setup.captureCharFrame().split("\n");
      expect(lines[command.screenY]).toContain(labels[id]!);
    }

    await parsedEscape(setup);
    const restored = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(restored.getSelectedOption()?.value).toBe("source-7");
    expect(selectScrollOffset(restored)).toBe(offset);
    expect(setup.captureCharFrame()).toContain("source-7");
  } finally {
    setup.renderer.destroy();
  }
});
