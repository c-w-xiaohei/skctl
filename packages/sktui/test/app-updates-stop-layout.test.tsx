/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { WorkspaceView, UpdateObservation } from "@skctl/core";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, parsedEnter } from "./reader-test-controls";
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
  const region = root.findDescendantById("updates-browser-body");
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
function rowNames(setup: Setup) {
  return ["team-main", "other-source"].map((source) => {
    const cell = setup.renderer.root.findDescendantById(
      `updates-browser-row-${source}:cell-status`,
    );
    return `${source} ${cell instanceof TextRenderable ? cell.plainText : "missing"}`;
  });
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
  const projection: WorkspaceView = {
    ...base,
    installedSkills: [...readerProjection().installedSkills, otherInstalledSkill],
    effective: { ...base.effective, sources: [base.effective.sources[0]!, otherSource] },
  };
  const checks: string[] = [];
  const completedChecks: string[] = [];
  const updates: Parameters<typeof import("@skctl/core").updateSkills>[1][] = [];
  let updateAborts = 0;
  const observation = (source: string, path: string): UpdateObservation => ({
    source,
    kind: "github",
    baseline: "baseline:test",
    exactRevision: revision,
    changed: [{ path, name: path, description: `Changed ${path}` }],
    added: [],
    removed: [],
    unchanged: projection.installedSkills
      .filter((skill) => skill.address.source === source && skill.address.path !== path)
      .map((skill) => ({
        path: skill.address.path,
        name: skill.name,
        description: skill.description,
      })),
  });
  const core = directSourceCore(projection, {
    getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      const result = {
        value: observation(source, source === "team-main" ? "guide" : "other"),
        diagnostics: [],
      };
      completedChecks.push(source);
      return result;
    },
    updateSkills: (_environment: import("@skctl/core").CoreOptions, request, options) => {
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
  const priorCachePath = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  const cacheDirectory = await mkdtemp(join(tmpdir(), "skctl-stop-layout-"));
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cacheDirectory;
  let setup: Setup | undefined;
  let stage = "boot";
  try {
    setup = await testRender(() => <App core={core} exit={() => {}} />, {
      width: 120,
      height: 40,
    });
    await setup.waitFor(
      () => !!setup!.renderer.root.findDescendantById("shell-section-tab-updates"),
    );
    await enterLive(setup, "shell-section-tab-updates");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("updates-browser"));
    stage = "automatic startup checks settle";
    await setup.waitFor(() => completedChecks.length >= 2);
    await setup.waitFor(() => {
      const rows = rowNames(setup!);
      return (
        rows.length === 2 &&
        rows.every((row) => row.includes("Updates available")) &&
        !rows.some((row) => /checking|not checked/i.test(row))
      );
    });
    expect(checks.slice(0, 2), diagnostic(setup, stage)).toEqual(["team-main", "other-source"]);
    expect(updates).toEqual([]);
    stage = "explicit manual refresh after startup settles";
    const beforeManualCheck = checks.length;
    const beforeManualCompletion = completedChecks.length;
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const checkIndex = choices.options.findIndex((option) => option.value.id === "updates.check");
    expect(checkIndex).toBeGreaterThanOrEqual(0);
    choices.setSelectedIndex(checkIndex);
    await parsedEnter(setup);
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
        rows.every((row) => row.includes("Updates available")) &&
        !rows.some((row) => /checking|not checked/i.test(row))
      );
    });
    stage = "execute exact checked two-Source batch";
    await enterLive(setup, "updates-update-all");
    await setup.waitFor(
      () => updates.length === 1 && !!setup!.renderer.root.findDescendantById("updates-stop"),
    );
    expect(updates, diagnostic(setup, stage)).toEqual([
      {
        source: "team-main",
        paths: ["guide"],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
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
    await setup.flush();
    stage = "post-Stop result, feedback, focus, and geometry";
    const root = setup.renderer.root;
    const page = root.findDescendantById("updates-page");
    const region = root.findDescendantById("updates-browser-body");
    const browser = root.findDescendantById("updates-browser");
    const details = root.findDescendantById("updates-feedback-details");
    if (
      !page ||
      !(region instanceof ScrollBoxRenderable) ||
      !(browser instanceof BoxRenderable) ||
      !details
    )
      throw new Error(
        "Current Updates page, scroll region, table, or diagnostic action is not mounted",
      );
    expect(setup.renderer.currentFocusedRenderable === browser, diagnostic(setup, stage)).toBe(
      true,
    );
    expect(details.focusable, diagnostic(setup, stage)).toBe(true);
    expect(root.findDescendantById("updates-stop"), diagnostic(setup, stage)).toBeUndefined();
    expect(details.screenY + details.height, diagnostic(setup, stage)).toBeLessThanOrEqual(
      page.screenY + page.height,
    );
    expect(region.screenY, diagnostic(setup, stage)).toBeGreaterThanOrEqual(page.screenY);
    expect(region.screenY + region.height, diagnostic(setup, stage)).toBeLessThanOrEqual(
      page.screenY + page.height,
    );
    expect(browser.screenY + browser.height, diagnostic(setup, stage)).toBeLessThanOrEqual(
      details.screenY,
    );
    expect(region.horizontalScrollBar.visible, diagnostic(setup, stage)).toBe(false);
    expect(region.verticalScrollBar.visible, diagnostic(setup, stage)).toBe(false);
    expect(rowNames(setup).join("\n"), diagnostic(setup, stage)).toMatch(
      /team-main.*Needs attention/i,
    );
    expect(rowNames(setup).join("\n"), diagnostic(setup, stage)).toMatch(/other-source.*not run/i);
    expect(setup.captureCharFrame(), diagnostic(setup, stage)).toContain("Result not confirmed");
    expect(updates, diagnostic(setup, stage)).toEqual([
      {
        source: "team-main",
        paths: ["guide"],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
    ]);
    const frameLines = setup.captureCharFrame().split("\n");
    const feedbackLine = frameLines.findIndex((line) => line.includes("Result not confirmed"));
    const checkLine = frameLines.findIndex((line) => line.includes("Details"));
    expect(feedbackLine, diagnostic(setup, stage)).toBeGreaterThanOrEqual(0);
    expect(checkLine, diagnostic(setup, stage)).toBeGreaterThan(feedbackLine);
    expect(frameLines[feedbackLine], diagnostic(setup, stage)).not.toMatch(/[┌┐└┘─]/);
    expect(setup.captureCharFrame(), diagnostic(setup, stage)).not.toMatch(/█.*Details|Details.*█/);
  } catch (error) {
    if (!setup) throw error;
    throw new Error(diagnostic(setup, stage), { cause: error });
  } finally {
    setup?.renderer.destroy();
    if (priorCachePath === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    else process.env.SKTUI_UPDATE_SCHEDULE_DIR = priorCachePath;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
