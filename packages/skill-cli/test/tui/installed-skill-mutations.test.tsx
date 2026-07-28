import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  InstalledSkillPreviewFailureOverlay,
  InstalledSkillReviewOverlay,
} from "../../src/tui/operations";
import type { InstalledSkillReview } from "../../src/tui/effects";
import type { ConfigDeclarationOwner } from "../../src/core/api";

const address = { source: "team-main", path: "guide" };
const owner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/engineering/members/guide",
};

test("Installed Skill reviews expose proof truth and every blocking Membership owner", async () => {
  let resolved: ConfigDeclarationOwner | undefined;
  const blocked: InstalledSkillReview = {
    kind: "uninstall",
    id: "blocked",
    address,
    impact: {
      kind: "uninstall",
      installed: [address],
      directMemberships: [owner],
      disappearingSelectors: [{ selector: "engineering:guide", address, paths: [] }],
      retainedSelectors: [],
      blockers: [{ reason: "membership", owner }],
      allowed: false,
    },
  };
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={blocked}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        onResolveMembership={(value) => {
          resolved = value;
        }}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Direct Membership: project (/collections/engineering/members/guide)");
    expect(frame).toContain("Disappears: engineering:guide");
    expect(frame).toContain("Operation is blocked by current dependencies.");
    setup.mockInput.pressEnter();
    expect(resolved).toEqual(owner);
  } finally {
    setup.renderer.destroy();
  }
});

test("Rebind review renders exact old and new address with disabled unprovable truth", async () => {
  const review: InstalledSkillReview = {
    kind: "rebind",
    id: "unprovable",
    address,
    owner: "replacement",
    ownerPath: "alternate/guide",
    impact: {
      kind: "rebind",
      address,
      owner: "replacement",
      ownerPath: "alternate/guide",
      proof: "unprovable",
      allowed: false,
    },
  };
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={review}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        onResolveMembership={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Installed Skill: team-main/guide");
    expect(frame).toContain("New owner: replacement");
    expect(frame).toContain("New path: alternate/guide");
    expect(frame).toContain("Identity proof: unprovable");
    expect(frame).toContain("Operation is blocked by current dependencies.");
  } finally {
    setup.renderer.destroy();
  }
});

test("Rebind preview failure stays mounted and native Retry preserves its exact structural request", async () => {
  let retries = 0;
  let cancelled = 0;
  const setup = await testRender(
    () => (
      <InstalledSkillPreviewFailureOverlay
        request={{ kind: "rebind", address, owner: "replacement", ownerPath: "alternate/guide" }}
        error={{ code: "PROVIDER_UNAVAILABLE", message: "Replacement source is offline" }}
        pending={false}
        cancelling={false}
        onRetry={() => {
          retries++;
        }}
        onCancel={() => {
          cancelled++;
        }}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Rebind Skill preview failed");
    expect(frame).toContain("Installed Skill: team-main/guide");
    expect(frame).toContain("Replacement: replacement/alternate/guide");
    expect(frame).toContain("PROVIDER_UNAVAILABLE: Replacement source is offline");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(retries).toBe(1);
    expect(cancelled).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
