import { expect, test } from "bun:test";
import { SelectRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skill-cli/core";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, openAllInstalledSkills, parsedEnter } from "./reader-test-controls";

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

function textBuffers(node: { getChildren(): readonly unknown[] }): TextBufferRenderable[] {
  return node.getChildren().flatMap((child) => {
    if (child instanceof TextBufferRenderable) return [child];
    if (child && typeof child === "object" && "getChildren" in child)
      return textBuffers(child as { getChildren(): readonly unknown[] });
    return [];
  });
}

test("All Installed Skills inspector follows the browser's native arrow selection", async () => {
  const loads: { source: string; path: string }[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projectionWithSkills(2), {
          installed: {
            load: async ({ address }) => {
              loads.push(address);
              return {
                address,
                name: address.path,
                description: `Description for ${address.path}`,
                rawText: `# ${address.path}\n`,
                markdownText: `# ${address.path}\n`,
              };
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skill-inspector-address"));

    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => {
      const current = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        current instanceof SelectRenderable &&
        current.getSelectedOption()?.value === '["team-main","skill-001"]'
      );
    });
    const address = setup.renderer.root.findDescendantById("skill-inspector-address");
    expect(address).toBeInstanceOf(TextBufferRenderable);
    await setup.waitFor(() =>
      (address as TextBufferRenderable).plainText.includes("team-main/skill-001"),
    );

    const inspector = setup.renderer.root.findDescendantById("skill-inspector");
    expect(inspector).toBeDefined();
    await setup.waitFor(() =>
      textBuffers(inspector!).some((text) => text.plainText === "skill-001"),
    );
    await focusLive(setup, "skill-inspector-open-reader");
    await parsedEnter(setup);
    await setup.waitFor(() => loads.length === 1);
    expect(loads).toEqual([{ source: "team-main", path: "skill-001" }]);
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
    const address = setup.renderer.root.findDescendantById("skill-inspector-address");
    expect(address).toBeInstanceOf(TextBufferRenderable);
    await setup.waitFor(() =>
      (address as TextBufferRenderable).plainText.includes(`team-main/${selectedPath}`),
    );
    const inspector = setup.renderer.root.findDescendantById("skill-inspector");
    expect(inspector).toBeDefined();
    await setup.waitFor(() =>
      textBuffers(inspector!).some((text) => text.plainText === selectedPath),
    );
  } finally {
    setup.renderer.destroy();
  }
});
