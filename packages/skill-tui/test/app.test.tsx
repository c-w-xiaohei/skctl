import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import {
  SkillCliError,
  type CollectionView,
  type ManagementProjection,
  type MembershipBatchImpact,
} from "@skill-cli/core";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function remoteConfigProjection(): ManagementProjection {
  const base = workspaceProjection();
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              configSources: [
                {
                  id: "team-remote",
                  owner: {
                    level: "project",
                    file: "/workspace/skill-cli/skill-cli.jsonc",
                    pointer: "/configSources/team-remote",
                  },
                  binding: {
                    kind: "github",
                    origin: "https://github.com/acme/config",
                    root: "",
                    ref: "main",
                  },
                  adoption: { status: "not-adopted" },
                  contributed: { sources: [], collections: [] },
                },
              ],
            },
          }
        : config,
    ),
  };
}

const configObservation = (exactRevision: string) => ({
  value: {
    id: "team-remote",
    kind: "github" as const,
    exactRevision,
    contributions: { sources: [], collections: [] },
  },
  diagnostics: [],
});

const configImpact = (exactRevision: string) => ({
  value: {
    kind: "config-source-adopt" as const,
    id: "team-remote",
    owner: {
      level: "project" as const,
      file: "/workspace/skill-cli/skill-cli.jsonc",
      pointer: "/configSources/team-remote",
    },
    binding: {
      kind: "github" as const,
      origin: "https://github.com/acme/config",
      root: "",
      ref: "main",
    },
    exactRevision,
    declarationRetained: true,
    contributions: { sources: [], collections: [] },
    delta: {
      addedSources: [],
      changedSources: [],
      removedSources: [],
      addedCollections: [],
      changedCollections: [],
      removedCollections: [],
    },
    affectedInstalled: [],
    disappearingSelectors: [],
    blockers: [],
    allowed: true,
  },
  diagnostics: [],
});

import {
  parsedEnter as awaitParsedEnter,
  parsedEscape as awaitParsedEscape,
} from "./reader-test-controls";

async function readySourceCommand(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: "source-command-config-source" | "source-command-skills",
  label: string,
) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
  await setup.waitForFrame((frame) => frame.includes(label));
  await setup.renderOnce();
  await setup.waitFor(() => {
    const command = setup.renderer.root.findDescendantById(id);
    return !!command && command.height > 0 && command.screenY > 0;
  });
  for (
    let attempt = 0;
    attempt < 2 && setup.renderer.currentFocusedRenderable?.id !== id;
    attempt++
  ) {
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
  }
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  await setup.waitForFrame((frame) => frame.includes(`>${label}`));
  const command = setup.renderer.root.findDescendantById(id);
  if (!command || command.height <= 0 || command.screenY <= 0)
    throw new Error(`Source command ${id} was not laid out`);
  return command;
}

async function readySourceBrowser(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
  await setup.renderOnce();
  await setup.waitFor(() => {
    const browser = setup.renderer.root.findDescendantById("source-browser");
    return !!browser && browser.height > 0 && browser.screenY > 0;
  });
  const browser = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
  return browser;
}

async function focusLive(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
  const control = setup.renderer.root.findDescendantById(id)!;
  control.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
}

async function activateControl(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  await focusLive(setup, id);
  await awaitParsedEnter(setup);
}

async function populated(
  setup: Awaited<ReturnType<typeof testRender>>,
  scope: "collections" | "sources" | "all-installed-skills",
) {
  await setup.flush();
  await focusLive(setup, "shell-section-tab-skills");
  const target =
    scope === "collections"
      ? "shell-section-tab-collections"
      : scope === "sources"
        ? "shell-section-tab-sources"
        : "skills-view-tab-all-installed-skills";
  while (setup.renderer.currentFocusedRenderable?.id !== target) {
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
  }
  const browser =
    scope === "collections"
      ? "collection-browser"
      : scope === "sources"
        ? "source-browser"
        : "installed-skill-browser";
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(browser));
  await focusLive(setup, browser);
}

async function activatePaletteCommand(
  setup: Awaited<ReturnType<typeof testRender>>,
  recordId: string,
) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
  );
  await setup.renderOnce();
  await focusLive(setup, `palette-${recordId}`);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(`palette-${recordId}`);
  await awaitParsedEnter(setup);
}

async function openSourceCommand(
  setup: Awaited<ReturnType<typeof testRender>>,
  command:
    | "add-skills"
    | "check-updates"
    | "view-installed-skills"
    | "open-config"
    | "open-config-source"
    | "remove-source",
) {
  await focusLive(setup, "source-browser");
  await activatePaletteCommand(setup, command);
}

async function focusCollection(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup, "collections");
  const browser = setup.renderer.root.findDescendantById("collection-browser") as SelectRenderable;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
  await setup.waitFor(
    () =>
      (
        setup.renderer.root.findDescendantById("collection-browser") as SelectRenderable
      ).getSelectedOption()?.value === "team",
  );
}

async function openProjectConfigSourceActions(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
  workspace.focus();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
  );
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-project",
  );
  await setup.waitForFrame((frame) => frame.includes("Project Config / Sources"));
  const sources = setup.renderer.root.findDescendantById("shell-section-tab-sources")!;
  sources.focus();
  setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Project Config / Config Sources"));
  const browser = setup.renderer.root.findDescendantById("config-config-source-browser")!;
  browser.focus();
  setup.mockInput.pressArrow("down");
  await setup.renderOnce();
  setup.mockInput.pressArrow("up");
  await setup.renderOnce();
  await setup.waitForFrame((frame) => frame.includes("Selected > team-remote"));
  await focusLive(setup, "config-config-source-browser");
  await awaitParsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
  await focusLive(setup, "config-command-config-observe");
}

function repairProjection() {
  return {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "review" },
        name: "review",
        description: "Repair target",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
}

const collectionOwner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/team",
};

function collectionProjection(members: CollectionView["members"] = []) {
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
          members,
          references: [],
          links: [],
        },
      ],
    },
  };
}

async function openCollectionAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  action:
    | "new-collection"
    | "add-membership"
    | "import-collection"
    | "add-reference"
    | "add-link"
    | "remove-collection",
) {
  await focusCollection(setup);
  await activatePaletteCommand(setup, action);
}

async function chooseCollectionAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  action:
    | "new-collection"
    | "add-membership"
    | "import-collection"
    | "add-reference"
    | "add-link"
    | "remove-collection",
) {
  await activatePaletteCommand(setup, action);
}

async function openCollectionDetail(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup, "collections");
  const browser = setup.renderer.root.findDescendantById("collection-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
  await awaitParsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
}

test("RENDER stale Import preview completion cannot replace a newer same-kind Collection draft", async () => {
  const previewA = deferred<{
    readonly value: {
      readonly kind: "collection-import";
      readonly source: string;
      readonly destination: string;
      readonly owner: typeof collectionOwner;
      readonly additions: [];
      readonly skipped: [];
      readonly conflicts: [];
      readonly allowed: true;
    };
    readonly diagnostics: [];
  }>();
  const requests: unknown[] = [];
  let consumedA = 0;
  const base = directSourceCore(collectionProjection());
  const setup = await testRender(
    () => (
      <App
        core={{
          ...base,
          configuration: {
            ...base.configuration,
            previewImport: async (request) => {
              requests.push(request);
              return previewA.promise.then((value) => {
                consumedA++;
                return value;
              });
            },
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openCollectionAction(setup, "import-collection");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-import-from",
    );
    await setup.mockInput.typeText("import-a");
    await setup.renderOnce();
    await activateControl(setup, "collection-import-review");
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([{ level: "project", from: "import-a", into: "team" }]);
    await awaitParsedEscape(setup);
    await chooseCollectionAction(setup, "import-collection");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-import-from",
    );
    await setup.mockInput.typeText("import-b");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-import-from");
    expect(setup.captureCharFrame()).toContain("import-b");
    previewA.resolve({
      value: {
        kind: "collection-import",
        source: "import-a",
        destination: "team",
        owner: collectionOwner,
        additions: [],
        skipped: [],
        conflicts: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(requests).toHaveLength(1);
    expect(consumedA).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-import-from");
    expect(setup.captureCharFrame()).toContain("import-b");
    expect(setup.captureCharFrame()).not.toContain("From: import-a");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stale Membership add preview completion cannot replace a newer same-kind Membership draft", async () => {
  const previewA = deferred<{
    readonly value: MembershipBatchImpact;
    readonly diagnostics: [];
  }>();
  const previewB = deferred<{
    readonly value: MembershipBatchImpact;
    readonly diagnostics: [];
  }>();
  const requests: unknown[] = [];
  let consumedA = 0;
  const projection = {
    ...collectionProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const base = directSourceCore(projection);
  const setup = await testRender(
    () => (
      <App
        core={{
          ...base,
          configuration: {
            ...base.configuration,
            previewMembershipBatch: async (request) => {
              requests.push(request);
              return requests.length === 1
                ? previewA.promise.then((value) => {
                    consumedA++;
                    return value;
                  })
                : previewB.promise;
            },
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  const openDraft = async (name: string, initial = false) => {
    if (initial) await openCollectionAction(setup, "add-membership");
    else await chooseCollectionAction(setup, "add-membership");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-choice",
    );
    await awaitParsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    await setup.mockInput.typeText(name);
    await activateControl(setup, "membership-batch-review");
  };
  try {
    await openDraft("-a", true);
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([
      {
        level: "project",
        collection: "team",
        additions: [{ name: "guide-a", address: { source: "team-main", path: "guide" } }],
        removals: [],
      },
    ]);
    await awaitParsedEscape(setup);
    await openDraft("-b");
    await setup.waitFor(() => requests.length === 2);
    expect(requests[1]).toEqual({
      level: "project",
      collection: "team",
      additions: [{ name: "guide-b", address: { source: "team-main", path: "guide" } }],
      removals: [],
    });
    previewA.resolve({
      value: {
        kind: "membership-batch",
        collection: "team",
        decision: { kind: "direct", owner: collectionOwner },
        additions: [{ name: "guide-a", address: { source: "team-main", path: "guide" } }],
        removals: [],
        affected: [],
        blockers: [],
        effectful: true,
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(consumedA).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("membership-batch-review");
    expect(setup.captureCharFrame()).toContain("guide-b");
    expect(setup.captureCharFrame()).not.toContain("Add to Collection");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER cancelled Membership draft ignores a late preview without changing memberships", async () => {
  const preview = deferred<{
    readonly value: MembershipBatchImpact;
    readonly diagnostics: [];
  }>();
  const changes: unknown[] = [];
  const projection = {
    ...collectionProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const base = directSourceCore(projection);
  const setup = await testRender(
    () => (
      <App
        core={{
          ...base,
          configuration: {
            ...base.configuration,
            previewMembershipBatch: async () => preview.promise,
            change: async (change) => {
              changes.push(change);
              return {
                value: { level: "project" as const, changed: true },
                diagnostics: [],
              };
            },
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openCollectionAction(setup, "add-membership");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-choice",
    );
    setup.mockInput.pressArrow("down");
    await awaitParsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    await awaitParsedEnter(setup);
    await awaitParsedEscape(setup);
    preview.resolve({
      value: {
        kind: "membership-batch",
        collection: "team",
        decision: { kind: "direct", owner: collectionOwner },
        additions: [{ name: "guide", address: { source: "team-main", path: "guide" } }],
        removals: [],
        affected: [],
        blockers: [],
        effectful: true,
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(changes).toEqual([]);
    expect(setup.renderer.root.findDescendantById("membership-batch-name-0")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("collection-review-choice")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stale Membership removal preview completion cannot replace a newer same-kind removal", async () => {
  const previewA = deferred<{
    readonly value: MembershipBatchImpact;
    readonly diagnostics: [];
  }>();
  const previewB = deferred<{
    readonly value: MembershipBatchImpact;
    readonly diagnostics: [];
  }>();
  const requests: unknown[] = [];
  let consumedA = 0;
  let consumedB = 0;
  const base = directSourceCore(
    collectionProjection([
      {
        name: "guide",
        address: { source: "team-main", path: "guide" },
        paths: [
          {
            kind: "direct",
            collection: "team",
            entryName: "guide",
            owner: collectionOwner,
          },
        ],
      },
    ]),
  );
  const setup = await testRender(
    () => (
      <App
        core={{
          ...base,
          configuration: {
            ...base.configuration,
            previewMembershipBatch: async (request) => {
              requests.push(request);
              return requests.length === 1
                ? previewA.promise.then((value) => {
                    consumedA++;
                    return value;
                  })
                : previewB.promise.then((value) => {
                    consumedB++;
                    return value;
                  });
            },
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  const beginRemoval = async () => {
    if (!setup.renderer.root.findDescendantById("membership.remove")) {
      await activateControl(setup, "collection-relationships");
    }
    await activateControl(setup, "membership.remove");
  };
  try {
    await openCollectionDetail(setup);
    await beginRemoval();
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([
      {
        level: "project",
        collection: "team",
        expectedOwner: collectionOwner,
        additions: [],
        removals: [
          {
            name: "guide",
            expectedAddress: { source: "team-main", path: "guide" },
          },
        ],
      },
    ]);
    await awaitParsedEscape(setup);
    await beginRemoval();
    await setup.waitFor(() => requests.length === 2);
    previewA.resolve({
      value: {
        kind: "membership-batch",
        collection: "team",
        decision: { kind: "direct", owner: collectionOwner },
        additions: [],
        removals: [
          {
            name: "guide",
            expectedAddress: { source: "team-main", path: "stale-a" },
          },
        ],
        affected: [],
        blockers: [],
        effectful: true,
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.waitFor(() => consumedA === 1);
    expect(consumedA).toBe(1);
    expect(consumedB).toBe(0);
    expect(setup.captureCharFrame()).toContain("team  1 Membership");
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("collection-review-choice");
    previewB.resolve({
      value: {
        kind: "membership-batch",
        collection: "team",
        decision: { kind: "direct", owner: collectionOwner },
        additions: [],
        removals: [
          {
            name: "guide",
            expectedAddress: { source: "team-main", path: "guide" },
          },
        ],
        affected: [
          {
            selector: "current-b:guide",
            address: { source: "team-main", path: "guide" },
            paths: [],
          },
        ],
        blockers: [],
        effectful: true,
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.waitForFrame((frame) => frame.includes("Affected: current-b:guide"));
    const membershipFrame = setup.captureCharFrame();
    expect(consumedB).toBe(1);
    expect(membershipFrame).toContain("Remove from Collection");
    expect(membershipFrame).toContain("Collection: team");
    expect(membershipFrame).toContain("Remove: guide team-main/guide");
    expect(membershipFrame).toContain("Affected: current-b:guide");
    expect(membershipFrame).not.toContain("stale-a");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-review-choice");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stale Collection removal preview completion cannot replace a newer same-kind removal", async () => {
  const previewA = deferred<{
    readonly value: {
      readonly kind: "collection-removal";
      readonly owner: typeof collectionOwner;
      readonly decision: {
        readonly kind: "direct";
        readonly owner: typeof collectionOwner;
      };
      readonly repository: { readonly derived: false; readonly producers: [] };
      readonly disappearingSelectors: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly retainedSelectors: [];
      readonly blockers: [];
      readonly allowed: true;
    };
    readonly diagnostics: [];
  }>();
  const previewB = deferred<{
    readonly value: {
      readonly kind: "collection-removal";
      readonly owner: typeof collectionOwner;
      readonly decision: {
        readonly kind: "direct";
        readonly owner: typeof collectionOwner;
      };
      readonly repository: { readonly derived: false; readonly producers: [] };
      readonly disappearingSelectors: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly retainedSelectors: [];
      readonly blockers: [];
      readonly allowed: true;
    };
    readonly diagnostics: [];
  }>();
  const requests: unknown[] = [];
  let consumedA = 0;
  let consumedB = 0;
  const base = directSourceCore(collectionProjection());
  const setup = await testRender(
    () => (
      <App
        core={{
          ...base,
          configuration: {
            ...base.configuration,
            previewCollectionRemoval: async (request) => {
              requests.push(request);
              return requests.length === 1
                ? previewA.promise.then((value) => {
                    consumedA++;
                    return value;
                  })
                : previewB.promise.then((value) => {
                    consumedB++;
                    return value;
                  });
            },
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openCollectionAction(setup, "remove-collection");
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([{ level: "project", collection: "team" }]);
    await awaitParsedEscape(setup);
    await chooseCollectionAction(setup, "remove-collection");
    await setup.waitFor(() => requests.length === 2);
    previewA.resolve({
      value: {
        kind: "collection-removal",
        owner: collectionOwner,
        decision: { kind: "direct", owner: collectionOwner },
        repository: { derived: false, producers: [] },
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(consumedA).toBe(1);
    expect(consumedB).toBe(0);
    expect(setup.captureCharFrame()).toContain("Collections 1/1");
    expect(setup.captureCharFrame()).toContain("team");
    expect(setup.captureCharFrame()).not.toContain("Remove Collection");
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("collection-review-choice");
    previewB.resolve({
      value: {
        kind: "collection-removal",
        owner: collectionOwner,
        decision: { kind: "direct", owner: collectionOwner },
        repository: { derived: false, producers: [] },
        disappearingSelectors: [
          {
            selector: "team-b:guide-b",
            address: { source: "team-b-main", path: "guide-b" },
            paths: [],
          },
        ],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.waitForFrame((frame) => frame.includes("Remove Collection"));
    const collectionFrame = setup.captureCharFrame();
    expect(consumedB).toBe(1);
    expect(collectionFrame).toContain("Remove Collection");
    expect(collectionFrame).toContain(
      "Owner: project: /workspace/skill-cli/skill-cli.jsonc /collections/team",
    );
    expect(collectionFrame).toContain("Disappears: team-b:guide-b");
    expect(collectionFrame).not.toContain("Collections 0/1");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-review-choice");
  } finally {
    setup.renderer.destroy();
  }
});

const blockedSourceRemoval = () => ({
  kind: "source-removal" as const,
  source: "team-main",
  owner: directOwner,
  installed: [{ source: "team-main", path: "review" }],
  repairs: [
    {
      address: { source: "team-main", path: "review" },
      actions: ["rebind", "uninstall"] as const,
    },
  ],
  blockers: [
    {
      reason: "installed" as const,
      address: { source: "team-main", path: "review" },
    },
  ],
  allowed: false,
});

async function openSourceRemoval(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup, "sources");
  await openSourceCommand(setup, "remove-source");
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "source-removal-choice",
  );
}

test("RENDER keyboard Sources browser selects a contributed Source then exposes its named Config Source command", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    skills.focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    const browser = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    browser.focus();
    setup.mockInput.pressArrow("down");
    await setup.flush();
    const contributed = setup.renderer.root.findDescendantById(
      "source-browser",
    ) as SelectRenderable;
    contributed.focus();
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable === contributed &&
        contributed.getSelectedOption()?.value === "team-config/lark",
    );
    await awaitParsedEnter(setup);
    await setup.flush();
    await readySourceCommand(setup, "source-command-config-source", "Open owning Config Source");
    expect(setup.captureCharFrame()).toContain("Open owning Config Source");
    expect(setup.captureCharFrame()).not.toContain("Actions");
    await awaitParsedEnter(setup);
    await setup.flush();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-config-source-browser"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER zero-owned Source exposes its named Installed Skills command and reversibly shows no filtered results", async () => {
  let loads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection({ includeDirect: false }), {
          loadInstalled: async (request) => {
            loads++;
            return {
              value: {
                address: request.address,
                name: request.address.path,
                description: "",
                rawText: "",
                markdownText: "",
              },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.flush();
    const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    skills.focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    const browser = setup.renderer.root.findDescendantById("source-browser")!;
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    await awaitParsedEnter(setup);
    await readySourceCommand(setup, "source-command-skills", "View Installed Skills");
    await awaitParsedEnter(setup);
    await setup.flush();
    await setup.waitForFrame((frame) =>
      frame.includes("Installed Skills from team-config/lark 0/0"),
    );
    expect(setup.captureCharFrame()).toContain("No Installed Skills from team-config/lark.");
    setup.renderer.root.findDescendantById("clear-source-filter")!.focus();
    await awaitParsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    expect(loads).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Add Skills selects observed eligible roots, disables installed roots, and installs the exact revision once", async () => {
  const calls: unknown[] = [];
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "installed" },
        name: "installed",
        description: "Already here",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          discover: async (request) => ({
            value: {
              source: request.source,
              kind: "github",
              exactRevision: "reviewed",
              candidates: [
                {
                  path: "installed",
                  name: "installed",
                  description: "Already here",
                },
                { path: "new", name: "new", description: "Install me" },
              ],
            },
            diagnostics: [],
          }),
          install: async (request) => {
            calls.push(request);
            return { value: [], diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await activatePaletteCommand(setup, "add-skills");
    await setup.waitForFrame(
      (frame) => frame.includes("Add Skills") && frame.includes("Revision: reviewed"),
    );
    expect(setup.captureCharFrame()).toContain("[-] Available installed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-operation-selection");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await awaitParsedEnter(setup);
    await activateControl(setup, "source-operation-submit");
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([{ source: "team-main", paths: ["new"], exactRevision: "reviewed" }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source observation Cancel waits for an abort-ignoring provider and never publishes selection", async () => {
  let resolveDiscovery:
    | ((value: {
        readonly value: {
          readonly source: string;
          readonly kind: "github";
          readonly exactRevision: string;
          readonly candidates: [];
        };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: () =>
            new Promise((resolve) => {
              resolveDiscovery = resolve;
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await activatePaletteCommand(setup, "add-skills");
    await setup.waitForFrame((frame) => frame.includes("Discovering Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-observation-progress");
    await awaitParsedEnter(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Cancelling observation"));
    expect(setup.renderer.root.findDescendantById("palette-navigate.workspace")).toBeUndefined();
    resolveDiscovery!({
      value: {
        source: "team-main",
        kind: "github",
        exactRevision: "late",
        candidates: [],
      },
      diagnostics: [],
    });
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("source-observation-overlay"),
    );
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
    );
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.captureCharFrame()).not.toContain("Source Selection");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-navigate.workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER retry observation Cancel retains cancellation ownership until its late result settles", async () => {
  let attempts = 0;
  let resolveRetry:
    | ((value: {
        readonly value: {
          readonly source: string;
          readonly kind: "github";
          readonly exactRevision: string;
          readonly candidates: [];
        };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: () => {
            attempts++;
            if (attempts === 1)
              return Promise.reject(new SkillCliError("PROVIDER_UNAVAILABLE", "offline"));
            return new Promise((resolve) => {
              resolveRetry = resolve;
            });
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await activatePaletteCommand(setup, "add-skills");
    await setup.waitForFrame((frame) => frame.includes("Observation failed"));
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Retry"));
    await focusLive(setup, "source-observation-progress");
    await activateControl(setup, "source-observation-retry");
    await setup.waitForFrame((frame) => frame.includes("Observing"));
    await activateControl(setup, "source-observation-progress");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Cancelling observation"));
    expect(setup.renderer.root.findDescendantById("palette-navigate.workspace")).toBeUndefined();
    resolveRetry!({
      value: {
        source: "team-main",
        kind: "github",
        exactRevision: "late-retry",
        candidates: [],
      },
      diagnostics: [],
    });
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("source-observation-overlay"),
    );
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
    );
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.captureCharFrame()).not.toContain("Source Selection");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-navigate.workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config observation Retry repeats observe and preview without checking Source updates", async () => {
  const calls: unknown[] = [];
  let observes = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(remoteConfigProjection(), {
          observeConfig: async (request) => {
            calls.push(["observe", request]);
            if (++observes === 1) throw new SkillCliError("PROVIDER_UNAVAILABLE", "offline");
            return {
              value: {
                id: request.id,
                kind: "github",
                exactRevision: "retry-commit",
                contributions: { sources: [], collections: [] },
              },
              diagnostics: [],
            };
          },
          previewAdoptConfig: async (request) => {
            calls.push(["preview", request]);
            return {
              value: {
                kind: "config-source-adopt",
                id: request.id,
                owner: {
                  level: "project",
                  file: "/workspace/skill-cli/skill-cli.jsonc",
                  pointer: "/configSources/team-remote",
                },
                binding: {
                  kind: "github",
                  origin: "https://github.com/acme/config",
                  root: "",
                  ref: "main",
                },
                exactRevision: request.exactRevision,
                declarationRetained: true,
                contributions: { sources: [], collections: [] },
                delta: {
                  addedSources: [],
                  changedSources: [],
                  removedSources: [],
                  addedCollections: [],
                  changedCollections: [],
                  removedCollections: [],
                },
                affectedInstalled: [],
                disappearingSelectors: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
          checkUpdate: async (request) => {
            calls.push(["check-update", request]);
            throw new Error("Config retry must not check Source updates");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openProjectConfigSourceActions(setup);
    await awaitParsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("PROVIDER_UNAVAILABLE: offline"));
    await focusLive(setup, "config-command-config-observe");
    await awaitParsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Exact revision: retry-commit"));
    expect(calls).toEqual([
      ["observe", { id: "team-remote" }],
      ["observe", { id: "team-remote" }],
      [
        "preview",
        {
          id: "team-remote",
          exactRevision: "retry-commit",
          observation: {
            id: "team-remote",
            kind: "github",
            exactRevision: "retry-commit",
            contributions: { sources: [], collections: [] },
          },
        },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stale Config preview completion cannot replace a newer same-kind observation", async () => {
  const previewA = deferred<ReturnType<typeof configImpact>>();
  const observationB = deferred<ReturnType<typeof configObservation>>();
  let observes = 0;
  let previews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(remoteConfigProjection(), {
          observeConfig: () => {
            observes++;
            return observes === 1
              ? Promise.resolve(configObservation("preview-a"))
              : observationB.promise;
          },
          previewAdoptConfig: () =>
            ++previews === 1 ? previewA.promise : Promise.resolve(configImpact("preview-b")),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  const observeAgain = async () => {
    await focusLive(setup, "config-command-config-observe");
    await awaitParsedEnter(setup);
  };
  try {
    await openProjectConfigSourceActions(setup);
    await awaitParsedEnter(setup);
    await setup.waitFor(() => previews === 1);
    await setup.waitForFrame((frame) => frame.includes("Observing Config"));
    await awaitParsedEscape(setup);
    await observeAgain();
    await setup.waitForFrame((frame) => frame.includes("Observing Config"));
    previewA.resolve(configImpact("stale-preview"));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Observing Config");
    expect(setup.captureCharFrame()).not.toContain("Exact revision: stale-preview");
    expect(observes).toBe(2);
    expect(previews).toBe(1);
    observationB.resolve(configObservation("current-observation"));
    await setup.waitForFrame((frame) => frame.includes("Reviewed commit: preview-b"));
    expect(previews).toBe(2);
    await awaitParsedEscape(setup);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stale Config retry preview completion cannot mutate a newer same-kind observation", async () => {
  const retryPreview = deferred<ReturnType<typeof configImpact>>();
  const observationB = deferred<ReturnType<typeof configObservation>>();
  const adopts: unknown[] = [];
  let observes = 0;
  let previews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(remoteConfigProjection(), {
          observeConfig: () => {
            observes++;
            if (observes === 1)
              return Promise.reject(new SkillCliError("PROVIDER_UNAVAILABLE", "offline"));
            if (observes === 2) return Promise.resolve(configObservation("retry-observation"));
            return observationB.promise;
          },
          previewAdoptConfig: () =>
            ++previews === 1
              ? retryPreview.promise
              : Promise.resolve(configImpact("current-retry")),
          adoptConfig: async (request) => {
            adopts.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  const observeAgain = async () => {
    await focusLive(setup, "config-command-config-observe");
    await awaitParsedEnter(setup);
  };
  try {
    await openProjectConfigSourceActions(setup);
    await awaitParsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("PROVIDER_UNAVAILABLE: offline"));
    await focusLive(setup, "config-command-config-observe");
    await awaitParsedEnter(setup);
    await setup.waitFor(() => previews === 1);
    await awaitParsedEscape(setup);
    await observeAgain();
    await setup.waitForFrame((frame) => frame.includes("Observing Config"));
    retryPreview.resolve(configImpact("stale-retry"));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Observing Config");
    expect(setup.captureCharFrame()).not.toContain("Exact revision: stale-retry");
    expect(observes).toBe(3);
    expect(previews).toBe(1);
    observationB.resolve(configObservation("current-observation"));
    await setup.waitForFrame((frame) => frame.includes("Reviewed commit: current-retry"));
    expect(previews).toBe(2);
    const errors: unknown[][] = [];
    const originalConsoleError = console.error;
    const originalStderrWrite = process.stderr.write;
    console.error = (...args: unknown[]) => {
      errors.push(args);
      originalConsoleError(...args);
    };
    process.stderr.write = ((...args: Parameters<typeof process.stderr.write>) => {
      errors.push(args);
      return originalStderrWrite.call(process.stderr, ...args);
    }) as typeof process.stderr.write;
    try {
      await awaitParsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "config-command-config-observe",
      );
    } finally {
      console.error = originalConsoleError;
      process.stderr.write = originalStderrWrite;
    }
    const logged = errors.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("Error in global keypress handler");
    expect(logged).not.toContain("configOperation().impact");
    await awaitParsedEnter(setup);
    await setup.renderOnce();
    expect(adopts).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source browser pointer opens direct and contributed rows exactly once", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.flush();
    const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
    skills.focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.flush();
    const direct = await readySourceBrowser(setup);
    await setup.mockMouse.click(direct.screenX + 1, direct.screenY);
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-command-skills"));
    expect(setup.captureCharFrame()).toContain("team-main");
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeUndefined();
    await awaitParsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));

    const contributed = await readySourceBrowser(setup);
    await setup.mockMouse.click(contributed.screenX + 1, contributed.screenY + 1);
    await setup.flush();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-command-config-source"),
    );
    expect(setup.captureCharFrame()).toContain("team-config/lark");
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Project Source browser initializes its visual first row before contextual actions", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: async (request) => {
            calls.push(request);
            return {
              value: { source: request.source, kind: "github", candidates: [] },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "add-skills");
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([{ source: "team-main" }]);
  } finally {
    setup.renderer.destroy();
  }
});

async function projectContributedSource(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup, "sources");
  setup.mockInput.pressArrow("down");
  await focusLive(setup, "source-browser");
  await awaitParsedEnter(setup);
  await readySourceCommand(setup, "source-command-config-source", "Open owning Config Source");
}

test("RENDER Project contributed Source installs selected observed roots at its exact revision", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: async (request) => {
            calls.push(["discover", request]);
            return {
              value: {
                source: request.source,
                kind: "github",
                exactRevision: "contributed-install",
                candidates: [{ path: "review", name: "review", description: "Review" }],
              },
              diagnostics: [],
            };
          },
          install: async (request) => {
            calls.push(["install", request]);
            return { value: [], diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.flush();
    await activateControl(setup, "shell-section-tab-sources");
    const browser = await readySourceBrowser(setup);
    browser.setSelectedIndex(1);
    await activateControl(setup, "workspace-action-add-skills");
    await setup.waitForFrame((frame) => frame.includes("Revision: contributed-install"));
    await activateControl(setup, "source-operation-selection");
    await activateControl(setup, "source-operation-submit");
    await setup.waitFor(() => calls.length === 2);
    expect(calls).toEqual([
      ["discover", { source: "team-config/lark" }],
      [
        "install",
        {
          source: "team-config/lark",
          paths: ["review"],
          exactRevision: "contributed-install",
        },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test.each(["team-main", "team-config/lark"])(
  "RENDER Source %s updates selected Changed roots through its workbench",
  async (source) => {
    const base = workspaceProjection();
    const projection: ManagementProjection = {
      ...base,
      installedSkills: ["changed", "old", "same"].map((path) => ({
        address: { source, path },
        name: path,
        description: path,
        owner: { source, health: "healthy" },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete", values: [] },
        aliases: [],
        problems: [],
      })),
    };
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            checkUpdate: async (request) => {
              return {
                value: {
                  source: request.source,
                  kind: "github",
                  exactRevision: "d".repeat(40),
                  baseline: "reviewed-baseline",
                  changed: [{ path: "changed", name: "changed", description: "Changed" }],
                  added: [{ path: "new", name: "new", description: "New" }],
                  removed: [{ path: "old", name: "old", description: "Removed" }],
                  unchanged: [{ path: "same", name: "same", description: "Unchanged" }],
                },
                diagnostics: [],
              };
            },
            update: async (request) => {
              calls.push(request);
              return { value: undefined, diagnostics: [] };
            },
            install: async () => {
              throw new Error("Updates must not install new roots");
            },
            uninstall: async () => {
              throw new Error("Updates must not uninstall removed roots");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await setup.flush();
      await activateControl(setup, "shell-section-tab-sources");
      const browser = await readySourceBrowser(setup);
      browser.setSelectedIndex(source === "team-main" ? 0 : 1);
      browser.focus();
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      const choices = setup.renderer.root.findDescendantById("palette-choices") as SelectRenderable;
      const check = choices.options.findIndex((option) => option.value.id === "check-updates");
      expect(check).toBeGreaterThanOrEqual(0);
      choices.setSelectedIndex(check);
      await awaitParsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
      await activateControl(setup, "updates-browser");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
      await setup.waitForFrame((frame) => frame.includes("changed"));
      expect(setup.renderer.root.findDescendantById("source-operation-selection")).toBeUndefined();
      expect(calls).toEqual([]);
      await focusLive(setup, "source-updates-browser");
      setup.mockInput.pressKey(" ");
      await setup.renderOnce();
      await activateControl(setup, "source-updates-update-all");
      await setup.waitFor(() => calls.length === 1);
      expect(calls).toEqual([
        {
          source,
          paths: ["changed"],
          exactRevision: "d".repeat(40),
          expectedBaseline: "reviewed-baseline",
        },
      ]);
    } catch (cause) {
      throw new Error(
        `Source update entry; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
        { cause },
      );
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER contributed Source filters unhealthy Installed Skills and restores each originating layer", async () => {
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-config/lark", path: "doc" },
        name: "doc",
        description: "Lark",
        owner: {
          source: "team-config/lark",
          health: "unresolved-config" as const,
        },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await projectContributedSource(setup);
    await awaitParsedEscape(setup);
    await openSourceCommand(setup, "view-installed-skills");
    await setup.waitForFrame((frame) =>
      frame.includes("Installed Skills from team-config/lark 1/1"),
    );
    await activateControl(setup, "installed-skill-browser");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Address  team-config/lark/doc") &&
        frame.includes("Health  unresolved-config"),
    );
    await awaitParsedEscape(setup);
    await setup.waitForFrame((frame) =>
      frame.includes("Installed Skills from team-config/lark 1/1"),
    );
    await awaitParsedEscape(setup);
    await setup.waitForFrame(
      (frame) => frame.includes("Workspace / Sources") && frame.includes("team-config/lark"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Escape aborts a pending Add Skills observation before it opens a selection", async () => {
  let aborts = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          discover: (_request, options) =>
            new Promise((_, reject) =>
              options?.signal?.addEventListener("abort", () => {
                aborts++;
                reject(new SkillCliError("CANCELLED", "cancelled"));
              }),
            ),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "add-skills");
    await setup.renderOnce();
    await awaitParsedEscape(setup);
    await setup.waitFor(() => aborts === 1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Open Config and Open Config Source route to their exact selected owner rows", async () => {
  const direct = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(direct, "sources");
    await openSourceCommand(direct, "open-config");
    await direct.waitFor(
      () =>
        (
          direct.renderer.root.findDescendantById("config-source-browser") as SelectRenderable
        )?.getSelectedOption()?.value === "team-main",
    );
    expect(
      (
        direct.renderer.root.findDescendantById("config-source-browser") as SelectRenderable
      ).getSelectedOption()?.name,
    ).toBe("team-main · github");
  } finally {
    direct.renderer.destroy();
  }

  const contributed = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(contributed, "sources");
    contributed.mockInput.pressArrow("down");
    await openSourceCommand(contributed, "open-config-source");
    await contributed.waitForFrame((frame) => frame.includes("Selected > team-config"));
    expect(contributed.captureCharFrame()).toContain("> team-config");
  } finally {
    contributed.renderer.destroy();
  }
});

test("RENDER blocked impact repair select opens the exact Rebind repair form", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () => ({
            value: {
              kind: "source-removal",
              source: "team-main",
              owner: directOwner,
              installed: [{ source: "team-main", path: "review" }],
              repairs: [
                {
                  address: { source: "team-main", path: "review" },
                  actions: ["rebind", "uninstall"],
                },
              ],
              blockers: [
                {
                  reason: "installed",
                  address: { source: "team-main", path: "review" },
                },
              ],
              allowed: false,
            },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Removal is blocked"));
    await activateControl(setup, "source-removal-repair-0-rebind");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Rebind Skill") &&
        frame.includes("Replacement Source-root-relative Skill path"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("rebind-source-choice");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER source-removal uninstall repair executes then restores the same parent review", async () => {
  let previews = 0;
  let uninstalls = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: async () => ({
            value: blockedSourceRemoval(),
            diagnostics: [],
          }),
          previewUninstall: async (request) => {
            previews++;
            return {
              value: {
                kind: "uninstall" as const,
                installed: request.paths.map((path) => ({
                  source: request.source,
                  path,
                })),
                directMemberships: [],
                disappearingSelectors: [],
                retainedSelectors: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
          uninstall: async () => {
            uninstalls++;
            return { value: undefined, diagnostics: [] };
          },
          get: async () => ({ value: repairProjection(), diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await activateControl(setup, "installed-skill-review-confirm");
    await setup.waitFor(() => uninstalls === 1);
    await setup.waitForFrame((frame) => frame.includes("Removal is blocked by installed Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-removal-choice");
    expect(setup.captureCharFrame()).toContain("team-main/review");
    expect(previews).toBe(1);
    expect(uninstalls).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER dismissed repair preview ignores an abort-ignoring success and closes its exact session", async () => {
  let aborts = 0;
  let resolvePreview:
    | ((value: {
        readonly value: {
          readonly kind: "uninstall";
          readonly installed: readonly {
            readonly source: string;
            readonly path: string;
          }[];
          readonly directMemberships: [];
          readonly disappearingSelectors: [];
          readonly retainedSelectors: [];
          readonly blockers: [];
          readonly allowed: true;
        };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: async () => ({
            value: blockedSourceRemoval(),
            diagnostics: [],
          }),
          previewUninstall: (request, options) =>
            new Promise((resolve) => {
              resolvePreview = resolve;
              options?.signal?.addEventListener("abort", () => aborts++);
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-uninstall");
    await setup.waitForFrame((frame) => frame.includes("Reviewing impact"));
    await awaitParsedEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Cancelling preview"));
    resolvePreview!({
      value: {
        kind: "uninstall",
        installed: [{ source: "team-main", path: "review" }],
        directMemberships: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.waitForFrame(
      (frame) => frame.includes("team-main") && !frame.includes("Uninstall Skill"),
    );
    expect(aborts).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER source-removal rebind repair executes then restores the same parent review", async () => {
  let rebinds = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: async () => ({
            value: blockedSourceRemoval(),
            diagnostics: [],
          }),
          previewRebind: async (request) => ({
            value: {
              kind: "rebind" as const,
              address: { source: request.source, path: request.path },
              owner: request.owner,
              ownerPath: request.ownerPath ?? request.path,
              proof: "proven" as const,
              allowed: true,
            },
            diagnostics: [],
          }),
          rebind: async () => {
            rebinds++;
            return { value: undefined, diagnostics: [] };
          },
          get: async () => ({ value: repairProjection(), diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-rebind");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "rebind-source-choice",
    );
    await awaitParsedEnter(setup);
    await focusLive(setup, "rebind-owner-path");
    await setup.mockInput.typeText("alt/review");
    await activateControl(setup, "rebind-preview");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await activateControl(setup, "installed-skill-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("Removal is blocked by installed Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-removal-choice");
    expect(setup.captureCharFrame()).toContain("team-main/review");
    expect(rebinds).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER failed repair preview returns to its source-removal parent and an empty re-review closes only that session", async () => {
  let sourceReviews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: async () => {
            sourceReviews++;
            return { value: blockedSourceRemoval(), diagnostics: [] };
          },
          previewUninstall: async () => {
            throw new SkillCliError("WRITE_FAILED", "preview failed");
          },
          uninstall: async () => ({ value: undefined, diagnostics: [] }),
          get: async () => ({ value: repairProjection(), diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-uninstall");
    await setup.waitForFrame((frame) => frame.includes("Removal is blocked by installed Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-removal-choice");
    expect(setup.captureCharFrame()).toContain("Removal is blocked by installed Skills");
    expect(setup.captureCharFrame()).toContain("WRITE_FAILED: preview failed");
    expect(sourceReviews).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER failed uninstall repair restores its child review and physical Cancel closes that exact repair session", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: async () => ({
            value: blockedSourceRemoval(),
            diagnostics: [],
          }),
          previewUninstall: async (request) => ({
            value: {
              kind: "uninstall" as const,
              installed: request.paths.map((path) => ({
                source: request.source,
                path,
              })),
              directMemberships: [],
              disappearingSelectors: [],
              retainedSelectors: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          uninstall: async () => {
            throw new SkillCliError("WRITE_FAILED", "repair failed");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await activateControl(setup, "installed-skill-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("WRITE_FAILED: repair failed"));
    await activateControl(setup, "installed-skill-review-cancel");
    await setup.waitForFrame(
      (frame) => frame.includes("team-main") && !frame.includes("Uninstall Skill"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty parent re-review closes after a completed uninstall repair", async () => {
  let sourceReviews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: async () => {
            sourceReviews++;
            if (sourceReviews === 1) return { value: blockedSourceRemoval(), diagnostics: [] };
            throw new SkillCliError("WRITE_FAILED", "parent unavailable");
          },
          previewUninstall: async (request) => ({
            value: {
              kind: "uninstall" as const,
              installed: request.paths.map((path) => ({
                source: request.source,
                path,
              })),
              directMemberships: [],
              disappearingSelectors: [],
              retainedSelectors: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          uninstall: async () => ({ value: undefined, diagnostics: [] }),
          get: async () => ({ value: repairProjection(), diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await activateControl(setup, "installed-skill-review-confirm");
    await setup.waitFor(() => sourceReviews === 2);
    await setup.waitForFrame(
      (frame) => frame.includes("team-main") && !frame.includes("Remove Source: impact review"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER physical child Cancel prevents a stale parent re-review from replacing a newer Palette", async () => {
  let sourceReviews = 0;
  let resolveRereview: (() => void) | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(repairProjection(), {
          preview: () => {
            sourceReviews++;
            if (sourceReviews === 1)
              return Promise.resolve({
                value: blockedSourceRemoval(),
                diagnostics: [],
              });
            return new Promise((resolve) => {
              resolveRereview = () => resolve({ value: blockedSourceRemoval(), diagnostics: [] });
            });
          },
          previewUninstall: async (request) => ({
            value: {
              kind: "uninstall" as const,
              installed: request.paths.map((path) => ({
                source: request.source,
                path,
              })),
              directMemberships: [],
              disappearingSelectors: [],
              retainedSelectors: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          uninstall: async () => ({ value: undefined, diagnostics: [] }),
          get: async () => ({ value: repairProjection(), diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openSourceRemoval(setup);
    await activateControl(setup, "source-removal-repair-0-uninstall");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    await activateControl(setup, "installed-skill-review-confirm");
    await setup.waitFor(() => sourceReviews === 2);
    await activateControl(setup, "installed-skill-review-cancel");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
    );
    resolveRereview!();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.captureCharFrame()).not.toContain("Remove Source: impact review");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-navigate.workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Palette routes its Project destination and omits contributed removal", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(setup, "sources");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette") && frame.includes("Project"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-navigate.workspace");
    await focusLive(setup, "palette-navigate.project");
    await awaitParsedEnter(setup);
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("config-source-browser") as SelectRenderable
        )?.getSelectedOption()?.value === "team-main",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER normal Ctrl+C exits exactly once", async () => {
  let exits = 0;
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => exits++} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(setup, "sources");
    setup.mockInput.pressCtrlC();
    setup.mockInput.pressCtrlC();
    expect(exits).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER modal Ctrl+C follows Escape dismissal without exiting", async () => {
  let exits = 0;
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => exits++} />,
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
    );
    setup.mockInput.pressCtrlC();
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("palette-navigate.workspace"),
    );
    expect(exits).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("palette-navigate.workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Escape cancels a pending preview exactly once and late preview success cannot reopen confirmation", async () => {
  let aborts = 0;
  let resolvePreview:
    | ((value: {
        readonly value: {
          readonly kind: "source-removal";
          readonly source: string;
          readonly owner: typeof directOwner;
          readonly installed: [];
          readonly repairs: [];
          readonly blockers: [];
          readonly allowed: true;
        };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: (options) =>
            new Promise((resolve) => {
              resolvePreview = resolve;
              options?.signal?.addEventListener("abort", () => aborts++);
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Reviewing Source removal impact"));
    await Promise.resolve();
    await setup.renderOnce();
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    resolvePreview!({
      value: {
        kind: "source-removal",
        source: "team-main",
        owner: directOwner,
        installed: [],
        repairs: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(aborts).toBe(1);
    expect(setup.captureCharFrame()).not.toContain("Remove this direct Source declaration?");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER collection removal preview failure closes the session and permits retry", async () => {
  let previews = 0;
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/team",
  };
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: [{ id: "team", owner }],
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
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const baseCore = directSourceCore(projection);
  const setup = await testRender(
    () => (
      <App
        core={{
          ...baseCore,
          configuration: {
            ...baseCore.configuration,
            previewCollectionRemoval: async () => {
              previews++;
              throw new Error("preview failed");
            },
          },
        }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "collections");
    await focusCollection(setup);
    setup.mockInput.pressKey("P", { ctrl: true });
    await activatePaletteCommand(setup, "remove-collection");
    await setup.waitFor(() => previews === 1);
    await setup.waitForFrame((frame) => frame.includes("INTERNAL: preview failed"));
    expect(setup.captureCharFrame()).not.toContain("Remove Collection");
    setup.mockInput.pressKey("P", { ctrl: true });
    await activatePaletteCommand(setup, "remove-collection");
    await setup.waitFor(() => previews === 2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER allowed removal confirms once, refreshes once, and reselects the nearest Source", async () => {
  let removes = 0;
  let gets = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          remove: async () => {
            removes++;
            return { value: undefined, diagnostics: [] };
          },
          get: async () => ({
            value:
              ++gets === 1 ? workspaceProjection() : workspaceProjection({ includeDirect: false }),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    await activateControl(setup, "source-removal-confirm");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("team-config/lark") &&
        !frame.includes("Remove this direct Source declaration?"),
    );
    expect(removes).toBe(1);
    expect(gets).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER preview failure closes its pending surface, retains the exact error, and permits retry", async () => {
  let previews = 0;
  let removes = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () => {
            previews++;
            if (previews === 1) throw new SkillCliError("WRITE_FAILED", "preview disk full");
            return {
              value: {
                kind: "source-removal",
                source: "team-main",
                owner: directOwner,
                installed: [],
                repairs: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
          remove: async () => {
            removes++;
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("WRITE_FAILED: preview disk full") &&
        !frame.includes("Reviewing Source removal impact"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    expect(removes).toBe(0);
    expect(previews).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER preview owner mismatch closes the preview, exposes TRANSACTION_CONFLICT, and permits retry", async () => {
  let previews = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () => {
            previews++;
            return {
              value: {
                kind: "source-removal",
                source: "team-main",
                owner: previews === 1 ? { ...directOwner, pointer: "/sources/other" } : directOwner,
                installed: [],
                repairs: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("TRANSACTION_CONFLICT") &&
        !frame.includes("Reviewing Source removal impact"),
    );
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    expect(previews).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER duplicate confirm while removal is pending is inert until one refresh settles", async () => {
  let removes = 0;
  let gets = 0;
  let settleRemove: (() => void) | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          remove: async () =>
            new Promise<{
              readonly value: undefined;
              readonly diagnostics: [];
            }>((resolve) => {
              removes++;
              settleRemove = () => resolve({ value: undefined, diagnostics: [] });
            }),
          get: async () => ({
            value:
              ++gets === 1 ? workspaceProjection() : workspaceProjection({ includeDirect: false }),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    await activateControl(setup, "source-removal-confirm");
    await setup.waitFor(() => removes === 1);
    await setup.renderOnce();
    await awaitParsedEnter(setup);
    expect(removes).toBe(1);
    settleRemove!();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("team-config/lark") &&
        !frame.includes("Remove this direct Source declaration?"),
    );
    expect(gets).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source removal execution failure restores its review and dismissal closes it", async () => {
  let removals = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          remove: async () => {
            removals++;
            throw new Error("write denied");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await openSourceCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    await activateControl(setup, "source-removal-confirm");
    await setup.waitForFrame((frame) => frame.includes("INTERNAL: write denied"));
    expect(removals).toBe(1);
    expect(setup.captureCharFrame()).toContain("Remove this direct Source declaration?");
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Remove this direct Source declaration?");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER late cancelled preview cannot close a newly opened Palette", async () => {
  let resolvePreview: (() => void) | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          preview: async () =>
            new Promise((resolve) => {
              resolvePreview = () =>
                resolve({
                  value: {
                    kind: "source-removal",
                    source: "team-main",
                    owner: directOwner,
                    installed: [],
                    repairs: [],
                    blockers: [],
                    allowed: true,
                  },
                  diagnostics: [],
                });
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup, "sources");
    await activatePaletteCommand(setup, "remove-source");
    await setup.waitForFrame((frame) => frame.includes("Reviewing Source removal impact"));
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    resolvePreview!();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-navigate.workspace");
  } finally {
    setup.renderer.destroy();
  }
});
