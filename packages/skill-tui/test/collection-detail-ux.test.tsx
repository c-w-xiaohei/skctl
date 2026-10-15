import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import type { CollectionView } from "@skill-cli/core";
import { collectionRelationRows } from "../src/collections-page";
import { collectionRelationKey } from "../src/collections/relationship-inspector";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { parsedEnter, parsedEscape, focusLive } from "./reader-test-controls";

const owner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/team",
};

function expectFocusInside(setup: Awaited<ReturnType<typeof testRender>>, paneId: string) {
  let current = setup.renderer.currentFocusedRenderable;
  while (current && current.id !== paneId) current = current.parent;
  expect(current?.id).toBe(paneId);
}

function geometry(target: {
  readonly id: string;
  readonly screenY: number;
  readonly height: number;
}) {
  return `${target.id} y=${target.screenY} height=${target.height} bottom=${target.screenY + target.height}`;
}

function inspectorGeometry(
  setup: Awaited<ReturnType<typeof testRender>>,
  inspectorId: string,
  commandId: string,
) {
  const inspector = setup.renderer.root.findDescendantById(inspectorId);
  const command = setup.renderer.root.findDescendantById(commandId);
  const viewport = inspector instanceof ScrollBoxRenderable ? inspector.viewport : undefined;
  return [
    inspector ? geometry(inspector) : `${inspectorId} missing`,
    viewport ? geometry(viewport) : `${inspectorId} viewport missing`,
    command ? geometry(command) : `${commandId} missing`,
    `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}`,
    `frame:\n${setup.captureCharFrame()}`,
  ].join("\n");
}

function isInside(
  child: { readonly screenY: number; readonly height: number },
  parent: { readonly screenY: number; readonly height: number },
) {
  return (
    child.screenY >= parent.screenY &&
    child.screenY + child.height <= parent.screenY + parent.height
  );
}

function mountedIds(target: Pick<BaseRenderable, "id" | "getChildren">): string[] {
  return [
    ...(target.id ? [target.id] : []),
    ...target.getChildren().flatMap((child) => mountedIds(child)),
  ];
}

function journeyFailure(
  setup: Awaited<ReturnType<typeof testRender>>,
  stage: string,
  error: unknown,
) {
  return new Error(
    [
      `Collection journey stage: ${stage}`,
      error instanceof Error ? error.message : String(error),
      `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}`,
      `mounted=${mountedIds(setup.renderer.root).join(",")}`,
      `frame:\n${setup.captureCharFrame()}`,
    ].join("\n"),
  );
}

async function flushFocusedReveal(
  setup: Awaited<ReturnType<typeof testRender>>,
  target: { readonly id: string },
) {
  await new Promise<void>((resolve) => setImmediate(resolve));
  // CommandControl calls the public ScrollBox reveal on a renderer-frame event.
  // That scroll changes coordinates after the frame's layout; render once more
  // so subsequent hit testing uses the newly laid-out target position.
  await setup.renderOnce();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === target.id);
}

async function parsedPageDown(setup: Awaited<ReturnType<typeof testRender>>) {
  let parsed = false;
  const onKeypress = (event: { readonly name: string }) => {
    if (event.name === "pagedown" || event.name === "page-down") parsed = true;
  };
  setup.renderer.keyInput.on("keypress", onKeypress);
  try {
    setup.mockInput.pressKey("\u001b[6~");
    await setup.waitFor(() => parsed);
  } finally {
    setup.renderer.keyInput.off("keypress", onKeypress);
  }
  await setup.renderOnce();
}

async function clickRevealedControl(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: string,
  paneId: string,
) {
  const focused = await focusLive(setup, id);
  await flushFocusedReveal(setup, focused);
  const target = setup.renderer.root.findDescendantById(id);
  const pane = setup.renderer.root.findDescendantById(paneId);
  let scrollbox = target?.parent;
  while (scrollbox && !(scrollbox instanceof ScrollBoxRenderable)) scrollbox = scrollbox.parent;
  const viewport = scrollbox instanceof ScrollBoxRenderable ? scrollbox.viewport : pane;
  if (!target || !pane || !viewport || !isInside(target, pane) || !isInside(target, viewport))
    throw new Error(
      `${id} is not visible in ${paneId}\n${journeyFailure(setup, `reveal ${id}`, "clipped control")}`,
    );
  await setup.mockMouse.click(target.screenX + 1, target.screenY);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
  await setup.renderOnce();
  return target;
}

async function openCollectionsSection(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("shell-section-tab-collections") ||
      !!setup.renderer.root.findDescendantById("shell-section-navigation"),
  );
  const collectionTab = setup.renderer.root.findDescendantById("shell-section-tab-collections");
  if (collectionTab) {
    await setup.mockMouse.click(collectionTab.screenX + 1, collectionTab.screenY);
  } else {
    const navigation = setup.renderer.root.findDescendantById(
      "shell-section-navigation",
    ) as SelectRenderable;
    const collectionIndex = navigation.options.findIndex(
      (option) => option.value === "collections",
    );
    expect(collectionIndex).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(navigation.screenX + 2, navigation.screenY + collectionIndex);
  }
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
}

function collectionProjection(): ReturnType<typeof workspaceProjection> {
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
          members: [
            {
              name: "review",
              address: { source: "team-main", path: "review" },
              paths: [
                {
                  kind: "repository-derived",
                  repository: "acme/main",
                  source: "team-main",
                  path: "review",
                },
              ],
            },
          ],
          references: [
            { name: "docs", collection: "docs", description: "Read team documentation", owner },
          ],
          links: [],
        } satisfies CollectionView,
      ],
    },
    installedSkills: [
      {
        address: { source: "team-main", path: "review" },
        name: "review",
        description: "Review changes for correctness and clarity.",
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

test("RENDER 80x16 Collection detail keeps Entries usable and Actions explicit in the real App", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  let stage = "mount";
  try {
    stage = "open Collections";
    await openCollectionsSection(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));

    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    await focusLive(setup, "collection-browser");
    const rowX = browser.screenX + 2;
    const rowY = browser.screenY;
    await setup.mockMouse.click(rowX, rowY);
    await setup.waitFor(() => browser.getSelectedOption()?.value === "team");
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeFalsy();
    await parsedEnter(setup);

    await setup.waitFor(
      () =>
        setup.renderer.root.findDescendantById("collection-relationships") instanceof
        SelectRenderable,
    );
    const list = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    const pane = setup.renderer.root.findDescendantById("collection-detail-pane")!;
    expect(list.height).toBeGreaterThanOrEqual(1);
    expect(list.showDescription).toBe(false);
    expect(list.screenY).toBeGreaterThan(pane.screenY);
    expect(list.screenY + list.height).toBeLessThan(pane.screenY + pane.height);
    expect(setup.captureCharFrame()).toContain("team");
    expect(setup.captureCharFrame()).toContain("Review changes for correctness and clarity.");
    stage = "open parent Collection Actions";
    expect(setup.renderer.root.findDescendantById("collection-actions-toggle")).toBeTruthy();
    expect(
      setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
    ).toBeFalsy();
    await clickRevealedControl(setup, "collection-actions-toggle", "collection-detail-pane");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
    );
    expect(setup.captureCharFrame()).toContain("Check Collection updates");
    await clickRevealedControl(setup, "collection-actions-toggle", "collection-detail-pane");
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
    );

    stage = "open selected member";
    await setup.mockMouse.click(list.screenX + 2, list.screenY);
    await setup.waitFor(() => list.getSelectedOption()?.value === "review:0");
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    expect(setup.captureCharFrame()).toContain("Open Skill");
    expect(setup.captureCharFrame()).toContain("review");
    expect(setup.captureCharFrame()).not.toContain("Collection details");
    expect(setup.renderer.root.findDescendantById("membership.open-source")).toBeFalsy();
    await clickRevealedControl(
      setup,
      "collection-membership-actions",
      "collection-membership-inspector",
    );
    stage = "reveal member Open Source";
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership.open-source"));
    const details = setup.renderer.root.findDescendantById("collection-membership-details");
    expect(details).toBeTruthy();
    expect(setup.captureCharFrame()).toContain("Details");

    const secondary = await focusLive(setup, "membership.open-source");
    await flushFocusedReveal(setup, secondary);
    const inspector = setup.renderer.root.findDescendantById(
      "collection-membership-inspector",
    ) as ScrollBoxRenderable;
    try {
      await setup.waitFor(() => isInside(secondary, inspector.viewport));
    } catch {
      throw new Error(
        inspectorGeometry(setup, "collection-membership-inspector", "membership.open-source"),
      );
    }
    if (!setup.captureCharFrame().includes("Open Source"))
      throw new Error(
        inspectorGeometry(setup, "collection-membership-inspector", "membership.open-source"),
      );

    await parsedEnter(setup);
    stage = "open Source from member";
    await setup.waitFor(() => {
      const target = setup.renderer.root.findDescendantById("source-details-pane");
      return !!target && target.height > 1;
    });
    const keyboardSourcePane = setup.renderer.root.findDescendantById("source-details-pane")!;
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeFalsy();
    expect(setup.renderer.root.findDescendantById("source-metadata")).toBeTruthy();
    expectFocusInside(setup, "source-details-pane");
    expect(setup.captureCharFrame()).toContain("team-main");
    expect(setup.captureCharFrame()).toContain("https://github.com/acme/main");
    expect(setup.captureCharFrame()).toContain("Check updates");
    expect(keyboardSourcePane.screenY).toBeGreaterThan(0);
    expect(keyboardSourcePane.height).toBeGreaterThan(1);
    await parsedEscape(setup);
    stage = "restore member after Source Back";
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    expect(setup.renderer.root.findDescendantById("membership.open-source")).toBeFalsy();
    expect(setup.renderer.root.findDescendantById("collection-membership-actions")).toBeTruthy();
    expect(setup.renderer.root.findDescendantById("collection-membership-details")).toBeTruthy();
    await clickRevealedControl(
      setup,
      "collection-membership-actions",
      "collection-membership-inspector",
    );
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership.open-source"));
    stage = "open member Details";
    await clickRevealedControl(
      setup,
      "collection-membership-details",
      "collection-membership-inspector",
    );
    await focusLive(setup, "collection-membership-inspector");
    for (let page = 0; page < 8; page++) {
      const frame = setup.captureCharFrame();
      if (
        frame.includes("Target team-main/review") &&
        frame.includes("Repository team-main/review")
      )
        break;
      await parsedPageDown(setup);
    }
    expect(setup.captureCharFrame()).toContain("Target team-main/review");
    expect(setup.captureCharFrame()).toContain("Repository team-main/review");
    await clickRevealedControl(
      setup,
      "collection-membership-details",
      "collection-membership-inspector",
    );
    await setup.waitFor(() => !setup.captureCharFrame().includes("Target team-main/review"));

    stage = "open Source by pointer";
    const pointerOpenSource = await focusLive(setup, "membership.open-source");
    await flushFocusedReveal(setup, pointerOpenSource);
    const pointerInspector = setup.renderer.root.findDescendantById(
      "collection-membership-inspector",
    ) as ScrollBoxRenderable;
    try {
      await setup.waitFor(() => isInside(pointerOpenSource, pointerInspector.viewport));
    } catch {
      throw new Error(
        inspectorGeometry(setup, "collection-membership-inspector", "membership.open-source"),
      );
    }
    await setup.mockMouse.click(pointerOpenSource.screenX + 1, pointerOpenSource.screenY);
    await setup.waitFor(() => {
      const target = setup.renderer.root.findDescendantById("source-details-pane");
      return !!target && target.height > 1;
    });
    const pointerSourcePane = setup.renderer.root.findDescendantById("source-details-pane")!;
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeFalsy();
    expect(setup.renderer.root.findDescendantById("source-metadata")).toBeTruthy();
    expectFocusInside(setup, "source-details-pane");
    expect(setup.captureCharFrame()).toContain("team-main");
    expect(setup.captureCharFrame()).toContain("https://github.com/acme/main");
    expect(setup.captureCharFrame()).toContain("Check updates");
    expect(pointerSourcePane.screenY).toBeGreaterThan(0);
    expect(pointerSourcePane.height).toBeGreaterThan(1);
    await parsedEscape(setup);
    stage = "return Collection Entries";
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    expect(setup.renderer.root.findDescendantById("membership.open-source")).toBeFalsy();
    expect(setup.renderer.root.findDescendantById("collection-membership-actions")).toBeTruthy();

    await clickRevealedControl(
      setup,
      "collection.inspector-back",
      "collection-membership-inspector",
    );
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    expect(setup.captureCharFrame()).toContain("[ Entries ]");
    const restoredEntries = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    expect(restoredEntries.getSelectedOption()?.value).toBe("review:0");
    const entries = setup.renderer.root.findDescendantById("collection-tabs-tab-entries")!;
    await setup.mockMouse.click(entries.screenX + 1, entries.screenY);
    await setup.waitFor(() => setup.captureCharFrame().includes("[ Entries ]"));
    await setup.mockMouse.click(
      setup.renderer.root.findDescendantById("collection-tabs-tab-relations")!.screenX + 1,
      setup.renderer.root.findDescendantById("collection-tabs-tab-relations")!.screenY,
    );
    await setup.waitFor(() => setup.captureCharFrame().includes("Reference docs"));
    const relationList = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    const reference = collectionRelationRows("team", collectionProjection()).find(
      (row) => row.intent?.kind === "collection-reference" && row.intent.name === "docs",
    )!;
    const referenceKey = collectionRelationKey(reference);
    expect(relationList.options.map((option) => option.value)).toContain(referenceKey);
    await setup.mockMouse.click(relationList.screenX + 2, relationList.screenY);
    await setup.waitFor(() => relationList.getSelectedOption()?.value === referenceKey);
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    expect(setup.captureCharFrame()).toContain("Reference docs");
    expect(setup.captureCharFrame()).toContain("Read team documentation");
    expect(setup.captureCharFrame()).toContain("Open owning Config");
    expect(setup.captureCharFrame()).not.toContain("Collection details");
    await clickRevealedControl(setup, "collection.inspector-back", "collection-relation-inspector");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    expect(setup.captureCharFrame()).toContain("[ Relations ]");
    const restoredRelations = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    expect(restoredRelations.getSelectedOption()?.value).toBe(referenceKey);
    const returnedPane = setup.renderer.root.findDescendantById("collection-detail-pane")!;
    const footer = setup.renderer.root.findDescendantById("command-status")!;
    expect(footer.screenY).toBeGreaterThanOrEqual(returnedPane.screenY + returnedPane.height);
    expect(setup.renderer.root.findDescendantById("remove-from-collection")).toBeFalsy();
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.root.findDescendantById("collection-browser") instanceof SelectRenderable,
    );
    const returnedBrowser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    expect(returnedBrowser.getSelectedOption()?.value).toBe("team");
  } catch (error) {
    throw journeyFailure(setup, stage, error);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  { width: 80, height: 16 },
  { width: 80, height: 17 },
  { width: 80, height: 18 },
  { width: 43, height: 30 },
  { width: 120, height: 40 },
])(
  "RENDER Collection detail preserves list geometry at $width x $height",
  async ({ width, height }) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      await openCollectionsSection(setup);
      await setup.waitFor(() => {
        const target = setup.renderer.root.findDescendantById("collection-browser");
        return target instanceof SelectRenderable;
      });
      const browser = setup.renderer.root.findDescendantById(
        "collection-browser",
      ) as SelectRenderable;
      await focusLive(setup, "collection-browser");
      await setup.mockMouse.click(browser.screenX + 2, browser.screenY);
      await setup.waitFor(() => browser.getSelectedOption()?.value === "team");
      await parsedEnter(setup);
      await setup.waitFor(() => {
        const target = setup.renderer.root.findDescendantById("collection-relationships");
        return target instanceof SelectRenderable;
      });
      const list = setup.renderer.root.findDescendantById(
        "collection-relationships",
      ) as SelectRenderable;
      const pane = setup.renderer.root.findDescendantById("collection-detail-pane")!;
      expect(list.height).toBeGreaterThanOrEqual(height > 16 ? 2 : 1);
      expect(list.showDescription).toBe(height > 16);
      expect(list.screenY + list.height).toBeLessThan(pane.screenY + pane.height);
      expect(setup.captureCharFrame()).toContain("review");
      expect(setup.renderer.root.findDescendantById("collection-actions-toggle")).toBeTruthy();
      await clickRevealedControl(setup, "collection-actions-toggle", "collection-detail-pane");
      await setup.waitFor(
        () =>
          !!setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
      );
      await clickRevealedControl(setup, "collection-actions-toggle", "collection-detail-pane");
      await setup.waitFor(
        () => !setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
      );
      await setup.mockMouse.click(list.screenX + 2, list.screenY);
      await setup.waitFor(() => list.getSelectedOption()?.value === "review:0");
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-membership-actions"),
      );
      expect(setup.renderer.root.findDescendantById("membership.open-skill")).toBeTruthy();
      expect(setup.renderer.root.findDescendantById("membership.open-source")).toBeFalsy();
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER empty Collection Entries reaches its exact owned Reference through View Relations", async () => {
  const projection = collectionProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const baseCollection = projection.effective.collectionsView[0]!;
  const emptyProjection = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [{ ...baseCollection, members: [] }],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection)} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  let stage = "mount";
  try {
    stage = "open Collections";
    await openCollectionsSection(setup);
    await setup.waitFor(() => {
      const target = setup.renderer.root.findDescendantById("collection-browser");
      return target instanceof SelectRenderable;
    });
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    await focusLive(setup, "collection-browser");
    await setup.mockMouse.click(browser.screenX + 2, browser.screenY);
    try {
      await setup.waitFor(() => browser.getSelectedOption()?.value === "team");
    } catch {
      throw new Error(
        [
          "Empty-Reference Collection row did not select team.",
          geometry(browser),
          `selected=${browser.getSelectedOption()?.value ?? "none"}`,
          `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}`,
          `frame:\n${setup.captureCharFrame()}`,
        ].join("\n"),
      );
    }
    stage = "open empty Collection Entries";
    await parsedEnter(setup);
    stage = "open View Relations";
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-open-relations"),
    );
    const viewRelations = setup.renderer.root.findDescendantById("collection-open-relations")!;
    await setup.mockMouse.click(viewRelations.screenX + 1, viewRelations.screenY);
    await setup.renderOnce();
    await setup.waitFor(() => setup.captureCharFrame().includes("[ Relations ]"));
    const relations = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    const reference = collectionRelationRows("team", emptyProjection).find(
      (row) => row.intent?.kind === "collection-reference" && row.intent.name === "docs",
    )!;
    const referenceKey = collectionRelationKey(reference);
    expect(relations.options.map((option) => option.value)).toEqual([referenceKey]);
    expect(relations.height).toBeGreaterThanOrEqual(1);
    expect(setup.captureCharFrame()).toContain("Reference docs");
    stage = "select Reference row";
    await focusLive(setup, "collection-relationships");
    await setup.mockMouse.click(relations.screenX + 2, relations.screenY);
    await setup.waitFor(() => relations.getSelectedOption()?.value === referenceKey);
    await focusLive(setup, "collection-relationships");
    expect(relations.getSelectedOption()?.value).toBe(referenceKey);
    await setup.renderOnce();
    stage = "open selected Reference";
    await parsedEnter(setup);
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
      );
    } catch {
      throw new Error(
        [
          `Reference ${referenceKey} did not open after pointer selection and Enter.`,
          geometry(relations),
          `selected=${relations.getSelectedOption()?.value ?? "none"}`,
          `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}`,
          `frame:\n${setup.captureCharFrame()}`,
        ].join("\n"),
      );
    }
    expect(setup.captureCharFrame()).toContain("Reference docs");
    expect(setup.captureCharFrame()).toContain("Read team documentation");
    expect(setup.renderer.root.findDescendantById("relationship.remove-reference")).toBeFalsy();
    stage = "open Reference Actions";
    await clickRevealedControl(
      setup,
      "collection-relation-actions",
      "collection-relation-inspector",
    );
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("relationship.remove-reference"),
    );
  } catch (error) {
    throw journeyFailure(setup, stage, error);
  } finally {
    setup.renderer.destroy();
  }
});
