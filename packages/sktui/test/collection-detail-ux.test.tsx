import { expect, test } from "bun:test";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type BaseRenderable,
  type Renderable,
} from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { testRender } from "@opentui/solid";
import type { CollectionView } from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import {
  enterLive,
  focusLive,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

const owner = {
  level: "project" as const,
  file: "/workspace/skctl/skctl.jsonc",
  pointer: "/collections/team",
};
const memberKey = "review:0";
const rowId = (key: string) => `collection-relationships-row-${encodeURIComponent(key)}`;
type Setup = Awaited<ReturnType<typeof testRender>>;
function collectionProjection(): ReturnType<typeof workspaceProjection> {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: { ...config.direct, collections: [{ id: "team", owner }] },
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
        owner: { source: "team-main", health: "healthy" },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
    ],
  };
}
const descendants = (node: BaseRenderable): BaseRenderable[] => [
  node,
  ...node.getChildren().flatMap(descendants),
];
function assertInside(child: Renderable, parent: Renderable) {
  expect(child.screenY).toBeGreaterThanOrEqual(parent.screenY);
  expect(child.screenY + child.height).toBeLessThanOrEqual(parent.screenY + parent.height);
  expect(child.screenX).toBeGreaterThanOrEqual(parent.screenX);
  expect(child.screenX + child.width).toBeLessThanOrEqual(parent.screenX + parent.width);
}
async function openContents(setup: Setup) {
  await openMainPage(setup, "collections");
  await enterLive(setup, "collection-browser");
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("collection-current-actions-pane"),
  );
  const table = await focusLive(setup, "collection-relationships");
  await setup.flush();
  return table;
}
async function clickControl(setup: Setup, id: string, paneId: string) {
  await focusLive(setup, id);
  await setup.flush();
  const target = setup.renderer.root.findDescendantById(id)!;
  const pane = setup.renderer.root.findDescendantById(paneId)!;
  assertInside(target, pane);
  const footer = setup.renderer.root.findDescendantById("command-status")!;
  expect(target.screenY + target.height).toBeLessThanOrEqual(footer.screenY);
  await setup.mockMouse.click(target.screenX + 1, target.screenY);
  await setup.flush();
}
function expectTab(setup: Setup, tab: "members" | "settings") {
  const trigger = setup.renderer.root.findDescendantById(`collection-tabs-tab-${tab}`);
  expect(trigger).toBeInstanceOf(TabsTabRenderable);
  expect((trigger as TabsTabRenderable).getState().selected).toBe(true);
}
async function manageCurrent(setup: Setup) {
  await enterLive(setup, "collection-more");
  await enterLive(setup, "collection-current-details");
}

test("RENDER 80x16 Collection Contents reads directly, Manage opens ownership, and Source Back restores its row", async () => {
  const reads: unknown[] = [],
    mutations: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(collectionProjection(), {
          loadInstalledSkill: async (_environment, { address }) => {
            reads.push(address);
            return {
              address,
              name: "review",
              description: "Review changes",
              rawText: "Installed review body",
              markdownText: "Installed review body",
            };
          },
          updateSkills: async () => {
            mutations.push("update");
            return { value: undefined, diagnostics: [] };
          },
          removeSource: async () => {
            mutations.push("remove");
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 16 },
  );
  try {
    const table = await openContents(setup);
    expect(table).toBeInstanceOf(BoxRenderable);
    expectTab(setup, "members");
    expect(setup.renderer.root.findDescendantById("collection-actions-toggle")).toBeUndefined();
    // Row Enter is Read, never the removed membership-management step.
    await parsedEnter(setup);
    await waitForReaderBody(setup, "Installed review body");
    expect(reads).toEqual([{ source: "team-main", path: "review" }]);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(rowId(memberKey)));
    await manageCurrent(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    const body = setup.renderer.root.findDescendantById("collection-membership-inspector")!;
    expect(
      descendants(body)
        .filter((node) => node instanceof TextRenderable)
        .map((node) => (node as TextRenderable).plainText)
        .join(" "),
    ).toContain("team-main/review");
    expect(setup.renderer.root.findDescendantById("collection-membership-actions")).toBeUndefined();
    for (const pointer of [false, true]) {
      if (pointer)
        await clickControl(setup, "membership.open-source", "collection-inspector-surface");
      else await enterLive(setup, "membership.open-source");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
      expect(setup.captureCharFrame()).toContain("team-main");
      if (!setup.renderer.root.findDescendantById("source-metadata"))
        await enterLive(setup, "source-view-tab-settings");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
      await setup.waitForFrame((frame) => frame.includes("https://github.com/acme/main"));
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
      );
      expect(setup.renderer.root.findDescendantById("membership.open-source")).toBeDefined();
    }
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(rowId(memberKey)));
    expectTab(setup, "members");
    await focusLive(setup, "collection-relationships");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await manageCurrent(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    expect(setup.captureCharFrame()).toContain("Read team documentation");
    await parsedEscape(setup);
    expectTab(setup, "members");
    expect(reads).toHaveLength(1);
    expect(mutations).toEqual([]);
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
  "RENDER Collection detail preserves table and Manage geometry at $width x $height",
  async ({ width, height }) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      const table = await openContents(setup);
      const pane = setup.renderer.root.findDescendantById("collection-detail-pane")!;
      const body = setup.renderer.root.findDescendantById("collection-relationships-body");
      expect(body).toBeInstanceOf(ScrollBoxRenderable);
      expect(body!.height).toBeGreaterThanOrEqual(1);
      assertInside(table, pane);
      const actions = setup.renderer.root.findDescendantById("collection-current-actions-pane")!;
      expect(actions).toBeDefined();
      assertInside(actions, pane);
      expect(setup.captureCharFrame()).toContain("review");
      await manageCurrent(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership.open-source"));
      for (const id of ["membership.open-source"]) {
        const control = await focusLive(setup, id);
        await setup.flush();
        assertInside(
          control,
          setup.renderer.root.findDescendantById("collection-inspector-surface")!,
        );
        expect(control.screenY + control.height).toBeLessThanOrEqual(height - 1);
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Reference-only Contents preserves the exact owner through Relations Manage", async () => {
  const projection = collectionProjection();
  if (projection.effective.status !== "complete") throw new Error("Expected complete fixture");
  const referenceOnly = {
    ...projection,
    effective: {
      ...projection.effective,
      collectionsView: [{ ...projection.effective.collectionsView[0]!, members: [] }],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(referenceOnly)} exit={() => {}} />,
    { width: 80, height: 16 },
  );
  try {
    await openContents(setup);
    // References are real Contents now, not an empty Entries fallback button.
    expect(setup.renderer.root.findDescendantById("collection-open-relations")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("docs");
    await manageCurrent(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    expect(setup.captureCharFrame()).toContain("Read team documentation");
    const body = setup.renderer.root.findDescendantById("collection-relation-inspector")!;
    const ownership = descendants(body)
      .filter((node): node is TextRenderable => node instanceof TextRenderable)
      .map((node) => node.plainText)
      .join(" ");
    expect(ownership).toContain("/collections/team");
    // Legal relationship commands are direct native controls, without another Actions disclosure.
    expect(!!setup.renderer.root.findDescendantById("relationship.remove-reference")).toBe(false);
    expect(setup.renderer.root.findDescendantById("collection-relation-actions")).toBeUndefined();
    await parsedEscape(setup);
    expectTab(setup, "members");
  } finally {
    setup.renderer.destroy();
  }
});
