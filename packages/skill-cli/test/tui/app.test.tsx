import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { SkillCliError, type CollectionView, type ManagementProjection } from "../../src/core/api";
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

async function awaitParsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
}

async function populated(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  await Promise.resolve();
  await setup.waitForFrame((frame) => frame.includes("Skills"));
  await setup.waitFor(() => {
    const id = setup.renderer.currentFocusedRenderable?.id;
    return id === "installed-skill-browser" || id === "empty-workspace-action";
  });
  if (!setup.renderer.currentFocusedRenderable?.id?.startsWith("workspace-section-browser-tab-")) {
    await awaitParsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
  }
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser-tab-skills");
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  setup.mockInput.pressArrow("right");
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("team-main"));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
}

async function openActions(setup: Awaited<ReturnType<typeof testRender>>) {
  setup.mockInput.pressEnter();
  await setup.waitForFrame(
    (frame) => frame.includes("Open Config") && frame.includes("Remove Source"),
  );
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-action-menu");
}

async function openProjectConfigSourceActions(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup);
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("Configure · Project > Sources"));
  const sources = setup.renderer.root.findDescendantById("config-section-browser-tab-sources")!;
  sources.focus();
  setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
  const browser = setup.renderer.root.findDescendantById("config-config-source-browser")!;
  browser.focus();
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressArrow("up");
  await setup.waitForFrame((frame) => frame.includes("Selected > team-remote"));
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
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

async function openCollectionAction(setup: Awaited<ReturnType<typeof testRender>>, index: number) {
  await populated(setup);
  setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!.focus();
  setup.mockInput.pressArrow("right");
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-collections",
  );
  setup.mockInput.pressEnter();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
  for (let step = 0; step < index + 4; step++) setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
}

async function chooseCollectionAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  index: number,
) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
  for (let step = 0; step < index + 4; step++) setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
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
    await openCollectionAction(setup, 2);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-import-from",
    );
    await setup.mockInput.typeText("import-a");
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([{ level: "project", from: "import-a", into: "team" }]);
    await awaitParsedEscape(setup);
    await chooseCollectionAction(setup, 2);
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
    readonly value: {
      readonly kind: "add-to-collection";
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly decision: { readonly kind: "direct"; readonly owner: typeof collectionOwner };
      readonly intent: {
        readonly owner: typeof collectionOwner;
        readonly stableEntryName: string;
        readonly address: { readonly source: string; readonly path: string };
      };
      readonly existing: [];
      readonly blockers: [];
      readonly allowed: true;
    };
    readonly diagnostics: [];
  }>();
  const previewB = deferred<{
    readonly value: {
      readonly kind: "add-to-collection";
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly decision: { readonly kind: "direct"; readonly owner: typeof collectionOwner };
      readonly intent: {
        readonly owner: typeof collectionOwner;
        readonly stableEntryName: string;
        readonly address: { readonly source: string; readonly path: string };
      };
      readonly existing: [];
      readonly blockers: [];
      readonly allowed: true;
    };
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
            previewAddToCollection: async (request) => {
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
  const openDraft = async (name: string) => {
    await chooseCollectionAction(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-choice",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    await setup.mockInput.typeText(name);
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
  };
  try {
    await openCollectionAction(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-choice",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    await setup.mockInput.typeText("-a");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([
      {
        level: "project",
        collection: "team",
        address: { source: "team-main", path: "guide" },
        name: "guide-a",
      },
    ]);
    await awaitParsedEscape(setup);
    await openDraft("-b");
    await setup.waitFor(() => requests.length === 2);
    expect(requests[1]).toEqual({
      level: "project",
      collection: "team",
      address: { source: "team-main", path: "guide" },
      name: "guide-b",
    });
    previewA.resolve({
      value: {
        kind: "add-to-collection",
        collection: "team",
        address: { source: "team-main", path: "guide" },
        decision: { kind: "direct", owner: collectionOwner },
        intent: {
          owner: collectionOwner,
          stableEntryName: "guide-a",
          address: { source: "team-main", path: "guide" },
        },
        existing: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(consumedA).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("membership-add-choice");
    expect(setup.captureCharFrame()).toContain("guide-b");
    expect(setup.captureCharFrame()).not.toContain("Add Membership\nCollection: team");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER stale Membership removal preview completion cannot replace a newer same-kind removal", async () => {
  const previewA = deferred<{
    readonly value: {
      readonly kind: "membership-removal";
      readonly collection: string;
      readonly name: string;
      readonly decision: { readonly kind: "direct"; readonly owner: typeof collectionOwner };
      readonly affected: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly retained: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly disappearing: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly linkActions: readonly {
        readonly owner?: typeof collectionOwner;
        readonly paths: [];
      }[];
      readonly allowed: true;
    };
    readonly diagnostics: [];
  }>();
  const previewB = deferred<{
    readonly value: {
      readonly kind: "membership-removal";
      readonly collection: string;
      readonly name: string;
      readonly decision: { readonly kind: "direct"; readonly owner: typeof collectionOwner };
      readonly affected: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly retained: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly disappearing: readonly {
        readonly selector: string;
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: [];
      }[];
      readonly linkActions: readonly {
        readonly owner?: typeof collectionOwner;
        readonly paths: [];
      }[];
      readonly allowed: true;
    };
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
            previewMembershipRemoval: async (request) => {
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
    const relationships = setup.renderer.root.findDescendantById("collection-relationships")!;
    relationships.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === relationships);
    setup.mockInput.pressEnter();
  };
  try {
    await openCollectionAction(setup, 0);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    await beginRemoval();
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([{ level: "project", collection: "team", name: "guide" }]);
    await awaitParsedEscape(setup);
    await beginRemoval();
    await setup.waitFor(() => requests.length === 2);
    previewA.resolve({
      value: {
        kind: "membership-removal",
        collection: "team",
        name: "guide",
        decision: { kind: "direct", owner: collectionOwner },
        affected: [
          { selector: "team:guide", address: { source: "team-main", path: "guide" }, paths: [] },
        ],
        retained: [],
        disappearing: [
          {
            selector: "stale-a:guide",
            address: { source: "team-main", path: "guide" },
            paths: [],
          },
        ],
        linkActions: [],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(consumedA).toBe(1);
    expect(consumedB).toBe(0);
    expect(setup.captureCharFrame()).toContain("team  1 Skills");
    expect(setup.captureCharFrame()).not.toContain("Membership: guide");
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("collection-review-choice");
    previewB.resolve({
      value: {
        kind: "membership-removal",
        collection: "team",
        name: "guide",
        decision: { kind: "direct", owner: collectionOwner },
        affected: [
          {
            selector: "team:guide",
            address: { source: "team-main", path: "guide" },
            paths: [],
          },
        ],
        retained: [],
        disappearing: [
          {
            selector: "current-b:guide",
            address: { source: "team-main", path: "guide" },
            paths: [],
          },
        ],
        linkActions: [{ owner: collectionOwner, paths: [] }],
        allowed: true,
      },
      diagnostics: [],
    });
    await setup.waitForFrame((frame) => frame.includes("Remove Membership"));
    const membershipFrame = setup.captureCharFrame();
    expect(consumedB).toBe(1);
    expect(membershipFrame).toContain("Remove Membership");
    expect(membershipFrame).toContain("Collection: team");
    expect(membershipFrame).toContain("Membership: guide");
    expect(membershipFrame).toContain(
      "Link alternative: project: /workspace/skill-cli/skill-cli.jsonc /collections/team",
    );
    expect(membershipFrame).toContain("Disappears: current-b:guide");
    expect(membershipFrame).not.toContain("Disappears: stale-a:guide");
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
      readonly decision: { readonly kind: "direct"; readonly owner: typeof collectionOwner };
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
      readonly decision: { readonly kind: "direct"; readonly owner: typeof collectionOwner };
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
    await openCollectionAction(setup, 5);
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([{ level: "project", collection: "team" }]);
    await awaitParsedEscape(setup);
    await chooseCollectionAction(setup, 5);
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
    expect(setup.captureCharFrame()).toContain("team  0 Skills");
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
    expect(collectionFrame).not.toContain("team  0 Skills");
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
  await populated(setup);
  await openActions(setup);
  setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
  setup.mockInput.pressEnter();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "source-removal-choice",
  );
}

test("RENDER keyboard browser selects a contributed Source then opens its contextual Actions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await populated(setup);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Open Config Source"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-action-menu");
    expect(setup.captureCharFrame()).not.toContain("Remove Source");
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Add Skills") && frame.includes("Revision: reviewed"),
    );
    expect(setup.captureCharFrame()).toContain("[-] Available installed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-operation-selection");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([{ source: "team-main", paths: ["new"], exactRevision: "reviewed" }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER physical Source observation Cancel ignores a provider late success and preserves a newer Palette", async () => {
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Discovering Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-observation-progress");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    resolveDiscovery!({
      value: {
        source: "team-main",
        kind: "github",
        exactRevision: "late",
        candidates: [],
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.captureCharFrame()).not.toContain("Source Selection");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER physical retry observation Cancel ignores its late success and preserves a newer Palette", async () => {
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Observation failed"));
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Retry"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-observation-progress");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Observing"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-observation-progress");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    resolveRetry!({
      value: {
        source: "team-main",
        kind: "github",
        exactRevision: "late-retry",
        candidates: [],
      },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.captureCharFrame()).not.toContain("Source Selection");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
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
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Observation failed"));
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
  };
  try {
    await openProjectConfigSourceActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
  };
  try {
    await openProjectConfigSourceActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Observation failed"));
    setup.mockInput.pressEnter();
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
        () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
      );
    } finally {
      console.error = originalConsoleError;
      process.stderr.write = originalStderrWrite;
    }
    const logged = errors.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("Error in global keypress handler");
    expect(logged).not.toContain("configOperation().impact");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(adopts).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Check Updates labels categories and applies only a selected Changed root at its observation revision", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          checkUpdate: async () => ({
            value: {
              source: "team-main",
              kind: "github",
              exactRevision: "update-commit",
              changed: [
                {
                  path: "changed",
                  name: "changed",
                  description: "Changed skill",
                },
              ],
              added: [{ path: "new", name: "new", description: "New skill" }],
              removed: [{ path: "old", name: "old", description: "Removed skill" }],
              unchanged: [{ path: "same", name: "same", description: "Same skill" }],
            },
            diagnostics: [],
          }),
          update: async (request) => {
            calls.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Changed changed") && frame.includes("Unchanged same"),
    );
    expect(setup.captureCharFrame()).toContain("[-] New new");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKeys([
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
    ]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([
      {
        source: "team-main",
        paths: ["changed"],
        exactRevision: "update-commit",
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER View Installed Skills filters exact structural Source ownership", async () => {
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "review" },
        name: "review",
        description: "Team review",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
      {
        address: { source: "team-config/lark", path: "doc" },
        name: "doc",
        description: "Lark docs",
        owner: { source: "team-config/lark", health: "healthy" as const },
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => {
      const browser = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      return (
        setup.captureCharFrame().includes("Installed Skills from team-main 1/1") &&
        browser?.options.length === 1 &&
        browser.options[0]?.value === "team-main/review" &&
        browser.options[0]?.description === "Team review · team-main"
      );
    });
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER filtered Installed Skills selection leaves Source context intact and Escape returns to it", async () => {
  const projection = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "first" },
        name: "first",
        description: "First",
        owner: { source: "team-main", health: "missing" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
      {
        address: { source: "team-main", path: "second" },
        name: "second",
        description: "Second",
        owner: { source: "team-main", health: "drifted" as const },
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => {
      const browser = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      return (
        browser?.options[0]?.name === "! first" &&
        browser.options[0]?.description === "First · team-main" &&
        browser.options[1]?.name === "! second"
      );
    });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await awaitParsedEscape(setup);
    await setup.waitForFrame(
      (frame) => frame.includes("team-main") && frame.includes("View Installed Skills"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
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
    await populated(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("config-source-browser") as SelectRenderable
        )?.getSelectedOption()?.value === "team-main",
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Add Skills"));
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 1);
    expect(calls).toEqual([{ source: "team-main" }]);
  } finally {
    setup.renderer.destroy();
  }
});

async function projectContributedSource(setup: Awaited<ReturnType<typeof testRender>>) {
  await populated(setup);
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitForFrame((frame) => frame.includes("Palette"));
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.waitFor(
    () =>
      (
        setup.renderer.root.findDescendantById("config-source-browser") as SelectRenderable
      )?.getSelectedOption()?.value === "team-main",
  );
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) => frame.includes("Open Config Source"));
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
    await projectContributedSource(setup);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Revision: contributed-install"));
    setup.mockInput.pressEnter();
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
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

test("RENDER Project contributed Source updates only selected Changed roots at its exact revision", async () => {
  const calls: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection(), {
          checkUpdate: async (request) => {
            calls.push(["check", request]);
            return {
              value: {
                source: request.source,
                kind: "github",
                exactRevision: "contributed-update",
                changed: [{ path: "review", name: "review", description: "Changed" }],
                added: [{ path: "new", name: "new", description: "New" }],
                removed: [],
                unchanged: [],
              },
              diagnostics: [],
            };
          },
          update: async (request) => {
            calls.push(["update", request]);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await projectContributedSource(setup);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Changed review") && frame.includes("New new"),
    );
    setup.mockInput.pressEnter();
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => calls.length === 2);
    expect(calls).toEqual([
      ["check", { source: "team-config/lark" }],
      [
        "update",
        {
          source: "team-config/lark",
          paths: ["review"],
          exactRevision: "contributed-update",
        },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Project contributed Source filters unhealthy Installed Skills and returns to Config context", async () => {
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
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills from team-config/") &&
        frame.includes("lark 1/1") &&
        frame.includes("! doc"),
    );
    await awaitParsedEscape(setup);
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Configure · Project > Sources") && frame.includes("team-config/lark"),
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressEnter();
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
    await populated(direct);
    await openActions(direct);
    direct.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    direct.mockInput.pressEnter();
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
    await populated(contributed);
    contributed.mockInput.pressArrow("down");
    await openActions(contributed);
    contributed.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    contributed.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Removal is blocked"));
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
          readonly installed: readonly { readonly source: string; readonly path: string }[];
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
          preview: async () => ({ value: blockedSourceRemoval(), diagnostics: [] }),
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
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "rebind-source-choice",
    );
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKeys(["a", "l", "t", "/", "r", "e", "v", "i", "e", "w"]);
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("WRITE_FAILED: repair failed"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-review");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => sourceReviews === 2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-review");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    resolveRereview!();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.captureCharFrame()).not.toContain("Remove Source: impact review");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
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
    await populated(setup);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette") && frame.includes("Project"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
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
    await populated(setup);
    setup.mockInput.pressCtrlC();
    setup.mockInput.pressCtrlC();
    expect(exits).toBe(1);
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
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
    await populated(setup);
    setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!.focus();
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Collections"));
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-collections",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    setup.mockInput.pressKey("P", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    setup.mockInput.pressKeys([
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
    ]);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => previews === 1);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    expect(setup.captureCharFrame()).not.toContain("Remove Collection");
    setup.mockInput.pressKey("P", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    setup.mockInput.pressKeys([
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
      "ARROW_DOWN",
    ]);
    setup.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes("WRITE_FAILED: preview disk full") &&
        !frame.includes("Reviewing Source removal impact"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) =>
        frame.includes(
          "TRANSACTION_CONFLICT: Source removal preview no longer matches the selected declaration",
        ) && !frame.includes("Reviewing Source removal impact"),
    );
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => removes === 1);
    await setup.renderOnce();
    setup.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Remove this direct Source declaration?"));
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
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
    await populated(setup);
    await openActions(setup);
    setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Reviewing Source removal impact"));
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitForFrame((frame) => frame.includes("Palette"));
    resolvePreview!();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Palette");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
  } finally {
    setup.renderer.destroy();
  }
});
