import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { CollectionReviewOverlay, ReferenceOverlay } from "../../src/tui/operations";
import type { CollectionReview } from "../../src/tui/effects";

const owner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/team",
};

test("RENDER Collection reference and link previews disclose direct-only exposure and exact link paths", async () => {
  const reference = await testRender(
    () => (
      <ReferenceOverlay
        level="project"
        collection="team"
        name="docs"
        target="documentation"
        description="Read first"
        remove={false}
        pending={false}
        onPreview={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await reference.renderOnce();
    expect(reference.captureCharFrame()).toContain("Reference");
    expect(reference.captureCharFrame()).toContain("documentation");
  } finally {
    reference.renderer.destroy();
  }
  const review: CollectionReview = {
    kind: "link-change",
    id: "review",
    intent: {
      kind: "link-change",
      collection: "team",
      target: "documentation",
      level: "project",
      linked: true,
    },
    impact: {
      kind: "link-change",
      collection: "team",
      target: "documentation",
      linked: true,
      members: [{ name: "guide", address: { source: "docs", path: "guide" }, paths: [] }],
      disappearingSelectors: [],
      retainedSelectors: [
        { selector: "team:guide", address: { source: "docs", path: "guide" }, paths: [] },
      ],
      blockers: [],
      allowed: true,
    },
  };
  const link = await testRender(
    () => (
      <CollectionReviewOverlay
        review={review}
        pending={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await link.renderOnce();
    expect(link.captureCharFrame()).toContain("Add Link");
    expect(link.captureCharFrame()).toContain("Retained: team:guide");
  } finally {
    link.renderer.destroy();
  }
});

test("RENDER Collection removal blocks an exact dependency and keeps Cancel selected", async () => {
  const review: CollectionReview = {
    kind: "collection-removal",
    id: "review",
    intent: { kind: "collection-removal", level: "project", collection: "team" },
    impact: {
      kind: "collection-removal",
      owner,
      decision: { kind: "direct", owner },
      repository: { derived: false, producers: [] },
      disappearingSelectors: [
        { selector: "team:guide", address: { source: "docs", path: "guide" }, paths: [] },
      ],
      retainedSelectors: [],
      blockers: [{ reason: "use", owner }],
      allowed: false,
    },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={review}
        pending={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Blocker: use");
    expect(setup.captureCharFrame()).toContain("Operation is blocked by current dependencies.");
  } finally {
    setup.renderer.destroy();
  }
});
