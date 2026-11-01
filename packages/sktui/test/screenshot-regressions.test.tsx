import { expect, test } from "bun:test";
import { SelectRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  waitForReaderBody,
} from "./reader-test-controls";
function projectionWithSkills(count: number): WorkspaceView {
  const projection = readerProjection();
  const template = projection.installedSkills[0]!;
  return {
    ...projection,
    installedSkills: Array.from({ length: count }, (_, index) => {
      const path = `skill-${String(index).padStart(3, "0")}`;
      return {
        ...template,
        address: { source: "team-main", path },
        name: path,
        description: `Description for ${path}`,
      };
    }),
  };
}
test("All Installed Skills Reader follows native arrow selection without an Inspector", async () => {
  const loads: {
    source: string;
    path: string;
  }[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projectionWithSkills(2), {
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => {
            loads.push(address);
            return {
              address,
              name: address.path,
              description: `Description for ${address.path}`,
              rawText: `# ${address.path}\n`,
              markdownText: `# ${address.path}\n`,
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await waitForReaderBody(setup, "skill-000");
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => {
      const current = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        current instanceof SelectRenderable &&
        current.getSelectedOption()?.value === '["team-main","skill-001"]'
      );
    });
    await waitForReaderBody(setup, "skill-001");
    const identity = setup.renderer.root.findDescendantById("reader-identity");
    expect(identity).toBeInstanceOf(TextRenderable);
    expect((identity as TextRenderable).plainText).toContain("skill-001");
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    expect(loads).toEqual([
      { source: "team-main", path: "skill-000" },
      { source: "team-main", path: "skill-001" },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
test("clicking a visible installed skill after native scrolling opens that row", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projectionWithSkills(120))} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await focusLive(setup, "installed-skill-browser");
    for (let step = 0; step < 50; step++) {
      setup.mockInput.pressArrow("down");
      const expectedIndex = step + 1;
      await setup.waitFor(() => {
        const current = setup.renderer.root.findDescendantById("installed-skill-browser");
        return current instanceof SelectRenderable && current.getSelectedIndex() === expectedIndex;
      });
    }
    await setup.waitFor(() => {
      const current = setup.renderer.root.findDescendantById("installed-skill-browser");
      return current instanceof SelectRenderable && selectScrollOffset(current) > 0;
    });
    const currentBrowser = setup.renderer.root.findDescendantById("installed-skill-browser");
    expect(currentBrowser).toBeInstanceOf(SelectRenderable);
    const activeBrowser = currentBrowser as SelectRenderable;
    const offset = selectScrollOffset(activeBrowser);
    const visibleRow = 1;
    const target = activeBrowser.options[offset + visibleRow]!;
    expect(target).toBeDefined();
    await setup.mockMouse.click(activeBrowser.screenX + 2, activeBrowser.screenY + visibleRow);
    const [, selectedPath] = JSON.parse(target.value) as [string, string];
    await waitForReaderBody(setup, selectedPath);
    const identity = setup.renderer.root.findDescendantById("reader-identity");
    expect(identity).toBeInstanceOf(TextRenderable);
    expect((identity as TextRenderable).plainText).toContain(selectedPath);
    expect(activeBrowser.getSelectedOption()?.value).toBe(target.value);
    expect(setup.renderer.currentFocusedRenderable === activeBrowser).toBe(true);
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
