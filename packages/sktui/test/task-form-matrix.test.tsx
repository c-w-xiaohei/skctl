import { expect, test } from "bun:test";
import { ScrollBoxRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import {
  CollectionCreateOverlay,
  CollectionImportOverlay,
  LinkChangeOverlay,
  ReferenceOverlay,
} from "../src/operations/collection-forms";
import { RebindSourceOverlay, CollectionHandoffOverlay } from "../src/operations/choices";
import { directOwner } from "./direct-source.fixture";
import { enterLive, focusLive } from "./reader-test-controls";

const collection = "team/" + "长目录/".repeat(20);
const target = "next/" + "长目标/".repeat(20);
const sizes = [
  [120, 30],
  [100, 24],
  [80, 23],
  [43, 13],
] as const;
function bodyOf(node: BaseRenderable): ScrollBoxRenderable | undefined {
  if (node instanceof ScrollBoxRenderable) return node;
  for (const child of node.getChildren()) {
    const body = bodyOf(child);
    if (body) return body;
  }
}

for (const kind of ["create", "import", "reference", "link"] as const) {
  for (const state of ["ready", "pending", "failed"] as const) {
    test(`${kind} ${state} keeps task controls fixed and preserves exact targets across sizes`, async () => {
      const requests: unknown[] = [];
      let cancelled = 0;
      const common = {
        pending: state === "pending",
        error: state === "failed" ? { code: "IO", message: target } : undefined,
        onCancel: () => cancelled++,
      };
      const setup = await testRender(
        () => {
          switch (kind) {
            case "create":
              return (
                <CollectionCreateOverlay
                  {...common}
                  level="project"
                  collection={collection}
                  fixed
                  onSubmit={(value) => requests.push(value)}
                />
              );
            case "import":
              return (
                <CollectionImportOverlay
                  {...common}
                  level="project"
                  from={collection}
                  into={target}
                  onPreview={(value) => requests.push(value)}
                />
              );
            case "reference":
              return (
                <ReferenceOverlay
                  {...common}
                  level="project"
                  expectedOwner={directOwner}
                  collection={collection}
                  name="guide"
                  target={target}
                  description="Guide"
                  remove={false}
                  onPreview={(value) => requests.push(value)}
                />
              );
            case "link":
              return (
                <LinkChangeOverlay
                  {...common}
                  level="project"
                  expectedOwner={directOwner}
                  collection={collection}
                  target={target}
                  linked
                  onPreview={(value) => requests.push(value)}
                />
              );
          }
        },
        { width: 120, height: 30 },
      );
      const prefix = kind === "create" || kind === "import" ? `collection-${kind}` : kind;
      try {
        await setup.flush();
        const body = bodyOf(setup.renderer.root)!;
        const cancel = setup.renderer.root.findDescendantById(`${prefix}-cancel`)!;
        for (const [width, height] of sizes) {
          setup.resize(width, height);
          await setup.flush();
          expect(body.viewport.height).toBeGreaterThanOrEqual(6);
          expect(!!body.findDescendantById(cancel.id)).toBe(false);
          const y = cancel.screenY;
          body.scrollTo(body.scrollHeight);
          await setup.flush();
          expect(cancel.screenY).toBe(y);
          expect(cancel.screenY + cancel.height).toBeLessThanOrEqual(height - 1);
        }
        const submit = setup.renderer.root.findDescendantById(
          `${prefix}-${kind === "create" ? "submit" : "review"}`,
        )!;
        if (state === "ready") {
          const field =
            kind === "create"
              ? "collection-create-description"
              : kind === "import"
                ? "collection-import-into"
                : kind === "reference"
                  ? "reference-target"
                  : "link-target";
          await focusLive(setup, field);
          await setup.flush();
          await mkdir("out/task-forms", { recursive: true });
          await writeFile(`out/task-forms/${kind}-43x13.txt`, setup.captureCharFrame());
        }
        if (state === "pending") {
          await setup.mockMouse.click(submit.screenX + 1, submit.screenY);
          await setup.flush();
          expect(requests).toEqual([]);
        } else {
          await enterLive(setup, submit.id);
          const expected =
            kind === "create"
              ? { level: "project", collection }
              : kind === "import"
                ? { kind: "collection-import", level: "project", from: collection, into: target }
                : kind === "reference"
                  ? {
                      kind: "reference-add",
                      level: "project",
                      expectedOwner: directOwner,
                      collection,
                      name: "guide",
                      target,
                      description: "Guide",
                    }
                  : {
                      kind: "link-change",
                      level: "project",
                      expectedOwner: directOwner,
                      collection,
                      target,
                      linked: true,
                    };
          expect(requests).toEqual([expected]);
        }
        await enterLive(setup, cancel.id);
        expect(cancelled).toBe(1);
      } finally {
        setup.renderer.destroy();
      }
    });
  }
}

test("rebind retains the selected Source and exact owner path after resize", async () => {
  const requests: unknown[] = [];
  const setup = await testRender(
    () => (
      <RebindSourceOverlay
        address={{ source: collection, path: "old" }}
        sources={["first", "team/next"]}
        onSelect={(source, ownerPath) => requests.push({ source, ownerPath })}
        onClose={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await focusLive(setup, "rebind-source-choice");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await focusLive(setup, "rebind-owner-path");
    await setup.mockInput.typeText("skills/new");
    for (const [width, height] of sizes) {
      setup.resize(width, height);
      await setup.flush();
      const cancel = setup.renderer.root.findDescendantById("rebind-cancel")!;
      expect(cancel.screenY + cancel.height).toBeLessThanOrEqual(height - 1);
      expect(bodyOf(setup.renderer.root)!.viewport.height).toBeGreaterThanOrEqual(6);
    }
    await enterLive(setup, "rebind-preview");
    expect(requests).toEqual([{ source: "team/next", ownerPath: "skills/new" }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection handoff keeps all three target rows within the short viewport", async () => {
  const choices = Array.from({ length: 12 }, (_, index) => ({
    collection: `${collection}-${index}`,
    owner: directOwner,
    level: "project" as const,
  }));
  const selected: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionHandoffOverlay
        choices={choices}
        onCreate={() => {}}
        onSelect={(value) => selected.push(value)}
        onClose={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("collection-handoff-choice")!;
    const cancel = setup.renderer.root.findDescendantById("collection-handoff-cancel")!;
    expect(list.height).toBeGreaterThanOrEqual(6);
    expect(list.screenY + list.height).toBeLessThanOrEqual(cancel.screenY);
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await enterLive(setup, list.id);
    expect(selected).toEqual([choices[1]]);
  } finally {
    setup.renderer.destroy();
  }
});
