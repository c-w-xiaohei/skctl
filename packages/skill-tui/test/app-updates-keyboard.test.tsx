/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { WorkspaceView, UpdateObservation } from "@skill-cli/core";
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
    "skill-inspector-open-reader",
    "top-navigation-tab-workspace",
    "shell-section-navigation",
    "updates-browser",
    "updates-details",
    "updates-check",
    "updates-stop",
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
  const checks: string[] = [];
  const core = directSourceCore(projection, {
    installed: {
      checkUpdate: ({ source }, options) => {
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
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  let stage = "boot";
  try {
    await setup.waitFor(() => {
      const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
      const focused = setup.renderer.currentFocusedRenderable;
      return (
        !!browser &&
        !browser.isDestroyed &&
        !!browser.parent &&
        !!focused &&
        !focused.isDestroyed &&
        !!focused.parent
      );
    });

    // Startup focus is App-owned and may change as projection hydrates. Follow
    // real Tab stops, bounded by the existing physical panel cycle.
    stage = "Tab traversal to section navigation";
    for (
      let step = 0;
      step < 6 && setup.renderer.currentFocusedRenderable?.id !== "shell-section-navigation";
      step++
    )
      await tab(setup);
    expect(setup.renderer.currentFocusedRenderable?.id, diagnostic(setup, stage)).toBe(
      "shell-section-navigation",
    );

    // The normal section-navigation key handler moves from Skills to Updates.
    stage = "section navigation to Updates";
    for (let i = 0; i < 3; i++) await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    expect(setup.captureCharFrame()).toContain("Updates");

    stage = "Updates browser boundary reaches Check before any manual check";
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
    await key(setup, "ARROW_RIGHT"); // expand the current Source row
    const browser = setup.renderer.root.findDescendantById("updates-browser");
    if (!(browser instanceof SelectRenderable))
      throw new Error("Updates browser is not a native Select");
    for (
      let step = 0;
      step <= browser.options.length &&
      setup.renderer.currentFocusedRenderable?.id !== "updates-check";
      step++
    )
      await key(setup, "ARROW_DOWN");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-check");
    expect(checks).toEqual([]);
    await key(setup, "ENTER");
    stage = "pending update Stop reachability";
    await setup.waitFor(
      () => checks.length === 2 && !!setup.renderer.root.findDescendantById("updates-stop"),
    );
    expect(checks).toEqual(["team-main", "other-source"]);
    await setup.waitFor(() => setup.captureCharFrame().includes("1 changed"));

    // The initiating Check became disabled. Its leaf-owned handoff keeps the
    // physical keyboard owner on the newly mounted active Stop command.
    stage = "active Stop focus handoff";
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-stop");

    const check = setup.renderer.root.findDescendantById("updates-check");
    expect(check?.focusable).toBe(false);
    expect(setup.renderer.root.findDescendantById("updates-stop")?.focusable).toBe(true);
    await tab(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("updates-stop");
    await tab(setup, true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-stop");
    await key(setup, "ENTER");
    await setup.waitFor(() => aborts === 1);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");

    // After Stop restores the browser, navigate from the pending Source back
    // to the completed group's changed Skill and enter its result details.
    stage = "checked result details after Stop";
    await key(setup, "ARROW_UP");
    await key(setup, "ARROW_UP");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ARROW_RIGHT");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-details");
  } catch (error) {
    throw new Error(diagnostic(setup, stage), { cause: error });
  } finally {
    setup.renderer.destroy();
  }
});
