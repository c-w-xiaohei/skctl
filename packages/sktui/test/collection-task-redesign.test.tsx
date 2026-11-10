/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";

test("Collection view commands fit one row at 100 columns", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    for (const view of ["description", "settings", "members"]) {
      await enterLive(setup, `collection-tabs-tab-${view}`);
      await setup.flush();
      const row = setup.renderer.root.findDescendantById("collection-toolbar")!;
      expect(row.height).toBe(1);
      const more = setup.renderer.root.findDescendantById("collection-more")!;
      expect(more.screenX + more.width).toBeLessThanOrEqual(row.screenX + row.width);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection Details restores the selected member and scrolled list through shared Back", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Complete workspace required");
  const effective = base.effective;
  const team = base.effective.collectionsView[0]!;
  const member = team.members[0]!;
  const members = Array.from({ length: 40 }, (_, index) => ({ ...member, name: `entry-${index}` }));
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          effective: {
            ...effective,
            collectionsView: [{ ...team, members }, ...effective.collectionsView.slice(1)],
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await focusLive(setup, "collection-relationships");
    setup.mockInput.pressKey("HOME");
    for (let index = 0; index < 32; index++) setup.mockInput.pressArrow("down");
    await setup.flush();
    const body = setup.renderer.root.findDescendantById(
      "collection-relationships-body",
    ) as ScrollBoxRenderable;
    expect(body.scrollTop).toBeGreaterThan(0);
    const scroll = body.scrollTop;
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    const text = setup.renderer.root.findDescendantById("collection-inspector-object")!;
    expect(
      text
        .getChildren()
        .filter((node) => node instanceof TextRenderable)
        .map((node) => node.plainText)
        .join("\n"),
    ).toContain("team-main/guide");
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    const restored = setup.renderer.root.findDescendantById(
      "collection-relationships-body",
    ) as ScrollBoxRenderable;
    await setup.waitFor(() => restored.scrollTop === scroll);
    const selected = setup.renderer.root.findDescendantById(
      "collection-relationships-row-entry-32%3A0",
    )!;
    expect((selected.getChildren()[0]!.getChildren()[0] as TextRenderable).plainText).toBe("› ");
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    expect(!!setup.renderer.root.findDescendantById("collection-membership-inspector")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

for (const width of [120, 43]) {
  test(`Collection tasks stay direct and details only explain origins at ${width} columns`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
      { width, height: width === 43 ? 13 : 32 },
    );
    try {
      await openMainPage(setup, "collections");
      await enterLive(setup, "collection-browser");
      const table = setup.renderer.root.findDescendantById("collection-relationships")!;
      const tabs = setup.renderer.root.findDescendantById("collection-tabs-tab-members")!;
      const tabY = tabs.screenY;
      const tableY = table.screenY;
      expect(setup.captureCharFrame()).toContain("Contents");
      const actions = setup.renderer.root.findDescendantById("collection-toolbar")!;
      expect(actions.height).toBe(1);
      expect(actions.screenY + actions.height).toBeLessThanOrEqual(tabY);
      await focusLive(setup, "collection-relationships");
      await setup.mockInput.typeText(" ");
      await setup.flush();
      const batch = setup.renderer.root.findDescendantById("collection-batch-pane")!;
      expect(batch.screenY).toBeGreaterThan(table.screenY);
      expect(batch.screenY + batch.height).toBeLessThanOrEqual(setup.renderer.height - 1);
      await setup.mockInput.typeText(" ");
      await setup.flush();
      await enterLive(setup, "collection-more");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-current-details",
      );
      await enterLive(setup, "collection-current-details");
      expect(!!setup.renderer.root.findDescendantById("collection-relationships")).toBe(false);
      const details = setup.renderer.root.findDescendantById("collection-inspector-surface")!;
      expect(details.parent?.id).toBe("collection-detail-pane");
      expect(details.screenY).toBe(tableY);
      expect(setup.renderer.root.findDescendantById("collection-tabs-tab-members")?.screenY).toBe(
        tabY,
      );
      expect(details.height).toBeGreaterThanOrEqual(width === 43 ? 6 : 12);
      expect(!!setup.renderer.root.findDescendantById("membership.remove")).toBe(false);
      expect(!!setup.renderer.root.findDescendantById("membership.open-skill")).toBe(false);
      expect(setup.captureCharFrame()).not.toMatch(/[·•]/);
      await parsedEscape(setup);
      expect(!!setup.renderer.root.findDescendantById("collection-membership-inspector")).toBe(
        false,
      );
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
      if (width === 120) {
        await enterLive(setup, "collection-more");
        await enterLive(setup, "collection-current-details");
        await enterLive(setup, "breadcrumb-1");
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
        );
        expect(
          setup.renderer.root.findDescendantById("collection-membership-inspector"),
        ).toBeUndefined();
      }
      await enterLive(setup, "collection-add");
      for (const id of ["add-membership", "add-reference", "add-link", "import-collection"]) {
        const command = setup.renderer.root.findDescendantById(`collection-action-${id}`)!;
        expect(command.screenX + command.width).toBeLessThanOrEqual(width);
        expect(command.screenY + command.height).toBeLessThanOrEqual(width === 43 ? 13 : 32);
      }
      await parsedEscape(setup);
      await setup.flush();
      expect(!!setup.renderer.root.findDescendantById("collection-action-add-membership")).toBe(
        false,
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("Settings exposes included Collections and catalog locations without a generic inspector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await focusLive(setup, "collection-relationships");
    setup.mockInput.pressKey("END");
    await setup.flush();
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    expect(!!setup.renderer.root.findDescendantById("collection-relation-inspector")).toBe(true);
    await enterLive(setup, "collection-tabs-tab-settings");
    expect(!!setup.renderer.root.findDescendantById("collection-inspector-surface")).toBe(false);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Included Collections");
    expect(frame).toContain("Agent catalog entry");
    expect(frame).toContain("Configuration locations");
    expect(frame).not.toContain("Relationships");
    expect(frame).not.toContain("Inspect…");
  } finally {
    setup.renderer.destroy();
  }
});

test("Browsing another Collection does not display or hide content using the previous member's Details", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 32 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    await focusLive(setup, "collection-browser");
    setup.mockInput.pressKey("HOME");
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("collection-inspector-surface")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("collection-relationships")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test("multi-location removal previews only the chosen location and keeps the others", async () => {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Complete workspace required");
  const team = base.effective.collectionsView[0]!;
  const globalOwner = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/collections/team",
  };
  const workspace = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...team,
          declared: [...team.declared, globalOwner],
          members: team.members.map((member, index) =>
            index
              ? member
              : {
                  ...member,
                  paths: [
                    ...member.paths,
                    {
                      kind: "direct" as const,
                      collection: "team",
                      entryName: member.name,
                      owner: {
                        ...globalOwner,
                        pointer: `/collections/team/members/${member.name}`,
                      },
                    },
                  ],
                },
          ),
        },
        ...base.effective.collectionsView.slice(1),
      ],
    },
  };
  const requests: import("@skctl/core").MemberEditRequest[] = [];
  const writes: import("@skctl/core").ReviewedMemberEditRequest[] = [];
  const core = directSourceCore(workspace);
  core.previewMembershipBatch = async (_environment, request) => {
    requests.push(request);
    return {
      value: {
        kind: "membership-batch",
        collection: request.collection,
        decision: { kind: "direct", owner: request.expectedOwner! },
        additions: [],
        removals: request.removals,
        affected: [],
        blockers: [],
        allowed: true,
        effectful: true,
      },
      diagnostics: [],
    };
  };
  core.editMembers = async (_environment, request) => {
    writes.push(request);
    return {
      value: { level: request.level, file: request.expectedOwner!.file, changed: true },
      diagnostics: [],
    };
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 100,
    height: 24,
  });
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-membership.remove");
    expect(requests).toHaveLength(0);
    expect(!!setup.renderer.root.findDescendantById("collection-review-confirm")).toBe(false);
    await enterLive(setup, "membership-removal-owner-1");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-review-confirm"),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      level: "global",
      expectedOwner: globalOwner,
      removals: [{ name: "guide", expectedAddress: { source: "team-main", path: "guide" } }],
    });
    expect(writes).toHaveLength(0);
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => writes.length === 1);
    expect(writes[0]).toMatchObject({ level: "global", collection: "team" });
  } finally {
    setup.renderer.destroy();
  }
});
