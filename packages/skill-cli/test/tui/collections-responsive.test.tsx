import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { CollectionsPage } from "../../src/tui/collections-page";
import { createTuiState } from "../../src/tui/model";
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
                { kind: "direct" as const, collection: "engineering", entryName: "review", owner },
              ],
            },
          ],
          references: [{ name: "docs", collection: "docs", description: "Read docs", owner }],
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
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Installed Skills"));
    setup.renderer.root.findDescendantById("workspace-section-browser")?.focus();
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("engineering"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Members"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-tabs");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collection browser mounts an empty initial projection", async () => {
  const noop = () => {};
  const setup = await testRender(
    () => (
      <CollectionsPage
        state={createTuiState()}
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

test("RENDER Collection filters search, retain mounted clear focus, and clear locally", async () => {
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
                { kind: "direct" as const, collection: "engineering", entryName: "review", owner },
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
    const type = (value: string) => setup.mockInput.typeText(value);
    const applyFilter = async (dimension: string, value: string) => {
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collections-filter-search",
      );
      await type(dimension);
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collections-filter-dimensions",
      );
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collections-filter-search",
      );
      await type(value);
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collections-filter-values",
      );
      setup.mockInput.pressEnter();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-browser",
      );
    };
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Installed Skills"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Collections 1/1"));
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    setup.mockInput.pressKey("TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collections-query");
    setup.mockInput.pressKey("TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collections-filter");
    await applyFilter("For agents", "Excluded");
    expect(
      setup.renderer.root.findDescendantById("clear-collections-filter-For agents"),
    ).toBeDefined();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collections-filter");
    await applyFilter("Problems", "No problems");
    expect(
      setup.renderer.root.findDescendantById("clear-collections-filter-Problems"),
    ).toBeDefined();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    const firstClear = setup.renderer.currentFocusedRenderable?.id;
    if (!firstClear) throw new Error("Collection clear filter was not focused");
    expect(["clear-collections-filter-For agents", "clear-collections-filter-Problems"]).toContain(
      firstClear,
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id !== firstClear &&
        ["clear-collections-filter-For agents", "clear-collections-filter-Problems"].includes(
          setup.renderer.currentFocusedRenderable?.id ?? "",
        ),
    );
    expect(setup.renderer.root.findDescendantById(firstClear)).toBeUndefined();
    setup.mockInput.pressKey("TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("clear-all-collections-filters");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
    expect(
      setup.renderer.root.findDescendantById("clear-collections-filter-For agents"),
    ).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("clear-collections-filter-Problems"),
    ).toBeUndefined();
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
      declaration: { level: "global" as const, pointer: "/collections/contributed" },
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
          repository: { derived: true, producers: [{ source: "repo", path: "skill" }] },
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
          repository: { derived: true, producers: [{ source: "repo", path: "combo" }] },
          members: [
            {
              name: "combo",
              address: { source: "repo", path: "combo" },
              paths: [
                {
                  kind: "via-link" as const,
                  links: [
                    { collection: "composed", linkedCollection: "shared", owner: direct },
                    { collection: "shared", linkedCollection: "nested", owner: direct },
                  ],
                },
              ],
            },
          ],
          references: [
            { name: "docs", collection: "direct", description: "zero exposure", owner: direct },
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
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Installed Skills"));
    setup.mockInput.pressKey("TAB", { shift: true });
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) =>
      [
        "direct  1  project",
        "contributed  0  global / /configSources/team",
        "derived  1  Repository",
        "composed  1  project + Repository",
        "empty  0  Empty",
      ].every((row) => frame.includes(row)),
    );
    expect(setup.captureCharFrame()).not.toContain("\ncollections\n");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Collections retain selection, tab, and focus through 120 80 79 43 120", async () => {
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/a" };
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
    await setup.waitForFrame((frame) => frame.includes("Installed Skills"));
    setup.renderer.root.findDescendantById("workspace-section-browser")?.focus();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-tabs");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    for (const width of [120, 80, 79, 43, 120] as const) {
      setup.resize(width, 24);
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable).toBeDefined();
      expect(setup.captureCharFrame()).toContain("a");
      if (width >= 80)
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
