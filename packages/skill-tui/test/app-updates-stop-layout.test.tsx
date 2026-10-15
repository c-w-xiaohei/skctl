/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { ManagementProjection, UpdateObservation } from "@skill-cli/core";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, focusLive } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
const revision = "c".repeat(40);

function bounds(target: ReturnType<Setup["renderer"]["root"]["findDescendantById"]>) {
  return target && !target.isDestroyed
    ? {
        id: target.id,
        x: target.screenX,
        y: target.screenY,
        width: target.width,
        height: target.height,
      }
    : undefined;
}

function diagnostic(setup: Setup, stage: string) {
  const root = setup.renderer.root;
  const page = root.findDescendantById("updates-page");
  const region = root.findDescendantById("updates-scroll-region");
  const browser = root.findDescendantById("updates-browser");
  const check = root.findDescendantById("updates-check");
  const updateAll = root.findDescendantById("updates-update-all");
  const stop = root.findDescendantById("updates-stop");
  return `${stage}; focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}; bounds=${JSON.stringify(
    {
      page: bounds(page),
      region: bounds(region),
      browser: bounds(browser),
      check: bounds(check),
      updateAll: bounds(updateAll),
      stop: bounds(stop),
      horizontalScrollBar:
        region instanceof ScrollBoxRenderable ? bounds(region.horizontalScrollBar) : undefined,
      verticalScrollBar:
        region instanceof ScrollBoxRenderable ? bounds(region.verticalScrollBar) : undefined,
    },
  )}\n${setup.captureCharFrame()}`;
}

async function key(setup: Setup, key: "down" | "enter") {
  if (key === "down") setup.mockInput.pressArrow("down");
  else setup.mockInput.pressEnter();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

function rowNames(setup: Setup) {
  const browser = setup.renderer.root.findDescendantById("updates-browser");
  if (!(browser instanceof SelectRenderable)) return [];
  return browser.options.map((option) => option.name);
}

test("App Updates keeps Source results above actions after Stop removes the active command", async () => {
  const base = workspaceProjection({ includeContribution: false });
  const otherSource = { ...base.effective.sources[0]!, id: "other-source" };
  const otherInstalledSkill = {
    ...readerProjection().installedSkills[0]!,
    address: { source: otherSource.id, path: "other" },
    name: "other",
    description: "Installed Skill from the second Source",
    owner: { source: otherSource.id, health: "healthy" as const },
    source: otherSource,
  };
  const projection: ManagementProjection = {
    ...base,
    installedSkills: [...readerProjection().installedSkills, otherInstalledSkill],
    effective: { ...base.effective, sources: [base.effective.sources[0]!, otherSource] },
  };
  const checks: string[] = [];
  const completedChecks: string[] = [];
  const updates: { source: string; paths: readonly string[]; exactRevision?: string }[] = [];
  let updateAborts = 0;
  const observation = (source: string, path: string): UpdateObservation => ({
    source,
    kind: "github",
    exactRevision: revision,
    changed: [{ path, name: path, description: `Changed ${path}` }],
    added: [],
    removed: [],
    unchanged: [],
  });
  const core = directSourceCore(projection, {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      const result = {
        value: observation(source, source === "team-main" ? "guide" : "other"),
        diagnostics: [],
      };
      completedChecks.push(source);
      return result;
    },
    update: (request, options) => {
      updates.push(request);
      return new Promise((_, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => {
            updateAborts++;
            reject(new Error("stopped"));
          },
          { once: true },
        ),
      );
    },
  });

  const priorCachePath = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
  const cacheDirectory = await mkdtemp(join(tmpdir(), "skill-cli-stop-layout-"));
  process.env.SKILL_TUI_UPDATE_CACHE_DIR = cacheDirectory;
  let setup: Setup | undefined;
  let stage = "boot";
  try {
    setup = await testRender(() => <App core={core} exit={() => {}} />, {
      width: 120,
      height: 40,
    });
    await setup.waitFor(
      () => !!setup!.renderer.root.findDescendantById("shell-section-navigation"),
    );
    await focusLive(setup, "shell-section-navigation");
    for (let step = 0; step < 3; step++) await key(setup, "down");
    await key(setup, "enter");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-browser"));

    stage = "automatic startup checks settle";
    await setup.waitFor(() => completedChecks.length >= 2);
    await setup.waitFor(() => {
      const rows = rowNames(setup!);
      return (
        rows.length === 2 &&
        rows.some((row) => /team-main.*1 updates/i.test(row)) &&
        rows.some((row) => /other-source.*1 updates/i.test(row)) &&
        !rows.some((row) => /checking|not checked/i.test(row))
      );
    });
    expect(checks.slice(0, 2), diagnostic(setup, stage)).toEqual(["team-main", "other-source"]);
    expect(setup.captureCharFrame(), diagnostic(setup, stage)).toContain(
      "Update available 2 Skills",
    );

    stage = "explicit manual refresh after startup settles";
    const beforeManualCheck = checks.length;
    const beforeManualCompletion = completedChecks.length;
    await enterLive(setup, "updates-check");
    await setup.waitFor(() => checks.length === beforeManualCheck + 2);
    expect(checks.slice(beforeManualCheck), diagnostic(setup, stage)).toEqual([
      "team-main",
      "other-source",
    ]);
    await setup.waitFor(() => completedChecks.length === beforeManualCompletion + 2);
    expect(completedChecks.slice(beforeManualCompletion), diagnostic(setup, stage)).toEqual([
      "team-main",
      "other-source",
    ]);
    await setup.waitFor(() => {
      const rows = rowNames(setup!);
      return (
        rows.length === 2 &&
        rows.some((row) => /team-main.*1 updates/i.test(row)) &&
        rows.some((row) => /other-source.*1 updates/i.test(row)) &&
        !rows.some((row) => /checking|not checked/i.test(row))
      );
    });

    stage = "review exact checked targets";
    await enterLive(setup, "updates-update-all");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-review-execute"));
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Exact update targets") &&
        frame.includes("team-main/guide") &&
        frame.includes("other-source/other"),
      { maxPasses: 200 },
    );
    const review = setup.captureCharFrame();
    expect(review, diagnostic(setup, stage)).toContain("Exact update targets");
    expect(review, diagnostic(setup, stage)).toContain("team-main/guide");
    expect(review, diagnostic(setup, stage)).toContain("other-source/other");
    expect(updates, diagnostic(setup, stage)).toEqual([]);

    stage = "execute reviewed two-Source batch";
    await enterLive(setup, "updates-review-execute");
    await setup.waitFor(
      () => updates.length === 1 && !!setup!.renderer.root.findDescendantById("updates-stop"),
    );
    expect(updates, diagnostic(setup, stage)).toEqual([
      { source: "team-main", paths: ["guide"], exactRevision: revision },
    ]);
    const activeStop = setup.renderer.root.findDescendantById("updates-stop");
    expect(activeStop?.focusable, diagnostic(setup, stage)).toBe(true);
    expect(
      activeStop && !activeStop.isDestroyed && !!activeStop.parent,
      diagnostic(setup, stage),
    ).toBe(true);

    stage = "activate live Stop";
    await enterLive(setup, "updates-stop");
    await setup.waitFor(() => updateAborts === 1);
    await setup.waitFor(() => !setup!.renderer.root.findDescendantById("updates-stop"));
    await setup.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "updates-browser");
    await setup.renderOnce();
    await setup.renderOnce();

    stage = "post-Stop result, feedback, focus, and geometry";
    const root = setup.renderer.root;
    const page = root.findDescendantById("updates-page");
    const region = root.findDescendantById("updates-scroll-region");
    const browser = root.findDescendantById("updates-browser");
    const check = root.findDescendantById("updates-check");
    if (
      !page ||
      !(region instanceof ScrollBoxRenderable) ||
      !(browser instanceof SelectRenderable) ||
      !check
    )
      throw new Error("Current Updates page, scroll region, list, or Check action is not mounted");
    expect(setup.renderer.currentFocusedRenderable, diagnostic(setup, stage)).toBe(browser);
    expect(check.focusable, diagnostic(setup, stage)).toBe(true);
    expect(root.findDescendantById("updates-update-all"), diagnostic(setup, stage)).toBeUndefined();
    expect(check.screenY + check.height, diagnostic(setup, stage)).toBeLessThanOrEqual(
      page.screenY + page.height,
    );
    expect(region.screenY, diagnostic(setup, stage)).toBeGreaterThanOrEqual(page.screenY);
    expect(region.screenY + region.height, diagnostic(setup, stage)).toBeLessThanOrEqual(
      page.screenY + page.height,
    );
    expect(browser.screenY + browser.height, diagnostic(setup, stage)).toBeLessThanOrEqual(
      check.screenY,
    );
    expect(region.horizontalScrollBar.visible, diagnostic(setup, stage)).toBe(false);
    expect(region.verticalScrollBar.visible, diagnostic(setup, stage)).toBe(false);
    expect(rowNames(setup).join("\n"), diagnostic(setup, stage)).toMatch(/team-main.*cancelled/i);
    expect(rowNames(setup).join("\n"), diagnostic(setup, stage)).toMatch(/other-source.*not run/i);
    expect(setup.captureCharFrame(), diagnostic(setup, stage)).toContain(
      "Update outcome may be unknown; check updates again",
    );
    expect(updates, diagnostic(setup, stage)).toEqual([
      { source: "team-main", paths: ["guide"], exactRevision: revision },
    ]);
    const frameLines = setup.captureCharFrame().split("\n");
    const feedbackLine = frameLines.findIndex((line) =>
      line.includes("Update outcome may be unknown"),
    );
    const checkLine = frameLines.findIndex((line) => line.includes("Check updates"));
    expect(feedbackLine, diagnostic(setup, stage)).toBeGreaterThanOrEqual(0);
    expect(checkLine, diagnostic(setup, stage)).toBeGreaterThan(feedbackLine);
    expect(frameLines[feedbackLine], diagnostic(setup, stage)).not.toMatch(/[┌┐└┘─]/);
    expect(setup.captureCharFrame(), diagnostic(setup, stage)).not.toMatch(
      /█.*Check updates|Check updates.*█/,
    );
  } catch (error) {
    if (!setup) throw error;
    throw new Error(diagnostic(setup, stage), { cause: error });
  } finally {
    setup?.renderer.destroy();
    if (priorCachePath === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
    else process.env.SKILL_TUI_UPDATE_CACHE_DIR = priorCachePath;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
