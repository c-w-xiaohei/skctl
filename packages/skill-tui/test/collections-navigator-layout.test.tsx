/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { BoxRenderable, ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { ButtonRenderable } from "@tuiparts/core/button";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CollectionView, ManagementProjection } from "@skill-cli/core";
import { App } from "../src/app";
import { theme } from "../src/ui/theme";
import {
  collectionFilterPathKey,
  deriveCollectionFilterTree,
} from "../src/collections/collection-filter-tree";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";

const selectedTreeRow = (setup: Awaited<ReturnType<typeof testRender>>, key: string) => {
  const row = setup.renderer.root.findDescendantById(
    `collection-browser-row-${encodeURIComponent(key)}`,
  );
  return row instanceof BoxRenderable && row.backgroundColor.a > 0;
};

async function press(setup: Awaited<ReturnType<typeof testRender>>, key: string) {
  await new Promise<void>((resolve) => {
    const observed = () => {
      setup.renderer.keyInput.off("keypress", observed);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", observed);
    setup.mockInput.pressKey(key);
  });
  await setup.flush();
}

async function applyProjectFilter(setup: Awaited<ReturnType<typeof testRender>>) {
  await enterLive(setup, "collections-filter");
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("collections-filter-dimensions"),
  );
  const dimensions = setup.renderer.root.findDescendantById(
    "collections-filter-dimensions",
  ) as SelectRenderable;
  await focusLive(setup, "collections-filter-dimensions");
  await setup.waitFor(() => dimensions.options.length > 0);
  const config = dimensions.options.findIndex((option) => option.value === "Config");
  expect(config).toBeGreaterThanOrEqual(0);
  dimensions.setSelectedIndex(config);
  await parsedEnter(setup);
  const values = setup.renderer.root.findDescendantById(
    "collections-filter-values",
  ) as SelectRenderable;
  await focusLive(setup, "collections-filter-values");
  await setup.waitFor(() => values.options.length > 0);
  const project = values.options.findIndex((option) => option.value === "project");
  expect(project).toBeGreaterThanOrEqual(0);
  values.setSelectedIndex(project);
  await parsedEnter(setup);
  await setup.flush();
}

function expectSearchControlsBounded(setup: Awaited<ReturnType<typeof testRender>>) {
  const row = setup.renderer.root.findDescendantById("collections-search-controls-pane")!;
  const query = setup.renderer.root.findDescendantById("collections-query")!;
  const filter = setup.renderer.root.findDescendantById("collections-filter")!;
  const clear = setup.renderer.root.findDescendantById("clear-all-collections-filters-keyboard");
  expect(query.screenY).toBe(filter.screenY);
  expect(query.screenX).toBeGreaterThanOrEqual(row.screenX);
  expect(query.screenX + query.width).toBeLessThanOrEqual(filter.screenX - 1);
  if (clear) {
    expect(filter.screenX + filter.width).toBeLessThanOrEqual(clear.screenX - 1);
    expect(clear.screenX + clear.width).toBeLessThanOrEqual(row.screenX + row.width);
  } else {
    expect(filter.screenX + filter.width).toBeLessThanOrEqual(row.screenX + row.width);
  }
}

function denseProjection(): ManagementProjection {
  const projection = collectionsSourcesProjection();
  if (projection.effective.status !== "complete") throw new Error("Expected complete fixture");
  const owner = projection.configs.find((config) => config.level === "project")!.direct
    .collections[0]!.owner;
  const existing = projection.effective.collectionsView;
  const byId = new Map(existing.map((collection) => [collection.id, collection]));
  const team = byId.get("team")!;
  const docs = byId.get("docs")!;
  const deep: CollectionView[] = ["reference-1", "reference-2", "reference-3"].map((id, index) => ({
    id,
    declared: [{ ...owner, pointer: `/collections/${id}` }],
    repository: { derived: false, producers: [] },
    members: [],
    references:
      index < 2
        ? [
            {
              name: `nested-${index + 1}`,
              collection: `reference-${index + 2}`,
              description: `Nested Reference ${index + 1}`,
              owner: { ...owner, pointer: `/collections/${id}/references/nested-${index + 1}` },
            },
          ]
        : [],
    links: [],
  }));
  const roots = Array.from({ length: 28 }, (_, index) => {
    const id = `collection-root-${String(index + 1).padStart(2, "0")}-with-a-long-identity`;
    return {
      id,
      declared: [{ ...owner, pointer: `/collections/${id}` }],
      repository: { derived: false, producers: [] },
      members: [],
      references: [],
      links: [],
    } satisfies CollectionView;
  });
  const collections = [
    {
      ...team,
      references: [
        ...team.references,
        {
          name: "long-chain",
          collection: "reference-1",
          description: "Deep Reference chain",
          owner: { ...owner, pointer: "/collections/team/references/long-chain" },
        },
      ],
    },
    docs,
    ...existing.filter((collection) => collection.id !== "team" && collection.id !== "docs"),
    ...deep,
    ...roots,
  ];
  return {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: collections.map((collection) => ({
                id: collection.id,
                owner: collection.declared[0] ?? {
                  ...config.direct.collections[0]!.owner,
                  pointer: `/collections/${collection.id}`,
                },
              })),
            },
          }
        : config,
    ),
    effective: {
      ...projection.effective,
      collections: collections.map((collection) => collection.id),
      collectionsView: collections,
    },
  };
}

async function mount(width: number, height: number) {
  const projection = denseProjection();
  const core = directSourceCore(projection);
  core.configuration.change = async () => {
    throw new Error("The navigator layout must not mutate configuration");
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("shell-section-tab-collections"),
  );
  await enterLive(setup, "shell-section-tab-collections");
  await setup.waitFor(
    () =>
      setup.renderer.root.findDescendantById("collection-browser") instanceof ScrollBoxRenderable,
  );
  await setup.flush();
  return { setup, dispose: () => setup.renderer.destroy() };
}

test.each([
  [144, 40, "dark"],
  [132, 24, "dark"],
  [100, 24, "dark"],
  [48, 13, "dark"],
  [49, 13, "dark"],
  [43, 13, "dark"],
  [48, 13, "light"],
  [43, 13, "light"],
] as const)(
  "Collections navigator keeps separated control groups bounded at %ix%i in %s",
  async (width, height, mode) => {
    theme.setMode(mode);
    theme.override({
      colors: {
        background: mode === "dark" ? "#1b2025" : "#f4f6f8",
        foreground: mode === "dark" ? "#e8eef5" : "#142435",
      },
    });
    const mounted = await mount(width, height);
    const { setup } = mounted;
    try {
      const pane = setup.renderer.root.findDescendantById("collections-list-pane")!;
      const search = setup.renderer.root.findDescendantById("collections-query")!;
      const filter = setup.renderer.root.findDescendantById("collections-filter")!;
      const toolbar = setup.renderer.root.findDescendantById("collections-tree-controls-pane")!;
      const tree = setup.renderer.root.findDescendantById(
        "collection-browser",
      ) as ScrollBoxRenderable;
      const buttons = [
        filter,
        setup.renderer.root.findDescendantById("collection-action-new-collection")!,
        setup.renderer.root.findDescendantById("collections-expand-all")!,
        setup.renderer.root.findDescendantById("collections-collapse-all")!,
      ];
      if (process.env.PAGE_INTERACTION_CAPTURE_DIR) {
        await mkdir(process.env.PAGE_INTERACTION_CAPTURE_DIR, { recursive: true });
        await writeFile(
          join(
            process.env.PAGE_INTERACTION_CAPTURE_DIR,
            `collections-${width}x${height}-${mode}.txt`,
          ),
          setup.captureCharFrame(),
        );
        await writeFile(
          join(
            process.env.PAGE_INTERACTION_CAPTURE_DIR,
            `collections-${width}x${height}-${mode}.json`,
          ),
          JSON.stringify(setup.captureSpans(), null, 2),
        );
      }
      expect(search.screenY).toBe(filter.screenY);
      expect(toolbar.screenY).toBe(search.screenY + 2);
      expect(tree.screenY).toBe(toolbar.screenY + 1);
      expect(tree.height).toBeGreaterThanOrEqual(pane.height - 5);
      for (const button of buttons) {
        expect(button).toBeInstanceOf(ButtonRenderable);
        expect(button.screenX).toBeGreaterThanOrEqual(pane.screenX + 1);
        expect(button.screenX + button.width).toBeLessThanOrEqual(pane.screenX + pane.width - 1);
      }
      const searchControls = setup.renderer.root.findDescendantById(
        "collections-search-controls-pane",
      )!;
      expect(search.screenX + search.width).toBeLessThanOrEqual(filter.screenX - 1);
      expect(filter.screenX + filter.width).toBeLessThanOrEqual(
        searchControls.screenX + searchControls.width,
      );
      expect(filter.screenY).toBe(search.screenY);
      const utilityButtons = buttons.slice(1);
      for (const button of utilityButtons) {
        expect(button.screenY - (filter.screenY + filter.height)).toBeGreaterThanOrEqual(1);
        expect(button.screenY).toBe(toolbar.screenY);
        expect(button.screenX + button.width).toBeLessThanOrEqual(toolbar.screenX + toolbar.width);
      }
      for (let index = 1; index < utilityButtons.length; index++)
        expect(
          utilityButtons[index]!.screenX -
            (utilityButtons[index - 1]!.screenX + utilityButtons[index - 1]!.width),
        ).toBeGreaterThanOrEqual(1);
      expect(setup.renderer.root.findDescendantById("collections-expand-all")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("collections-collapse-all")).toBeDefined();
      expect(setup.captureCharFrame()).toContain("Expand");
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("palette-choices"));
      const choices = setup.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
      for (const [id, verb] of [
        ["collections.filter.open", "Filter"],
        ["new-collection", "New Collection"],
        ["collections.expand-all", "Expand all"],
        ["collections.collapse-all", "Collapse all"],
      ]) {
        const action = choices.options.find((option) => option.value.id === id)?.value;
        expect(action?.verb).toBe(verb);
        expect(action?.destination).toBeDefined();
      }
      await parsedEscape(setup);

      const query = setup.renderer.root.findDescendantById("collections-query")!;
      query.focus();
      await setup.mockInput.typeText("team");
      await setup.flush();
      expectSearchControlsBounded(setup);
      expect(setup.captureCharFrame()).toContain("team");
      await applyProjectFilter(setup);
      expect(setup.captureCharFrame()).toContain("Filter 1");
      expectSearchControlsBounded(setup);
    } catch (error) {
      console.error(setup.captureCharFrame());
      throw error;
    } finally {
      mounted.dispose();
      theme.override(undefined);
      theme.setMode("system");
    }
  },
);

test("Collections navigator preserves deep path, expanded state, query/filter and Back context", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    const path = collectionFilterPathKey({
      segments: [
        { collection: "team" },
        {
          collection: "reference-1",
          reference: { name: "long-chain", target: "reference-1" },
        },
        {
          collection: "reference-2",
          reference: { name: "nested-1", target: "reference-2" },
        },
        {
          collection: "reference-3",
          reference: { name: "nested-2", target: "reference-3" },
        },
      ],
    });
    const tree = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    const projection = denseProjection();
    const expandedRows = deriveCollectionFilterTree(projection, "all");
    if (expandedRows.status !== "available") throw new Error("Expected Collection tree");
    const deepIndex = expandedRows.rows.findIndex((row) => row.key === path);
    expect(deepIndex).toBeGreaterThanOrEqual(0);
    await enterLive(setup, "collections-expand-all");
    await setup.flush();
    const deepName = setup.renderer.root.findDescendantById(
      `collection-browser-row-${encodeURIComponent(path)}-name`,
    );
    expect(deepName).toBeDefined();
    await focusLive(setup, "collection-browser");
    await press(setup, "END");
    for (let index = 0; index < expandedRows.rows.length - 1 - deepIndex; index++)
      await press(setup, "ARROW_UP");
    expect(selectedTreeRow(setup, path)).toBe(true);
    const visibleDeepName = setup.renderer.root.findDescendantById(
      `collection-browser-row-${encodeURIComponent(path)}-name`,
    )!;
    expect(visibleDeepName.screenY).toBeGreaterThanOrEqual(tree.viewport.screenY);
    expect(visibleDeepName.screenY).toBeLessThan(tree.viewport.screenY + tree.viewport.height);
    setup.resize(80, 40);
    await setup.flush();
    await focusLive(setup, "collection-browser");
    const selectedScroll = (
      setup.renderer.root.findDescendantById("collection-browser") as ScrollBoxRenderable
    ).scrollTop;
    expect(selectedScroll).toBeGreaterThan(0);
    await parsedEnter(setup);
    await setup.flush();
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("collection-detail-pane") as
            | BoxRenderable
            | undefined
        )?.title?.includes("reference-3") === true,
    );
    expect(
      (
        setup.renderer.root.findDescendantById("collection-detail-pane") as
          | BoxRenderable
          | undefined
      )?.title,
    ).toContain("reference-3");
    expect(setup.captureCharFrame()).toContain("reference-3");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("route-back"));
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    const restoredTree = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    expect(
      setup.renderer.root.findDescendantById(
        `collection-browser-row-${encodeURIComponent(path)}-name`,
      ),
    ).toBeDefined();
    expect(selectedTreeRow(setup, path)).toBe(true);
    expect(restoredTree.scrollTop).toBe(selectedScroll);
    setup.resize(144, 40);
    await setup.flush();

    const query = setup.renderer.root.findDescendantById("collections-query")!;
    query.focus();
    await setup.mockInput.typeText("reference-3");
    await setup.flush();
    expect(
      setup.renderer.root.findDescendantById(
        `collection-browser-row-${encodeURIComponent(path)}-name`,
      ),
    ).toBeDefined();
    expect(setup.captureCharFrame()).toContain("reference-3");

    await applyProjectFilter(setup);
    expect(setup.captureCharFrame()).toContain("Filter 1");
    expect(setup.captureCharFrame()).toContain("reference-3");
    expectSearchControlsBounded(setup);
    const filteredTree = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    const filteredScroll = filteredTree.scrollTop;
    await enterLive(setup, "collections-filter");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collections-filter-dimensions"),
    );
    await setup.flush();
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    await setup.flush();
    const restoredFilteredTree = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    expect(restoredFilteredTree).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById(
        `collection-browser-row-${encodeURIComponent(path)}-name`,
      ),
    ).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collections-query")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collections-expand-all")).toBeDefined();
    expect(selectedTreeRow(setup, path)).toBe(true);
    expect(restoredFilteredTree.scrollTop).toBe(filteredScroll);
  } catch (error) {
    console.error(setup.captureCharFrame());
    throw error;
  } finally {
    mounted.dispose();
  }
});
