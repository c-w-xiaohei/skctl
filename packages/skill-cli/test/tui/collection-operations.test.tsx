import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal, type Accessor, type JSX } from "solid-js";
import {
  CollectionCreateOverlay,
  CollectionImportOverlay,
  CollectionReviewOverlay,
  CollectionUseOverlay,
  LinkChangeOverlay,
  MembershipAddOverlay,
  ReferenceOverlay,
} from "../../src/tui/operations";
import type { CollectionReview } from "../../src/tui/effects";

type FormState = {
  readonly pending: boolean;
  readonly error?: { readonly code: string; readonly message: string };
};

async function renderReactiveForm(render: (state: Accessor<FormState>) => JSX.Element) {
  let patch: (value: Partial<FormState>) => void = () => {};
  const setup = await testRender(
    () => {
      const [state, setState] = createSignal<FormState>({ pending: false });
      patch = (value) => setState((current) => ({ ...current, ...value }));
      return render(state);
    },
    { width: 110, height: 30 },
  );
  return { setup, patch };
}

const input = (setup: Awaited<ReturnType<typeof testRender>>, id: string) =>
  setup.renderer.root.findDescendantById(id) as InputRenderable;

async function retryChoice(setup: Awaited<ReturnType<typeof testRender>>) {
  setup.mockInput.pressKey("ARROW_UP");
  setup.mockInput.pressKey("ARROW_DOWN");
  setup.mockInput.pressEnter();
}

const owner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/team",
};

test("collection creation renders an ID input and Cancel-first choice", async () => {
  let submitted:
    | { readonly level: "global" | "project" | "local"; readonly collection: string }
    | undefined;
  let cancelled = 0;
  const setup = await testRender(
    () => (
      <CollectionCreateOverlay
        level="project"
        collection=""
        pending={false}
        onSubmit={(value) => {
          submitted = value;
        }}
        onCancel={() => {
          cancelled++;
        }}
      />
    ),
    { width: 80, height: 20 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Cancel");
    expect(setup.captureCharFrame()).toContain("Collection ID");
    expect(cancelled).toBe(0);
    expect(submitted).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("collection review truthfully renders import entries and only confirms by keyboard selection", async () => {
  let confirms = 0;
  const review: CollectionReview = {
    kind: "collection-import",
    id: "1",
    intent: { kind: "collection-import", level: "project", from: "source", into: "team" },
    impact: {
      kind: "collection-import",
      source: "source",
      destination: "team",
      owner,
      additions: [{ name: "review", address: { source: "team", path: "review" } }],
      skipped: [{ name: "same", address: { source: "team", path: "same" } }],
      conflicts: [
        {
          reason: "conflict",
          name: "other",
          existing: { address: { source: "a", path: "b" }, paths: [] },
          proposed: { address: { source: "c", path: "d" }, paths: [] },
        },
      ],
      allowed: true,
    },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={review}
        pending={false}
        onConfirm={() => {
          confirms++;
        }}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 25 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Add: review");
    expect(frame).toContain("Skip: same");
    expect(frame).toContain("Conflict: conflict");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(confirms).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("collection removal shows exact blockers and blocks destructive confirmation", async () => {
  let confirms = 0;
  const review: CollectionReview = {
    kind: "collection-removal",
    id: "1",
    intent: { kind: "collection-removal", level: "project", collection: "team" },
    impact: {
      kind: "collection-removal",
      owner,
      decision: { kind: "direct", owner },
      repository: { derived: false, producers: [] },
      disappearingSelectors: [
        { selector: "team:review", address: { source: "team", path: "review" }, paths: [] },
      ],
      retainedSelectors: [],
      blockers: [
        { reason: "use", owner },
        { reason: "reference", owner },
        { reason: "link", owner },
      ],
      allowed: false,
    },
  };
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={review}
        pending={false}
        onConfirm={() => {
          confirms++;
        }}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 25 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Disappears: team:review");
    expect(frame).toContain("Blocker: use");
    expect(frame).toContain("Blocker: reference");
    expect(frame).toContain("Blocker: link");
    setup.mockInput.pressEnter();
    expect(confirms).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("reference draft preserves visible values through an ordinary error render", async () => {
  const previews: unknown[] = [];
  const cancelled: string[] = [];
  const setup = await testRender(
    () => (
      <ReferenceOverlay
        level="project"
        collection="team"
        name="ref"
        target="docs"
        description="Docs"
        remove={false}
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onPreview={(intent) => previews.push(intent)}
        onCancel={() => cancelled.push("reference")}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("WRITE_FAILED: retry");
    expect(frame).toContain("ref");
    expect(frame).toContain("Docs");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-name");
    expect(previews).toEqual([]);
    expect(cancelled).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection Create is keyboard-editable and submits its exact typed value", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionCreateOverlay
        level="project"
        collection=""
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 20 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-create-choice");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([{ level: "project", collection: "team" }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("fixed Config Collection Create retains its ID through same-mounted error and retry", async () => {
  const submitted: unknown[] = [];
  const form = await renderReactiveForm((state) => (
    <CollectionCreateOverlay
      level="local"
      collection=""
      pending={state().pending}
      error={state().error}
      onSubmit={(value) => submitted.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await form.setup.waitFor(
      () => form.setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    const id = input(form.setup, "collection-create-id");
    await form.setup.mockInput.pressKeys(["l", "o", "c", "a", "l"]);
    form.setup.mockInput.pressKey("TAB");
    await form.setup.renderOnce();
    const focused = form.setup.renderer.currentFocusedRenderable;
    await retryChoice(form.setup);
    form.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await form.setup.renderOnce();
    expect(input(form.setup, "collection-create-id")).toBe(id);
    expect(id.value).toBe("local");
    expect(form.setup.renderer.currentFocusedRenderable).toBe(focused);
    form.patch({ error: undefined });
    await form.setup.renderOnce();
    await retryChoice(form.setup);
    expect(submitted).toEqual([
      { level: "local", collection: "local" },
      { level: "local", collection: "local" },
    ]);
  } finally {
    form.setup.renderer.destroy();
  }
});

test("selectable Workspace Collection Create traverses level, ID, and Cancel-first action", async () => {
  const submitted: unknown[] = [];
  const form = await renderReactiveForm((state) => (
    <CollectionCreateOverlay
      allowedLevels={["global", "project", "local"]}
      collection=""
      pending={state().pending}
      error={state().error}
      onSubmit={(value) => submitted.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await form.setup.waitFor(
      () => form.setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
    );
    const level = form.setup.renderer.currentFocusedRenderable!;
    form.setup.mockInput.pressKey("ARROW_DOWN");
    form.setup.mockInput.pressEnter();
    form.setup.mockInput.pressKey("TAB");
    await form.setup.renderOnce();
    expect(form.setup.renderer.currentFocusedRenderable?.id).toBe("collection-create-id");
    const id = input(form.setup, "collection-create-id");
    await form.setup.mockInput.pressKeys(["p", "r", "o", "j"]);
    form.setup.mockInput.pressKey("TAB");
    await form.setup.renderOnce();
    expect(form.setup.renderer.currentFocusedRenderable?.id).toBe("collection-create-choice");
    const focused = form.setup.renderer.currentFocusedRenderable;
    await retryChoice(form.setup);
    form.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await form.setup.renderOnce();
    expect(form.setup.renderer.root.findDescendantById("collection-create-level")).toBe(level);
    expect(input(form.setup, "collection-create-id")).toBe(id);
    expect(id.value).toBe("proj");
    expect(form.setup.renderer.currentFocusedRenderable).toBe(focused);
    form.patch({ error: undefined });
    await form.setup.renderOnce();
    await retryChoice(form.setup);
    expect(submitted).toEqual([
      { level: "project", collection: "proj" },
      { level: "project", collection: "proj" },
    ]);
    form.setup.mockInput.pressKey("TAB", { shift: true });
    await form.setup.renderOnce();
    expect(form.setup.renderer.currentFocusedRenderable?.id).toBe("collection-create-id");
  } finally {
    form.setup.renderer.destroy();
  }
});

test("selectable Workspace Collection Create submits each allowed level exactly", async () => {
  const submitted: unknown[] = [];
  for (const level of ["global", "project", "local"] as const) {
    const setup = await testRender(
      () => (
        <CollectionCreateOverlay
          allowedLevels={[level]}
          collection=""
          pending={false}
          onSubmit={(value) => submitted.push(value)}
          onCancel={() => {}}
        />
      ),
      { width: 100, height: 20 },
    );
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
      );
      setup.mockInput.pressKey("TAB");
      await setup.mockInput.pressKeys(["x"]);
      setup.mockInput.pressKey("TAB");
      await retryChoice(setup);
    } finally {
      setup.renderer.destroy();
    }
  }
  expect(submitted).toEqual([
    { level: "global", collection: "x" },
    { level: "project", collection: "x" },
    { level: "local", collection: "x" },
  ]);
});

test("Membership Add is keyboard-editable, retains its draft, and previews the authorized intent", async () => {
  const previews: unknown[] = [];
  const setup = await testRender(
    () => (
      <MembershipAddOverlay
        level="project"
        collection="team"
        address={{ source: "source", path: "skill" }}
        initialName="review"
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onPreview={(value) => previews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 20 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    expect(setup.captureCharFrame()).toContain("review");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("membership-add-choice");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(previews).toEqual([
      {
        kind: "add-to-collection",
        level: "project",
        collection: "team",
        address: { source: "source", path: "skill" },
        name: "review",
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Import draft traverses both inputs and previews its exact typed intent", async () => {
  const previews: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionImportOverlay
        level="project"
        from=""
        into=""
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onPreview={(value) => previews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 22 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-import-from",
    );
    await setup.mockInput.pressKeys(["f", "r", "o", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-import-into");
    await setup.mockInput.pressKeys(["i", "n", "t", "o"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-import-choice");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(previews).toEqual([
      { kind: "collection-import", level: "project", from: "from", into: "into" },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Reference draft traverses all inputs, including reverse Tab, and previews exact values", async () => {
  const previews: unknown[] = [];
  const setup = await testRender(
    () => (
      <ReferenceOverlay
        level="project"
        collection="team"
        name=""
        target=""
        description=""
        remove={false}
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onPreview={(value) => previews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reference-name");
    await setup.mockInput.pressKeys(["d", "o", "c"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.mockInput.pressKeys(["D"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-choice");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-description");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(previews).toEqual([
      {
        kind: "reference",
        level: "project",
        collection: "team",
        name: "doc",
        target: "team",
        description: "D",
        remove: false,
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Link and Collection Use drafts are keyboard-editable and emit their exact intents", async () => {
  const linkPreviews: unknown[] = [];
  const link = await testRender(
    () => (
      <LinkChangeOverlay
        level="project"
        collection="team"
        target=""
        linked={true}
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onPreview={(value) => linkPreviews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 20 },
  );
  try {
    await link.waitFor(() => link.renderer.currentFocusedRenderable?.id === "link-target");
    await link.mockInput.pressKeys(["d", "o", "c", "s"]);
    link.mockInput.pressKey("TAB");
    await link.renderOnce();
    expect(link.renderer.currentFocusedRenderable?.id).toBe("link-choice");
    link.mockInput.pressKey("ARROW_DOWN");
    link.mockInput.pressEnter();
    expect(linkPreviews).toEqual([
      { kind: "link-change", level: "project", collection: "team", target: "docs", linked: true },
    ]);
  } finally {
    link.renderer.destroy();
  }
  const usePreviews: unknown[] = [];
  const use = await testRender(
    () => (
      <CollectionUseOverlay
        level="project"
        collections={[]}
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onPreview={(value) => usePreviews.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 20 },
  );
  try {
    await use.waitFor(() => use.renderer.currentFocusedRenderable?.id === "collection-use-values");
    await use.mockInput.pressKeys(["t", "e", "a", "m", ",", "d", "o", "c", "s"]);
    use.mockInput.pressKey("TAB");
    await use.renderOnce();
    expect(use.renderer.currentFocusedRenderable?.id).toBe("collection-use-choice");
    use.mockInput.pressKey("ARROW_DOWN");
    use.mockInput.pressEnter();
    expect(usePreviews).toEqual([
      { kind: "collection-use", level: "project", collections: ["team", "docs"] },
    ]);
  } finally {
    use.renderer.destroy();
  }
});

test("Create and Membership retain the same mounted input and exact retry draft", async () => {
  const created: unknown[] = [];
  const create = await renderReactiveForm((state) => (
    <CollectionCreateOverlay
      level="project"
      collection=""
      pending={state().pending}
      error={state().error}
      onSubmit={(value) => created.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await create.setup.waitFor(
      () => create.setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    const id = input(create.setup, "collection-create-id");
    await create.setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    create.setup.mockInput.pressKey("TAB");
    await create.setup.renderOnce();
    const focused = create.setup.renderer.currentFocusedRenderable;
    await retryChoice(create.setup);
    create.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await create.setup.renderOnce();
    expect(input(create.setup, "collection-create-id")).toBe(id);
    expect(id.value).toBe("team");
    expect(create.setup.renderer.currentFocusedRenderable).toBe(focused);
    create.patch({ error: undefined });
    await create.setup.renderOnce();
    await retryChoice(create.setup);
    expect(created).toEqual([
      { level: "project", collection: "team" },
      { level: "project", collection: "team" },
    ]);
  } finally {
    create.setup.renderer.destroy();
  }
  const previews: unknown[] = [];
  const member = await renderReactiveForm((state) => (
    <MembershipAddOverlay
      level="project"
      collection="team"
      address={{ source: "source", path: "skill" }}
      initialName="review"
      pending={state().pending}
      error={state().error}
      onPreview={(value) => previews.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await member.setup.waitFor(
      () => member.setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    const name = input(member.setup, "membership-add-name");
    member.setup.mockInput.pressKey("TAB");
    await member.setup.renderOnce();
    const focused = member.setup.renderer.currentFocusedRenderable;
    await retryChoice(member.setup);
    member.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await member.setup.renderOnce();
    expect(input(member.setup, "membership-add-name")).toBe(name);
    expect(name.value).toBe("review");
    expect(member.setup.renderer.currentFocusedRenderable).toBe(focused);
    member.patch({ error: undefined });
    await member.setup.renderOnce();
    await retryChoice(member.setup);
    expect(previews).toEqual([
      {
        kind: "add-to-collection",
        level: "project",
        collection: "team",
        address: { source: "source", path: "skill" },
        name: "review",
      },
      {
        kind: "add-to-collection",
        level: "project",
        collection: "team",
        address: { source: "source", path: "skill" },
        name: "review",
      },
    ]);
  } finally {
    member.setup.renderer.destroy();
  }
});

test("Import, Reference, Link, and Use retain mounted drafts and exact retries", async () => {
  const importPreviews: unknown[] = [];
  const imported = await renderReactiveForm((state) => (
    <CollectionImportOverlay
      level="project"
      from=""
      into=""
      pending={state().pending}
      error={state().error}
      onPreview={(value) => importPreviews.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await imported.setup.waitFor(
      () => imported.setup.renderer.currentFocusedRenderable?.id === "collection-import-from",
    );
    const from = input(imported.setup, "collection-import-from");
    const into = input(imported.setup, "collection-import-into");
    await imported.setup.mockInput.pressKeys(["f"]);
    imported.setup.mockInput.pressKey("TAB");
    await imported.setup.mockInput.pressKeys(["i"]);
    imported.setup.mockInput.pressKey("TAB");
    await imported.setup.renderOnce();
    const focused = imported.setup.renderer.currentFocusedRenderable;
    await retryChoice(imported.setup);
    imported.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await imported.setup.renderOnce();
    expect(input(imported.setup, "collection-import-from")).toBe(from);
    expect(input(imported.setup, "collection-import-into")).toBe(into);
    expect(from.value).toBe("f");
    expect(into.value).toBe("i");
    expect(imported.setup.renderer.currentFocusedRenderable).toBe(focused);
    imported.patch({ error: undefined });
    await imported.setup.renderOnce();
    await retryChoice(imported.setup);
    expect(importPreviews).toEqual([
      { kind: "collection-import", level: "project", from: "f", into: "i" },
      { kind: "collection-import", level: "project", from: "f", into: "i" },
    ]);
  } finally {
    imported.setup.renderer.destroy();
  }
  const referencePreviews: unknown[] = [];
  const reference = await renderReactiveForm((state) => (
    <ReferenceOverlay
      level="project"
      collection="team"
      name=""
      target=""
      description=""
      remove={false}
      pending={state().pending}
      error={state().error}
      onPreview={(value) => referencePreviews.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await reference.setup.waitFor(
      () => reference.setup.renderer.currentFocusedRenderable?.id === "reference-name",
    );
    const name = input(reference.setup, "reference-name");
    const target = input(reference.setup, "reference-target");
    const description = input(reference.setup, "reference-description");
    await reference.setup.mockInput.pressKeys(["n"]);
    reference.setup.mockInput.pressKey("TAB");
    await reference.setup.mockInput.pressKeys(["t"]);
    reference.setup.mockInput.pressKey("TAB");
    await reference.setup.mockInput.pressKeys(["d"]);
    reference.setup.mockInput.pressKey("TAB");
    await reference.setup.renderOnce();
    const focused = reference.setup.renderer.currentFocusedRenderable;
    await retryChoice(reference.setup);
    reference.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await reference.setup.renderOnce();
    expect(input(reference.setup, "reference-name")).toBe(name);
    expect(input(reference.setup, "reference-target")).toBe(target);
    expect(input(reference.setup, "reference-description")).toBe(description);
    expect(name.value).toBe("n");
    expect(target.value).toBe("t");
    expect(description.value).toBe("d");
    expect(reference.setup.renderer.currentFocusedRenderable).toBe(focused);
    reference.patch({ error: undefined });
    await reference.setup.renderOnce();
    await retryChoice(reference.setup);
    expect(referencePreviews).toEqual([
      {
        kind: "reference",
        level: "project",
        collection: "team",
        name: "n",
        target: "t",
        description: "d",
        remove: false,
      },
      {
        kind: "reference",
        level: "project",
        collection: "team",
        name: "n",
        target: "t",
        description: "d",
        remove: false,
      },
    ]);
  } finally {
    reference.setup.renderer.destroy();
  }
  const removalPreviews: unknown[] = [];
  const removal = await renderReactiveForm((state) => (
    <ReferenceOverlay
      level="project"
      collection="team"
      name="ref"
      target="docs"
      description="old"
      remove={true}
      pending={state().pending}
      error={state().error}
      onPreview={(value) => removalPreviews.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await removal.setup.waitFor(
      () => removal.setup.renderer.currentFocusedRenderable?.id === "reference-name",
    );
    const name = input(removal.setup, "reference-name");
    const target = input(removal.setup, "reference-target");
    removal.setup.mockInput.pressKey("TAB");
    removal.setup.mockInput.pressKey("TAB");
    await removal.setup.renderOnce();
    const focused = removal.setup.renderer.currentFocusedRenderable;
    await retryChoice(removal.setup);
    removal.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await removal.setup.renderOnce();
    expect(input(removal.setup, "reference-name")).toBe(name);
    expect(input(removal.setup, "reference-target")).toBe(target);
    expect(name.value).toBe("ref");
    expect(target.value).toBe("docs");
    expect(removal.setup.renderer.currentFocusedRenderable).toBe(focused);
    removal.patch({ error: undefined });
    await removal.setup.renderOnce();
    await retryChoice(removal.setup);
    expect(removalPreviews).toEqual([
      {
        kind: "reference",
        level: "project",
        collection: "team",
        name: "ref",
        target: "docs",
        description: "old",
        remove: true,
      },
      {
        kind: "reference",
        level: "project",
        collection: "team",
        name: "ref",
        target: "docs",
        description: "old",
        remove: true,
      },
    ]);
  } finally {
    removal.setup.renderer.destroy();
  }
  const linkPreviews: unknown[] = [];
  const link = await renderReactiveForm((state) => (
    <LinkChangeOverlay
      level="project"
      collection="team"
      target=""
      linked={false}
      pending={state().pending}
      error={state().error}
      onPreview={(value) => linkPreviews.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await link.setup.waitFor(
      () => link.setup.renderer.currentFocusedRenderable?.id === "link-target",
    );
    const target = input(link.setup, "link-target");
    await link.setup.mockInput.pressKeys(["d"]);
    link.setup.mockInput.pressKey("TAB");
    await link.setup.renderOnce();
    const focused = link.setup.renderer.currentFocusedRenderable;
    await retryChoice(link.setup);
    link.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await link.setup.renderOnce();
    expect(input(link.setup, "link-target")).toBe(target);
    expect(target.value).toBe("d");
    expect(link.setup.renderer.currentFocusedRenderable).toBe(focused);
    link.patch({ error: undefined });
    await link.setup.renderOnce();
    await retryChoice(link.setup);
    expect(linkPreviews).toEqual([
      { kind: "link-change", level: "project", collection: "team", target: "d", linked: false },
      { kind: "link-change", level: "project", collection: "team", target: "d", linked: false },
    ]);
  } finally {
    link.setup.renderer.destroy();
  }
  const usePreviews: unknown[] = [];
  const use = await renderReactiveForm((state) => (
    <CollectionUseOverlay
      level="project"
      collections={[]}
      pending={state().pending}
      error={state().error}
      onPreview={(value) => usePreviews.push(value)}
      onCancel={() => {}}
    />
  ));
  try {
    await use.setup.waitFor(
      () => use.setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    const values = input(use.setup, "collection-use-values");
    await use.setup.mockInput.pressKeys(["a", ",", "b"]);
    use.setup.mockInput.pressKey("TAB");
    await use.setup.renderOnce();
    const focused = use.setup.renderer.currentFocusedRenderable;
    await retryChoice(use.setup);
    use.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await use.setup.renderOnce();
    expect(input(use.setup, "collection-use-values")).toBe(values);
    expect(values.value).toBe("a,b");
    expect(use.setup.renderer.currentFocusedRenderable).toBe(focused);
    use.patch({ error: undefined });
    await use.setup.renderOnce();
    await retryChoice(use.setup);
    expect(usePreviews).toEqual([
      { kind: "collection-use", level: "project", collections: ["a", "b"] },
      { kind: "collection-use", level: "project", collections: ["a", "b"] },
    ]);
  } finally {
    use.setup.renderer.destroy();
  }
});
