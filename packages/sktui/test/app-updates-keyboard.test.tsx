/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { WorkspaceView, UpdateObservation } from "@skctl/core";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
async function key(setup: Awaited<ReturnType<typeof testRender>>, value: string) {
  if (value === "ARROW_DOWN") setup.mockInput.pressArrow("down");
  else if (value === "ARROW_UP") setup.mockInput.pressArrow("up");
  else if (value === "ARROW_RIGHT") setup.mockInput.pressArrow("right");
  else if (value === "ENTER") setup.mockInput.pressEnter();
  else setup.mockInput.pressKey(value);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}
async function tab(setup: Awaited<ReturnType<typeof testRender>>, shift = false) {
  setup.mockInput.pressTab({ shift });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}
function diagnostic(setup: Awaited<ReturnType<typeof testRender>>, stage: string) {
  const ids = [
    "installed-skill-browser",
    "shell-section-tab-skills",
    "shell-section-tab-updates",
    "updates-browser",
    "source-updates-browser",
    "update-preview-pane",
    "process-status",
  ].map((id) => {
    const target = setup.renderer.root.findDescendantById(id);
    return { id, mounted: !!target && !target.isDestroyed && !!target.parent };
  });
  return `${stage}; focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}; ids=${JSON.stringify(ids)}\n${setup.captureCharFrame()}`;
}
test("App keyboard navigation reaches Updates commands and active Stop without forced focus", async () => {
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
    // Supply actual installed members for both Sources: Updates scope discovery
    // intentionally excludes declared Sources with no installed Skills.
    installedSkills: [...readerProjection().installedSkills, otherInstalledSkill],
    effective: {
      ...base.effective,
      sources: [base.effective.sources[0]!, otherSource],
    },
  };
  let aborts = 0;
  const mutations: unknown[] = [];
  const checks: string[] = [];
  const core = directSourceCore(projection, {
    getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
    checkUpdate: (_environment: import("@skctl/core").CoreOptions, { source }, options) => {
      checks.push(source);
      if (source === base.effective.sources[0]!.id) {
        const observation: UpdateObservation = {
          source,
          kind: "github",
          baseline: "baseline:test",
          exactRevision: "b".repeat(40),
          changed: [{ path: "guide", name: "guide", description: "Updated guide" }],
          added: [],
          removed: [],
          unchanged: [],
        };
        return Promise.resolve({ value: observation, diagnostics: [] });
      }
      return new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          aborts++;
          reject(new Error(`cancelled ${source}`));
        }),
      );
    },
    updateSkills: async (_environment, request) => {
      mutations.push(request);
      return { value: undefined, diagnostics: [] };
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  let stage = "boot";
  try {
    await setup.waitFor(
      () =>
        checks.length === 2 &&
        setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
    );
    // Start from App-owned focus; do not force focus onto a test-only target.
    stage = "Tab traversal to section navigation";
    for (
      let i = 0;
      i < 12 && setup.renderer.currentFocusedRenderable?.id !== "shell-section-tab-skills";
      i++
    )
      await tab(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-section-tab-skills");
    stage = "section navigation to Updates";
    for (let i = 0; i < 3; i++) await key(setup, "ARROW_RIGHT");
    await key(setup, "ENTER");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    expect(setup.captureCharFrame()).toContain("Updates");
    expect(checks).toEqual(["team-main", "other-source"]);
    const choose = async (id: string) => {
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      const index = choices.options.findIndex((option) => option.value.id === id);
      expect(index, diagnostic(setup, stage)).toBeGreaterThanOrEqual(0);
      expect(choices.options[index]!.value.enabled).toBe(true);
      const current = choices.getSelectedIndex();
      for (let row = 0; row < Math.abs(index - current); row++)
        await key(setup, index > current ? "ARROW_DOWN" : "ARROW_UP");
      await key(setup, "ENTER");
    };
    stage = "active checks Stop via shared keyboard Actions";
    await choose("checks.task.stop");
    await setup.waitFor(() => aborts === 1);
    stage = "manual recheck remains keyboard reachable after Stop";
    await choose("updates.check");
    await setup.waitFor(() => checks.length === 4);
    expect(checks).toEqual(["team-main", "other-source", "team-main", "other-source"]);
    await choose("checks.task.stop");
    await setup.waitFor(() => aborts === 2);
    expect(mutations).toEqual([]);
  } catch (error) {
    throw new Error(diagnostic(setup, stage), { cause: error });
  } finally {
    setup.renderer.destroy();
  }
});
