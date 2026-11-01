/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SkctlError,
  type CollectionUseImpact,
  type WorkspaceView,
  type OperationResult,
} from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { CollectionUseOverlay } from "../src/operations";
import { theme } from "../src/ui/theme";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { enterLive, focusLive, live, parsedEnter, parsedEscape } from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
type UseIntent = Parameters<Parameters<typeof CollectionUseOverlay>[0]["onPreview"]>[0];
const available = [
  { id: "team", description: "Team authoring and review" },
  { id: "docs", description: "Read documentation" },
];
const owner = {
  level: "project" as const,
  file: "/workspace/skctl/skctl.jsonc",
  pointer: "/use",
};
const result = <T,>(value: T): OperationResult<T> => ({ value, diagnostics: [] });
afterEach(() => {
  theme.override(undefined);
  theme.setMode("system");
});
async function capture(setup: Setup, name: string) {
  const directory = process.env.PAGE_INTERACTION_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(directory, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}
async function expectFocusedInBody(setup: Setup, id: string, caption: string) {
  const target = live(setup, id);
  let ancestor = target.parent;
  while (ancestor && !(ancestor instanceof ScrollBoxRenderable)) ancestor = ancestor.parent;
  if (!(ancestor instanceof ScrollBoxRenderable))
    throw new Error(`Missing modal viewport for ${id}`);
  const body = ancestor;
  await setup.waitForFrame(
    (frame) =>
      setup.renderer.currentFocusedRenderable === target &&
      target.screenY >= body.viewport.screenY &&
      target.screenY + target.height <= body.viewport.screenY + body.viewport.height &&
      frame
        .split("\n")
        .slice(target.screenY, target.screenY + target.height)
        .join("\n")
        .includes(caption),
  );
  expect(setup.renderer.currentFocusedRenderable === target).toBe(true);
  expect(target.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
  expect(target.screenY + target.height).toBeLessThanOrEqual(
    body.viewport.screenY + body.viewport.height,
  );
  expect(
    setup
      .captureCharFrame()
      .split("\n")
      .slice(target.screenY, target.screenY + target.height)
      .join("\n"),
  ).toContain(caption);
}
async function expectRenderedReview(setup: Setup, oldCollections: string, newCollections: string) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-confirm"));
  await setup.waitForFrame(
    (frame) =>
      setup.renderer.currentFocusedRenderable?.id === "collection-review-choice" &&
      frame.includes(`Owner: project: ${owner.file} /use`) &&
      frame.includes(`Old: ${oldCollections}`) &&
      frame.includes(`New: ${newCollections}`),
  );
  const frame = setup.captureCharFrame();
  expect(frame).toContain(`Owner: project: ${owner.file} /use`);
  expect(frame).toContain(`Old: ${oldCollections}`);
  expect(frame).toContain(`New: ${newCollections}`);
}
function choices(setup: Setup) {
  const list = live(setup, "collection-use-values");
  if (!(list instanceof SelectRenderable)) throw new Error("Expected native Collection choices");
  return list;
}
async function current(setup: Setup, id: string) {
  const list = choices(setup);
  await focusLive(setup, list.id);
  const index = list.options.findIndex((option) => option.value === id);
  expect(index).toBeGreaterThanOrEqual(0);
  while (list.getSelectedIndex() < index) {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
  }
  while (list.getSelectedIndex() > index) {
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
  }
  return list;
}
function checked(setup: Setup) {
  return choices(setup)
    .options.filter((option) => option.name.startsWith("[x]"))
    .map((option) => option.value);
}
test("Use choices distinguish current from checked, preserve unavailable IDs, and review an explicit empty set", async () => {
  const previews: UseIntent[] = [];
  let cancels = 0;
  const setup = await testRender(
    () => (
      <CollectionUseOverlay
        level="local"
        collections={["team", "retired"]}
        availableCollections={available}
        pending={false}
        onPreview={(intent) => previews.push(intent)}
        onCancel={() => cancels++}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    expect(checked(setup)).toEqual(["team", "retired"]);
    await current(setup, "docs");
    expect(checked(setup)).toEqual(["team", "retired"]);
    await enterLive(setup, "collection-use-review");
    expect(previews[0]).toEqual({
      kind: "collection-use",
      level: "local",
      collections: ["team", "retired"],
    });
    await current(setup, "retired");
    expect(setup.captureCharFrame()).toContain("Unavailable");
    await parsedEnter(setup);
    expect(checked(setup)).toEqual(["team"]);
    expect(choices(setup).options.some((option) => option.value === "retired")).toBe(true);
    await parsedEnter(setup); // Deliberate removal remains reversible.
    expect(checked(setup)).toEqual(["team", "retired"]);
    await parsedEnter(setup);
    await current(setup, "team");
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    expect(checked(setup)).toEqual([]);
    expect(setup.captureCharFrame()).toContain("explicit empty Use");
    await enterLive(setup, "collection-use-review");
    expect(previews[1]).toEqual({ kind: "collection-use", level: "local", collections: [] });
    await parsedEscape(setup);
    expect(cancels).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
test("Use pointer row focus is separate from its check gutter and pending/error/resize preserve the same draft", async () => {
  const previews: UseIntent[] = [];
  let setState!: (state: {
    pending: boolean;
    error?: {
      code: string;
      message: string;
    };
  }) => void;
  const setup = await testRender(
    () => {
      const [state, update] = createSignal<{
        pending: boolean;
        error?: {
          code: string;
          message: string;
        };
      }>({ pending: false });
      setState = update;
      return (
        <CollectionUseOverlay
          level="global"
          collections={["team"]}
          availableCollections={available}
          pending={state().pending}
          error={state().error}
          onPreview={(intent) => previews.push(intent)}
          onCancel={() => {}}
        />
      );
    },
    { width: 100, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    const list = choices(setup);
    await setup.mockMouse.click(list.screenX + 8, list.screenY + 1);
    await setup.renderOnce();
    expect(list.getSelectedOption()?.value).toBe("docs");
    expect(checked(setup)).toEqual(["team"]);
    await setup.mockMouse.click(list.screenX + 4, list.screenY + 1);
    await setup.renderOnce();
    expect(checked(setup)).toEqual(["team", "docs"]);
    await enterLive(setup, "collection-use-review");
    setState({ pending: true });
    await setup.renderOnce();
    await current(setup, "team");
    await parsedEnter(setup);
    expect(checked(setup)).toEqual(["team", "docs"]);
    expect(live(setup, "collection-use-review").focusable).toBe(false);
    setState({ pending: false, error: { code: "TRANSACTION_CONFLICT", message: "Review again" } });
    await setup.renderOnce();
    expect(choices(setup)).toBe(list);
    setup.resize(43, 13);
    await setup.renderOnce();
    await current(setup, "docs");
    expect(choices(setup)).toBe(list);
    expect(checked(setup)).toEqual(["team", "docs"]);
    await focusLive(setup, "collection-use-review");
    await expectFocusedInBody(setup, "collection-use-review", "Review Collection Use");
    await parsedEnter(setup);
    expect(previews).toEqual([
      { kind: "collection-use", level: "global", collections: ["team", "docs"] },
      { kind: "collection-use", level: "global", collections: ["team", "docs"] },
    ]);
    expect(setup.captureCharFrame()).toContain("Review Collection Use");
  } finally {
    setup.renderer.destroy();
  }
});
for (const mode of ["dark", "light"] as const) {
  for (const [width, height] of [
    [80, 24],
    [43, 13],
  ] as const) {
    test(`Use picker and failed-review controls remain readable inside the body at ${width}×${height} in ${mode}`, async () => {
      theme.setMode(mode);
      theme.override({
        colors: {
          background: mode === "dark" ? "#1b2025" : "#f4f6f8",
          foreground: mode === "dark" ? "#e8eef5" : "#142435",
        },
      });
      const previews: UseIntent[] = [];
      let setState!: (state: {
        pending: boolean;
        error?: {
          code: string;
          message: string;
        };
      }) => void;
      const setup = await testRender(
        () => {
          const [state, update] = createSignal<{
            pending: boolean;
            error?: {
              code: string;
              message: string;
            };
          }>({ pending: false });
          setState = update;
          return (
            <CollectionUseOverlay
              level="project"
              collections={["team", "retired"]}
              availableCollections={available}
              pending={state().pending}
              error={state().error}
              onPreview={(value) => previews.push(value)}
              onCancel={() => {}}
            />
          );
        },
        { width, height },
      );
      try {
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
        );
        await current(setup, "docs");
        await expectFocusedInBody(setup, "collection-use-values", "[ ] docs");
        await capture(setup, `use-${mode}-${width}x${height}-picker`);
        await current(setup, "retired");
        await expectFocusedInBody(setup, "collection-use-values", "[x] Unavailable: retired");
        await capture(setup, `use-${mode}-${width}x${height}-unavailable`);
        await current(setup, "docs");
        await parsedEnter(setup);
        await focusLive(setup, "collection-use-review");
        await expectFocusedInBody(setup, "collection-use-review", "Review Collection Use");
        await parsedEnter(setup);
        setState({ pending: true });
        await setup.renderOnce();
        setState({
          pending: false,
          error: { code: "TRANSACTION_CONFLICT", message: "Review again" },
        });
        await setup.renderOnce();
        await focusLive(setup, "collection-use-values");
        await current(setup, "docs");
        await expectFocusedInBody(setup, "collection-use-values", "[x] docs");
        await capture(setup, `use-${mode}-${width}x${height}-error-picker`);
        await focusLive(setup, "collection-use-review");
        await expectFocusedInBody(setup, "collection-use-review", "Review Collection Use");
        await capture(setup, `use-${mode}-${width}x${height}-error-review`);
        await parsedEnter(setup);
        expect(previews).toEqual([
          { kind: "collection-use", level: "project", collections: ["team", "retired", "docs"] },
          { kind: "collection-use", level: "project", collections: ["team", "retired", "docs"] },
        ]);
        expect(checked(setup)).toEqual(["team", "docs", "retired"]);
      } finally {
        setup.renderer.destroy();
      }
    });
  }
}
test("unavailable inventory keeps every direct ID removable and invents no available choices", async () => {
  const previews: UseIntent[] = [];
  const setup = await testRender(
    () => (
      <CollectionUseOverlay
        level="project"
        collections={["team", "docs"]}
        availableCollections={[]}
        inventoryUnavailable
        pending={false}
        onPreview={(value) => previews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    expect(choices(setup).options.map((option) => option.value)).toEqual(["team", "docs"]);
    expect(choices(setup).options.every((option) => option.name.includes("Unavailable"))).toBe(
      true,
    );
    await enterLive(setup, "collection-use-review");
    expect(previews[0]?.collections).toEqual(["team", "docs"]);
  } finally {
    setup.renderer.destroy();
  }
});
test("no available Collections still permits deliberate review of an explicit empty Use", async () => {
  const previews: UseIntent[] = [];
  const setup = await testRender(
    () => (
      <CollectionUseOverlay
        level="project"
        collections={[]}
        availableCollections={[]}
        pending={false}
        onPreview={(value) => previews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(choices(setup).options).toEqual([]);
    expect(setup.captureCharFrame()).toContain("No available Collections");
    await enterLive(setup, "collection-use-review");
    expect(previews).toEqual([{ kind: "collection-use", level: "project", collections: [] }]);
  } finally {
    setup.renderer.destroy();
  }
});
test("live effective inventory changes never silently remove checked direct IDs", async () => {
  let update!: (value: typeof available) => void;
  const previews: UseIntent[] = [];
  const setup = await testRender(
    () => {
      const [inventory, setInventory] = createSignal(available);
      update = setInventory;
      return (
        <CollectionUseOverlay
          level="project"
          collections={["team"]}
          availableCollections={inventory()}
          pending={false}
          onPreview={(value) => previews.push(value)}
          onCancel={() => {}}
        />
      );
    },
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    await current(setup, "docs");
    await parsedEnter(setup);
    update([{ id: "new", description: "New effective Collection" }]);
    await setup.renderOnce();
    expect(checked(setup)).toEqual(["team", "docs"]);
    expect(choices(setup).getSelectedOption()?.value).toBe("docs");
    expect(choices(setup).options.find((option) => option.value === "team")?.name).toContain(
      "Unavailable",
    );
    expect(choices(setup).options.find((option) => option.value === "new")?.name).toContain("[ ]");
    await enterLive(setup, "collection-use-review");
    expect(previews[0]).toEqual({
      kind: "collection-use",
      level: "project",
      collections: ["team", "docs"],
    });
  } finally {
    setup.renderer.destroy();
  }
});
test("an unchecked current Collection stays visibly current when inventory disappears and reappears", async () => {
  const [inventory, update] = createSignal(available);
  const [cursor, setCursor] = createSignal<string>();
  const previews: UseIntent[] = [];
  const setup = await testRender(
    () => (
      <CollectionUseOverlay
        level="project"
        collections={["team"]}
        availableCollections={inventory()}
        currentCollection={cursor()}
        onCurrentChange={setCursor}
        pending={false}
        onPreview={(value) => previews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    await current(setup, "docs");
    expect(checked(setup)).toEqual(["team"]);
    update([available[0]!]);
    await setup.flush();
    expect(choices(setup).getSelectedOption()?.value).toBe("docs");
    expect(choices(setup).getSelectedOption()?.name).toContain("Unavailable");
    expect(checked(setup)).toEqual(["team"]);
    setup.resize(80, 24);
    await setup.flush();
    expect(choices(setup).getSelectedOption()?.value).toBe("docs");
    update(available);
    await setup.flush();
    expect(choices(setup).getSelectedOption()?.value).toBe("docs");
    expect(choices(setup).getSelectedOption()?.name).not.toContain("Unavailable");
    await enterLive(setup, "collection-use-review");
    expect(previews).toEqual([{ kind: "collection-use", level: "project", collections: ["team"] }]);
  } finally {
    setup.renderer.destroy();
  }
});
for (const [width, height] of [
  [144, 40],
  [80, 24],
  [43, 13],
] as const) {
  test(`Use choices browse a real-length 28-Collection inventory at ${width}×${height} without widening the checked set`, async () => {
    const inventory = Array.from({ length: 28 }, (_, index) => ({
      id: `team/collection-${String(index).padStart(2, "0")}`,
      description: `Task ${index}`,
    }));
    const previews: UseIntent[] = [];
    const setup = await testRender(
      () => (
        <CollectionUseOverlay
          level="project"
          collections={[inventory[0]!.id]}
          availableCollections={inventory}
          pending={false}
          onPreview={(value) => previews.push(value)}
          onCancel={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
      );
      await current(setup, inventory[27]!.id);
      expect(checked(setup)).toEqual([inventory[0]!.id]);
      expect(setup.captureCharFrame()).toContain("collection-27");
      await parsedEnter(setup);
      setup.mockInput.pressTab();
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-use-cancel");
      setup.mockInput.pressTab();
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-use-review");
      await parsedEnter(setup);
      expect(previews).toEqual([
        {
          kind: "collection-use",
          level: "project",
          collections: [inventory[0]!.id, inventory[27]!.id],
        },
      ]);
    } finally {
      setup.renderer.destroy();
    }
  });
}
function useProjection(): WorkspaceView {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  return {
    ...base,
    configs: base.configs.map((config) => ({
      ...config,
      direct: {
        ...config.direct,
        collections: config.direct.collections.filter((collection) =>
          ["team", "docs"].includes(collection.id),
        ),
        collectionUse: (config.level === "project" ? ["team", "retired"] : ["docs"]).map(
          (collection, index) => ({
            collection,
            owner: {
              ...owner,
              level: config.level,
              file: config.file.file,
              pointer: `/use/${index}`,
            },
          }),
        ),
      },
    })),
    effective: {
      ...base.effective,
      use: ["docs", "retired", "team"],
      collectionsView: base.effective.collectionsView.slice(0, 2),
      collections: ["team", "docs"],
    },
  };
}
async function chooseAction(setup: Setup, id: string) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const list = live(setup, "palette-choices") as SelectRenderable;
  const index = list.options.findIndex((option) => option.value.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < index; step++) {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
  }
  await parsedEnter(setup);
}
async function openConfigUse(setup: Setup) {
  await openMainPage(setup, "settings");
  await enterLive(setup, "shell-scope-select");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("scope-choices"));
  const scope = live(setup, "scope-choices") as SelectRenderable;
  const index = scope.options.findIndex((option) => option.value === "project");
  expect(index).toBeGreaterThanOrEqual(0);
  await focusLive(setup, scope.id);
  for (let step = 0; step < index; step++) {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
  }
  await parsedEnter(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("settings-section-tab-collections"),
  );
  await enterLive(setup, "settings-section-tab-collections");
  await chooseAction(setup, "set-collection-use");
}
for (const entry of ["Config", "relationship Edit Use", "Settings level"] as const) {
  test(`production App ${entry} reviews and commits only the exact host Use, not effective roots or current row`, async () => {
    const previews: unknown[] = [],
      changes: unknown[] = [];
    const core = directSourceCore(useProjection());
    core.previewCollectionUse = async (
      _environment: import("@skctl/core").CoreOptions,
      request,
    ) => {
      previews.push(request);
      return result<CollectionUseImpact>({
        kind: "collection-use",
        owner,
        oldCollections: ["team", "retired"],
        newCollections: request.collections,
        affectedSelectors: [],
        newlyExposed: [],
        removedAtOwner: [],
        retained: [],
        alternateOwners: [],
        currentComplete: false,
        proposedComplete: true,
        blockers: [],
        allowed: true,
      });
    };
    core.setUse = async (_environment: import("@skctl/core").CoreOptions, request) => {
      changes.push(request);
      return result({
        level: "project",
        file: owner.file,
        changed: true,
        use: { before: ["team", "retired"], after: [...request.collections] },
      });
    };
    const setup = await testRender(() => <App core={core} exit={() => {}} />, {
      width: 120,
      height: 40,
    });
    try {
      if (entry === "Config") await openConfigUse(setup);
      else {
        await openMainPage(setup, "collections");
        await enterLive(setup, "collection-browser");
        await enterLive(setup, "collection-tabs-tab-settings");
        await enterLive(setup, "collection-use-project");
      }
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
      );
      expect(choices(setup).options.map((option) => option.value)).toEqual([
        "team",
        "docs",
        "retired",
      ]);
      expect(checked(setup)).toEqual(["team", "retired"]);
      await current(setup, "retired");
      await parsedEnter(setup);
      await current(setup, "docs");
      await parsedEnter(setup);
      await enterLive(setup, "collection-use-review");
      await expectRenderedReview(setup, "team, retired", "team, docs");
      expect(previews).toEqual([{ level: "project", collections: ["team", "docs"] }]);
      expect(changes).toEqual([]);
      const frame = setup.captureCharFrame();
      expect(frame).toContain(`Owner: project: ${owner.file} /use`);
      expect(frame).toContain("Old: team, retired");
      expect(frame).toContain("New: team, docs");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-review-choice");
      await enterLive(setup, "collection-review-confirm");
      await setup.waitFor(() => changes.length === 1);
      expect(changes).toEqual([{ level: "project", collections: ["team", "docs"] }]);
    } finally {
      setup.renderer.destroy();
    }
  });
}
test("production App failed Use review retains the same checked draft across supported and gated resize; cancelling writes nothing", async () => {
  const previews: unknown[] = [],
    changes: unknown[] = [];
  const core = directSourceCore(useProjection());
  core.previewCollectionUse = async (_environment: import("@skctl/core").CoreOptions, request) => {
    previews.push(request);
    throw new SkctlError("TRANSACTION_CONFLICT", "Review the current declaration again");
  };
  core.setUse = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push(request);
    return result({
      level: "project",
      file: owner.file,
      changed: true,
      use: { before: ["team", "retired"], after: [...request.collections] },
    });
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openConfigUse(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    const list = choices(setup);
    await current(setup, "docs");
    await parsedEnter(setup);
    await enterLive(setup, "collection-use-review");
    await setup.waitFor(
      () =>
        previews.length === 1 &&
        live(setup, "collection-use-review").focusable &&
        setup.captureCharFrame().includes("TRANSACTION_CONFLICT"),
    );
    expect(previews).toEqual([{ level: "project", collections: ["team", "retired", "docs"] }]);
    expect(choices(setup)).toBe(list);
    expect(checked(setup)).toEqual(["team", "docs", "retired"]);
    expect(setup.captureCharFrame()).toContain("TRANSACTION_CONFLICT");
    setup.resize(43, 13);
    await setup.renderOnce();
    expect(choices(setup)).toBe(list);
    setup.resize(42, 11);
    await setup.renderOnce();
    setup.resize(100, 24);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
    expect(checked(setup)).toEqual(["team", "docs", "retired"]);
    expect(choices(setup).getSelectedOption()?.value).toBe("docs");
    await enterLive(setup, "collection-use-review");
    await setup.waitFor(
      () => previews.length === 2 && live(setup, "collection-use-review").focusable,
    );
    expect(previews[1]).toEqual(previews[0]);
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("collection-use-values"));
    expect(changes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
test("production App reviews and commits explicit empty Use without substituting other host roots", async () => {
  const changes: unknown[] = [];
  const core = directSourceCore(useProjection());
  core.previewCollectionUse = async (_environment: import("@skctl/core").CoreOptions, request) =>
    result<CollectionUseImpact>({
      kind: "collection-use",
      owner,
      oldCollections: ["team", "retired"],
      newCollections: request.collections,
      affectedSelectors: [],
      newlyExposed: [],
      removedAtOwner: [],
      retained: [],
      alternateOwners: [],
      currentComplete: false,
      proposedComplete: false,
      blockers: [],
      allowed: true,
    });
  core.setUse = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push(request);
    return result({
      level: "project",
      file: owner.file,
      changed: true,
      use: { before: ["team", "retired"], after: [...request.collections] },
    });
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 100,
    height: 24,
  });
  try {
    await openConfigUse(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    await current(setup, "team");
    await parsedEnter(setup);
    await current(setup, "retired");
    await parsedEnter(setup);
    await enterLive(setup, "collection-use-review");
    await expectRenderedReview(setup, "team, retired", "(empty)");
    expect(setup.captureCharFrame()).toContain("New: (empty)");
    expect(setup.captureCharFrame()).toContain("Complete: no");
    expect(changes).toEqual([]);
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => changes.length === 1);
    expect(changes).toEqual([{ level: "project", collections: [] }]);
  } finally {
    setup.renderer.destroy();
  }
});
test("production App cancels an outstanding Use preview without applying its late result", async () => {
  let settle!: (value: OperationResult<CollectionUseImpact>) => void;
  let signal: AbortSignal | undefined;
  const pending = new Promise<OperationResult<CollectionUseImpact>>((resolve) => {
    settle = resolve;
  });
  const changes: unknown[] = [];
  const core = directSourceCore(useProjection());
  core.previewCollectionUse = async (
    _environment: import("@skctl/core").CoreOptions,
    _request,
    options,
  ) => {
    signal = options?.signal;
    return pending;
  };
  core.setUse = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push(request);
    return result({
      level: "project",
      file: owner.file,
      changed: true,
      use: { before: ["team", "retired"], after: [...request.collections] },
    });
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 100,
    height: 24,
  });
  try {
    await openConfigUse(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    await enterLive(setup, "collection-use-review");
    await setup.waitFor(() => !!signal && !live(setup, "collection-use-review").focusable);
    await parsedEscape(setup);
    expect(signal?.aborted).toBe(true);
    settle(
      result({
        kind: "collection-use",
        owner,
        oldCollections: ["team", "retired"],
        newCollections: ["team", "retired"],
        affectedSelectors: [],
        newlyExposed: [],
        removedAtOwner: [],
        retained: [],
        alternateOwners: [],
        currentComplete: false,
        proposedComplete: false,
        blockers: [],
        allowed: true,
      }),
    );
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("collection-use-values"));
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
    expect(changes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
