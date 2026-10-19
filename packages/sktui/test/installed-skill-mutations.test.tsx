import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  InstalledSkillPreviewFailureOverlay,
  InstalledSkillReviewOverlay,
} from "../src/operations";
import type { InstalledSkillReview } from "../src/effects";
import type { ConfigDeclarationOwner } from "@skctl/core";

const address = { source: "team-main", path: "guide" };
const owner = {
  level: "project" as const,
  file: "/workspace/skctl/skctl.jsonc",
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
    setup.renderer.root.findDescendantById("installed-skill-review-resolve-0")?.focus();
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

test("Installed Skill danger review focuses Cancel and requires explicit focus before confirmation", async () => {
  let cancelled = 0;
  let confirmed = 0;
  const review: InstalledSkillReview = {
    kind: "uninstall",
    id: "allowed",
    address,
    impact: {
      kind: "uninstall",
      installed: [address],
      directMemberships: [],
      disappearingSelectors: [],
      retainedSelectors: [],
      blockers: [],
      allowed: true,
    },
  };
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={review}
        pending={false}
        onCancel={() => cancelled++}
        onConfirm={() => confirmed++}
        onResolveMembership={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-review-cancel",
    );
    setup.mockInput.pressEnter();
    expect(cancelled).toBe(1);
    expect(confirmed).toBe(0);
    setup.renderer.root.findDescendantById("installed-skill-review-confirm")?.focus();
    setup.mockInput.pressEnter();
    expect(confirmed).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("Rebind preview failure reaches Retry by Tab and preserves its exact structural request", async () => {
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
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "installed-skill-preview-failure-cancel",
    );
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "installed-skill-preview-failure-retry",
    );
    setup.mockInput.pressEnter();
    expect(retries).toBe(1);
    expect(cancelled).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
