/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
  type ReaderSetup,
} from "./reader-test-controls";
const shellSlots = [
  "global-bar",
  "shell-context-panel",
  "shell-activity",
  "workarea-navigation-pane",
  "route-back-slot",
  "section-nav",
  "route-content",
  "command-status",
] as const;
function geometry(setup: ReaderSetup, ids: readonly string[] = shellSlots) {
  return Object.fromEntries(
    ids.map((id) => {
      const node = live(setup, id);
      return [id, [node.screenX, node.screenY, node.width, node.height]];
    }),
  );
}
async function capture(setup: ReaderSetup, name: string) {
  const output = process.env.NAVIGATION_CAPTURE_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${name}.txt`), setup.captureCharFrame());
  await writeFile(
    join(output, `${name}.json`),
    JSON.stringify(
      geometry(
        setup,
        shellSlots.filter((id) => !!setup.renderer.root.findDescendantById(id)),
      ),
      null,
      2,
    ),
  );
}
async function chooseAction(setup: ReaderSetup, id: string) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
  await parsedEnter(setup);
}
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [79, 24],
  [64, 24],
  [43, 13],
])(
  "navigation slots do not move across loading, focus, Reader, overlays and checks at %ix%i",
  async (width, height) => {
    await mkdir("/tmp/opencode", { recursive: true });
    const cache = await mkdtemp("/tmp/opencode/navigation-geometry-");
    const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
    const projection = readerProjection();
    let release!: () => void;
    const loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checks = 0;
    let checkStarted!: () => void;
    const checking = new Promise<void>((resolve) => {
      checkStarted = resolve;
    });
    let signal: AbortSignal | undefined;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            getWorkspace: async () => {
              await loading;
              return { value: projection, diagnostics: [] };
            },
            checkUpdate: async (
              _environment: import("@skctl/core").CoreOptions,
              _request,
              options,
            ) => {
              checks++;
              checkStarted();
              signal = options?.signal;
              await new Promise<void>((_resolve, reject) => {
                const abort = () =>
                  reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
              });
              throw new Error("Only cancellation settles this check");
            },
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              { address },
            ) => ({
              address,
              name: address.path,
              description: "Navigation geometry fixture",
              rawText: "# Installed instructions\n\nRead without moving navigation.",
              markdownText: "# Installed instructions\n\nRead without moving navigation.",
            }),
          })}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await setup.flush();
      const shell = geometry(setup);
      const chromeHeight = width < 80 ? 3 : 2;
      expect(live(setup, "global-bar").height).toBe(chromeHeight);
      expect(live(setup, "section-nav").screenY).toBe(0);
      expect(live(setup, "section-nav").screenX).toBe(1);
      expect(live(setup, "route-back-slot").width).toBe(6);
      expect(live(setup, "shell-context-panel").screenY).toBe(width < 80 ? 1 : 0);
      expect(live(setup, "route-content").screenY).toBe(chromeHeight);
      const pages = live(setup, "section-nav");
      const pageControl = live(
        setup,
        width < 100 ? "shell-pages-select" : "shell-section-tab-settings",
      );
      expect(pageControl.screenX + pageControl.width).toBeLessThanOrEqual(
        pages.screenX + pages.width,
      );
      for (const id of shellSlots) {
        const node = live(setup, id);
        expect(node.height).toBeGreaterThan(0);
        expect(node.width).toBeGreaterThan(0);
        expect(node.screenX + node.width).toBeLessThanOrEqual(width);
        expect(node.screenY + node.height).toBeLessThanOrEqual(height);
      }
      expect(setup.renderer.root.findDescendantById("route-title")).toBeUndefined();
      await capture(setup, `${width}x${height}-loading`);
      release();
      // The check cache loads through filesystem IO, not renderer frames.
      await checking;
      await setup.flush();
      expect(checks).toBe(1);
      await openAllInstalledSkills(setup);
      await setup.flush();
      expect(geometry(setup)).toEqual(shell);
      let views = geometry(setup, ["skills-local-views"]);
      let viewNode = live(setup, "skills-local-views");
      let compactReaderShell: ReturnType<typeof geometry> | undefined;
      let inReader = false;
      const assertStable = async () => {
        await setup.flush();
        if (width < 100 && inReader) {
          expect(setup.renderer.root.findDescendantById("skills-local-views")).toBeUndefined();
          if (width < 80) {
            expect(live(setup, "global-bar").height).toBe(1);
            expect(live(setup, "route-content").screenY).toBe(1);
            const current = geometry(setup, [
              "global-bar",
              "route-back-slot",
              "route-content",
              "command-status",
            ]);
            compactReaderShell ??= current;
            expect(current).toEqual(compactReaderShell);
          } else {
            expect(geometry(setup)).toEqual(shell);
          }
          return;
        }
        expect(geometry(setup)).toEqual(shell);
        expect(geometry(setup, ["skills-local-views"])).toEqual(views);
        expect(live(setup, "skills-local-views") === viewNode).toBe(true);
      };
      await parsedEnter(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
      await waitForReaderBody(setup, "Read without moving navigation.");
      inReader = true;
      await assertStable();
      await capture(setup, `${width}x${height}-reader`);
      for (const id of ["reader-tabs-tab-details", "shell-more-actions", "route-back"]) {
        await focusLive(setup, id);
        await assertStable();
        if (id === "route-back") {
          expect(setup.captureCharFrame()).toContain("Back to Skills");
          const back = live(setup, "route-back");
          const actions = live(setup, "shell-more-actions");
          expect(actions.screenX - back.screenX - back.width).toBeGreaterThanOrEqual(1);
        }
      }
      // Native pointer down/up must hit the same page-view control after focus changes.
      if (width < 100) {
        await enterLive(setup, "route-back");
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills"),
        );
        inReader = false;
        views = geometry(setup, ["skills-local-views"]);
        viewNode = live(setup, "skills-local-views");
      }
      const tab = live(setup, "skills-view-tab-all-installed-skills");
      const position = [tab.screenX, tab.screenY];
      await setup.mockMouse.pressDown(position[0]! + 1, position[1]!);
      await assertStable();
      expect([tab.screenX, tab.screenY]).toEqual(position);
      await setup.mockMouse.release(position[0]! + 1, position[1]!);
      await assertStable();
      expect([tab.screenX, tab.screenY]).toEqual(position);
      await focusLive(setup, "installed-skill-browser");
      await parsedEnter(setup);
      await focusLive(setup, "route-back");
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      inReader = false;
      if (width < 100) {
        views = geometry(setup, ["skills-local-views"]);
        viewNode = live(setup, "skills-local-views");
      }
      await assertStable();
      await openMainPage(setup, "settings");
      await setup.flush();
      const settingsShell = geometry(setup);
      expect(geometry(setup, ["global-bar", "route-content", "command-status"])).toEqual(
        Object.fromEntries(
          ["global-bar", "route-content", "command-status"].map((id) => [id, shell[id]]),
        ),
      );
      await enterLive(setup, "shell-scope-select");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("scope-choices"));
      expect(geometry(setup)).toEqual(settingsShell);
      await parsedEscape(setup);
      await setup.flush();
      expect(geometry(setup)).toEqual(settingsShell);
      await openMainPage(setup, "skills");
      views = geometry(setup, ["skills-local-views"]);
      viewNode = live(setup, "skills-local-views");
      await focusLive(setup, "installed-skill-browser");
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("palette-choices"));
      await assertStable();
      await parsedEscape(setup);
      await chooseAction(setup, "checks.task.stop");
      await setup.waitFor(() => signal?.aborted === true);
      await assertStable();
      await capture(setup, `${width}x${height}-stopped`);
      for (const section of ["sources", "collections", "updates", "skills"]) {
        await openMainPage(setup, section as "skills" | "sources" | "collections" | "updates");
        await setup.flush();
        expect(geometry(setup)).toEqual(shell);
      }
      expect(checks).toBe(1);
    } finally {
      release();
      setup.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    }
  },
);
test.each([144, 80])(
  "object Reader has an explicit inventory landing and Back restores the retained page view at %i columns",
  async (width) => {
    await mkdir("/tmp/opencode", { recursive: true });
    const cache = await mkdtemp("/tmp/opencode/navigation-reader-");
    const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(collectionsSourcesProjection(), {
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              { address },
            ) => ({
              address,
              name: address.path,
              description: "Installed object",
              rawText: "Exact installed object",
              markdownText: "Exact installed object",
            }),
          })}
          exit={() => {}}
        />
      ),
      { width, height: 24 },
    );
    const selected = (view: string) => {
      const tab = live(setup, `skills-view-tab-${view}`);
      return tab instanceof TabsTabRenderable && tab.getState().selected;
    };
    try {
      await setup.flush();
      const shell = geometry(setup);
      await enterLive(setup, "skills-view-tab-unassigned");
      await openMainPage(setup, "collections");
      await enterLive(setup, "collection-browser");
      await enterLive(setup, "collection-relationships");
      await waitForReaderBody(setup, "Exact installed object");
      if (width >= 100) {
        // A semantic Reader route does not erase the useful wide inventory pane.
        expect(selected("all-installed-skills")).toBe(true);
        const browser = live(setup, "installed-skill-browser") as SelectRenderable;
        expect(browser.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "guide"]));
      } else {
        expect(setup.renderer.root.findDescendantById("skills-local-views")).toBeUndefined();
      }
      if (width >= 100) expect(geometry(setup)).toEqual(shell);
      else expect(live(setup, "route-content").height).toBeGreaterThan(0);
      await enterLive(setup, "route-back");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      await openMainPage(setup, "skills");
      expect(selected("unassigned")).toBe(true);
      expect(geometry(setup)).toEqual(shell);
    } finally {
      setup.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    }
  },
);
