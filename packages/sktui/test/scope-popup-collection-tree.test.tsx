/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import type { WorkspaceView, SkillAddress } from "@skctl/core";
import { testRender } from "@opentui/solid";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import {
  collectionFilterPathKey,
  deriveCollectionFilterTree,
} from "../src/collections/collection-filter-tree";
async function mount(
  width: number,
  height: number,
  projection: WorkspaceView = collectionsSourcesProjection(),
) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/scope-tree-");
  const previous = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const reads: SkillAddress[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => {
            reads.push(address);
            const text = "# guide\n\nScoped installed instructions.";
            return {
              address,
              name: "guide",
              description: "Scoped instructions",
              rawText: text,
              markdownText: text,
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  return {
    setup,
    reads,
    async dispose() {
      setup.renderer.destroy();
      if (previous === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = previous;
      await rm(cache, { recursive: true, force: true });
    },
  };
}
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])("Scope popup anchors to its trigger and stays in bounds at %ix%i", async (width, height) => {
  const mounted = await mount(width, height);
  const { setup } = mounted;
  try {
    await enterLive(setup, "shell-scope-select");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("scope-choices"));
    await setup.flush();
    const trigger = setup.renderer.root.findDescendantById("shell-scope-select")!;
    const popup = setup.renderer.root.findDescendantById("scope-popup")!;
    expect(popup).toBeDefined();
    expect(popup.screenY).toBe(trigger.screenY + trigger.height);
    expect(popup.screenX).toBeGreaterThanOrEqual(0);
    expect(popup.screenX + popup.width).toBeLessThanOrEqual(width);
    expect(popup.screenY + popup.height).toBeLessThanOrEqual(height);
    expect(popup.screenX).toBeLessThan(trigger.screenX + trigger.width);
    expect(popup.screenX + popup.width).toBeGreaterThan(trigger.screenX);
    const output = process.env.SCOPE_TREE_CAPTURE_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, `scope-${width}x${height}.txt`), setup.captureCharFrame());
    }
    setup.mockInput.pressArrow("down");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === trigger.id);
    expect(setup.captureCharFrame()).toContain("Workspace");
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "Collections navigator uses Reference paths, with expand all and collapse all at %ix%i",
  async (width, height) => {
    const mounted = await mount(width, height);
    const { setup } = mounted;
    const root = collectionFilterPathKey({ segments: [{ collection: "team" }] });
    const child = collectionFilterPathKey({
      segments: [
        { collection: "team" },
        { collection: "docs", reference: { name: "docs", target: "docs" } },
      ],
    });
    const id = (key: string) => `collection-browser-row-${encodeURIComponent(key)}`;
    try {
      await enterLive(setup, "shell-section-tab-collections");
      expect(setup.renderer.root.findDescendantById("collection-browser")).toBeInstanceOf(
        ScrollBoxRenderable,
      );
      expect(setup.renderer.root.findDescendantById(id(root))).toBeDefined();
      expect(setup.renderer.root.findDescendantById(id(child))).toBeUndefined();
      await enterLive(setup, "collections-expand-all");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id(child)));
      await setup.flush();
      await focusLive(setup, "collection-browser");
      setup.mockInput.pressArrow("right");
      await setup.flush();
      const parent = setup.renderer.root.findDescendantById(`${id(root)}-name`)!;
      const nested = setup.renderer.root.findDescendantById(`${id(child)}-name`)!;
      expect(nested.screenX).toBeGreaterThan(parent.screenX);
      const output = process.env.SCOPE_TREE_CAPTURE_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await writeFile(
          join(output, `collections-expanded-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
      }
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      if (width < 100) {
        await parsedEscape(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "collection-browser",
        );
        expect(setup.renderer.root.findDescendantById(id(child))).toBeDefined();
      }
      await enterLive(setup, "collections-collapse-all");
      await setup.flush();
      expect(setup.renderer.root.findDescendantById(id(child))).toBeUndefined();
      if (width >= 100) {
        expect(setup.captureCharFrame()).toContain("─team─");
        const cell = setup.renderer.root.findDescendantById(
          "collection-relationships-row-guide%3A0:cell-name",
        )!;
        expect(cell.height).toBeGreaterThan(0);
        expect(cell.width).toBeGreaterThan(0);
        expect(cell.screenY).toBeGreaterThan(5);
        expect(cell.screenY + cell.height).toBeLessThan(height - 1);
        await enterLive(setup, "collection-relationships");
        await setup.waitFor(() => mounted.reads.length === 1);
        expect(mounted.reads).toEqual([{ source: "team-main", path: "guide" }]);
        await parsedEscape(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
        );
        await setup.flush();
      }
      const browser = setup.renderer.root.findDescendantById(
        "collection-browser",
      ) as ScrollBoxRenderable;
      expect(browser.viewport.height).toBeGreaterThan(0);
      expect(browser.viewport.screenY + browser.viewport.height).toBeLessThanOrEqual(height - 1);
      if (output) {
        await writeFile(
          join(output, `collections-collapsed-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
      }
    } finally {
      await mounted.dispose();
    }
  },
);
test("an open Scope popup follows resize without changing its candidate and outside click restores the trigger", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await enterLive(setup, "shell-scope-select");
    const choices = setup.renderer.root.findDescendantById("scope-choices") as SelectRenderable;
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(choices.getSelectedIndex()).toBe(1);
    setup.resize(43, 13);
    await setup.flush();
    const trigger = setup.renderer.root.findDescendantById("shell-scope-select")!;
    const popup = setup.renderer.root.findDescendantById("scope-popup")!;
    expect(popup.screenY).toBe(trigger.screenY + trigger.height);
    expect(popup.screenX + popup.width).toBeLessThanOrEqual(43);
    expect(setup.renderer.root.findDescendantById("scope-choices")).toBe(choices);
    expect(choices.getSelectedIndex()).toBe(1);
    await setup.mockMouse.click(0, 11);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("scope-choices"));
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === trigger.id);
    await parsedEnter(setup);
    expect(
      (
        setup.renderer.root.findDescendantById("scope-choices") as SelectRenderable
      ).getSelectedIndex(),
    ).toBe(0);
  } finally {
    await mounted.dispose();
  }
});
test("search reveals matching nested Collections with their Reference ancestor context", async () => {
  const mounted = await mount(100, 24);
  const { setup } = mounted;
  const child = collectionFilterPathKey({
    segments: [
      { collection: "team" },
      { collection: "docs", reference: { name: "docs", target: "docs" } },
    ],
  });
  try {
    await enterLive(setup, "shell-section-tab-collections");
    await focusLive(setup, "collections-query");
    await setup.mockInput.typeText("docs");
    await setup.flush();
    expect(
      setup.renderer.root.findDescendantById(`collection-browser-row-${encodeURIComponent(child)}`),
    ).toBeDefined();
    await parsedEnter(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("─docs─");
  } finally {
    await mounted.dispose();
  }
});
test("Scope popup deactivates the underlying Collection tree and closing does not reclaim tree focus", async () => {
  const mounted = await mount(100, 24);
  const { setup } = mounted;
  try {
    await enterLive(setup, "shell-section-tab-collections");
    const tree = (await focusLive(setup, "collection-browser")) as ScrollBoxRenderable;
    expect(tree.focusable).toBe(true);
    await enterLive(setup, "shell-scope-select");
    await setup.flush();
    expect(tree.focusable).toBe(false);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "shell-scope-select");
    await setup.flush();
    expect(tree.focusable).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-scope-select");
  } finally {
    await mounted.dispose();
  }
});
test("Tab reaches bulk tree controls and their arrows stay within that region", async () => {
  const mounted = await mount(100, 24);
  const { setup } = mounted;
  const waitFocus = async (id: string, stage = id) =>
    setup
      .waitFor(() => setup.renderer.currentFocusedRenderable?.id === id)
      .catch((error) => {
        throw new Error(
          `${stage}: expected ${id}, focused ${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}\n${error}`,
        );
      });
  try {
    await enterLive(setup, "shell-section-tab-collections");
    await waitFocus("collection-browser", "initial entry");
    setup.mockInput.pressTab();
    await waitFocus("collections-expand-all");
    await parsedEnter(setup);
    await setup.flush();
    setup.mockInput.pressArrow("right");
    await waitFocus("collections-collapse-all");
    await parsedEnter(setup);
    setup.mockInput.pressTab({ shift: true });
    await waitFocus("collection-browser", "return from bulk controls");
    expect(mounted.reads).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test.each([
  [100, 24],
  [43, 13],
])(
  "missing Reference selection exposes its exact reason without opening another Collection at %ix%i",
  async (width, height) => {
    const base = collectionsSourcesProjection();
    if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
    const projection = {
      ...base,
      effective: {
        ...base.effective,
        collectionsView: base.effective.collectionsView.map((collection) =>
          collection.id === "team"
            ? {
                ...collection,
                references: [
                  { ...collection.references[0]!, name: "gone-target", collection: "gone-target" },
                ],
              }
            : collection,
        ),
      },
    };
    const mounted = await mount(width, height, projection);
    const { setup } = mounted;
    try {
      await enterLive(setup, "shell-section-tab-collections");
      await enterLive(setup, "collections-expand-all");
      await focusLive(setup, "collection-browser");
      setup.mockInput.pressArrow("right");
      await setup.flush();
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-tree-issue",
      );
      expect(setup.captureCharFrame()).toContain("gone-target");
      expect(setup.captureCharFrame()).toContain("unavailable");
      expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeUndefined();
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-browser",
      );
      expect(mounted.reads).toEqual([]);
    } finally {
      await mounted.dispose();
    }
  },
);
test("cycle termination is explained and Enter can still enter the actual available Collection", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: base.effective.collectionsView.map((collection) =>
        collection.id === "docs"
          ? {
              ...collection,
              references: [{ ...team.references[0]!, name: "team", collection: "team" }],
            }
          : collection,
      ),
    },
  };
  const cycle = deriveCollectionFilterTree(projection, "all").rows.find((row) => row.cycle)!;
  expect(cycle).toBeDefined();
  const mounted = await mount(80, 24, projection);
  const { setup } = mounted;
  try {
    await enterLive(setup, "shell-section-tab-collections");
    await enterLive(setup, "collections-expand-all");
    await focusLive(setup, "collection-browser");
    setup.mockInput.pressArrow("right");
    await setup.flush();
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    await enterLive(setup, "collection-about");
    expect(setup.captureCharFrame()).toContain("Reference cycle returns");
    expect(mounted.reads).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("issue Escape returns locally before an existing Reference route predecessor", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: base.effective.collectionsView.map((collection) =>
        collection.id === "docs"
          ? {
              ...collection,
              references: [
                { ...team.references[0]!, name: "gone-target", collection: "gone-target" },
              ],
            }
          : collection,
      ),
    },
  };
  const mounted = await mount(100, 24, projection);
  const { setup } = mounted;
  try {
    await enterLive(setup, "shell-section-tab-collections");
    await enterLive(setup, "collection-browser");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("─docs─"));
    await enterLive(setup, "collections-expand-all");
    await focusLive(setup, "collection-browser");
    setup.mockInput.pressArrow("right");
    await setup.flush();
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-tree-issue",
    );
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    expect(setup.captureCharFrame()).toContain("gone-target");
    await parsedEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("─team─"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
    expect(mounted.reads).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
