/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";

const revision = "e".repeat(40);
type Setup = Awaited<ReturnType<typeof testRender>>;

function projection(sourceCount: number, skillCount = 1) {
  const base = workspaceProjection({ includeContribution: false });
  const sources = Array.from({ length: sourceCount }, (_, index) => ({
    ...base.effective.sources[0]!,
    id: index ? `source-${String(index + 1).padStart(2, "0")}` : "team-main",
  }));
  return {
    ...base,
    effective: { ...base.effective, sources },
    installedSkills: sources.flatMap((source) =>
      Array.from({ length: skillCount }, (_, index) => ({
        address: { source: source.id, path: `skill-${index}` },
        name: `Skill ${index}`,
        description: `Installed Skill ${index}`,
        owner: { source: source.id, health: "healthy" as const },
        source,
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
  };
}

function text(setup: Setup, id: string) {
  const cell = setup.renderer.root.findDescendantById(id);
  return cell instanceof TextRenderable ? cell.plainText : undefined;
}

async function renderApp(core: ReturnType<typeof directSourceCore>, width: number, height: number) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/update-table-app-");
  const prior = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
  process.env.SKILL_TUI_UPDATE_CACHE_DIR = cache;
  let setup: Setup | undefined;
  return {
    async mount() {
      setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("shell-section-tab-updates"),
      );
      await enterLive(setup, "shell-section-tab-updates");
      return setup;
    },
    async dispose() {
      setup?.renderer.destroy();
      if (prior === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
      else process.env.SKILL_TUI_UPDATE_CACHE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    },
  };
}

async function capture(setup: Setup, name: string) {
  const output = process.env.UPDATE_TABLE_CAPTURE_DIR;
  if (!output) return;
  // A text-property update can precede the native draw captured below.
  for (let i = 0; i < 3; i++) await setup.renderOnce();
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${name}.txt`), setup.captureCharFrame());
  await writeFile(join(output, `${name}.json`), JSON.stringify(setup.captureSpans(), null, 2));
}

test.each([
  [80, 16],
  [80, 24],
  [43, 30],
])(
  "RENDER App update table keeps status, scrolling and actions usable at %ix%i",
  async (width, height) => {
    const calls: string[] = [];
    const fixture = projection(12);
    const mounted = await renderApp(
      directSourceCore(fixture, {
        checkUpdate: async ({ source }) => {
          calls.push(source);
          if (source === "source-12") throw new Error("Remote unavailable: fixture network error");
          return {
            value: {
              source,
              kind: "github",
              exactRevision: revision,
              changed: [],
              removed: [],
              added: [],
              unchanged: [{ path: "skill-0", name: "Skill 0", description: "Installed Skill 0" }],
            },
            diagnostics: [],
          };
        },
        loadInstalled: async () => {
          throw new Error("The update table must not read Skill content");
        },
      }),
      width,
      height,
    );
    try {
      const setup = await mounted.mount();
      const failed = "updates-browser-row-group%3Asource-12:cell-status";
      await setup.waitFor(() => text(setup, failed) === "Check failed", { maxPasses: 200 });
      for (let i = 0; i < 3; i++) await setup.renderOnce();
      expect(new Set(calls).size).toBe(12);
      const browser = await focusLive(setup, "updates-browser");
      expect(browser).toBeInstanceOf(BoxRenderable);
      expect(browser.height).toBeGreaterThanOrEqual(2);
      setup.mockInput.pressKey(KeyCodes.END);
      for (let i = 0; i < 3; i++) await setup.renderOnce();
      const body = setup.renderer.root.findDescendantById(
        "updates-browser-body",
      ) as ScrollBoxRenderable;
      const row = setup.renderer.root.findDescendantById("updates-browser-row-group%3Asource-12")!;
      expect(row.screenY + row.height).toBeLessThanOrEqual(
        body.viewport.screenY + body.viewport.height,
      );
      expect(setup.captureCharFrame()).toContain("Remote unavailable:");
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      const check = setup.renderer.root.findDescendantById("updates-check")!;
      expect(setup.renderer.currentFocusedRenderable).toBe(check);
      expect(check.screenY + check.height).toBeLessThan(height);
      await capture(setup, `overview-${width}x${height}`);
      await focusLive(setup, "updates-browser");
      setup.mockInput.pressKey(KeyCodes.HOME);
      for (let i = 0; i < 3; i++) await setup.renderOnce();
      expect(setup.captureCharFrame()).not.toContain("Remote unavailable:");
    } finally {
      await mounted.dispose();
    }
  },
);

test("RENDER App Source table submits one selected Skill once at the checked exact revision", async () => {
  const requests: unknown[] = [];
  const fixture = projection(1, 120);
  const mounted = await renderApp(
    directSourceCore(fixture, {
      checkUpdate: async ({ source }) => ({
        value: {
          source,
          kind: "github",
          exactRevision: revision,
          changed: fixture.installedSkills.map((skill) => ({
            path: skill.address.path,
            name: skill.name,
            description: skill.description,
          })),
          removed: [],
          added: [],
          unchanged: [],
        },
        diagnostics: [],
      }),
      update: async (request) => {
        requests.push(request);
        return { value: undefined, diagnostics: [] };
      },
      loadInstalled: async () => {
        throw new Error("Table navigation and submit must not read Skill content");
      },
    }),
    80,
    24,
  );
  try {
    const setup = await mounted.mount();
    await setup.waitFor(
      () => text(setup, "updates-browser-row-group%3Ateam-main:cell-updates") === "120",
      { maxPasses: 200 },
    );
    await enterLive(setup, "updates-browser");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-updates-browser-header-skill"),
    );
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    await focusLive(setup, "source-updates-browser");
    setup.mockInput.pressKey(KeyCodes.END);
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    setup.mockInput.pressKey(" ");
    const lastRow = `source-updates-browser-row-${encodeURIComponent("team-main\u0000skill-119")}`;
    await setup.waitFor(() => text(setup, `${lastRow}:check`)?.includes("✓") === true);
    expect(requests).toEqual([]);
    await capture(setup, "source-120-80x24");
    await enterLive(setup, "source-updates-submit");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-review-execute"));
    await enterLive(setup, "updates-review-execute");
    await setup.waitFor(() => requests.length === 1);
    expect(requests[0]).toMatchObject({
      source: "team-main",
      paths: ["skill-119"],
      exactRevision: revision,
    });
    expect(requests).toHaveLength(1);
    await parsedEscape(setup);
  } finally {
    await mounted.dispose();
  }
});
