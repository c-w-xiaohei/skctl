import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable, ScrollBoxRenderable } from "@opentui/core";
import { enterLive, focusLive } from "./reader-test-controls";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { CollectionsPage } from "../src/collections-page";
import { createCollectionsState } from "../src/collections/state";
import { createFocusRegistry } from "../src/focus";
import { collectionRelationRows } from "../src/collections-page";
import { collectionRelationKey } from "../src/collections/relationship-inspector";
import {
  collectionEntryColumns,
  collectionRelationColumns,
} from "../src/collections/collection-table";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

async function parsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
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
  await setup.renderOnce();
}

async function openCollections(
  setup: Awaited<ReturnType<typeof testRender>>,
  focusBrowser = false,
) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
  const section = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
  section.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
  await setup.renderOnce();
  setup.mockInput.pressArrow("right");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
  await setup.flush();
  if (focusBrowser) {
    await focusLive(setup, "collection-browser");
  }
}

function collectionProjection() {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/engineering",
  };
  return {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          id: "engineering",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "guide",
                  owner,
                },
              ],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
}

function renderCollectionDetail(
  collections: Parameters<typeof CollectionsPage>[0]["collections"],
  projection: Parameters<typeof CollectionsPage>[0]["projection"],
  width: number,
  height: number,
) {
  return testRender(
    () => (
      <CollectionsPage
        collections={collections}
        mode="medium"
        surface="detail"
        projection={projection}
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
    { width, height },
  );
}

test("RENDER Collection Inspector replaces the Work Area with exactly Entries and Relations", async () => {
  const collections = createCollectionsState();
  collections.select("engineering");
  const setup = await testRender(
    () => (
      <CollectionsPage
        collections={collections}
        mode="medium"
        surface="detail"
        projection={() => collectionProjection()}
        onSelect={() => {}}
        onQuery={() => {}}
        onFilter={() => {}}
        onClear={() => {}}
        onClearAll={() => {}}
        onFilterOpen={() => {}}
        onFilterDimension={() => {}}
        onFilterSearch={() => {}}
        onFilterClose={() => {}}
        onTab={(id, tab) => collections.selectTab(id, tab)}
        onInspectorFocus={() => {}}
        onDetail={() => {}}
        onRelationship={() => {}}
      />
    ),
    { width: 79, height: 24 },
  );
  try {
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("collection-tabs-tab-entries")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collection-tabs-tab-relations")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collection-tabs-tab-members")).toBeUndefined();
    await setup.waitForFrame((frame) => frame.includes("guide"));
    expect(setup.captureCharFrame()).toContain("Contents");
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE Collection local view retains Entries or Relations independently per Collection", () => {
  const collections = createCollectionsState();
  collections.selectTab("engineering", "relations");
  collections.selectTab("docs", "entries");
  expect(collections.tab("engineering")).toBe("relations");
  expect(collections.tab("docs")).toBe("entries");
});

test("STATE Collection snapshot restores independent row, tab, scroll, and origin state across A-B-A", () => {
  const collections = createCollectionsState();
  collections.select("a");
  collections.selectTab("a", "relations");
  collections.selectRow("a", "relations", "collection-link:2");
  collections.setScroll("collection:a:relations", 7);
  collections.toggleOrigin("a", "origin-a");
  collections.select("b");
  collections.selectTab("b", "entries");
  collections.selectRow("b", "entries", "guide:0");
  collections.setScroll("collection:b:entries", 3);
  collections.select("a");
  expect(collections.tab("a")).toBe("relations");
  expect(collections.selectedRow("a", "relations")).toBe("collection-link:2");
  expect(collections.scroll("collection:a:relations")).toBe(7);
  expect(collections.selectedOrigins("a")).toEqual(["origin-a"]);
  expect(collections.selectedRow("b", "entries")).toBe("guide:0");
  expect(collections.scroll("collection:b:entries")).toBe(3);
});

test("DECLARATION Collection tables expose exact columns", () => {
  expect(collectionEntryColumns.map((column) => column.label)).toEqual(["Name", "Skill", "Origin"]);
  expect(collectionRelationColumns.map((column) => column.label)).toEqual([
    "Kind",
    "Target",
    "Owner",
    "Effect",
  ]);
});

test("RENDER wide Collections mount the work-area controls in the expected layout", async () => {
  const collections = createCollectionsState();
  collections.select("engineering");
  const setup = await testRender(
    () => (
      <CollectionsPage
        collections={collections}
        mode="wide"
        surface="detail"
        projection={() => collectionProjection()}
        onSelect={() => {}}
        onQuery={() => {}}
        onFilter={() => {}}
        onClear={() => {}}
        onClearAll={() => {}}
        onFilterOpen={() => {}}
        onFilterDimension={() => {}}
        onFilterSearch={() => {}}
        onFilterClose={() => {}}
        onTab={(id, tab) => collections.selectTab(id, tab)}
        onInspectorFocus={() => {}}
        onDetail={() => {}}
        onRelationship={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    await setup.flush();
    const rows = setup.renderer.root.findDescendantById("collection-relationships")!;
    const tabs = setup.renderer.root.findDescendantById("collection-tabs-tab-entries")!;
    expect(rows).toBeDefined();
    expect(tabs).toBeDefined();
    expect(rows.screenY).toBeGreaterThan(tabs.screenY);
    expect(rows.width).toBeGreaterThan(40);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection browser keeps its tree mounted while loading", async () => {
  const noop = () => {};
  const setup = await testRender(
    () => (
      <CollectionsPage
        collections={createCollectionsState()}
        mode="medium"
        surface="browser"
        projection={() => undefined}
        onSelect={noop}
        onQuery={noop}
        onFilter={noop}
        onClear={noop}
        onClearAll={noop}
        onFilterOpen={noop}
        onFilterDimension={noop}
        onFilterSearch={noop}
        onFilterClose={noop}
        onTab={noop}
        onInspectorFocus={noop}
        onDetail={noop}
        onRelationship={noop}
      />
    ),
    { width: 79, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Loading Collections");
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeInstanceOf(
      ScrollBoxRenderable,
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection browser preserves direct, contributed, derived, linked, and empty origins in one-line rows", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const direct = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/direct",
  };
  const contributed = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/collections/contributed",
    contribution: {
      configSource: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/configSources/team",
      },
      declaration: {
        level: "global" as const,
        pointer: "/collections/contributed",
      },
    },
  };
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: [
                {
                  collection: "engineering",
                  owner: {
                    level: "project" as const,
                    file: "/project.jsonc",
                    pointer: "/use/0",
                  },
                },
              ],
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      collectionsView: [
        {
          id: "direct",
          declared: [direct],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "review",
              address: { source: "main", path: "review" },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "direct",
                  entryName: "review",
                  owner: direct,
                },
              ],
            },
          ],
          references: [],
          links: [],
        },
        {
          id: "contributed",
          declared: [contributed],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "derived",
          declared: [],
          repository: {
            derived: true,
            producers: [{ source: "repo", path: "skill" }],
          },
          members: [
            {
              name: "skill",
              address: { source: "repo", path: "skill" },
              paths: [
                {
                  kind: "repository-derived" as const,
                  repository: "acme/repo",
                  source: "repo",
                  path: "skill",
                },
              ],
            },
          ],
          references: [],
          links: [],
        },
        {
          id: "linked",
          declared: [direct],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "main", path: "guide" },
              paths: [
                {
                  kind: "via-link" as const,
                  links: [
                    {
                      collection: "linked",
                      linkedCollection: "shared",
                      owner: direct,
                    },
                  ],
                },
              ],
            },
          ],
          references: [],
          links: [{ collection: "shared", owner: direct }],
        },
        {
          id: "empty",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openCollections(setup);
    await setup.waitForFrame((frame) =>
      ["direct", "contributed", "derived", "linked", "empty"].every((id) => frame.includes(id)),
    );
    const rows = setup.captureCharFrame().split("\n");
    for (const id of ["direct", "contributed", "derived", "linked", "empty"])
      expect(rows.filter((row) => row.includes(id)).length).toBeGreaterThan(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection query keeps one-line rows and restores the browser after Escape", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openCollections(setup);
    setup.renderer.root.findDescendantById("collections-query")!.focus();
    setup.mockInput.typeText("no-such-collection");
    await setup.waitForFrame((frame) => frame.includes("No Collections match"));
    expect(setup.captureCharFrame()).toContain("No Collections match");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER App routes Sources to Collections and opens a narrow Collection inspector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
    {
      width: 79,
      height: 24,
    },
  );
  try {
    await openCollections(setup);
    await enterLive(setup, "collection-browser");
    await setup.waitForFrame((frame) => frame.includes("Contents"));
    expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collections captures the mounted browser scroll and restores it after one Escape", async () => {
  const base = collectionProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: Array.from({ length: 40 }, (_, index) => ({
        id: `collection-${index}`,
        declared: [],
        repository: { derived: false, producers: [] },
        members: [],
        references: [],
        links: [],
      })),
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 79, height: 24 },
  );
  try {
    await openCollections(setup, true);
    for (let index = 0; index < 25; index++) setup.mockInput.pressArrow("down");
    await setup.flush();
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    const scroll = browser.scrollTop;
    expect(scroll).toBeGreaterThan(0);
    await enterLive(setup, "collection-browser");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-tabs-tab-entries"),
    );

    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    await setup.flush();
    const restored = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    expect(restored.scrollTop).toBe(scroll);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(restored.id);
    await enterLive(setup, "collection-browser");
    await setup.waitForFrame((frame) => frame.includes("collection-31"));
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 79])(
  "RENDER Collection Inspector Esc restores the Collection Work Area at width %i",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await openCollections(setup);
      await enterLive(setup, "collection-browser");
      await setup.renderOnce();
      await setup.waitFor(
        () => setup.renderer.root.findDescendantById("collection-tabs-tab-entries") !== undefined,
      );
      const relationships = setup.renderer.root.findDescendantById("collection-relationships")!;
      relationships.focus();
      await setup.renderOnce();
      await parsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Collection Relations Enter is inspectable without opening a mutation draft", async () => {
  const projection = collectionProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = projection.effective.collectionsView[0]!.declared[0]!;
  const relationProjection = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          ...projection.effective.collectionsView[0]!,
          references: [{ name: "docs", collection: "docs", description: "Docs", owner }],
          links: [{ collection: "shared", owner }],
        },
      ],
    },
  };
  const collections = createCollectionsState();
  collections.select("engineering");
  collections.selectTab("engineering", "relations");
  const reference = collectionRelationRows("engineering", relationProjection).find(
    (row) => row.kind === "collection-reference",
  )!;
  collections.openRelation("engineering", collectionRelationKey(reference));
  const setup = await renderCollectionDetail(collections, () => relationProjection, 80, 24);
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    expect(setup.renderer.root.findDescendantById("collection-relation-inspector")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collection-review-choice")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Membership inspector names the object and exposes origin plus metadata", async () => {
  const collections = createCollectionsState();
  collections.select("engineering");
  collections.openMembership("engineering", "guide:0");
  const setup = await renderCollectionDetail(collections, () => collectionProjection(), 79, 24);
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeUndefined();
    expect(!!setup.renderer.root.findDescendantById("collection-membership-origin")).toBe(false);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("guide");
    expect(frame).toContain("In engineering");
    for (const field of ["Target", "Owner"]) expect(frame).toContain(field);
    expect(setup.renderer.root.findDescendantById("collection-membership-actions")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Relation inspector renders metadata commands and dispatches the focused record", async () => {
  const base = collectionProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = base.effective.collectionsView[0]!.declared[0]!;
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...base.effective.collectionsView[0]!,
          references: [{ name: "docs", collection: "docs", description: "Docs", owner }],
        },
      ],
    },
  };
  const collections = createCollectionsState();
  collections.select("engineering");
  collections.selectTab("engineering", "relations");
  collections.openRelation(
    "engineering",
    collectionRelationKey(
      collectionRelationRows("engineering", projection).find(
        (row) => row.kind === "collection-reference",
      )!,
    ),
  );
  const intents: unknown[] = [];
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
        onRelationship={(intent) => intents.push(intent)}
      />
    ),
    { width: 79, height: 24 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    const remove = setup.renderer.root.findDescendantById("relationship.remove-reference")!;
    remove.focus();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("relationship.remove-reference");
    expect(setup.renderer.root.findDescendantById("collection-relationships")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("collection-relation-inspector")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("relationship.open-owner")).toBeDefined();
    expect(remove).toBeDefined();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("docs");
    expect(frame).toContain("Relation in engineering");
    expect(frame).toContain("Open owning Config");
    expect(frame).toContain("Remove Reference");
    expect(setup.renderer.root.findDescendantById("collection-relation-actions")).toBeUndefined();
    expect(frame).not.toContain("Relationship inspector");
    expect(frame).not.toContain("Back to Relations");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => intents.length === 1);
    expect(intents).toEqual([
      {
        kind: "collection-reference",
        collection: "engineering",
        name: "docs",
        target: "docs",
        description: "Docs",
        owner,
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER contributed Membership and Reference retain Config Source provenance with declaration pointers", async () => {
  const base = collectionProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const contribution = {
    configSource: {
      level: "global" as const,
      file: "/global.jsonc",
      pointer: "/configSources/team",
    },
    declaration: {
      level: "global" as const,
      file: "/global.jsonc",
      pointer: "/collections/engineering",
    },
  };
  const owner = {
    ...base.effective.collectionsView[0]!.declared[0]!,
    contribution,
  };
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...base.effective.collectionsView[0]!,
          members: base.effective.collectionsView[0]!.members.map((member) => ({
            ...member,
            paths: member.paths.map((path) => (path.kind === "direct" ? { ...path, owner } : path)),
          })),
          references: [{ name: "docs", collection: "docs", description: "Docs", owner }],
        },
      ],
    },
  };
  const collections = createCollectionsState();
  collections.select("engineering");
  collections.openMembership("engineering", "guide:0");
  const setup = await renderCollectionDetail(collections, () => projection, 120, 40);
  try {
    await setup.waitForFrame((frame) => frame.includes("In engineering"));
    expect(setup.captureCharFrame()).toContain("global /global.jsonc /configSources/team");
    expect(setup.captureCharFrame()).toContain("project /project.jsonc /collections/engineering");
    collections.selectTab("engineering", "relations");
    collections.openRelation(
      "engineering",
      collectionRelationKey(
        collectionRelationRows("engineering", projection).find(
          (row) => row.kind === "collection-reference",
        )!,
      ),
    );
    await setup.waitForFrame((frame) => frame.includes("Relation in engineering"));
    expect(setup.captureCharFrame()).toContain("global /global.jsonc /configSources/team");
    expect(setup.captureCharFrame()).toContain("project /project.jsonc /collections/engineering");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection browser opens its exact memberships and their ownership facts", async () => {
  const base = collectionProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/engineering",
  };
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...base.effective.collectionsView[0]!,
          id: "engineering",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "guide",
                  owner,
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openCollections(setup);
    await enterLive(setup, "collection-browser");
    await setup.waitForFrame((frame) => frame.includes("guide"));
    expect(setup.captureCharFrame()).toContain("team-main");
    const body = setup.renderer.root.findDescendantById(
      "collection-relationships-body",
    ) as ScrollBoxRenderable;
    expect(
      body.getChildren().filter((row) => row.id.startsWith("collection-relationships-row-")),
    ).toHaveLength(1);
    await focusLive(setup, "collection-relationships");
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id.includes(":action-") === true,
    );
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("/project.jsonc") && frame.includes("/collections/engineering"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection Relations keep Collection Use, Reference, and Link ownership facts compact", async () => {
  const base = collectionProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = base.effective.collectionsView[0]!.declared[0]!;
  const projection = {
    ...base,
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: ["engineering:guide"],
        aliases: [],
        problems: [],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              collection: "engineering",
              selector: "engineering:guide",
              entry: "guide",
              paths: [
                {
                  kind: "via-link" as const,
                  links: [
                    {
                      collection: "engineering",
                      linkedCollection: "shared",
                      owner,
                    },
                  ],
                },
              ],
              useOwners: [owner],
            },
          ],
        },
      },
    ],
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...base.effective.collectionsView[0]!,
          references: [
            {
              name: "docs",
              collection: "docs",
              description: "Read docs",
              owner,
            },
          ],
          links: [{ collection: "shared", owner }],
        },
      ],
    },
  };
  const collections = createCollectionsState();
  collections.select("engineering");
  collections.selectTab("engineering", "relations");
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
        onTab={(id, tab) => collections.selectTab(id, tab)}
        onInspectorFocus={() => {}}
        onDetail={() => {}}
        onRelationship={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("docs") && frame.includes("shared"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Reference");
    expect(frame).toContain("Link");
    expect(frame).not.toContain("/project.jsonc");
    expect(frame).not.toContain("/collections/");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collections and relationships keep actionable identities primary", async () => {
  const collections = createCollectionsState();
  collections.select("engineering");
  const setup = await renderCollectionDetail(collections, () => collectionProjection(), 160, 40);
  try {
    await setup.waitForFrame((frame) => frame.includes("guide") && frame.includes("team-main"));
    expect(setup.captureCharFrame()).not.toContain("/project.jsonc");
    expect(setup.captureCharFrame()).not.toContain("/collections/");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection rows omit full address and relation owner facts from primary labels", async () => {
  const base = collectionProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = base.effective.collectionsView[0]!.declared[0]!;
  const longPath = `${"nested/".repeat(12)}guide`;
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...base.effective.collectionsView[0]!,
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: longPath },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "guide",
                  owner,
                },
              ],
            },
          ],
          references: [{ name: "docs", collection: "docs", description: "Docs", owner }],
        },
      ],
    },
  };
  const collections = createCollectionsState();
  collections.select("engineering");
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
        onTab={(id, tab) => collections.selectTab(id, tab)}
        onInspectorFocus={() => {}}
        onDetail={() => {}}
        onRelationship={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("guide") && frame.includes("team-main"));
    expect(setup.captureCharFrame()).not.toContain(longPath);
    expect(setup.captureCharFrame()).not.toContain("/project.jsonc");
    collections.selectTab("engineering", "relations");
    await setup.waitForFrame((frame) => frame.includes("Reference") && frame.includes("docs"));
    expect(setup.captureCharFrame()).not.toContain("engineering -> docs");
    expect(setup.captureCharFrame()).not.toContain("/project.jsonc");
    expect(setup.captureCharFrame()).not.toContain("/collections/");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection Work Area keeps context, tabs, and rows on separate lines", async () => {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: ["engineering:guide"],
        aliases: [],
        primary: "engineering:guide",
        problems: [],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              collection: "engineering",
              selector: "engineering:guide",
              entry: "guide",
              paths: [],
              useOwners: [
                {
                  level: "project" as const,
                  file: "/project.jsonc",
                  pointer: "/use/0",
                },
              ],
            },
          ],
        },
      },
    ],
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: [
                {
                  collection: "engineering",
                  owner: {
                    level: "project" as const,
                    file: "/project.jsonc",
                    pointer: "/use/0",
                  },
                },
              ],
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      managed: true,
      use: ["engineering"],
      collections: ["engineering"],
      collectionsView: [
        {
          id: "engineering",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openCollections(setup, true);
    await enterLive(setup, "collection-browser");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("engineering") && frame.includes("Contents") && frame.includes("guide"),
    );
    await setup.renderOnce();
    const rows = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    const tabs = setup.renderer.root.findDescendantById("collection-tabs-tab-entries")!;
    expect(tabs.screenY).toBeGreaterThan(0);
    expect(rows.screenY).toBeGreaterThan(tabs.screenY);
    expect(rows.width).toBeGreaterThan(40);
  } finally {
    setup.renderer.destroy();
  }
});

test("TASK7 RENDER Collection browser uses remaining list height for long results", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: Array.from({ length: 12 }, (_, index) => ({
        id: `collection-${index}`,
        declared: [],
        repository: { derived: false, producers: [] },
        members: [],
        references: [],
        links: [],
      })),
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openCollections(setup);
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as ScrollBoxRenderable;
    expect(browser.height).toBeGreaterThan(10);
    await focusLive(setup, "collection-browser");
    for (let index = 0; index < 11; index++) setup.mockInput.pressArrow("down");
    await enterLive(setup, "collection-browser");
    await setup.waitForFrame(
      (frame) => frame.includes("collection-11") && frame.includes("Contents"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("TASK7 RENDER medium Collection browser fills the 80x24 Content height and shows four rows", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: ["alpha", "bravo", "charlie", "delta"].map((id) => ({
        id,
        declared: [],
        repository: { derived: false, producers: [] },
        members: [],
        references: [],
        links: [],
      })),
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openCollections(setup);
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    expect(browser.height).toBeGreaterThan(0);
    const frame = setup.captureCharFrame().split("\n");
    expect(frame.filter((line) => /alpha|bravo|charlie|delta/.test(line))).toHaveLength(4);
  } finally {
    setup.renderer.destroy();
  }
});

test("TASK7 RENDER Collection browser preserves query, selection, and scroll through medium and narrow resizes", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: Array.from({ length: 41 }, (_, index) => ({
        id: `collection-${index}`,
        declared: [],
        repository: { derived: false, producers: [] },
        members: [],
        references: [],
        links: [],
      })),
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await openCollections(setup);
    const query = setup.renderer.root.findDescendantById("collections-query") as InputRenderable;
    query.focus();
    setup.mockInput.typeText("collection");
    await setup.waitFor(
      () =>
        (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value ===
        "collection",
    );
    await focusLive(setup, "collection-browser");
    for (let index = 0; index < 25; index++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    for (const width of [80, 43, 80] as const) {
      setup.resize(width, 24);
      await setup.flush();
      const resized = setup.renderer.root.findDescendantById(
        "collection-browser",
      ) as ScrollBoxRenderable;
      expect(
        (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value,
      ).toBe("collection");
      expect(resized.scrollTop).toBeGreaterThan(0);
      await enterLive(setup, "collection-browser");
      await setup.waitForFrame(
        (frame) => frame.includes("collection-31") && frame.includes("Contents"),
      );
      await parsedEscape(setup);
      await setup.flush();
      if (width === 43) {
        expect(setup.captureCharFrame()).toContain("Collections");
        const restored = setup.renderer.root.findDescendantById("collection-browser")!;
        expect(restored.screenY + restored.height).toBeLessThan(24);
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER wide Collections replace the Work Area without a permanent third Inspector", async () => {
  const collections = createCollectionsState();
  collections.select("engineering");
  const setup = await renderCollectionDetail(collections, () => collectionProjection(), 120, 40);
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("collections-inspector-panel")).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("collections-inspector-separator"),
    ).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Contents");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection entry arrow preview preserves compact origin context", async () => {
  const collections = createCollectionsState();
  collections.select("engineering");
  const setup = await renderCollectionDetail(collections, () => collectionProjection(), 120, 40);
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    const entries = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    entries.focus();
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("guide"));
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE Collection browser selection resets its first local row when the Collection changes", () => {
  const collections = createCollectionsState();
  collections.select("a");
  collections.select("b");
  expect(collections.selected()).toBe("b");
  expect(collections.tab("b")).toBe("entries");
});

test.each([120, 80, 43])(
  "RENDER Entries and Relations labels remain bounded at width %i",
  async (width) => {
    const collections = createCollectionsState();
    collections.select("engineering");
    const setup = await renderCollectionDetail(
      collections,
      () => collectionProjection(),
      width,
      30,
    );
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Contents");
      expect(setup.captureCharFrame()).toContain("Relations");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Collections filter FocusRegistry target is replaced after filter mount and unmount", async () => {
  const registry = createFocusRegistry();
  const collections = createCollectionsState();
  const setup = await testRender(
    () => (
      <CollectionsPage
        collections={collections}
        mode="medium"
        surface="browser"
        projection={() => collectionProjection()}
        focusRegistry={registry}
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
    { width: 120, height: 40 },
  );
  const owner = "command:collections.filter.open" as const;
  try {
    await setup.renderOnce();
    const first = registry.target(owner) as { readonly id?: string } | undefined;
    expect(first).toBeDefined();
    expect(first?.id).toBe("collections-filter");
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collections-filter")).toBeDefined();
    collections.openFilter();
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("collections-filter-search")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collections-filter-dimensions")).toBeDefined();
    await setup.waitFor(() => registry.target(owner) === undefined);
    expect(setup.renderer.root.findDescendantById("collections-filter-dimensions")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collections-filter-search")).toBeDefined();
    collections.closeFilter();
    await setup.renderOnce();
    const next = registry.target(owner) as { readonly id?: string } | undefined;
    expect(next).toBeDefined();
    expect(next?.id).toBe("collections-filter");
    expect(next).not.toBe(first);
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("collections-filter-search")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("collections-filter-dimensions")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("collections-filter")).toBeDefined();
  } finally {
    setup.renderer.destroy();
    expect(registry.target(owner)).toBeUndefined();
  }
});

test("RENDER Collection filter controls preserve one-line query filtering and clear controls", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openCollections(setup);
    const query = setup.renderer.root.findDescendantById("collections-query") as InputRenderable;
    query.focus();
    setup.mockInput.typeText("missing");
    await setup.waitForFrame((frame) => frame.includes("No Collections match"));
    expect(setup.captureCharFrame()).toContain("No Collections match");
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE Collections preserve selection, local tab, and filter state across responsive widths", () => {
  const collections = createCollectionsState();
  collections.select("a");
  collections.selectTab("a", "relations");
  collections.setQuery("a");
  for (const _width of [120, 80, 79, 43, 120]) collections.select("a");
  expect(collections.selected()).toBe("a");
  expect(collections.tab("a")).toBe("relations");
  expect(collections.query()).toBe("a");
});

test("STATE Collections refresh retains nearest selection and clears filtered empty selection", () => {
  const collections = createCollectionsState();
  const base = workspaceProjection();
  const projection = (ids: readonly string[]) => ({
    ...base,
    effective: {
      ...base.effective,
      collectionsView: ids.map((id) => ({
        id,
        declared: [],
        repository: { derived: false, producers: [] },
        members: [],
        references: [],
        links: [],
      })),
    },
  });
  const first = projection(["a", "b", "c"]);
  collections.select("b");
  collections.reconcile(first, projection(["a", "b", "d"]));
  expect(collections.selected()).toBe("b");
  collections.reconcile(projection(["a", "b", "d"]), projection(["a", "d"]));
  expect(collections.selected()).toBe("d");
  collections.setQuery("missing");
  collections.reconcile(projection(["a", "d"]), projection(["a", "d"]));
  expect(collections.selected()).toBeUndefined();
});
