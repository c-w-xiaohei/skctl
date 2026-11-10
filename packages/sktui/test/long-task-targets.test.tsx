import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import {
  CollectionContentOverlay,
  CollectionRenameOverlay,
} from "../src/operations/collection-forms";
import { MembershipRemovalPlanOverlay } from "../src/operations/membership";
import { collectionRemovalPlan } from "../src/collections/relationship-model";
import { SourceReplacementOverlay } from "../src/operations/source-replacement";
import { SourceRemovalOverlay } from "../src/operations/source";
import { InstalledSkillChooserOverlay } from "../src/operations/choices";
import {
  InstalledSkillPreviewOverlay,
  InstalledSkillPreviewFailureOverlay,
} from "../src/operations/installed-review";
import { directOwner } from "./direct-source.fixture";
import { enterLive } from "./reader-test-controls";

const collection = "team/" + "很长的目录/".repeat(25);

test("membership failure keeps Preview again fixed and retries the selected declaration", async () => {
  const owner = { ...directOwner, pointer: "/collections/team" };
  const plan = collectionRemovalPlan({ id: collection, declared: [owner] }, [
    {
      key: "guide",
      name: "guide",
      address: { source: "team/main", path: "guide" },
      path: {
        kind: "direct",
        collection,
        entryName: "guide",
        owner: { ...owner, pointer: `${owner.pointer}/members/guide` },
      },
    },
  ]);
  const selected: number[] = [];
  const setup = await testRender(
    () => (
      <MembershipRemovalPlanOverlay
        plan={plan}
        ownerIndex={0}
        pending={false}
        error={{ code: "IO", message: collection }}
        onSelect={(index) => selected.push(index)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const body = scrollBody(setup.renderer.root)!;
    const retry = setup.renderer.root.findDescendantById("membership-removal-retry")!;
    expect(!!body.findDescendantById(retry.id)).toBe(false);
    expect(body.viewport.height).toBeGreaterThanOrEqual(6);
    const y = retry.screenY;
    body.scrollTo(body.scrollHeight);
    await setup.flush();
    expect(retry.screenY).toBe(y);
    expect(retry.screenY + retry.height).toBeLessThanOrEqual(12);
    await enterLive(setup, retry.id);
    expect(selected).toEqual([0]);
  } finally {
    setup.renderer.destroy();
  }
});

test("installed Skill chooser shows three candidates and keeps exact selection through resize", async () => {
  const skills = Array.from({ length: 12 }, (_, index) => ({
    name: `guide-${index}`,
    description: `Guide ${index}`,
    address: { source: "team/main", path: `skills/guide-${index}` },
  }));
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <InstalledSkillChooserOverlay
        collection={collection}
        owner={directOwner}
        skills={skills}
        onSelect={(items) => submitted.push(items)}
        onClose={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-choice",
    ) as SelectRenderable;
    const submit = setup.renderer.root.findDescendantById("installed-skill-choice-submit")!;
    expect(list.height).toBeGreaterThanOrEqual(6);
    expect(list.screenY + list.height).toBeLessThanOrEqual(submit.screenY);
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await enterLive(setup, list.id);
    for (const [width, height] of [
      [120, 30],
      [100, 24],
      [80, 23],
      [43, 13],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      expect(list.getSelectedOption()?.value).toBe("1");
      expect(list.height).toBeGreaterThanOrEqual(6);
      expect(submit.screenY + submit.height).toBeLessThanOrEqual(height - 1);
    }
    await enterLive(setup, submit.id);
    expect(submitted).toEqual([[{ name: skills[1]!.name, address: skills[1]!.address }]]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Source replacement keeps preview visible while scrolling and submits the exact selected address", async () => {
  const selected = { source: collection, path: "skills/guide" };
  const previews: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceReplacementOverlay
        oldSource={collection}
        newSource="replacement"
        addresses={[selected]}
        selectedAddress={selected}
        targetPath="  next/guide  "
        registered
        receipt={Array.from({ length: 20 }, (_, index) => `Completed ${index}`)}
        pending={false}
        onDraft={() => {}}
        onPreview={(address, path) => previews.push({ address, path })}
        onInspect={() => {}}
        onAcquire={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const body = scrollBody(setup.renderer.root)!;
    const preview = setup.renderer.root.findDescendantById("replacement-preview")!;
    expect(!!body.findDescendantById(preview.id)).toBe(false);
    expect(body.viewport.height).toBeGreaterThanOrEqual(6);
    const y = preview.screenY;
    body.scrollTo(100);
    await setup.flush();
    expect(preview.screenY).toBe(y);
    expect(preview.screenX + preview.width).toBeLessThanOrEqual(42);
    expect(y + preview.height).toBeLessThanOrEqual(12);
    await enterLive(setup, preview.id);
    expect(previews).toEqual([{ address: selected, path: "next/guide" }]);
  } finally {
    setup.renderer.destroy();
  }
});

function scrollBody(node: BaseRenderable): ScrollBoxRenderable | undefined {
  if (node instanceof ScrollBoxRenderable) return node;
  for (const child of node.getChildren()) {
    const body = scrollBody(child);
    if (body) return body;
  }
}

for (const kind of [
  "rename",
  "content",
  "membership",
  "replacement",
  "chooser",
  "preview",
  "preview-failure",
  "source-removal",
] as const) {
  test(`${kind} retains six body rows and fixed cancellation with a long target at 43x13`, async () => {
    let cancelled = 0;
    const cancel = () => cancelled++;
    const setup = await testRender(
      () => {
        switch (kind) {
          case "source-removal":
            return (
              <SourceRemovalOverlay
                review={{
                  id: "remove",
                  intent: { kind: "source-removal", source: collection, owner: directOwner },
                  impact: {
                    kind: "source-removal",
                    source: collection,
                    owner: directOwner,
                    installed: [],
                    repairs: [],
                    blockers: [],
                    allowed: true,
                  },
                }}
                pending={false}
                onConfirm={() => {}}
                onRepair={() => {}}
                onCancel={cancel}
              />
            );
          case "preview":
            return (
              <InstalledSkillPreviewOverlay
                request={{ kind: "uninstall", address: { source: collection, path: "guide" } }}
                cancelling={false}
                onCancel={cancel}
              />
            );
          case "preview-failure":
            return (
              <InstalledSkillPreviewFailureOverlay
                request={{ kind: "uninstall", address: { source: collection, path: "guide" } }}
                error={{ code: "IO", message: collection }}
                pending={false}
                cancelling={false}
                onRetry={() => {}}
                onCancel={cancel}
              />
            );
          case "chooser":
            return (
              <InstalledSkillChooserOverlay
                collection={collection}
                owner={directOwner}
                skills={[]}
                onSelect={() => {}}
                onClose={cancel}
              />
            );
          case "rename":
            return (
              <CollectionRenameOverlay
                collection={collection}
                target="next"
                pending={false}
                onChange={() => {}}
                onPreview={() => {}}
                onCancel={cancel}
              />
            );
          case "content":
            return (
              <CollectionContentOverlay
                collection={collection}
                owner={directOwner}
                description="Draft"
                pending={false}
                onSave={() => {}}
                onCancel={cancel}
              />
            );
          case "membership":
            return (
              <MembershipRemovalPlanOverlay
                plan={{
                  collection,
                  rows: [],
                  removals: [],
                  ownerGroups: [],
                  explanations: [],
                  executable: false,
                }}
                pending={false}
                onSelect={() => {}}
                onConfirm={() => {}}
                onCancel={cancel}
              />
            );
          case "replacement":
            return (
              <SourceReplacementOverlay
                oldSource={collection}
                newSource={`next/${collection}`}
                addresses={[]}
                receipt={[]}
                pending={false}
                onDraft={() => {}}
                onPreview={() => {}}
                onInspect={() => {}}
                onAcquire={() => {}}
                onRemove={() => {}}
                onClose={cancel}
              />
            );
        }
      },
      { width: 43, height: 13 },
    );
    try {
      await setup.flush();
      const body = scrollBody(setup.renderer.root)!;
      expect(body.viewport.height).toBeGreaterThanOrEqual(6);
      expect(body.scrollHeight).toBeGreaterThan(body.viewport.height);
      const id = {
        rename: "collection-rename-cancel",
        content: "collection-content-cancel",
        membership: "membership-removal-plan",
        replacement: "replacement-close",
        chooser: "installed-skill-choice-cancel",
        preview: "installed-skill-preview-progress",
        "preview-failure": "installed-skill-preview-failure-cancel",
        "source-removal": "source-removal-choice",
      }[kind];
      const button = setup.renderer.root.findDescendantById(id)!;
      expect(!!body.findDescendantById(id)).toBe(false);
      const y = button.screenY;
      expect(y + button.height).toBeLessThanOrEqual(12);
      body.scrollTo(100);
      await setup.flush();
      expect(button.screenY).toBe(y);
      await enterLive(setup, id);
      expect(cancelled).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });
}
