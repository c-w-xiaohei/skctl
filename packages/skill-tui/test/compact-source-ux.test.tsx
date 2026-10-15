import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";

async function openSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-sources"));
  const tab = setup.renderer.root.findDescendantById("shell-section-tab-sources")!;
  await setup.mockMouse.click(tab.screenX + 1, tab.screenY);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
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
    await enterLive(setup, "source-browser");
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
    await enterLive(setup, "source-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("source-7");
    const pane = setup.renderer.root.findDescendantById("source-details-pane")!;
    const footer = setup.renderer.root.findDescendantById("command-status")!;
    const commands = [
      "workspace-action-add-skills",
      "workspace-action-remove-source",
      "source-command-skills",
      "source-command-config",
    ];
    for (const id of commands) {
      const command = await focusLive(setup, id);
      await setup.renderOnce();
      assertInsidePane(command, pane);
      expect(command.screenY + command.height).toBeLessThanOrEqual(footer.screenY);
      expect(command.id).toBe(id);
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
