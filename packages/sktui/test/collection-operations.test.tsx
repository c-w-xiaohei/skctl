import { expect, test } from "bun:test";
import { enterLive } from "./reader-test-controls";
import { InputRenderable, SelectRenderable, type Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal, type Accessor, type JSX } from "solid-js";
import {
  CollectionCreateOverlay,
  CollectionImportOverlay,
  CollectionReviewOverlay,
  CollectionUseOverlay,
  LinkChangeOverlay,
  InstalledSkillChooserOverlay,
  MembershipRemovalPlanOverlay,
  ReferenceOverlay,
} from "../src/operations";
import type { CollectionReview } from "../src/session";

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

const liveRenderable = (setup: Awaited<ReturnType<typeof testRender>>, id: string) => {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeDefined();
  if (!target || target.isDestroyed || target.parent === null) {
    throw new Error(`${id} is not a live renderable`);
  }
  return target;
};

const input = (setup: Awaited<ReturnType<typeof testRender>>, id: string) =>
  (() => {
    const target = liveRenderable(setup, id);
    expect(target).toBeDefined();
    expect(target).toBeInstanceOf(InputRenderable);
    if (!(target instanceof InputRenderable)) {
      throw new Error(`${id} is not an input`);
    }
    return target;
  })();

async function tabToCreateSubmit(setup: Awaited<ReturnType<typeof testRender>>) {
  for (const id of ["collection-create-description", "collection-create-submit"]) {
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  }
  return liveRenderable(setup, "collection-create-submit");
}

async function tabToCommand(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: string,
): Promise<Renderable> {
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => {
    const target = setup.renderer.root.findDescendantById(id);
    return (
      !!target &&
      !target.isDestroyed &&
      target.parent !== null &&
      target.focusable &&
      setup.renderer.currentFocusedRenderable === target
    );
  });
  const target = liveRenderable(setup, id);
  expect(setup.renderer.currentFocusedRenderable).toBe(target);
  return target;
}

async function retryChoice(setup: Awaited<ReturnType<typeof testRender>>, id: string) {
  const target = await tabToCommand(setup, id);
  setup.mockInput.pressEnter();
  return target;
}

const owner = {
  level: "project" as const,
  file: "/workspace/skctl/skctl.jsonc",
  pointer: "/collections/team",
};

test("collection creation renders editable fields and explicit submit and cancel actions", async () => {
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

test("Membership removal plan is cancel-first and exposes every exclusion", async () => {
  let continued = 0;
  const setup = await testRender(
    () => (
      <MembershipRemovalPlanOverlay
        collection="team"
        lines={["Remove: guide main/guide", "Repository acme/team: change its producer"]}
        executableCount={1}
        pending={false}
        onContinue={() => continued++}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 20 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-removal-plan",
    );
    expect(setup.captureCharFrame()).toContain("Repository acme/team");
    setup.mockInput.pressEnter();
    expect(continued).toBe(0);
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressEnter();
    expect(continued).toBe(1);
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
    setup.renderer.root.findDescendantById("collection-review-confirm")?.focus();
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
    await tabToCreateSubmit(setup);
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([{ level: "project", collection: "team" }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("fixed-level Collection Create retains its editable ID through same-mounted error and retry", async () => {
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
    const submit = await tabToCreateSubmit(form.setup);
    form.setup.mockInput.pressEnter();
    form.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await form.setup.renderOnce();
    expect(input(form.setup, "collection-create-id")).toBe(id);
    expect(id.value).toBe("local");
    const retrySubmit = form.setup.renderer.root.findDescendantById("collection-create-submit");
    expect(retrySubmit).toBeDefined();
    if (!retrySubmit || retrySubmit.isDestroyed || retrySubmit.parent === null) {
      throw new Error("collection-create-submit did not remain mounted");
    }
    expect(retrySubmit).toBe(submit);
    expect(form.setup.renderer.currentFocusedRenderable).toBe(retrySubmit);
    form.patch({ error: undefined });
    await form.setup.renderOnce();
    const finalSubmit = form.setup.renderer.root.findDescendantById("collection-create-submit");
    expect(finalSubmit).toBeDefined();
    if (!finalSubmit || finalSubmit.isDestroyed || finalSubmit.parent === null) {
      throw new Error("collection-create-submit did not remain mounted");
    }
    expect(finalSubmit).toBe(submit);
    expect(form.setup.renderer.currentFocusedRenderable).toBe(finalSubmit);
    form.setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      { level: "local", collection: "local" },
      { level: "local", collection: "local" },
    ]);
  } finally {
    form.setup.renderer.destroy();
  }
});

test("selectable Workspace Collection Create traverses level, ID, description, and submit", async () => {
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
    const level = form.setup.renderer.root.findDescendantById("collection-create-level");
    expect(level).toBeDefined();
    if (!level || level.isDestroyed || level.parent === null) {
      throw new Error("collection-create-level is not a live renderable");
    }
    expect(form.setup.renderer.currentFocusedRenderable).toBe(level);
    expect((level as SelectRenderable).getSelectedOption()?.value).toBe("project");
    form.setup.mockInput.pressEnter();
    form.setup.mockInput.pressKey("TAB");
    await form.setup.renderOnce();
    expect(form.setup.renderer.currentFocusedRenderable?.id).toBe("collection-create-id");
    const id = input(form.setup, "collection-create-id");
    await form.setup.mockInput.pressKeys(["p", "r", "o", "j"]);
    const submit = await tabToCreateSubmit(form.setup);
    form.setup.mockInput.pressEnter();
    form.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await form.setup.renderOnce();
    const retryLevel = form.setup.renderer.root.findDescendantById("collection-create-level");
    expect(retryLevel).toBeDefined();
    if (!retryLevel || retryLevel.isDestroyed || retryLevel.parent === null) {
      throw new Error("collection-create-level did not remain mounted");
    }
    expect(retryLevel).toBe(level);
    expect(input(form.setup, "collection-create-id")).toBe(id);
    expect(id.value).toBe("proj");
    const retrySubmit = form.setup.renderer.root.findDescendantById("collection-create-submit");
    expect(retrySubmit).toBeDefined();
    if (!retrySubmit || retrySubmit.isDestroyed || retrySubmit.parent === null) {
      throw new Error("collection-create-submit did not remain mounted");
    }
    expect(retrySubmit).toBe(submit);
    expect(form.setup.renderer.currentFocusedRenderable).toBe(retrySubmit);
    form.patch({ error: undefined });
    await form.setup.renderOnce();
    const finalSubmit = form.setup.renderer.root.findDescendantById("collection-create-submit");
    expect(finalSubmit).toBeDefined();
    if (!finalSubmit || finalSubmit.isDestroyed || finalSubmit.parent === null) {
      throw new Error("collection-create-submit did not remain mounted");
    }
    expect(finalSubmit).toBe(submit);
    expect(form.setup.renderer.currentFocusedRenderable).toBe(finalSubmit);
    form.setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      { level: "project", collection: "proj" },
      { level: "project", collection: "proj" },
    ]);
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
      await tabToCreateSubmit(setup);
      setup.mockInput.pressEnter();
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
      <InstalledSkillChooserOverlay
        owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/team" }}
        collection="team"
        skills={[]}
        initialSelected={[{ name: "review", address: { source: "source", path: "skill" } }]}
        pending={false}
        error={{ code: "WRITE_FAILED", message: "retry" }}
        onSelect={(value) => previews.push(value)}
        onClose={() => {}}
      />
    ),
    { width: 100, height: 20 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("review");
    await enterLive(setup, "installed-skill-choice-submit");
    expect(previews).toEqual([
      [
        {
          address: { source: "source", path: "skill" },
          name: "review",
        },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Membership batch draft edits retained names, blocks local duplicates, and previews one exact batch", async () => {
  const previews: unknown[] = [];
  const setup = await testRender(
    () => {
      const additions = [
        { name: "guide", address: { source: "team-main", path: "docs/guide" } },
        { name: "guide", address: { source: "team-main", path: "review" } },
      ];
      return (
        <InstalledSkillChooserOverlay
          owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/team" }}
          collection="team"
          skills={additions.map((item) => ({ ...item, description: "" }))}
          initialSelected={additions}
          pending={false}
          onSelect={(items) => previews.push(items)}
          onClose={() => {}}
        />
      );
    },
    { width: 100, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("team-main/docs/guide");
    expect(liveRenderable(setup, "installed-skill-choice-submit").focusable).toBe(false);
    expect(previews).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Choose unique, nonempty names");
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-import-cancel");
    setup.mockInput.pressKey("TAB");
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-cancel");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-review");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-cancel");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reference-description");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressEnter();
    expect(previews).toEqual([
      {
        kind: "reference-add",
        level: "project",
        collection: "team",
        name: "doc",
        target: "team",
        description: "D",
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
    expect(link.renderer.currentFocusedRenderable?.id).toBe("link-cancel");
    link.mockInput.pressKey("TAB");
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
        availableCollections={[{ id: "team" }, { id: "docs" }]}
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
    use.mockInput.pressEnter();
    use.mockInput.pressArrow("down");
    await use.renderOnce();
    use.mockInput.pressEnter();
    await use.flush();
    use.mockInput.pressKey("TAB");
    await use.renderOnce();
    expect(use.renderer.currentFocusedRenderable?.id).toBe("collection-use-cancel");
    use.mockInput.pressKey("TAB");
    use.mockInput.pressEnter();
    expect(usePreviews).toEqual([
      { kind: "collection-use", level: "project", collections: ["team", "docs"] },
    ]);
  } finally {
    use.renderer.destroy();
  }
});

test("Membership retains the same mounted input and exact retry draft", async () => {
  const previews: unknown[] = [];
  const member = await renderReactiveForm((state) => (
    <InstalledSkillChooserOverlay
      owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/team" }}
      collection="team"
      skills={[]}
      initialSelected={[{ name: "review", address: { source: "source", path: "skill" } }]}
      pending={state().pending}
      error={state().error}
      onSelect={(value) => previews.push(value)}
      onClose={() => {}}
    />
  ));
  try {
    await member.setup.renderOnce();
    const name = input(member.setup, "installed-skill-name-0");
    member.setup.mockInput.pressKey("TAB");
    await member.setup.renderOnce();
    const submit = await retryChoice(member.setup, "installed-skill-choice-submit");
    expect(member.setup.renderer.currentFocusedRenderable).toBe(submit);
    member.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await member.setup.renderOnce();
    expect(input(member.setup, "installed-skill-name-0")).toBe(name);
    expect(name.value).toBe("review");
    const retrySubmit = liveRenderable(member.setup, "installed-skill-choice-submit");
    expect(retrySubmit).toBe(submit);
    expect(member.setup.renderer.currentFocusedRenderable).toBe(retrySubmit);
    member.patch({ error: undefined });
    await member.setup.renderOnce();
    const finalSubmit = liveRenderable(member.setup, "installed-skill-choice-submit");
    expect(finalSubmit).toBe(submit);
    expect(member.setup.renderer.currentFocusedRenderable).toBe(finalSubmit);
    member.setup.mockInput.pressEnter();
    expect(previews).toEqual([
      [
        {
          address: { source: "source", path: "skill" },
          name: "review",
        },
      ],
      [
        {
          address: { source: "source", path: "skill" },
          name: "review",
        },
      ],
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
    imported.setup.mockInput.pressKey("TAB");
    const review = imported.setup.renderer.root.findDescendantById("collection-import-review");
    if (!review) throw new Error("collection-import-review is not mounted");
    expect(imported.setup.renderer.currentFocusedRenderable).toBe(review);
    imported.setup.mockInput.pressEnter();
    imported.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await imported.setup.renderOnce();
    expect(input(imported.setup, "collection-import-from")).toBe(from);
    expect(input(imported.setup, "collection-import-into")).toBe(into);
    expect(from.value).toBe("f");
    expect(into.value).toBe("i");
    expect(imported.setup.renderer.currentFocusedRenderable).toBe(review);
    imported.patch({ error: undefined });
    await imported.setup.renderOnce();
    imported.setup.mockInput.pressEnter();
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
    const review = await tabToCommand(reference.setup, "reference-review");
    reference.setup.mockInput.pressEnter();
    reference.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await reference.setup.renderOnce();
    expect(input(reference.setup, "reference-name")).toBe(name);
    expect(input(reference.setup, "reference-target")).toBe(target);
    expect(input(reference.setup, "reference-description")).toBe(description);
    expect(name.value).toBe("n");
    expect(target.value).toBe("t");
    expect(description.value).toBe("d");
    expect(liveRenderable(reference.setup, "reference-review")).toBe(review);
    expect(reference.setup.renderer.currentFocusedRenderable).toBe(review);
    reference.patch({ error: undefined });
    await reference.setup.renderOnce();
    expect(liveRenderable(reference.setup, "reference-review")).toBe(review);
    expect(reference.setup.renderer.currentFocusedRenderable).toBe(review);
    reference.setup.mockInput.pressEnter();
    expect(referencePreviews).toEqual([
      {
        kind: "reference-add",
        level: "project",
        collection: "team",
        name: "n",
        target: "t",
        description: "d",
      },
      {
        kind: "reference-add",
        level: "project",
        collection: "team",
        name: "n",
        target: "t",
        description: "d",
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
    const review = await retryChoice(removal.setup, "reference-review");
    removal.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await removal.setup.renderOnce();
    expect(input(removal.setup, "reference-name")).toBe(name);
    expect(input(removal.setup, "reference-target")).toBe(target);
    expect(name.value).toBe("ref");
    expect(target.value).toBe("docs");
    expect(liveRenderable(removal.setup, "reference-review")).toBe(review);
    expect(removal.setup.renderer.currentFocusedRenderable).toBe(review);
    removal.patch({ error: undefined });
    await removal.setup.renderOnce();
    expect(liveRenderable(removal.setup, "reference-review")).toBe(review);
    expect(removal.setup.renderer.currentFocusedRenderable).toBe(review);
    removal.setup.mockInput.pressEnter();
    expect(removalPreviews).toEqual([
      {
        kind: "reference-remove",
        level: "project",
        collection: "team",
        name: "ref",
        expected: { collection: "docs", description: "old" },
      },
      {
        kind: "reference-remove",
        level: "project",
        collection: "team",
        name: "ref",
        expected: { collection: "docs", description: "old" },
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
    const review = await retryChoice(link.setup, "link-review");
    link.patch({ error: { code: "CANCELLED", message: "cancelled" } });
    await link.setup.renderOnce();
    expect(input(link.setup, "link-target")).toBe(target);
    expect(target.value).toBe("d");
    expect(liveRenderable(link.setup, "link-review")).toBe(review);
    expect(link.setup.renderer.currentFocusedRenderable).toBe(review);
    link.patch({ error: undefined });
    await link.setup.renderOnce();
    expect(liveRenderable(link.setup, "link-review")).toBe(review);
    expect(link.setup.renderer.currentFocusedRenderable).toBe(review);
    link.setup.mockInput.pressEnter();
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
      availableCollections={[{ id: "a" }, { id: "b" }]}
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
    const values = liveRenderable(use.setup, "collection-use-values") as SelectRenderable;
    use.setup.mockInput.pressEnter();
    use.setup.mockInput.pressArrow("down");
    await use.setup.renderOnce();
    use.setup.mockInput.pressEnter();
    await use.setup.flush();
    use.setup.mockInput.pressKey("TAB");
    await use.setup.renderOnce();
    const review = await retryChoice(use.setup, "collection-use-review");
    use.patch({ error: { code: "WRITE_FAILED", message: "retry" } });
    await use.setup.renderOnce();
    expect(liveRenderable(use.setup, "collection-use-values")).toBe(values);
    expect(
      values.options
        .filter((option) => option.name.startsWith("[x]"))
        .map((option) => option.value),
    ).toEqual(["a", "b"]);
    expect(liveRenderable(use.setup, "collection-use-review")).toBe(review);
    expect(use.setup.renderer.currentFocusedRenderable).toBe(review);
    use.patch({ error: undefined });
    await use.setup.renderOnce();
    expect(liveRenderable(use.setup, "collection-use-review")).toBe(review);
    expect(use.setup.renderer.currentFocusedRenderable).toBe(review);
    use.setup.mockInput.pressEnter();
    expect(usePreviews).toEqual([
      { kind: "collection-use", level: "project", collections: ["a", "b"] },
      { kind: "collection-use", level: "project", collections: ["a", "b"] },
    ]);
  } finally {
    use.setup.renderer.destroy();
  }
});
