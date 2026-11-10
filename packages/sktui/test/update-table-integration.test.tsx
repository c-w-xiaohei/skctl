/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
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
async function renderApp(
  core: ReturnType<typeof directSourceCore>,
  width: number,
  height: number,
  reads: readonly unknown[],
) {
  const cache = await mkdtemp(join(tmpdir(), "update-table-app-"));
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  let setup: Setup | undefined;
  return {
    async mount() {
      setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
      await setup.waitFor(() => reads.length === 1);
      await openMainPage(setup, "updates");
      return setup;
    },
    async dispose() {
      setup?.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    },
  };
}
test.each([
  [80, 16],
  [80, 24],
  [43, 30],
])(
  "RENDER App update table keeps status, scrolling and actions usable at %ix%i",
  async (width, height) => {
    const calls: string[] = [];
    const reads: unknown[] = [];
    const failure = `Remote unavailable: ${"fixture network diagnostic. ".repeat(20)}`;
    const fixture = projection(12);
    const mounted = await renderApp(
      directSourceCore(fixture, {
        getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
        checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
          calls.push(source);
          if (source === "source-12") throw new Error(failure);
          return {
            value: {
              source,
              kind: "github",
              baseline: "baseline:test",
              exactRevision: revision,
              changed: [],
              removed: [],
              added: [],
              unchanged: [{ path: "skill-0", name: "Skill 0", description: "Installed Skill 0" }],
            },
            diagnostics: [],
          };
        },
        loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) => {
          reads.push(request);
          throw new Error("The update table must not read Skill content");
        },
      }),
      width,
      height,
      reads,
    );
    try {
      // The default installed inventory can read its current Skill before Updates opens.
      const setup = await mounted.mount();
      const startupReads = [...reads];
      const failed = "updates-browser-row-source-12:cell-status";
      await setup.waitFor(() => text(setup, failed) === "Check needed", { maxPasses: 200 });
      expect([...calls].sort()).toEqual(
        fixture.effective.sources.map((source) => source.id).sort(),
      );
      const browser = await focusLive(setup, "updates-browser");
      expect(browser).toBeInstanceOf(BoxRenderable);
      expect(browser.height).toBeGreaterThanOrEqual(2);
      setup.mockInput.pressKey(KeyCodes.END);
      for (let i = 0; i < 3; i++) await setup.renderOnce();
      const body = setup.renderer.root.findDescendantById("updates-browser-body");
      if (!(body instanceof ScrollBoxRenderable))
        throw new Error("Expected native overview viewport");
      const row = setup.renderer.root.findDescendantById("updates-browser-row-source-12")!;
      expect(row.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
      expect(row.screenY + row.height).toBeLessThanOrEqual(
        body.viewport.screenY + body.viewport.height,
      );
      await setup.mockInput.typeText("d");
      const detailText = (node: BaseRenderable): string =>
        node instanceof TextRenderable
          ? node.plainText
          : node.getChildren().map(detailText).join("");
      await setup.waitFor(() => {
        const pane = setup.renderer.root.findDescendantById("updates-feedback-pane");
        return pane instanceof ScrollBoxRenderable && detailText(pane).includes(failure);
      });
      expect(
        detailText(setup.renderer.root.findDescendantById("updates-feedback-pane")!),
      ).toContain(failure);
      await parsedEscape(setup);
      const firstAction = height <= 18 ? "updates-feedback-recover" : "updates-update-all";
      for (
        let step = 0;
        step < 8 && setup.renderer.currentFocusedRenderable?.id !== firstAction;
        step++
      ) {
        setup.mockInput.pressTab();
        await setup.renderOnce();
      }
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(firstAction);
      if (height > 18 && width >= 72) setup.mockInput.pressArrow("right");
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      const action = setup.renderer.root.findDescendantById(
        height <= 18 ? "updates-feedback-details" : width < 72 ? "updates-more" : "updates-check",
      )!;
      expect(setup.renderer.currentFocusedRenderable === action).toBe(true);
      const pane = setup.renderer.root.findDescendantById("updates-page")!;
      expect(action.screenY).toBeGreaterThanOrEqual(pane.screenY + 1);
      expect(action.screenY + action.height).toBeLessThanOrEqual(pane.screenY + pane.height - 1);
      expect(action.screenX).toBeGreaterThanOrEqual(pane.screenX + 1);
      expect(action.screenX + action.width).toBeLessThanOrEqual(pane.screenX + pane.width - 1);
      expect(action.screenY + action.height).toBeLessThan(height);
      await focusLive(setup, "updates-browser");
      setup.mockInput.pressKey(KeyCodes.HOME);
      for (let i = 0; i < 3; i++) await setup.renderOnce();
      expect(setup.captureCharFrame()).not.toContain("Remote unavailable:");
      expect(reads).toEqual(startupReads);
    } finally {
      await mounted.dispose();
    }
  },
);
test("RENDER App Source table submits one selected Skill once at the checked exact revision", async () => {
  const requests: unknown[] = [];
  const checks: string[] = [];
  const reads: unknown[] = [];
  const fixture = projection(1, 120);
  const mounted = await renderApp(
    directSourceCore(fixture, {
      getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
        checks.push(source);
        return {
          value: {
            source,
            kind: "github",
            baseline: "baseline:test",
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
        };
      },
      updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
        requests.push(request);
        return { value: undefined, diagnostics: [] };
      },
      loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) => {
        reads.push(request);
        throw new Error("Table navigation and submit must not read Skill content");
      },
    }),
    80,
    24,
    reads,
  );
  try {
    const setup = await mounted.mount();
    const startupReads = [...reads];
    await setup.waitFor(() => text(setup, "updates-browser-row-team-main:cell-updates") === "120", {
      maxPasses: 200,
    });
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
    const body = setup.renderer.root.findDescendantById("source-updates-browser-body");
    if (!(body instanceof ScrollBoxRenderable)) throw new Error("Expected native Source viewport");
    const row = setup.renderer.root.findDescendantById(lastRow)!;
    expect(row.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
    expect(row.screenY + row.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    await enterLive(setup, "source-updates-update-all");
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([
      {
        source: "team-main",
        paths: ["skill-119"],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
    ]);
    expect(checks).toEqual(["team-main"]);
    expect(reads).toEqual(startupReads);
  } finally {
    await mounted.dispose();
  }
});
