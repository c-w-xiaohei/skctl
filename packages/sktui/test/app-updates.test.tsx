/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { WorkspaceView, UpdateObservation } from "@skctl/core";
import { SelectRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
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
  await openMainPage(setup, "updates");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
}
async function chooseAction(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index, `Expected legal action ${id}`).toBeGreaterThanOrEqual(0);
  expect(choices.options[index]!.value.enabled).toBe(true);
  choices.setSelectedIndex(index);
  await setup.renderOnce();
  await parsedEnter(setup);
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
test.each([100, 43])(
  "checked update entry includes hidden checked Skills without expanding their Source at %i columns",
  async (width) => {
    const base = updatesProjection();
    const projection = {
      ...base,
      installedSkills: [
        ...base.installedSkills,
        {
          ...base.installedSkills[0]!,
          address: { source: addresses.first.source, path: "unselected" },
          name: "unselected",
        },
      ],
    };
    const updates: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
            checkUpdate: async (_environment, { source }) => ({
              value: observation(
                source,
                source === addresses.first.source ? ["guide", "unselected"] : ["other"],
              ),
              diagnostics: [],
            }),
            updateSkills: async (_environment, request) => {
              updates.push(request);
              return { value: undefined, diagnostics: [] };
            },
          })}
          exit={() => {}}
        />
      ),
      { width, height: 24 },
    );
    try {
      await openAllInstalledSkills(setup);
      await focusLive(setup, "installed-skill-browser");
      await setup.mockInput.typeText(" ");
      await focusLive(setup, "skills-query");
      await setup.mockInput.typeText("no-matches");
      await setup.waitForFrame((frame) => frame.includes("No matching Skills"));
      await enterLive(setup, "workspace-batch-update-skills");
      await setup.waitForFrame(
        (frame) => frame.includes("1 selected Skills") && frame.includes("Updates available"),
      );
      await chooseAction(setup, "updates.update-source");
      await setup.waitFor(() => updates.length === 1);
      expect(updates).toEqual([
        {
          source: addresses.first.source,
          paths: ["guide"],
          exactRevision: revision,
          expectedBaseline: "baseline:test",
        },
      ]);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("App automatic checks stay read-only and updating the current Source preserves its exact reviewed target", async () => {
  let current = updatesProjection();
  const checks: string[] = [];
  const updates: unknown[] = [];
  let contentLoads = 0;
  const core = directSourceCore(current, {
    getWorkspace: async () => ({ value: current, diagnostics: [] }),
    getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
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
    loadInstalledSkill: async (_environment, { address }) => {
      contentLoads++;
      return {
        address,
        name: address.path,
        description: "",
        rawText: "Startup content",
        markdownText: "Startup content",
      };
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 80,
    height: 16,
  });
  try {
    await setup.waitFor(() => contentLoads === 1);
    const startupLoads = contentLoads;
    expect(startupLoads).toBe(1);
    await openWorkspaceUpdates(setup);
    await setup.waitFor(() =>
      [addresses.first.source, addresses.second.source].every((source) => {
        const status = setup.renderer.root.findDescendantById(
          `updates-browser-row-${source}:cell-status`,
        );
        return status instanceof TextRenderable && status.plainText === "Updates available";
      }),
    );
    expect(contentLoads).toBe(startupLoads);
    expect(checks).toEqual([addresses.first.source, addresses.second.source]);
    expect(updates).toEqual([]);
    await chooseAction(setup, "updates.update-source");
    await setup.waitFor(() => updates.length === 1);
    expect(updates).toEqual([
      {
        source: addresses.first.source,
        paths: [addresses.first.path],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
    ]);
    expect(contentLoads).toBe(startupLoads);
  } finally {
    setup.renderer.destroy();
  }
});
test("App checks survive semantic Back, Stop checks cancels only reads, and host teardown cancels a replacement", async () => {
  const projection = updatesProjection();
  const checks: string[] = [];
  let aborts = 0;
  let exits = 0;
  let destroyed = false;
  let holdChecks = false;
  let setup!: Awaited<ReturnType<typeof testRender>>;
  const core = directSourceCore(projection, {
    getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }, options) => {
      checks.push(source);
      if (!holdChecks)
        return {
          value: observation(source, source === addresses.first.source ? ["guide"] : ["other"]),
          diagnostics: [],
        };
      return new Promise<import("@skctl/core").OperationResult<UpdateObservation>>((_, reject) =>
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
    await openWorkspaceUpdates(setup);
    await setup.waitFor(() =>
      [addresses.first.source, addresses.second.source].every((source) => {
        const status = setup.renderer.root.findDescendantById(
          `updates-browser-row-${source}:cell-status`,
        );
        return status instanceof TextRenderable && status.plainText === "Updates available";
      }),
    );
    await openMainPage(setup, "sources");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await focusLive(setup, "source-browser");
    holdChecks = true;
    await chooseAction(setup, "check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    await setup.waitFor(() => checks.length === 3);
    expect(checks[2]).toBe(addresses.first.source);
    // Esc browses Back while the request remains active; only Stop aborts it.
    await parsedEscape(setup);
    expect(aborts).toBe(0);
    await openWorkspaceUpdates(setup);
    await chooseAction(setup, "checks.task.stop");
    await setup.waitFor(() => aborts === 1);
    // Ctrl+C must tear down a newly active request, not merely exit after a prior Stop.
    await chooseAction(setup, "updates.check");
    await setup.waitFor(() => checks.length === 4);
    setup.mockInput.pressKey("c", { ctrl: true });
    await setup.waitFor(() => exits === 1 && aborts === 2);
  } finally {
    if (!destroyed) setup.renderer.destroy();
  }
});
test("App Collection checks include Reference descendants while Reader review updates only its Skill", async () => {
  const projection = collectionScopeProjection();
  const checks: string[] = [];
  const updates: Parameters<typeof import("@skctl/core").updateSkills>[1][] = [];
  const reads: unknown[] = [];
  const core = directSourceCore(projection, {
    getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks.push(source);
      return {
        value: observation(source, source === addresses.first.source ? ["guide"] : ["other"]),
        diagnostics: [],
      };
    },
    updateSkills: async (_environment, request) => {
      updates.push(request);
      return { value: undefined, diagnostics: [] };
    },
    loadInstalledSkill: async (_environment, { address }) => {
      reads.push(address);
      return {
        address,
        name: address.path,
        description: "",
        rawText: "Installed guide",
        markdownText: "Installed guide",
      };
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 80,
    height: 24,
  });
  try {
    await openWorkspaceUpdates(setup);
    await setup.waitFor(() =>
      projection.effective.sources.every((source) => {
        const status = setup.renderer.root.findDescendantById(
          `updates-browser-row-${source.id}:cell-status`,
        );
        return (
          status instanceof TextRenderable &&
          !["Checking", "Not checked", "Waiting"].includes(status.plainText)
        );
      }),
    );
    const startup = checks.length;
    const startupReads = [...reads];
    await openMainPage(setup, "collections");
    const releaseKey = collectionFilterPathKey({ segments: [{ collection: "release" }] });
    const release = setup.renderer.root.findDescendantById(
      `collection-browser-row-${encodeURIComponent(releaseKey)}-name`,
    )!;
    expect(release).toBeDefined();
    await setup.mockMouse.click(release.screenX + 1, release.screenY);
    await enterWithFocusContext(setup, "collection-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    // Collection-wide commands belong to shared Actions, not a removed local menu.
    await chooseAction(setup, "collection-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    await setup.waitFor(() => checks.length === startup + 2);
    expect(checks.slice(startup)).toEqual([addresses.first.source, addresses.second.source]);
    expect(checks.slice(startup)).not.toContain("unrelated-source");
    expect(updates).toEqual([]);
    expect(reads).toEqual(startupReads);
    expect(setup.captureCharFrame()).toContain("Collection release");
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    expect(setup.captureCharFrame()).toContain("release");
    await openMainPage(setup, "skills");
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await waitForReaderBody(setup, "Installed guide");
    await enterWithFocusContext(setup, "reader-action-skill-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    expect(updates).toEqual([]);
    await enterWithFocusContext(setup, "updates-update-all");
    await setup.waitFor(() => updates.length === 1);
    expect(updates).toEqual([
      {
        source: addresses.first.source,
        paths: [addresses.first.path],
        exactRevision: revision,
        expectedBaseline: "baseline:test",
      },
    ]);
    expect(setup.captureCharFrame()).toContain(`${addresses.first.source}/${addresses.first.path}`);
  } finally {
    setup.renderer.destroy();
  }
});
