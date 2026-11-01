/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { enterLive, parsedEscape } from "./reader-test-controls";

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
      expect(setup.captureCharFrame()).toContain("Contents");
      await enterLive(setup, "collection-current-details");
      expect(setup.renderer.root.findDescendantById("collection-relationships") === table).toBe(
        true,
      );
      expect(!!setup.renderer.root.findDescendantById("membership.remove")).toBe(false);
      expect(!!setup.renderer.root.findDescendantById("membership.open-skill")).toBe(false);
      expect(setup.captureCharFrame()).not.toMatch(/[·•]/);
      await parsedEscape(setup);
      expect(!!setup.renderer.root.findDescendantById("collection-membership-inspector")).toBe(
        false,
      );
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
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
    await enterLive(setup, "collection-tabs-tab-settings");
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
