import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ManagementProjection, MembershipBatchImpact, OperationResult } from "@skill-cli/core";
import { App } from "../src/app";
import { CollectionsPage } from "../src/collections-page";
import { createCollectionsState } from "../src/collections/state";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter } from "./reader-test-controls";

const result = <T,>(value: T): OperationResult<T> => ({
  value,
  diagnostics: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function openAllInstalledSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
  );
  const current = setup.renderer.root.findDescendantById("skills-view-tab-current-exposure")!;
  current.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === current);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
}

const collectionOwner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/team",
};

function membershipProjection(): ManagementProjection {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: [{ id: "team", owner: collectionOwner }],
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      collections: ["team"],
      collectionsView: [
        {
          id: "team",
          declared: [collectionOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: [
      {
        address: { source: "team/main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team/main", health: "healthy" },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
      {
        address: { source: "team/main", path: "review" },
        name: "review",
        description: "Review",
        owner: { source: "team/main", health: "healthy" },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
    ],
  };
}

async function choosePaletteCommand(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
  );
  await enterLive(setup, `palette-${id}`);
}

test("Space batch Add preserves slash-containing Source IDs and publishes selected Skills once", async () => {
  const previews: unknown[] = [];
  const changes: unknown[] = [];
  let refreshes = 0;
  let loads = 0;
  const projection = membershipProjection();
  const base = directSourceCore(projection);
  const core = {
    ...base,
    workspace: {
      get: async () => {
        refreshes++;
        return result(projection);
      },
    },
    content: {
      ...base.content,
      loadInstalled: async () => {
        loads++;
        return result({
          address: { source: "team/main", path: "guide" },
          name: "guide",
          description: "Guide",
          rawText: "# Guide",
          markdownText: "# Guide",
        });
      },
    },
    configuration: {
      ...base.configuration,
      previewMembershipBatch: async (request: {
        readonly level: "global" | "project" | "local";
        readonly collection: string;
        readonly additions: readonly {
          readonly name: string;
          readonly address: { readonly source: string; readonly path: string };
        }[];
        readonly removals: readonly {
          readonly name: string;
          readonly expectedAddress: {
            readonly source: string;
            readonly path: string;
          };
        }[];
      }) => {
        previews.push(request);
        const impact: MembershipBatchImpact = {
          kind: "membership-batch",
          collection: request.collection,
          decision: { kind: "direct", owner: collectionOwner },
          additions: request.additions,
          removals: request.removals,
          affected: [],
          blockers: [],
          effectful: true,
          allowed: true,
        };
        return result(impact);
      },
      change: async (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return result({ level: "project" as const, changed: true });
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    const section = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    section.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
    await setup.renderOnce();
    await openAllInstalledSkills(setup);
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    browser.focus();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    await setup.renderOnce();
    const beforeFirstSpace = loads;
    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    expect(loads).toBe(beforeFirstSpace);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    const beforeSecondSpace = loads;
    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("2 selected");
    expect(loads).toBe(beforeSecondSpace);
    setup.mockInput.pressKey("P", { ctrl: true });
    await choosePaletteCommand(setup, "skill-add-to-collection");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await enterLive(setup, "collection-handoff-choice");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    expect(setup.captureCharFrame()).toContain("guide");
    expect(setup.captureCharFrame()).toContain("review");
    const nameInput = setup.renderer.root.findDescendantById(
      "membership-batch-name-0",
    ) as InputRenderable;
    for (const character of "-entry") {
      await setup.mockInput.typeText(character);
      expect(setup.renderer.root.findDescendantById("membership-batch-name-0")).toBe(nameInput);
    }
    await enterLive(setup, "membership-batch-review");
    await setup.waitFor(() => previews.length === 1);
    expect(previews).toEqual([
      {
        level: "project",
        collection: "team",
        additions: [
          {
            name: "guide-entry",
            address: { source: "team/main", path: "guide" },
          },
          { name: "review", address: { source: "team/main", path: "review" } },
        ],
        removals: [],
      },
    ]);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-review-choice",
    );
    await enterLive(setup, "collection-review-confirm");
    await parsedEnter(setup);
    await setup.waitFor(() => changes.length === 1);
    expect(changes).toEqual([
      {
        type: "collection.members.change",
        level: "project",
        collection: "team",
        additions: [
          {
            name: "guide-entry",
            address: { source: "team/main", path: "guide" },
          },
          { name: "review", address: { source: "team/main", path: "review" } },
        ],
        removals: [],
        reviewedAffected: [],
      },
    ]);
    await setup.waitFor(() => refreshes === 2);
    expect(previews).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(setup.captureCharFrame()).not.toContain("2 selected");
  } finally {
    setup.renderer.destroy();
  }
});

test("repository-derived Add Membership creates its fixed ID then opens an owned batch draft", async () => {
  const initial = membershipProjection();
  if (initial.effective.status !== "complete") throw new Error("expected complete fixture");
  const repository = {
    ...initial,
    configs: initial.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, collections: [] } }
        : config,
    ),
    effective: {
      ...initial.effective,
      collectionsView: [
        {
          ...initial.effective.collectionsView[0]!,
          declared: [],
          repository: {
            derived: true,
            producers: [{ source: "team-main", path: "guide" }],
          },
        },
      ],
    },
  };
  const created = {
    ...repository,
    effective: {
      ...repository.effective,
      collectionsView: [
        {
          ...repository.effective.collectionsView[0]!,
          declared: [collectionOwner],
          repository: {
            derived: true,
            producers: [{ source: "team-main", path: "guide" }],
          },
        },
      ],
    },
  };
  const changes: unknown[] = [];
  let refreshes = 0;
  const base = directSourceCore(repository);
  const core = {
    ...base,
    workspace: {
      get: async () => result(++refreshes === 1 ? repository : created),
    },
    configuration: {
      ...base.configuration,
      change: async (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return result({ level: "project" as const, changed: true });
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    const section = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    section.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    setup.mockInput.pressKey("p", { ctrl: true });
    await choosePaletteCommand(setup, "add-membership");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
    );
    setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    await enterLive(setup, "collection-create-submit");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-choice",
    );
    await enterLive(setup, "installed-skill-choice");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    expect(changes).toEqual([{ type: "collection.create", level: "project", collection: "team" }]);
    await setup.waitForFrame((frame) => frame.includes("Add to team"));
  } finally {
    setup.renderer.destroy();
  }
});

test("Workspace Collection create selects a level, blocks duplicate submit, and reselects after refresh", async () => {
  const writing =
    deferred<OperationResult<{ readonly level: "global"; readonly changed: boolean }>>();
  const changes: unknown[] = [];
  let refreshes = 0;
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const effective = projection.effective;
  const created: ManagementProjection = {
    ...projection,
    effective: {
      ...effective,
      collections: ["team"],
      collectionsView: [
        {
          id: "team",
          declared: [
            {
              level: "global",
              file: "/global.jsonc",
              pointer: "/collections/team",
            },
          ],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const base = directSourceCore(projection);
  const core = {
    ...base,
    workspace: {
      get: async () => {
        refreshes++;
        return result(created);
      },
    },
    configuration: {
      ...base.configuration,
      change: (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return writing.promise;
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    const section = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    section.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    await focusLive(setup, "collection-browser");
    setup.mockInput.pressKey("P", { ctrl: true });
    await choosePaletteCommand(setup, "new-collection");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
    );
    await parsedEnter(setup);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    await setup.mockInput.typeText("team");
    await enterLive(setup, "collection-create-submit");
    await parsedEnter(setup);
    expect(changes).toEqual([{ type: "collection.create", level: "global", collection: "team" }]);
    expect(changes).toHaveLength(1);
    writing.resolve(result({ level: "global", changed: true }));
    await setup.waitForFrame((frame) => frame.includes("team"));
    expect(refreshes).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection detail has no generic Actions or duplicate Back command", async () => {
  const projection = membershipProjection();
  const collections = createCollectionsState();
  collections.select("team");
  const setup = await testRender(
    () => (
      <CollectionsPage
        collections={collections}
        mode="medium"
        surface="detail"
        projection={() => projection}
        onSelect={() => {}}
        onQuery={() => {}}
        onFilter={() => {}}
        onClear={() => {}}
        onClearAll={() => {}}
        onFilterOpen={() => {}}
        onFilterDimension={() => {}}
        onFilterSearch={() => {}}
        onFilterClose={() => {}}
        onTab={() => {}}
        onInspectorFocus={() => {}}
        onDetail={() => {}}
        onRelationship={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    expect(setup.captureCharFrame()).not.toContain("Actions");
    expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
