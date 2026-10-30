import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import {
  SkctlError,
  type WorkspaceView,
  type MembershipBatchImpact,
  type OperationResult,
} from "@skctl/core";
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
  file: "/workspace/skctl/skctl.jsonc",
  pointer: "/collections/team",
};
function membershipProjection(): WorkspaceView {
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
test("Collection discovery retry and Back preserve the target and checked draft", async () => {
  let attempts = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(membershipProjection(), {
          discoverSkills: async (_environment, { source }) => {
            if (++attempts <= 2)
              throw new SkctlError("SOURCE_NOT_FOUND", "Temporarily unavailable");
            return result({
              source,
              kind: "local",
              candidates:
                attempts < 5 ? [{ name: "new", path: "new", description: "New Skill" }] : [],
            });
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    await enterLive(setup, "shell-section-tab-collections");
    await enterLive(setup, "collection-action-add-membership");
    await enterLive(setup, "installed-skill-choice");
    await enterLive(setup, "installed-skill-acquire");
    await enterLive(setup, "acquire-source-choice");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-observation-retry"));
    await enterLive(setup, "source-observation-back");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-name-0"));
    expect(
      (setup.renderer.root.findDescendantById("installed-skill-name-0") as InputRenderable).value,
    ).toBe("guide");
    await enterLive(setup, "installed-skill-acquire");
    await enterLive(setup, "acquire-source-choice");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-observation-retry"));
    await enterLive(setup, "source-observation-retry");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-operation-selection"),
    );
    await focusLive(setup, "source-operation-selection");
    await setup.mockInput.typeText(" ");
    await focusLive(setup, "source-operation-search");
    await setup.mockInput.typeText("new");
    await enterLive(setup, "source-operation-back");
    await setup.waitForFrame((frame) => frame.includes("Add Skills to team"));
    expect(
      (setup.renderer.root.findDescendantById("installed-skill-name-0") as InputRenderable).value,
    ).toBe("guide");
    await enterLive(setup, "installed-skill-acquire");
    await enterLive(setup, "acquire-source-choice");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-operation-selection"),
    );
    expect(
      (setup.renderer.root.findDescendantById("source-operation-search") as InputRenderable).value,
    ).toBe("new");
    await setup.waitForFrame((frame) => frame.includes("1 selected"));
    expect(attempts).toBe(4);
    await enterLive(setup, "source-operation-back");
    await enterLive(setup, "installed-skill-acquire");
    await enterLive(setup, "acquire-source-choice");
    await setup.waitForFrame(
      (frame) => frame.includes("0 selected") && frame.includes("No matching Skills"),
    );
    expect(attempts).toBe(5);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([false, true])(
  "Collection discovery Cancel ends the task after %s pending cleanup",
  async (pending) => {
    const discovery =
      deferred<OperationResult<{ source: string; kind: "local"; candidates: [] }>>();
    let started = false;
    let aborted = false;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(membershipProjection(), {
            discoverSkills: async (_environment, _request, options) => {
              started = true;
              options?.signal?.addEventListener("abort", () => {
                aborted = true;
              });
              if (!pending) throw new SkctlError("SOURCE_NOT_FOUND", "Unavailable");
              return discovery.promise;
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 100, height: 24 },
    );
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("shell-section-tab-collections"),
      );
      await enterLive(setup, "shell-section-tab-collections");
      await enterLive(setup, "collection-action-add-membership");
      await enterLive(setup, "installed-skill-acquire");
      await enterLive(setup, "acquire-source-choice");
      await setup.waitFor(() => started);
      if (!pending)
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("source-observation-retry"),
        );
      await enterLive(setup, "source-observation-progress");
      if (pending) {
        expect(aborted).toBe(true);
        expect(!!setup.renderer.root.findDescendantById("source-observation-overlay")).toBe(true);
        discovery.resolve(result({ source: "team-main", kind: "local", candidates: [] }));
      }
      await setup.waitFor(
        () => !setup.renderer.root.findDescendantById("source-observation-overlay"),
      );
      expect(!!setup.renderer.root.findDescendantById("installed-skill-choice")).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  },
);
test("Collection addition keeps its draft and explains a blocked Core preview", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(membershipProjection(), {
          previewMembershipBatch: async (_environment, request) =>
            result({
              kind: "membership-batch",
              collection: request.collection,
              decision: { kind: "direct", owner: collectionOwner },
              additions: request.additions,
              removals: [],
              affected: [],
              blockers: [{ reason: "incomplete" }],
              effectful: false,
              allowed: false,
            }),
          editMembers: async () => {
            throw new Error("Blocked preview must not execute");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    await enterLive(setup, "shell-section-tab-collections");
    await enterLive(setup, "collection-action-add-membership");
    await enterLive(setup, "installed-skill-choice");
    await enterLive(setup, "installed-skill-choice-submit");
    await setup.waitForFrame((frame) => frame.includes("CONFIG_CONFLICT"));
    expect(
      (setup.renderer.root.findDescendantById("installed-skill-name-0") as InputRenderable).value,
    ).toBe("guide");
  } finally {
    setup.renderer.destroy();
  }
});

test("Source acquisition exposes a visible task Cancel at 43x13", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(membershipProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("shell-section-tab-collections"),
    );
    await enterLive(setup, "shell-section-tab-collections");
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-action-add-membership");
    await enterLive(setup, "installed-skill-acquire");
    await setup.waitForFrame((frame) => frame.includes("Cancel"));
    for (const id of ["acquire-source-add", "acquire-source-back", "acquire-source-cancel"]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY + control.height).toBeLessThanOrEqual(13);
    }
    await enterLive(setup, "acquire-source-cancel");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("acquire-source-choice"));
    expect(!!setup.renderer.root.findDescendantById("installed-skill-choice")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection acquisition inherits its owner; Back preserves selection and Cancel ends the task", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(membershipProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    await enterLive(setup, "shell-section-tab-collections");
    await enterLive(setup, "collection-action-add-membership");
    await enterLive(setup, "installed-skill-choice");
    await enterLive(setup, "installed-skill-acquire");
    await enterLive(setup, "acquire-source-add");
    expect(setup.renderer.root.findDescendantById("source-register-level")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("project");
    await focusLive(setup, "source-register-origin");
    await setup.mockInput.typeText("https://github.com/acme/skills");
    await focusLive(setup, "source-register-id");
    (setup.renderer.currentFocusedRenderable as InputRenderable).value = "custom";
    await enterLive(setup, "source-register-advanced");
    await focusLive(setup, "source-register-ref");
    (setup.renderer.currentFocusedRenderable as InputRenderable).value = "release";
    await enterLive(setup, "source-register-back");
    expect(
      (setup.renderer.root.findDescendantById("installed-skill-name-0") as InputRenderable).value,
    ).toBe("guide");
    await enterLive(setup, "installed-skill-acquire");
    await enterLive(setup, "acquire-source-add");
    expect(
      (setup.renderer.root.findDescendantById("source-register-origin") as InputRenderable).value,
    ).toBe("https://github.com/acme/skills");
    expect(
      (setup.renderer.root.findDescendantById("source-register-id") as InputRenderable).value,
    ).toBe("custom");
    expect(
      (setup.renderer.root.findDescendantById("source-register-ref") as InputRenderable).value,
    ).toBe("release");
    await focusLive(setup, "source-register-origin");
    (setup.renderer.currentFocusedRenderable as InputRenderable).value =
      "https://github.com/acme/other";
    await setup.flush();
    expect(
      (setup.renderer.root.findDescendantById("source-register-id") as InputRenderable).value,
    ).toBe("custom");
    await enterLive(setup, "source-register-choice");
    expect(setup.renderer.root.findDescendantById("installed-skill-choice")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("source-register-origin")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("Space batch Add preserves slash-containing Source IDs and publishes selected Skills once", async () => {
  const previews: unknown[] = [];
  const changes: unknown[] = [];
  let refreshes = 0;
  let loads = 0;
  const projection = membershipProjection();
  const base = directSourceCore(projection);
  const core = {
    ...base,
    getWorkspace: async () => {
      refreshes++;
      return result(projection);
    },
    loadInstalledSkill: async () => {
      loads++;
      return {
        address: { source: "team/main", path: "guide" },
        name: "guide",
        description: "Guide",
        rawText: "# Guide",
        markdownText: "# Guide",
      };
    },
    previewMembershipBatch: async (
      _environment: import("@skctl/core").CoreOptions,
      request: {
        readonly level: "global" | "project" | "local";
        readonly collection: string;
        readonly additions: readonly {
          readonly name: string;
          readonly address: {
            readonly source: string;
            readonly path: string;
          };
        }[];
        readonly removals: readonly {
          readonly name: string;
          readonly expectedAddress: {
            readonly source: string;
            readonly path: string;
          };
        }[];
      },
    ) => {
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
    editMembers: async (
      _environment: import("@skctl/core").CoreOptions,
      request: Parameters<typeof base.editMembers>[1],
    ) => {
      changes.push(request);
      return result({ level: "project" as const, file: "skctl.jsonc", changed: true });
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
    await enterLive(setup, "workspace-batch-add-to-collection");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await enterLive(setup, "collection-handoff-choice");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-name-0"));
    expect(setup.captureCharFrame()).toContain("guide");
    expect(setup.captureCharFrame()).toContain("review");
    const nameInput = setup.renderer.root.findDescendantById(
      "installed-skill-name-0",
    ) as InputRenderable;
    nameInput.focus();
    for (const character of "-entry") {
      await setup.mockInput.typeText(character);
      expect(setup.renderer.root.findDescendantById("installed-skill-name-0")).toBe(nameInput);
    }
    await enterLive(setup, "installed-skill-choice-submit");
    await setup.waitFor(() => previews.length === 1);
    expect(previews).toEqual([
      {
        level: "project",
        collection: "team",
        expectedOwner: {
          level: "project",
          file: "/workspace/skctl/skctl.jsonc",
          pointer: "/collections/team",
        },
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
    await setup.waitFor(() => changes.length === 1);
    expect(changes).toEqual([
      {
        level: "project",
        collection: "team",
        expectedOwner: {
          level: "project",
          file: "/workspace/skctl/skctl.jsonc",
          pointer: "/collections/team",
        },
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
    expect(setup.captureCharFrame()).toContain("2 selected");
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
    getWorkspace: async () => result(++refreshes === 1 ? repository : created),
    createCollection: async (
      _environment: import("@skctl/core").CoreOptions,
      request: Parameters<typeof base.createCollection>[1],
    ) => {
      changes.push(request);
      return result({ level: "project" as const, file: "skctl.jsonc", changed: true });
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
    await enterLive(setup, "collection-action-add-membership");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
    );
    await parsedEnter(setup);
    await enterLive(setup, "collection-create-submit");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-choice",
    );
    await enterLive(setup, "installed-skill-choice");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-name-0"));
    expect(changes).toEqual([{ level: "project", collection: "team" }]);
    await setup.waitForFrame((frame) => frame.includes("Add Skills to team"));
  } finally {
    setup.renderer.destroy();
  }
});
test("Workspace Collection create selects a level, blocks duplicate submit, and reselects after refresh", async () => {
  const writing = deferred<
    OperationResult<{
      readonly level: "global";
      readonly file: string;
      readonly changed: boolean;
    }>
  >();
  const changes: unknown[] = [];
  let refreshes = 0;
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const effective = projection.effective;
  const created: WorkspaceView = {
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
    getWorkspace: async () => {
      refreshes++;
      return result(created);
    },
    createCollection: (
      _environment: import("@skctl/core").CoreOptions,
      request: Parameters<typeof base.createCollection>[1],
    ) => {
      changes.push(request);
      return writing.promise;
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
    await enterLive(setup, "collection-action-new-collection");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
    );
    setup.mockInput.pressArrow("up");
    await parsedEnter(setup);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    await setup.mockInput.typeText("team");
    await focusLive(setup, "collection-create-description");
    await setup.mockInput.typeText("Team workflows");
    await enterLive(setup, "collection-create-submit");
    await parsedEnter(setup);
    expect(changes).toEqual([
      { level: "global", collection: "team", description: "Team workflows" },
    ]);
    expect(changes).toHaveLength(1);
    writing.resolve(result({ level: "global", file: "skctl.jsonc", changed: true }));
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-choice"));
    await setup.waitForFrame((frame) => frame.includes("Add Skills to team"));
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
