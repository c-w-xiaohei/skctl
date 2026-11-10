import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable, type BaseRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { InstalledSkillReviewOverlay } from "../src/operations/installed-review";
import { CollectionReviewOverlay } from "../src/operations/collection-review";
import type { CollectionReview, InstalledSkillReview } from "../src/session";
import { directOwner } from "./direct-source.fixture";
import { enterLive } from "./reader-test-controls";

const address = { source: "old", path: "guide" };
const after = { source: "new", path: "guide" };
const rebind: InstalledSkillReview = {
  kind: "rebind",
  id: "r",
  address,
  owner: "new",
  ownerPath: "guide",
  impact: {
    kind: "rebind",
    address,
    owner: "new",
    ownerPath: "guide",
    proof: "proven",
    scope: "captured-workspace",
    limitation: "External projects excluded",
    baseline: "opaque",
    directMemberships: [
      { collection: "team", name: "guide", owner: directOwner, before: address, after },
    ],
    blockers: [{ reason: "immutable", owner: directOwner }],
    allowed: false,
  },
};
const rename: CollectionReview = {
  kind: "collection-rename",
  id: "c",
  intent: { kind: "collection-rename", collection: "team", target: "next" },
  impact: {
    kind: "collection-rename",
    collection: "team",
    target: "next",
    scope: "captured-workspace",
    limitation: "External projects excluded",
    baseline: "opaque",
    declarations: [directOwner],
    references: [{ kind: "use", owner: directOwner }],
    addresses: [{ before: "team:guide", after: "next:guide" }],
    blockers: [{ reason: "collision", owner: directOwner }],
    allowed: false,
  },
};

test("rebind review renders membership repair, owner, blocker and limitation", async () => {
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={rebind}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        onResolveMembership={() => {}}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("team:guide: old/guide -> new/guide");
    expect(frame).toContain(directOwner.pointer);
    expect(frame).toContain("Blocker: immutable");
    expect(frame).toContain("External projects excluded");
    expect(
      setup.renderer.root.findDescendantById("installed-skill-review-confirm"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("rename review renders changed addresses, declarations, references and blockers", async () => {
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={rename}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("team:guide -> next:guide");
    expect(frame).toContain("Declaration: project:");
    expect(frame).toContain("use: project:");
    expect(frame).toContain("Blocker: collision");
    expect(frame).toContain("External projects excluded");
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("stale rebind review offers explicit preview instead of retry", async () => {
  let previews = 0;
  const allowed: InstalledSkillReview = {
    ...rebind,
    impact: { ...rebind.impact, blockers: [], allowed: true },
  };
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={allowed}
        pending={false}
        error={{ code: "CONFIG_CONFLICT", message: "stale" }}
        onCancel={() => {}}
        onConfirm={() => {}}
        onResolveMembership={() => {}}
        onPreviewAgain={() => previews++}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(
      setup.renderer.root.findDescendantById("installed-skill-review-confirm"),
    ).toBeUndefined();
    setup.renderer.root.findDescendantById("installed-skill-preview-again")?.focus();
    setup.mockInput.pressEnter();
    expect(previews).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("stale rename review offers explicit preview instead of retry", async () => {
  let previews = 0;
  const allowed: CollectionReview = {
    ...rename,
    impact: { ...rename.impact, blockers: [], allowed: true },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={allowed}
        pending={false}
        error={{ code: "CONFIG_CONFLICT", message: "stale" }}
        onCancel={() => {}}
        onConfirm={() => {}}
        onPreviewAgain={() => previews++}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
    setup.renderer.root.findDescendantById("collection-review-preview-again")?.focus();
    setup.mockInput.pressEnter();
    expect(previews).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("mounted rebind review follows replacement impact and disables confirmation", async () => {
  const original: InstalledSkillReview = {
    ...rebind,
    impact: { ...rebind.impact, blockers: [], allowed: true },
  };
  const nextOwner = { ...directOwner, pointer: "/collections/other/members/item" };
  const next: InstalledSkillReview = {
    ...rebind,
    id: "next",
    address: { source: "second", path: "root" },
    owner: "third",
    ownerPath: "next",
    impact: {
      ...rebind.impact,
      address: { source: "second", path: "root" },
      owner: "third",
      ownerPath: "next",
      directMemberships: [
        {
          collection: "other",
          name: "item",
          owner: nextOwner,
          before: { source: "second", path: "root" },
          after: { source: "third", path: "next" },
        },
      ],
      blockers: [{ reason: "collision", owner: nextOwner }],
      allowed: false,
    },
  };
  const [review, setReview] = createSignal<InstalledSkillReview>(original);
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={review()}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
        onResolveMembership={() => {}}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("installed-skill-review-confirm")).toBeDefined();
    setReview(next);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("other:item: second/root -> third/next");
    expect(frame).toContain(nextOwner.pointer);
    expect(frame).toContain("Blocker: collision");
    expect(frame).not.toContain("team:guide: old/guide -> new/guide");
    expect(
      setup.renderer.root.findDescendantById("installed-skill-review-confirm"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("mounted rename review follows replacement impact and disables confirmation", async () => {
  const original: CollectionReview = {
    ...rename,
    impact: { ...rename.impact, blockers: [], allowed: true },
  };
  const nextOwner = { ...directOwner, pointer: "/collections/other" };
  const next: CollectionReview = {
    kind: "collection-rename",
    id: "next",
    intent: { kind: "collection-rename", collection: "other", target: "latest" },
    impact: {
      ...rename.impact,
      collection: "other",
      target: "latest",
      declarations: [nextOwner],
      references: [{ kind: "link", owner: nextOwner }],
      addresses: [{ before: "other:item", after: "latest:item" }],
      blockers: [{ reason: "immutable", owner: nextOwner }],
      allowed: false,
    },
  };
  const [review, setReview] = createSignal<CollectionReview>(original);
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={review()}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeDefined();
    setReview(next);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("other:item -> latest:item");
    expect(frame).toContain(nextOwner.pointer);
    expect(frame).toContain("link: project:");
    expect(frame).toContain("Blocker: immutable");
    expect(frame).not.toContain("team:guide -> next:guide");
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("pending rename describes stopping without promising rollback", async () => {
  const allowed: CollectionReview = {
    ...rename,
    impact: { ...rename.impact, blockers: [], allowed: true },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={allowed}
        pending={true}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    ),
    { width: 160, height: 40 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Stop");
    expect(frame).toContain("may already have been applied");
    expect(frame).not.toContain("Keep current configuration");
  } finally {
    setup.renderer.destroy();
  }
});

function findScrollbox(node: BaseRenderable): ScrollBoxRenderable | undefined {
  if (node instanceof ScrollBoxRenderable) return node;
  for (const child of node.getChildren()) {
    const found = findScrollbox(child);
    if (found) return found;
  }
  return undefined;
}

for (const kind of ["rebind", "rename"] as const) {
  for (const state of ["ready", "blocked", "pending", "stale"] as const) {
    test(`${kind} ${state} keeps review and recovery controls bounded across sizes`, async () => {
      const calls: string[] = [];
      const common = {
        pending: state === "pending",
        error:
          state === "stale"
            ? { code: "CONFIG_CONFLICT", message: "Review the current configuration again" }
            : undefined,
        onCancel: () => calls.push("cancel"),
        onConfirm: () => calls.push("confirm"),
        onPreviewAgain: () => calls.push("preview"),
      };
      const setup = await testRender(
        () =>
          kind === "rebind" ? (
            <InstalledSkillReviewOverlay
              {...common}
              review={{ ...rebind, impact: { ...rebind.impact, allowed: state !== "blocked" } }}
              onResolveMembership={() => {}}
            />
          ) : (
            <CollectionReviewOverlay
              {...common}
              review={{ ...rename, impact: { ...rename.impact, allowed: state !== "blocked" } }}
              onBack={() => calls.push("back")}
            />
          ),
        { width: 120, height: 30 },
      );
      try {
        await setup.flush();
        const body = findScrollbox(setup.renderer.root)!;
        const cancelId =
          kind === "rebind" ? "installed-skill-review-cancel" : "collection-review-choice";
        const confirmId =
          kind === "rebind" ? "installed-skill-review-confirm" : "collection-review-confirm";
        const retryId =
          kind === "rebind" ? "installed-skill-preview-again" : "collection-review-preview-again";
        for (const [width, height] of [
          [120, 30],
          [100, 24],
          [80, 23],
          [43, 13],
        ] as const) {
          setup.resize(width, height);
          await setup.flush();
          expect(body.viewport.height).toBeGreaterThanOrEqual(6);
          expect(!!setup.renderer.root.findDescendantById(confirmId)).toBe(state === "ready");
          for (const id of [
            cancelId,
            ...(state === "stale" ? [retryId] : []),
            ...(state === "ready" ? [confirmId] : []),
          ]) {
            const control = setup.renderer.root.findDescendantById(id)!;
            expect(!!body.findDescendantById(id)).toBe(false);
            expect(control.screenX + control.width).toBeLessThanOrEqual(width - 1);
            expect(control.screenY + control.height).toBeLessThanOrEqual(height - 1);
          }
        }
        if (state === "ready") await enterLive(setup, confirmId);
        if (state === "stale") await enterLive(setup, retryId);
        await enterLive(setup, cancelId);
        expect(calls).toEqual(
          state === "ready"
            ? ["confirm", "cancel"]
            : state === "stale"
              ? ["preview", "cancel"]
              : ["cancel"],
        );
      } finally {
        setup.renderer.destroy();
      }
    });
  }
}

test("compact rebind review keeps identity and actions visible while impact scrolls", async () => {
  let confirmed = 0;
  const longReview: InstalledSkillReview = {
    ...rebind,
    impact: {
      ...rebind.impact,
      allowed: true,
      blockers: [],
      directMemberships: Array.from({ length: 12 }, (_, index) => ({
        collection: `team${index}`,
        name: "guide",
        owner: directOwner,
        before: address,
        after,
      })),
    },
  };
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={longReview}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => confirmed++}
        onResolveMembership={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    const scroll = findScrollbox(setup.renderer.root);
    expect(scroll).toBeDefined();
    expect(scroll!.viewport.height).toBeGreaterThan(0);
    scroll!.scrollBy(100);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Rebind Skill");
    expect(frame).toContain("old/guide");
    const cancel = setup.renderer.root.findDescendantById("installed-skill-review-cancel");
    const confirm = setup.renderer.root.findDescendantById("installed-skill-review-confirm");
    expect(cancel).toBeDefined();
    expect(confirm).toBeDefined();
    for (const control of [cancel!, confirm!]) {
      expect(control.screenY).toBeGreaterThanOrEqual(0);
      expect(control.screenY + control.height).toBeLessThanOrEqual(13);
      expect(control.screenY).toBeGreaterThanOrEqual(
        scroll!.viewport.screenY + scroll!.viewport.height,
      );
    }
    confirm!.focus();
    setup.mockInput.pressEnter();
    expect(confirmed).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("long installed address remains readable without consuming the compact review body", async () => {
  const address = {
    source: "team/" + "来源".repeat(30),
    path: "skills/" + "directory/".repeat(16) + "guide",
  };
  const review: InstalledSkillReview = {
    ...rebind,
    address,
    impact: { ...rebind.impact, address, allowed: true, blockers: [] },
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
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const scroll = findScrollbox(setup.renderer.root)!;
    expect(scroll.viewport.height).toBeGreaterThanOrEqual(6);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.viewport.height);
    const target = setup.renderer.root.findDescendantById("installed-review-target");
    expect(!!target).toBe(true);
    expect(target!.parent === scroll.content).toBe(true);
    const confirm = setup.renderer.root.findDescendantById("installed-skill-review-confirm")!;
    expect(confirm.screenY + confirm.height).toBeLessThanOrEqual(12);
  } finally {
    setup.renderer.destroy();
  }
});

test("long Collection rename targets keep the compact review body and cancel visible", async () => {
  const collection = "team/" + "collection/".repeat(18);
  const target = "next/" + "目录/".repeat(25);
  const review: CollectionReview = {
    ...rename,
    intent: { ...rename.intent, collection, target },
    impact: { ...rename.impact, collection, target, allowed: true, blockers: [] },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={review}
        pending={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const scroll = findScrollbox(setup.renderer.root)!;
    expect(scroll.viewport.height).toBeGreaterThanOrEqual(6);
    expect(!!scroll.findDescendantById("collection-review-target")).toBe(true);
    const cancel = setup.renderer.root.findDescendantById("collection-review-choice")!;
    expect(cancel.screenY + cancel.height).toBeLessThanOrEqual(12);
  } finally {
    setup.renderer.destroy();
  }
});

test("compact rename review keeps target and preview-again action visible while impact scrolls", async () => {
  let previews = 0;
  const longReview: CollectionReview = {
    ...rename,
    impact: {
      ...rename.impact,
      allowed: true,
      blockers: [],
      addresses: Array.from({ length: 12 }, (_, index) => ({
        before: `team:item${index}`,
        after: `next:item${index}`,
      })),
    },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={longReview}
        pending={false}
        error={{ code: "CONFIG_CONFLICT", message: "stale" }}
        onCancel={() => {}}
        onConfirm={() => {}}
        onPreviewAgain={() => previews++}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    const scroll = findScrollbox(setup.renderer.root);
    expect(scroll).toBeDefined();
    expect(scroll!.viewport.height).toBeGreaterThan(0);
    scroll!.scrollBy(100);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Rename Collection");
    expect(frame).toContain("team -> next");
    const cancel = setup.renderer.root.findDescendantById("collection-review-choice");
    const preview = setup.renderer.root.findDescendantById("collection-review-preview-again");
    for (const control of [cancel, preview]) {
      expect(control).toBeDefined();
      expect(control!.screenY).toBeGreaterThanOrEqual(
        scroll!.viewport.screenY + scroll!.viewport.height,
      );
      expect(control!.screenY + control!.height).toBeLessThanOrEqual(13);
    }
    preview!.focus();
    setup.mockInput.pressEnter();
    expect(previews).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("compact pending rebind exposes reachable Stop with long impact", async () => {
  let stopped = 0;
  const longReview: InstalledSkillReview = {
    ...rebind,
    impact: {
      ...rebind.impact,
      allowed: true,
      blockers: [],
      directMemberships: Array.from({ length: 12 }, (_, index) => ({
        collection: `team${index}`,
        name: "guide",
        owner: directOwner,
        before: address,
        after,
      })),
    },
  };
  const setup = await testRender(
    () => (
      <InstalledSkillReviewOverlay
        review={longReview}
        pending={true}
        onCancel={() => stopped++}
        onConfirm={() => {}}
        onResolveMembership={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    const scroll = findScrollbox(setup.renderer.root)!;
    scroll.scrollBy(100);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Rebind Skill");
    expect(frame).toContain("old/guide");
    expect(frame).toContain("Stop");
    const stop = setup.renderer.root.findDescendantById("installed-skill-review-cancel");
    expect(stop).toBeDefined();
    expect(stop!.screenY).toBeGreaterThanOrEqual(scroll.viewport.screenY + scroll.viewport.height);
    expect(stop!.screenY + stop!.height).toBeLessThanOrEqual(13);
    stop!.focus();
    setup.mockInput.pressEnter();
    expect(stopped).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
