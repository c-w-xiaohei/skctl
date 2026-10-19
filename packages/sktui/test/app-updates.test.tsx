/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { WorkspaceView, UpdateObservation } from "@skctl/core";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";
const revision = "a".repeat(40);
const addresses = {
  first: { source: "team-main", path: "guide" },
  second: { source: "other-source", path: "other" },
} as const;
const observation = (source: string, changed: readonly string[]): UpdateObservation => ({
  source,
  kind: "github",
  baseline: "baseline:test",
  exactRevision: revision,
  changed: changed.map((path) => ({ path, name: path, description: `${path} description` })),
  added: [],
  removed: [],
  unchanged: [],
});
function updatesProjection(): WorkspaceView {
  const base = workspaceProjection({ includeContribution: false });
  const secondSource = { ...base.effective.sources[0]!, id: addresses.second.source };
  return {
    ...base,
    effective: { ...base.effective, sources: [base.effective.sources[0]!, secondSource] },
    installedSkills: [
      {
        address: addresses.first,
        name: "guide",
        description: "First installed Skill",
        owner: { source: addresses.first.source, health: "healthy" },
        source: base.effective.sources[0],
        collections: [],
        selectors: [],
        selectorViews: { status: "complete", values: [] },
        aliases: [],
        problems: [],
      },
      {
        address: addresses.second,
        name: "other",
        description: "Second installed Skill",
        owner: { source: addresses.second.source, health: "healthy" },
        source: secondSource,
        collections: [],
        selectors: [],
        selectorViews: { status: "complete", values: [] },
        aliases: [],
        problems: [],
      },
    ],
  };
}
function collectionScopeProjection(): WorkspaceView {
  const projection = updatesProjection();
  if (projection.effective.status !== "complete")
    throw new Error("Collection scope fixture requires a complete effective projection");
  const effective = projection.effective;
  const owner = {
    level: "project" as const,
    file: "/workspace/skctl/skctl.jsonc",
    pointer: "/collections/release",
  };
  return {
    ...projection,
    installedSkills: [
      ...projection.installedSkills,
      {
        address: { source: "unrelated-source", path: "unrelated" },
        name: "unrelated",
        description: "Not in the Collection scope",
        owner: { source: "unrelated-source", health: "healthy" },
        source: { ...projection.effective.sources[0]!, id: "unrelated-source" },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete", values: [] },
        aliases: [],
        problems: [],
      },
    ],
    effective: {
      ...effective,
      sources: [...effective.sources, { ...effective.sources[0]!, id: "unrelated-source" }],
      collections: ["release", "referenced"],
      collectionsView: [
        {
          id: "release",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [{ name: "guide", address: addresses.first, paths: [] }],
          references: [
            {
              name: "referenced",
              collection: "referenced",
              description: "Referenced Updates",
              owner,
            },
          ],
          links: [],
        },
        {
          id: "referenced",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [{ name: "other", address: addresses.second, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
  };
}
async function openWorkspaceUpdates(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-updates"));
  await enterLive(setup, "shell-section-tab-updates");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
}
async function enterWithFocusContext(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  try {
    await enterLive(setup, id);
  } catch (error) {
    const target = setup.renderer.root.findDescendantById(id);
    const focused = setup.renderer.currentFocusedRenderable;
    const bounds = target
      ? `bounds=${target.screenX},${target.screenY},${target.width},${target.height}`
      : "bounds=missing";
    throw new Error(
      `Could not focus ${id}; focused=${focused?.id ?? "none"}; ${bounds}; frame=${JSON.stringify(setup.captureCharFrame())}`,
      { cause: error },
    );
  }
}
test("RED App Updates opens manually without automatic checks, then submits only the visible current group", async () => {
  let current = updatesProjection();
  const checks: string[] = [];
  const updates: unknown[] = [];
  let contentLoads = 0;
  const core = directSourceCore(current, {
    getWorkspace: async () => ({ value: current, diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      return {
        value: observation(source, source === addresses.first.source ? ["guide"] : ["other"]),
        diagnostics: [],
      };
    },
    updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
      updates.push(request);
      current = {
        ...current,
        installedSkills: current.installedSkills.map((skill) =>
          skill.address.source === request.source && request.paths.includes(skill.address.path)
            ? {
                ...skill,
                owner: { ...skill.owner, relevantRemoteRevision: request.exactRevision },
              }
            : skill,
        ),
      };
      return { value: undefined, diagnostics: [] };
    },
    loadInstalledSkill: async () => {
      contentLoads++;
      throw new Error("Updates must not load installed content");
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 80,
    height: 16,
  });
  try {
    await openWorkspaceUpdates(setup);
    expect(checks).toEqual([]);
    expect(contentLoads).toBe(0);
    await enterLive(setup, "updates-check");
    await setup.waitFor(() => checks.length === 2);
    expect(checks).toEqual([addresses.first.source, addresses.second.source]);
    await focusLive(setup, "updates-submit");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => updates.length === 1);
    expect(updates).toEqual([
      { source: addresses.first.source, paths: [addresses.first.path], exactRevision: revision },
    ]);
    expect(contentLoads).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
test("RED App Updates source, Collection, and Skill entries retain structural scope and Esc never aborts active work", async () => {
  const projection = updatesProjection();
  const checks: string[] = [];
  let aborts = 0;
  let exits = 0;
  let destroyed = false;
  let setup!: Awaited<ReturnType<typeof testRender>>;
  const core = directSourceCore(projection, {
    checkUpdate: (_environment: import("@skctl/core").CoreOptions, { source }, options) => {
      checks.push(source);
      return new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => {
          aborts++;
          reject(new Error("cancelled"));
        }),
      );
    },
    loadInstalledSkill: async () => {
      throw new Error("Updates entry must not load content");
    },
  });
  setup = await testRender(
    () => (
      <App
        core={core}
        exit={() => {
          exits++;
          // The test renderer does not unmount merely because App requests exit.
          // Destroying it models the real host teardown that owns effects.teardown().
          setup.renderer.destroy();
          destroyed = true;
        }}
      />
    ),
    { width: 80, height: 16 },
  );
  try {
    // Future App entry wiring uses the existing visible Source action, rather than a route fake.
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("shell-section-tab-sources"),
    );
    await enterLive(setup, "shell-section-tab-sources");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await enterLive(setup, "source-browser");
    await enterLive(setup, "workspace-action-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    expect(checks).toEqual([addresses.first.source]);
    // Esc browses Back while the request remains active; only Stop aborts it.
    await parsedEscape(setup);
    expect(aborts).toBe(0);
    await openWorkspaceUpdates(setup);
    await enterLive(setup, "updates-stop");
    await setup.waitFor(() => aborts === 1);
    // Ctrl+C must tear down a newly active request, not merely exit after a prior Stop.
    await enterLive(setup, "updates-check");
    await setup.waitFor(() => checks.length === 2);
    setup.mockInput.pressKey("c", { ctrl: true });
    await setup.waitFor(() => exits === 1 && aborts === 2);
  } finally {
    if (!destroyed) setup.renderer.destroy();
  }
});
test("RED App Updates Collection and Skill actions enter their exact visible structural scopes", async () => {
  const projection = collectionScopeProjection();
  const checks: string[] = [];
  const core = directSourceCore(projection, {
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      return {
        value: observation(source, source === addresses.first.source ? ["guide"] : ["other"]),
        diagnostics: [],
      };
    },
    loadInstalledSkill: async () => {
      throw new Error("Scope entry must not read SKILL.md");
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 80,
    height: 16,
  });
  try {
    // The Collection update action stays in the parent's existing progressive
    // Actions disclosure, not in an App-owned wrapper row or synthetic route.
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("shell-section-tab-collections"),
    );
    await enterWithFocusContext(setup, "shell-section-tab-collections");
    const collectionBrowser = await focusLive(setup, "collection-browser");
    expect(collectionBrowser).toBeInstanceOf(SelectRenderable);
    if (!(collectionBrowser instanceof SelectRenderable))
      throw new Error("Expected the native Collection SelectRenderable");
    expect(collectionBrowser.options.map((option) => option.value)).toContain("release");
    await setup.mockMouse.click(collectionBrowser.screenX + 1, collectionBrowser.screenY);
    await setup.waitFor(() => collectionBrowser.getSelectedOption()?.value === "release");
    await enterWithFocusContext(setup, "collection-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    await enterWithFocusContext(setup, "collection-actions-toggle");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
    );
    await enterWithFocusContext(setup, "collection-action-collection-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    await setup.waitFor(() => checks.length === 2);
    expect(checks).toEqual([addresses.first.source, addresses.second.source]);
    expect(checks).not.toContain("unrelated-source");
    expect(setup.captureCharFrame()).toContain("Collection release");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    expect(setup.captureCharFrame()).toContain("release");
    await enterWithFocusContext(setup, "shell-section-tab-skills");
    await setup.waitFor(() => setup.captureCharFrame().includes("[ Skills ]"));
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await enterWithFocusContext(setup, "installed-skill-browser");
    await enterWithFocusContext(setup, "skill-detail-actions-toggle");
    await enterWithFocusContext(setup, "workspace-action-skill-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    await setup.waitFor(() => checks.length === 3);
    expect(checks).toEqual([
      addresses.first.source,
      addresses.second.source,
      addresses.first.source,
    ]);
    expect(setup.captureCharFrame()).toContain(`${addresses.first.source}/${addresses.first.path}`);
  } finally {
    setup.renderer.destroy();
  }
});
