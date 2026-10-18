/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { ButtonRenderable } from "@tuiparts/core/button";
import { ScrollBoxRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import {
  enterLive,
  expectSharedReturn,
  focusLive,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
const descendants = (target: BaseRenderable): BaseRenderable[] => [
  target,
  ...target.getChildren().flatMap(descendants),
];
// DataTable derives native IDs from the existing semantic row command ID.
const guideManageId = `collection-relationships-row-guide%3A0:action-${encodeURIComponent("collection.row.team.guide%3A0.manage")}`;
async function mount(width = 144, height = 40, projection = collectionsSourcesProjection()) {
  const previews: unknown[] = [];
  const core = directSourceCore(projection);
  const preview = core.previewMembershipBatch;
  core.previewMembershipBatch = async (
    _environment: import("@skill-cli/core").CoreOptions,
    request,
    options,
  ) => {
    previews.push(request);
    return preview(_environment, request, options);
  };
  core.addMember =
    core.removeMember =
    core.editMembers =
      async () => {
        throw new Error("Unconfirmed collection actions must not write configuration");
      };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width,
    height,
  });
  return {
    setup,
    previews,
    dispose: () => setup.renderer.destroy(),
  };
}
async function openContents(setup: Setup) {
  await enterLive(setup, "shell-section-tab-collections");
  await enterLive(setup, "collection-browser");
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
  );
}
async function openActions(setup: Setup) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  return setup.renderer.currentFocusedRenderable as SelectRenderable;
}
async function chooseAction(setup: Setup, id: string) {
  const choices = await openActions(setup);
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let row = 0; row < index; row++) setup.mockInput.pressArrow("down");
  await parsedEnter(setup);
}
test("Collection rows stay quiet while the current direct member exposes only its legal semantic actions in Actions", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await openContents(setup);
    const actions = setup.renderer.root.findDescendantById(
      "collection-relationships-row-guide%3A0:actions",
    );
    expect(actions).toBeDefined();
    expect(
      descendants(actions!)
        .filter((node) => node instanceof ButtonRenderable)
        .map((node) => node.id),
    ).toEqual([guideManageId]);
    const choices = await openActions(setup);
    expect(
      choices.options
        .filter((option) =>
          ["membership.open-skill", "membership.open-owner", "membership.remove"].includes(
            option.value.id,
          ),
        )
        .map((option) => option.value.id),
    ).toEqual(["membership.open-skill", "membership.open-owner", "membership.remove"]);
    await parsedEscape(setup);
    await focusLive(setup, "collection-relationships");
    await setup.mockInput.typeText(" ");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await chooseAction(setup, "membership.remove");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership-removal-plan"));
    await enterLive(setup, "membership-removal-plan-continue");
    await setup.waitFor(() => mounted.previews.length === 1);
    expect(mounted.previews[0]).toMatchObject({
      collection: "team",
      removals: [
        { name: "reference", expectedAddress: { source: "team-main", path: "reference" } },
      ],
    });
    await parsedEscape(setup);
    expect(setup.captureCharFrame()).toContain("1 origins checked");
  } finally {
    mounted.dispose();
  }
});
test("Collection inspector returns through the single shared header with the tab-derived parent label", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, guideManageId);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    const contentsBack = setup.renderer.root.findDescendantById("route-back");
    expect(contentsBack).toBeInstanceOf(ButtonRenderable);
    await expectSharedReturn(setup, "Back to Contents");
    expect(setup.renderer.root.findDescendantById("collection.inspector-back")).toBeUndefined();
    await enterLive(setup, "route-back");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    await enterLive(setup, "collection-tabs-tab-relations");
    await focusLive(setup, "collection-relationships");
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    const relationsBack = setup.renderer.root.findDescendantById("route-back");
    expect(relationsBack).toBeInstanceOf(ButtonRenderable);
    await expectSharedReturn(setup, "Back to Relations");
    expect(setup.renderer.root.findDescendantById("collection.inspector-back")).toBeUndefined();
  } finally {
    mounted.dispose();
  }
});
test("multi-origin current members require Manage before any origin-specific action", async () => {
  const projection = collectionsSourcesProjection();
  if (projection.effective.status !== "complete") throw new Error("Expected complete fixture");
  const effective = projection.effective;
  const mounted = await mount(144, 40, {
    ...projection,
    effective: {
      ...effective,
      collectionsView: effective.collectionsView.map((collection) => ({
        ...collection,
        members: collection.members.map((member) => ({
          ...member,
          paths: member.paths.flatMap((path) =>
            path.kind === "direct" && path.owner
              ? [
                  path,
                  {
                    ...path,
                    owner: {
                      ...path.owner,
                      level: "global" as const,
                      file: "/home/test/skill-cli.jsonc",
                    },
                  },
                ]
              : [path],
          ),
        })),
      })),
    },
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    const choices = await openActions(setup);
    const ids = choices.options.map((option) => option.value.id);
    expect(ids).toContain("membership.open-skill");
    expect(ids).not.toContain("membership.open-owner");
    expect(ids).not.toContain("membership.remove");
    expect(ids).toContain("collection.row.team.guide%3A0.manage");
    await parsedEscape(setup);
    await enterLive(setup, guideManageId);
    const origin = setup.renderer.root.findDescendantById("collection-membership-origin");
    expect(origin).toBeInstanceOf(SelectRenderable);
    expect((origin as SelectRenderable).options).toHaveLength(2);
    expect(mounted.previews).toHaveLength(0);
  } finally {
    mounted.dispose();
  }
});
test("Relations current Reference retains direct Open in Actions without changing Enter inspection", async () => {
  const mounted = await mount();
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, "collection-tabs-tab-relations");
    await focusLive(setup, "collection-relationships");
    const choices = await openActions(setup);
    expect(
      choices.options.find((option) => option.value.id === "relationship.open-collection")?.value,
    ).toMatchObject({ enabled: true, destination: "team / Reference docs · docs" });
    await parsedEscape(setup);
    await focusLive(setup, "collection-relationships");
    await parsedEnter(setup);
    expect(setup.renderer.root.findDescendantById("collection-relation-inspector")).toBeDefined();
    await enterLive(setup, "route-back");
    await chooseAction(setup, "relationship.open-collection");
    await setup.waitFor(() =>
      setup.captureCharFrame().includes("Add Skills or a Reference to this Collection."),
    );
    expect(setup.renderer.root.findDescendantById("collection-relation-inspector")).toBeUndefined();
  } finally {
    mounted.dispose();
  }
});
for (const [width, height] of [
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
] as const) {
  test(`Collection inspector has bounded native normal/danger rows and usable data at ${width}x${height}`, async () => {
    const mounted = await mount(width, height);
    const { setup } = mounted;
    try {
      await openContents(setup);
      const actions = setup.renderer.root.findDescendantById(
        "collection-relationships-row-guide%3A0:actions",
      )!;
      expect(descendants(actions).filter((node) => node instanceof ButtonRenderable)).toHaveLength(
        1,
      );
      await enterLive(setup, guideManageId);
      const pane = setup.renderer.root.findDescendantById("collection-detail-pane")!;
      const body = setup.renderer.root.findDescendantById(
        "collection-membership-inspector",
      ) as ScrollBoxRenderable;
      const normal = setup.renderer.root.findDescendantById("collection-inspector-normal-actions")!;
      const danger = setup.renderer.root.findDescendantById("collection-inspector-danger-actions")!;
      expect(body.viewport.height).toBeGreaterThanOrEqual(1);
      expect(normal.height).toBe(1);
      expect(danger.height).toBe(1);
      expect(danger.screenY).toBeGreaterThan(normal.screenY);
      for (const group of [normal, danger]) {
        for (const button of descendants(group).filter(
          (node) => node instanceof ButtonRenderable,
        )) {
          expect(button.screenX).toBeGreaterThan(pane.screenX);
          expect(button.screenX + button.width).toBeLessThanOrEqual(pane.screenX + pane.width - 1);
          expect(button.screenY).toBeGreaterThan(pane.screenY);
          expect(button.screenY + button.height).toBeLessThanOrEqual(
            pane.screenY + pane.height - 1,
          );
        }
      }
      expect(setup.renderer.root.findDescendantById("collection.inspector-back")).toBeUndefined();
      await enterLive(setup, "route-back");
      expect(
        setup.renderer.root.findDescendantById("collection-membership-inspector"),
      ).toBeUndefined();
    } finally {
      mounted.dispose();
    }
  });
}
