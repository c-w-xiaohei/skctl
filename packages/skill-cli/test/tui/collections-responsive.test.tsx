import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { CollectionsPage } from "../../src/tui/collections-page";
import { createCollectionsState } from "../../src/tui/collections/state";
import { createFocusRegistry } from "../../src/tui/focus";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

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
}

async function navigateToCollections(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Skills"));
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
  );
  const skills = setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills");
  if (!skills) throw new Error("Workspace Skills trigger disappeared before it could be focused");
  skills.focus();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
  );
  setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Collections"));
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-collections",
  );
  setup.mockInput.pressEnter();
}

async function click(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeDefined();
  await setup.mockMouse.click(target!.screenX + 1, target!.screenY);
  await setup.renderOnce();
}

async function key(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
  if (name === "ENTER") setup.mockInput.pressEnter();
  else setup.mockInput.pressKey(name);
  await setup.renderOnce();
}

async function tabTo(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  for (let attempts = 0; attempts < 12; attempts++) {
    if (setup.renderer.currentFocusedRenderable?.id === id) return;
    await key(setup, "TAB");
  }
  throw new Error(
    `Timed out tabbing to ${id}; focused ${setup.renderer.currentFocusedRenderable?.id ?? "nothing"}`,
  );
}

test("RENDER App routes Sources to Collections and opens a narrow Collection inspector", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/engineering",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "engineering",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "review",
              address: { source: "team-main", path: "review" },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "review",
                  owner,
                },
              ],
            },
          ],
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
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 79,
    height: 24,
  });
  try {
    await navigateToCollections(setup);
    await setup.waitForFrame((frame) => frame.includes("engineering"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Members"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-tabs-tab-members");
    const members = setup.renderer.root.findDescendantById("collection-tabs-tab-members")!;
    await setup.mockMouse.click(members.screenX + 1, members.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-members",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collections and relationships keep actionable identities primary", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/alpha",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "alpha",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [{ kind: "direct" as const, collection: "alpha", entryName: "guide", owner }],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 160,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    expect(browser.options[0]).toMatchObject({ name: "alpha", value: "alpha" });
    expect(browser.options[0]!.description).toContain("1 member");
    expect(browser.showDescription).toBe(false);
    expect(browser.showSelectionIndicator).toBe(true);
    expect(browser.showScrollIndicator).toBe(true);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    const relationships = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    expect(relationships.options[0]).toMatchObject({
      name: "guide",
      description: "team-main/guide · project",
      value: "guide:0",
    });
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection browser uses remaining list height for long results", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections" };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: Array.from({ length: 12 }, (_, index) => ({
        id: `collection-${index}`,
        declared: [owner],
        repository: { derived: false, producers: [] },
        members: [],
        references: [],
        links: [],
      })),
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    expect(browser.height).toBeGreaterThan(10);
    browser.focus();
    for (let index = 0; index < 11; index++) setup.mockInput.pressArrow("down");
    await setup.waitFor(() => browser.getSelectedOption()?.value === "collection-11");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER wide Collections owns ordered bounded Browser and Inspector surfaces", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections" };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "engineering",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    const browser = setup.renderer.root.findDescendantById("collection-browser")!;
    const inspector = setup.renderer.root.findDescendantById("collections-inspector-panel");
    expect(inspector).toBeDefined();
    expect(inspector!.screenX).toBeGreaterThan(browser.screenX);
    expect(inspector!.screenX).toBeGreaterThanOrEqual(browser.screenX + browser.width);
    expect(inspector!.screenX + inspector!.width).toBeLessThanOrEqual(120);
    expect(inspector!.screenY + inspector!.height).toBeLessThanOrEqual(40);
    expect(setup.captureCharFrame()).toContain("Inspector");
    expect(
      setup.renderer.root.findDescendantById("collections-inspector-separator"),
    ).toBeUndefined();
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-members",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [80, 24, true],
  [79, 24, false],
  [43, 30, false],
] as const)(
  "RENDER Collections keeps the wide Inspector panel unmounted at %ix%i",
  async (width, height, hasMediumSeparator) => {
    const setup = await testRender(
      () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      await navigateToCollections(setup);
      expect(setup.renderer.root.findDescendantById("collections-inspector-panel")).toBeUndefined();
      expect(
        setup.renderer.root.findDescendantById("collections-inspector-separator") !== undefined,
      ).toBe(hasMediumSeparator);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Collection relationship preview follows arrow selection before opening", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/alpha",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "alpha",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [{ kind: "direct" as const, collection: "alpha", entryName: "guide", owner }],
            },
            {
              name: "review",
              address: { source: "team-main", path: "review" },
              paths: [{ kind: "direct" as const, collection: "alpha", entryName: "review", owner }],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 160,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    const relationships = setup.renderer.root.findDescendantById("collection-relationships")!;
    relationships.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.captureCharFrame()).toContain("Selected Member  guide");
    expect(setup.captureCharFrame()).toContain("Skill  team-main/guide");
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("Selected Member  review"));
    expect(setup.captureCharFrame()).toContain("Skill  team-main/review");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection relationship preview resets to the native first row when Browser selection changes", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/a",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "a",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "a-first",
              address: { source: "team-main", path: "a-first" },
              paths: [{ kind: "direct" as const, collection: "a", entryName: "a-first", owner }],
            },
            {
              name: "a-second",
              address: { source: "team-main", path: "a-second" },
              paths: [{ kind: "direct" as const, collection: "a", entryName: "a-second", owner }],
            },
          ],
          references: [],
          links: [],
        },
        {
          id: "b",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "b-first",
              address: { source: "team-main", path: "b-first" },
              paths: [{ kind: "direct" as const, collection: "b", entryName: "b-first", owner }],
            },
            {
              name: "b-second",
              address: { source: "team-main", path: "b-second" },
              paths: [{ kind: "direct" as const, collection: "b", entryName: "b-second", owner }],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 160,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    const relationships = setup.renderer.root.findDescendantById("collection-relationships")!;
    relationships.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("Selected Member  a-second"));

    const browser = setup.renderer.root.findDescendantById("collection-browser")!;
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("Selected Member  b-first"));
    expect(setup.captureCharFrame()).not.toContain("Selected Member  b-second");
    expect(
      (
        setup.renderer.root.findDescendantById("collection-relationships") as SelectRenderable
      ).getSelectedIndex(),
    ).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection relationship previews retain complete structured Member, Reference, and Link facts", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const configSource = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/configSources/team",
  };
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/alpha",
    contribution: {
      configSource,
      declaration: {
        level: "project" as const,
        pointer: "/collections/alpha",
        namespace: "team@commit",
      },
    },
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "alpha",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [{ kind: "direct" as const, collection: "alpha", entryName: "guide", owner }],
            },
          ],
          references: [
            { name: "docs", collection: "shared-docs", description: "Read shared docs", owner },
          ],
          links: [{ collection: "shared", owner }],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 160,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    let frame = setup.captureCharFrame();
    expect(frame).toContain("NAME SKILL FROM");
    expect(frame).toContain("Selected Member  guide");
    expect(frame).toContain("Skill  team-main/guide");
    expect(frame).toContain("Origin  project / /configSources/team");

    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((current) =>
      current.includes("NAME TARGET DESCRIPTION FROM 0 Skills exposed"),
    );
    frame = setup.captureCharFrame();
    expect(frame).toContain("Selected Reference  docs");
    expect(frame).toContain("Target  shared-docs");
    expect(frame).toContain("Description  Read shared docs");
    expect(frame).toContain("Owner  project /project.jsonc /collections/alpha");
    expect(frame).toContain("Provenance  Config Source project /project.jsonc /configSources/team");
    expect(frame).toContain("0 Skills exposed");

    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((current) => current.includes("TARGET FROM"));
    frame = setup.captureCharFrame();
    expect(frame).toContain("Selected Link  shared");
    expect(frame).toContain("Target  shared");
    expect(frame).toContain("Owner  project /project.jsonc /collections/alpha");
    expect(frame).toContain("Provenance  Config Source project /project.jsonc /configSources/team");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 43])(
  "RENDER Collection View label remains visible when the inspector is mounted at width %i",
  async (width) => {
    const projection = workspaceProjection();
    if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
    const owner = {
      level: "project" as const,
      file: "/workspace/skill-cli/skill-cli.jsonc",
      pointer: "/collections/engineering",
    };
    const complete = {
      ...projection,
      effective: {
        ...projection.effective,
        collectionsView: [
          {
            id: "engineering",
            declared: [owner],
            repository: { derived: false, producers: [] },
            members: [],
            references: [],
            links: [],
          },
        ],
      },
    };
    const setup = await testRender(
      () => <App core={directSourceCore(complete)} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await navigateToCollections(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-browser",
      );
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-tabs-tab-members"),
      );
      const frame = setup.captureCharFrame();
      expect(frame).toContain("engineering");
      if (width === 43) {
        expect(frame).toContain("Scope:");
        expect(frame).toContain("Browse · Workspace > Collections");
        expect(frame).not.toContain("View:");
      } else {
        expect(frame).toContain("View:");
        for (const value of ["members", "references", "links"])
          expect(
            setup.renderer.root.findDescendantById(`collection-tabs-tab-${value}`),
          ).toBeDefined();
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Collection browser mounts an empty initial projection", async () => {
  const noop = () => {};
  const setup = await testRender(
    () => (
      <CollectionsPage
        collections={createCollectionsState()}
        narrowLevel="list"
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
    {
      width: 79,
      height: 24,
    },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Collections");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collections filter refs replace same-owner targets without a queued ID focus", async () => {
  const registry = createFocusRegistry();
  const collections = createCollectionsState();
  const base = workspaceProjection();
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          id: "engineering",
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
    () => (
      <CollectionsPage
        collections={collections}
        narrowLevel="list"
        projection={() => projection}
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
  try {
    await setup.renderOnce();
    const open = setup.renderer.root.findDescendantById("collections-filter");
    expect(registry.target("collections-filter-open")).toBe(open);
    const first = registry.target("collections-filter-open");
    collections.openFilter();
    await setup.renderOnce();
    collections.closeFilter();
    await setup.renderOnce();
    const reopened = registry.target("collections-filter-open");
    expect(reopened).toBe(setup.renderer.root.findDescendantById("collections-filter"));
    expect(reopened).not.toBe(first);
    expect(registry.applyFocus("collections-filter-open")).toBe(true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collections-filter");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection query filters through physical keyboard input", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/engineering",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "engineering",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "review",
              address: { source: "team-main", path: "review" },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "review",
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
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    await setup.waitForFrame((frame) => frame.includes("Collections 1/1"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collections-query");
    setup.mockInput.typeText("no-such-collection");
    await setup.waitForFrame((frame) => frame.includes("Collections 0/1"));
    expect(setup.captureCharFrame()).toContain("No Collections match the current search");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection filter controls clear one by mouse and all by Enter", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/one",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "one",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team", path: "guide" },
              paths: [],
            },
          ],
          references: [],
          links: [],
        },
        {
          id: "two",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    await setup.waitForFrame((frame) => frame.includes("Collections 2/2"));
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collections-query");
    setup.mockInput.typeText("one");
    await setup.waitForFrame((frame) => frame.includes("Collections 1/2"));
    await tabTo(setup, "collections-filter");
    await key(setup, "ENTER");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collections-filter-search",
    );
    setup.mockInput.typeText("Config");
    await key(setup, "TAB");
    await key(setup, "ENTER");
    setup.mockInput.typeText("project");
    await key(setup, "TAB");
    await key(setup, "ENTER");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("clear-collections-filter-Config"),
    );

    await click(setup, "clear-collections-filter-Config");
    expect(
      setup.renderer.root.findDescendantById("clear-collections-filter-Config"),
    ).toBeUndefined();
    expect(
      (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value,
    ).toBe("one");
    expect(setup.captureCharFrame()).toContain("Collections 1/2");

    await tabTo(setup, "clear-all-collections-filters-keyboard");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Collections 2/2"));
    expect(
      (setup.renderer.root.findDescendantById("collections-query") as InputRenderable).value,
    ).toBe("");
    expect(setup.renderer.root.findDescendantById("clear-all-collections-filters")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection browser shows direct, contributed, derived, composed, and empty rows", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
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
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
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
          id: "composed",
          declared: [direct],
          repository: {
            derived: true,
            producers: [{ source: "repo", path: "combo" }],
          },
          members: [
            {
              name: "combo",
              address: { source: "repo", path: "combo" },
              paths: [
                {
                  kind: "via-link" as const,
                  links: [
                    {
                      collection: "composed",
                      linkedCollection: "shared",
                      owner: direct,
                    },
                    {
                      collection: "shared",
                      linkedCollection: "nested",
                      owner: direct,
                    },
                  ],
                },
              ],
            },
          ],
          references: [
            {
              name: "docs",
              collection: "direct",
              description: "zero exposure",
              owner: direct,
            },
          ],
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
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await navigateToCollections(setup);
    await setup.waitFor(() => {
      const browser = setup.renderer.root.findDescendantById(
        "collection-browser",
      ) as SelectRenderable;
      return (
        browser?.options.length === 5 &&
        browser.options[0]?.name === "direct" &&
        browser.options[0]?.description === "1 member · project" &&
        browser.options[4]?.name === "empty" &&
        browser.options[4]?.description === "0 members · Empty"
      );
    });
    expect(setup.captureCharFrame()).not.toContain("\ncollections\n");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collections retain selection, tab, and focus through 120 80 79 43 120", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/a",
  };
  const complete = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [
        {
          id: "a",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "b",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(complete)} exit={() => {}} />, {
    width: 120,
    height: 24,
  });
  try {
    await navigateToCollections(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-members",
    );
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    for (const width of [120, 80, 79, 43, 120] as const) {
      setup.resize(width, 24);
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable).toBeDefined();
      expect(setup.captureCharFrame()).toContain("a");
      if (width >= 100)
        expect(setup.renderer.root.findDescendantById("collections-inspector-panel")).toBeDefined();
      else if (width >= 80)
        expect(
          setup.renderer.root.findDescendantById("collections-inspector-separator"),
        ).toBeDefined();
      else
        expect(
          setup.renderer.root.findDescendantById("collections-inspector-separator"),
        ).toBeUndefined();
      if (width === 79) {
        await parsedEscape(setup);
        await setup.renderOnce();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE Collections refresh retains a surviving ID and selects the nearest replacement", () => {
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
});

test("STATE Collections preserve independent tabs across A-B-A selection", () => {
  const collections = createCollectionsState();
  collections.select("a");
  collections.selectTab("a", "references");
  collections.select("b");
  collections.selectTab("b", "links");
  collections.select("a");
  expect(collections.tab("a")).toBe("references");
  expect(collections.tab("b")).toBe("links");
});

test("STATE filtered and empty Collection refresh clears selection", () => {
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
  const first = projection(["a"]);
  collections.select("a");
  collections.setQuery("no-match");
  collections.reconcile(first, first);
  expect(collections.selected()).toBeUndefined();
  collections.setQuery("");
  collections.select("a");
  collections.reconcile(first, projection([]));
  expect(collections.selected()).toBeUndefined();
});
