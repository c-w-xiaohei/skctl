/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { SkctlError } from "@skctl/core";
import { SelectRenderable } from "@opentui/core";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import {
  enterLive,
  focusLive,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
const revision = "a".repeat(40);
const sourceRow = (path: string) =>
  `source-updates-browser-row-${encodeURIComponent(`team-main\u0000${path}`)}`;
function cell(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  if (!(target instanceof TextRenderable))
    throw new Error(`Missing table cell ${id}\n${setup.captureCharFrame()}`);
  return target.plainText;
}
test("RENDER Source Updates retains an exclusion after a cancelled Skill-scoped update and Back", async () => {
  const base = workspaceProjection({ includeContribution: false });
  const projection = {
    ...base,
    installedSkills: ["one", "two"].map((path) => ({
      address: { source: "team-main", path },
      name: path,
      description: path,
      owner: { source: "team-main", health: "healthy" as const },
      source: base.effective.sources[0],
      collections: [],
      selectors: [],
      selectorViews: { status: "complete" as const, values: [] },
      aliases: [],
      problems: [],
    })),
  };
  const checks: string[] = [],
    completed: string[] = [];
  const updates: Parameters<typeof import("@skctl/core").updateSkills>[1][] = [];
  let updateSignal: AbortSignal | undefined;
  const core = directSourceCore(projection, {
    loadInstalledSkill: async (_environment, { address }) => ({
      address,
      name: address.path,
      description: address.path,
      rawText: `Installed ${address.path}`,
      markdownText: `Installed ${address.path}`,
    }),
    getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      try {
        return {
          value: {
            source,
            kind: "github" as const,
            baseline: "baseline:test",
            exactRevision: revision,
            changed: ["one", "two"].map((path) => ({ path, name: path, description: path })),
            added: [],
            removed: [],
            unchanged: [],
          },
          diagnostics: [],
        };
      } finally {
        completed.push(source);
      }
    },
    updateSkills: async (_environment: import("@skctl/core").CoreOptions, request, options) => {
      updates.push(request);
      updateSignal = options?.signal;
      await new Promise<never>((_resolve, reject) => {
        const abort = () =>
          reject(new SkctlError("CANCELLED", "Stopped before fixture publication"));
        if (updateSignal?.aborted) abort();
        else updateSignal?.addEventListener("abort", abort, { once: true });
      });
      throw new Error("The cancelled fixture must never publish an update");
    },
  });
  const cacheKey = await mkdtemp(join(tmpdir(), "source-scope-back-"));
  const priorCacheKey = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cacheKey;
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    setup = await testRender(() => <App core={core} exit={() => {}} />, { width: 80, height: 24 });
    await setup.waitFor(
      () => !!setup!.renderer.root.findDescendantById("shell-section-tab-updates"),
    );
    await enterLive(setup, "shell-section-tab-updates");
    await setup.waitFor(() => completed.length === 1);
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById(sourceRow("two")));
    expect(setup.renderer.root.findDescendantById("source-updates-browser")).toBeInstanceOf(
      BoxRenderable,
    );
    expect(setup.renderer.root.findDescendantById(`${sourceRow("one")}:check`)).toBeUndefined();
    expect(setup.renderer.root.findDescendantById(`${sourceRow("two")}:check`)).toBeUndefined();
    await focusLive(setup, "source-updates-browser");
    setup.mockInput.pressKey(KeyCodes.HOME);
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => cell(setup!, `${sourceRow("one")}:check`).includes("✓"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => cell(setup!, `${sourceRow("two")}:check`).includes("✓"));
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => !cell(setup!, `${sourceRow("one")}:check`).includes("✓"));
    expect(cell(setup, `${sourceRow("two")}:check`)).toContain("✓");
    // Activating an update row now opens a read-only comparison, never Reader.
    // Follow Source details → All Skills for an installed-content action instead.
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "palette-choices");
    const commands = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const details = commands.options.findIndex(
      (option) => option.value.id === "source-updates.source-details",
    );
    expect(details).toBeGreaterThanOrEqual(0);
    commands.setSelectedIndex(details);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("source-command-skills"));
    await enterLive(setup, "source-command-skills");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("installed-skill-browser"));
    await enterLive(setup, "installed-skill-browser");
    await waitForReaderBody(setup, "Installed one");
    expect(setup.captureCharFrame()).toContain("one");
    expect(updates).toEqual([]);
    await enterLive(setup, "reader-action-skill-check-updates");
    await setup.waitFor(() => updates.length === 1);
    expect(updates).toEqual([
      {
        source: "team-main",
        paths: ["one"],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
    ]);
    expect(checks.every((source) => source === "team-main")).toBe(true);
    expect(updateSignal?.aborted).toBe(false);
    await enterLive(setup, "updates-stop");
    await setup.waitFor(
      () =>
        updateSignal?.aborted === true && !setup!.renderer.root.findDescendantById("updates-stop"),
    );
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("reader-scrollbox"));
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () => setup!.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("source-details-pane"));
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () => !!setup!.renderer.root.findDescendantById(`${sourceRow("two")}:check`),
    );
    expect(cell(setup, `${sourceRow("one")}:check`)).not.toContain("✓");
    expect(cell(setup, `${sourceRow("two")}:check`)).toContain("✓");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const selectedUpdate = choices.options.find(
      (option) => option.value.id === "source-updates.update-all",
    )?.value;
    expect(selectedUpdate).toMatchObject({ enabled: true });
    expect(selectedUpdate.destination).toContain("team-main");
    expect(selectedUpdate.destination).toContain("1 selected Skills");
    await parsedEscape(setup);
    expect(updates).toEqual([
      {
        source: "team-main",
        paths: ["one"],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
    ]);
    expect(cell(setup, `${sourceRow("two")}:check`)).toContain("✓");
  } finally {
    setup?.renderer.destroy();
    if (priorCacheKey === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    else process.env.SKTUI_UPDATE_SCHEDULE_DIR = priorCacheKey;
    await rm(cacheKey, { recursive: true, force: true });
  }
});
