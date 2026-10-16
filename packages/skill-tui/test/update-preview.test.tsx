/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { DiffRenderable, ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagementCapability, ManagementProjection, UpdatePreview } from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";

const revision = "d".repeat(40);
const address = { source: "team-main", path: "guide" };
const preview: UpdatePreview = {
  address,
  status: "ready",
  targetRevision: revision,
  removed: false,
  files: [
    {
      path: "SKILL.md",
      status: "modified",
      content: {
        kind: "text",
        before:
          Array.from({ length: 60 }, (_, i) =>
            i % 4 ? `Context ${i}` : `Old instruction ${i}`,
          ).join("\n") + "\n",
        after:
          Array.from({ length: 60 }, (_, i) =>
            i % 4 ? `Context ${i}` : `New instruction ${i}`,
          ).join("\n") + "\n",
      },
    },
    {
      path: "references/added.md",
      status: "added",
      content: { kind: "text", before: "", after: "Added resource\n" },
    },
    {
      path: "old.txt",
      status: "deleted",
      content: { kind: "text", before: "Removed resource\n", after: "" },
    },
    { path: "image.bin", status: "modified", content: { kind: "unavailable", reason: "binary" } },
  ],
};

async function mount(width: number, height: number, hook?: ManagementCapability["previewUpdate"]) {
  const prior = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/update-preview-");
  process.env.SKILL_TUI_UPDATE_CACHE_DIR = cache;
  const base = workspaceProjection({ includeContribution: false });
  const projection: ManagementProjection = {
    ...base,
    installedSkills: ["guide", "other"].map((path) => ({
      address: { ...address, path },
      name: path,
      description: "Preview fixture",
      source: base.effective.sources[0],
      owner: { source: address.source, health: "healthy" },
      collections: [],
      selectors: [],
      selectorViews: { status: "complete", values: [] },
      aliases: [],
      problems: [],
    })),
  };
  const requests: Parameters<ManagementCapability["previewUpdate"]>[0][] = [];
  const mutations: unknown[] = [];
  const core = directSourceCore(projection, {
    checkUpdate: async () => ({
      value: {
        source: address.source,
        kind: "github",
        exactRevision: revision,
        baseline: "checked",
        changed: projection.installedSkills.map((skill) => ({
          path: skill.address.path,
          name: skill.name,
          description: skill.description,
        })),
        unchanged: [],
        removed: [],
        added: [],
      },
      diagnostics: [],
    }),
    previewUpdate: async (request, options) => {
      requests.push(request);
      return hook ? hook(request, options) : { value: preview, diagnostics: [] };
    },
    update: async (request) => {
      mutations.push(request);
      return { value: undefined, diagnostics: [] };
    },
    loadInstalled: async () => {
      throw new Error("Updates activation must not open the installed Reader");
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-updates"));
  await enterLive(setup, "shell-section-tab-updates");
  await setup.waitForFrame((frame) => frame.includes("Updates available"));
  await enterLive(setup, "updates-browser");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
  return {
    setup,
    requests,
    mutations,
    async dispose() {
      setup.renderer.destroy();
      if (prior === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
      else process.env.SKILL_TUI_UPDATE_CACHE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    },
  };
}

test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "Updates Skill opens native Diff at %ix%i and Back preserves the exact browser",
  async (width, height) => {
    const mounted = await mount(width, height);
    const { setup, requests, mutations } = mounted;
    try {
      if (width === 80) {
        await focusLive(setup, "source-updates-browser");
        await setup.mockInput.typeText("/");
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "source-updates-query",
        );
        await setup.mockInput.typeText("guide");
        await parsedEnter(setup);
      }
      await focusLive(setup, "source-updates-browser");
      await setup.mockInput.typeText(" ");
      await parsedEnter(setup);
      await setup.waitFor(
        () =>
          setup.renderer.root.findDescendantById("source-updates-preview-diff") instanceof
          DiffRenderable,
      );
      await setup.flush();
      expect(requests).toEqual([
        { ...address, exactRevision: revision, expectedBaseline: "checked" },
      ]);
      const diff = () =>
        setup.renderer.root.findDescendantById("source-updates-preview-diff") as DiffRenderable;
      expect(diff().diff).toContain("-Old instruction 0");
      expect(diff().diff).toContain("+New instruction 0");
      expect(diff().view).toBe(width >= 100 ? "split" : "unified");
      expect(diff().screenY).toBeLessThan(height - 1);
      expect(setup.captureCharFrame()).toContain("Old instruction");
      expect(setup.captureCharFrame()).toContain("New instruction");
      expect(
        setup.renderer.root.findDescendantById("source-updates-actions-pane")!.parent!.visible,
      ).toBe(false);
      await focusLive(setup, "source-updates-preview-files");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => diff()?.diff.includes("Added resource"));
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => diff()?.diff.includes("-Removed resource"));
      setup.mockInput.pressArrow("down");
      await setup.waitForFrame((frame) => frame.includes("Binary"));
      const files = setup.renderer.root.findDescendantById(
        "source-updates-preview-files",
      ) as SelectRenderable;
      files.setSelectedIndex(0);
      await setup.flush();
      await focusLive(setup, "source-updates-preview-content-pane");
      await setup.mockInput.typeText("u");
      expect(mutations).toHaveLength(0);
      await new Promise<void>((resolve) => {
        const listener = (event: { readonly name: string }) => {
          if (event.name !== "pagedown" && event.name !== "page-down") return;
          setup.renderer.keyInput.off("keypress", listener);
          resolve();
        };
        setup.renderer.keyInput.prependListener("keypress", listener);
        setup.mockInput.pressKey("\x1b[6~");
      });
      await setup.flush();
      expect(
        (
          setup.renderer.root.findDescendantById(
            "source-updates-preview-content-pane",
          ) as ScrollBoxRenderable
        ).scrollTop,
      ).toBeGreaterThan(0);
      if (width === 80) {
        for (const [w, h] of [
          [43, 13],
          [144, 40],
          [80, 24],
        ]) {
          setup.resize(w!, h!);
          await setup.flush();
          expect(diff().view).toBe(w! >= 100 ? "split" : "unified");
        }
        expect(requests).toHaveLength(1);
      }
      if (process.env.UPDATE_PREVIEW_CAPTURE_DIR) {
        const output = process.env.UPDATE_PREVIEW_CAPTURE_DIR;
        await mkdir(output, { recursive: true });
        await writeFile(join(output, `diff-${width}x${height}.txt`), setup.captureCharFrame());
      }
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-updates-browser",
      );
      if (width === 80) {
        expect(setup.captureCharFrame()).toContain("Filter: guide");
        expect(setup.captureCharFrame()).not.toContain("other");
      }
      expect(setup.renderer.root.findDescendantById("source-updates-preview-pane")).toBeUndefined();
      await enterLive(setup, "source-updates-update-all");
      await setup.waitFor(() => mutations.length === 1);
      expect(mutations[0]).toMatchObject({ source: address.source, paths: ["guide"] });
    } finally {
      await mounted.dispose();
    }
  },
);

test("leaving a pending preview aborts its read and a late reply cannot replace the next preview", async () => {
  const signals: AbortSignal[] = [];
  const resolvers: ((value: Awaited<ReturnType<ManagementCapability["previewUpdate"]>>) => void)[] =
    [];
  const mounted = await mount(80, 24, async (_request, options) => {
    signals.push(options!.signal!);
    return await new Promise((resolve) => resolvers.push(resolve));
  });
  const { setup } = mounted;
  try {
    await enterLive(setup, "source-updates-browser");
    await setup.waitForFrame((frame) => frame.includes("Loading checked"));
    await parsedEscape(setup);
    expect(signals[0]!.aborted).toBe(true);
    await enterLive(setup, "source-updates-browser");
    await setup.waitFor(() => resolvers.length === 2);
    resolvers[0]!({ value: preview, diagnostics: [] });
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("source-updates-preview-diff")).toBeUndefined();
    resolvers[1]!({
      value: { address, status: "unavailable", reason: "local-live-content" },
      diagnostics: [],
    });
    await setup.waitForFrame((frame) => frame.includes("Local Skills use live files"));
    expect(mounted.mutations).toHaveLength(0);
  } finally {
    resolvers.forEach((resolve) => resolve({ value: preview, diagnostics: [] }));
    await mounted.dispose();
  }
});

test("preview errors remain readable and Back returns without triggering a recheck or update", async () => {
  const mounted = await mount(80, 24, async () => {
    throw new Error("Installed comparison changed; check updates again");
  });
  try {
    await enterLive(mounted.setup, "source-updates-browser");
    await mounted.setup.waitForFrame((frame) => frame.includes("Installed comparison changed"));
    await enterLive(mounted.setup, "route-back");
    await mounted.setup.waitFor(
      () => mounted.setup.renderer.currentFocusedRenderable?.id === "source-updates-browser",
    );
    expect(mounted.requests).toHaveLength(1);
    expect(mounted.mutations).toHaveLength(0);
  } finally {
    await mounted.dispose();
  }
});
