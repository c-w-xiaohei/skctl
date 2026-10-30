import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SourceRegistrationOverlay } from "../src/operations/source-registration";
import { CollectionHandoffOverlay, InstalledSkillChooserOverlay } from "../src/operations/choices";
import { SourceObservationOverlay, SourceSelectionOverlay } from "../src/operations/source";
import { createSignal } from "solid-js";
import {
  CollectionContentOverlay,
  CollectionCreateOverlay,
  CollectionImportOverlay,
  ReferenceOverlay,
  LinkChangeOverlay,
} from "../src/operations/collection-forms";
import { enterLive, focusLive } from "./reader-test-controls";
import { skillsStatus } from "../src/workspace/skills-status";
import { workspaceProjection } from "./direct-source.fixture";
import { CollectionReviewOverlay } from "../src/operations/collection-review";

test("Collection review keeps Back, Cancel and confirmation visible for a long impact at 43x13", async () => {
  const setup = await testRender(
    () => (
      <CollectionReviewOverlay
        review={{
          kind: "link-change",
          id: "review",
          intent: {
            kind: "link-change",
            level: "project",
            collection: "team",
            target: "docs",
            linked: true,
          },
          impact: {
            kind: "link-change",
            collection: "team",
            target: "docs",
            linked: true,
            owner: { level: "project", file: "/project/skctl.jsonc", pointer: "/collections/team" },
            members: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          },
        }}
        pending={false}
        error={{
          code: "CONFIG_CONFLICT",
          message: "Review the changed configuration. ".repeat(40),
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
        onBack={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    for (const id of [
      "collection-review-choice",
      "collection-review-back",
      "collection-review-confirm",
    ]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY).toBeGreaterThanOrEqual(0);
      expect(control.screenY + control.height).toBeLessThanOrEqual(13);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test.each(["import", "reference", "link"] as const)(
  "%s keeps review and cancel visible with long errors at 43x13",
  async (kind) => {
    const common = {
      level: "project" as const,
      pending: false,
      error: { code: "CONFIG_CONFLICT", message: "Review the changed configuration. ".repeat(30) },
      onPreview: () => {},
      onCancel: () => {},
    };
    const setup = await testRender(
      () =>
        kind === "import" ? (
          <CollectionImportOverlay {...common} from="docs" into="team" />
        ) : kind === "reference" ? (
          <ReferenceOverlay
            {...common}
            collection="team"
            name="docs"
            target="docs"
            description="Guidance"
            remove={false}
          />
        ) : (
          <LinkChangeOverlay {...common} collection="team" target="docs" linked />
        ),
      { width: 43, height: 13 },
    );
    try {
      await setup.renderOnce();
      const prefix = kind === "import" ? "collection-import" : kind;
      for (const suffix of ["review", "cancel"]) {
        const control = setup.renderer.root.findDescendantById(`${prefix}-${suffix}`)!;
        expect(control.screenY).toBeGreaterThanOrEqual(0);
        expect(control.screenY + control.height).toBeLessThanOrEqual(13);
      }
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("failed discovery keeps Back, Cancel and Retry visible with long errors in a short terminal", async () => {
  const actions: string[] = [];
  const setup = await testRender(
    () => (
      <SourceObservationOverlay
        title="Discovering Skills"
        source="team"
        cancelling={false}
        error={{
          code: "SOURCE_NOT_FOUND",
          message: "Repository could not be reached. ".repeat(50),
        }}
        onBack={() => actions.push("back")}
        onClose={() => actions.push("cancel")}
        onRetry={() => actions.push("retry")}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    for (const id of [
      "source-observation-back",
      "source-observation-progress",
      "source-observation-retry",
    ]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY).toBeGreaterThanOrEqual(0);
      expect(control.screenY + control.height).toBeLessThanOrEqual(13);
      await enterLive(setup, id);
    }
    expect(actions).toEqual(["back", "cancel", "retry"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection handoff keeps creation and cancellation visible with many targets in a short terminal", async () => {
  let creates = 0;
  let cancels = 0;
  const setup = await testRender(
    () => (
      <CollectionHandoffOverlay
        choices={Array.from({ length: 30 }, (_, index) => ({
          collection: `team-${index}`,
          level: "project",
        }))}
        onCreate={() => creates++}
        onClose={() => cancels++}
        onSelect={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    for (const id of ["collection-handoff-create", "collection-handoff-cancel"]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY).toBeGreaterThanOrEqual(0);
      expect(control.screenY + control.height).toBeLessThanOrEqual(13);
    }
    await enterLive(setup, "collection-handoff-create");
    await enterLive(setup, "collection-handoff-cancel");
    expect([creates, cancels]).toEqual([1, 1]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection creation restores its confirmed scope and all text when returning from the picker", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionCreateOverlay
        allowedLevels={["global", "project", "local"]}
        collection=""
        initialDraft={{ collection: "team", description: "Shared workflow", level: "global" }}
        pending={false}
        onBack={() => {}}
        onCancel={() => {}}
        onSubmit={(value) => submitted.push(value)}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    expect(
      (
        setup.renderer.root.findDescendantById("collection-create-level") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe("global");
    await enterLive(setup, "collection-create-submit");
    expect(submitted).toEqual([
      { collection: "team", description: "Shared workflow", level: "global" },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection creation submits an optional description in the same request", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionCreateOverlay
        level="project"
        collection="team"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await focusLive(setup, "collection-create-description");
    await setup.mockInput.typeText("Team workflows");
    await enterLive(setup, "collection-create-submit");
    expect(submitted).toEqual([
      { level: "project", collection: "team", description: "Team workflows" },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection creation keeps its submit visible at 43 by 13 while editing the description", async () => {
  const setup = await testRender(
    () => (
      <CollectionCreateOverlay
        allowedLevels={["global", "project", "local"]}
        collection="team"
        configFile={() => "/workspace/team/skctl.jsonc"}
        pending={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await focusLive(setup, "collection-create-description");
    await setup.mockInput.typeText("Team workflows");
    await setup.renderOnce();
    const submit = setup.renderer.root.findDescendantById("collection-create-submit")!;
    expect(submit.screenY).toBeGreaterThanOrEqual(0);
    expect(submit.screenY + submit.height).toBeLessThanOrEqual(11);
    expect(setup.captureCharFrame()).toContain("Create");
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection content editing keeps save and cancel visible above long instructions at 43 by 13", async () => {
  const saved: unknown[] = [];
  const setup = await testRender(
    () => (
      <CollectionContentOverlay
        collection="team"
        owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/team" }}
        instructions={"Existing instructions\n".repeat(30)}
        pending={false}
        onSave={(value) => saved.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await focusLive(setup, "collection-content-description");
    await setup.mockInput.typeText("Team workflows");
    await setup.flush();
    for (const id of ["collection-content-save", "collection-content-cancel"]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control.screenY).toBeGreaterThanOrEqual(2);
      expect(control.screenY + control.height).toBeLessThanOrEqual(11);
    }
    await enterLive(setup, "collection-content-save");
    expect(saved).toEqual([
      {
        level: "project",
        collection: "team",
        expectedOwner: {
          level: "project",
          file: "/project/skctl.jsonc",
          pointer: "/collections/team",
        },
        description: "Team workflows",
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Source address suggests an editable ID and tracks remote HEAD by default", async () => {
  const submissions: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        pending={false}
        onSubmit={(value, discover) => submissions.push({ value, discover })}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("https://github.com/acme/skills");
    await setup.renderOnce();
    expect(
      (setup.renderer.root.findDescendantById("source-register-id") as InputRenderable).value,
    ).toBe("skills");
    await enterLive(setup, "source-register-submit");
    expect(submissions).toEqual([
      {
        value: {
          level: "project",
          id: "skills",
          binding: {
            kind: "github",
            owner: "acme",
            repository: "skills",
            origin: "https://github.com/acme/skills",
            ref: "HEAD",
            root: "",
          },
        },
        discover: true,
      },
    ]);
    await enterLive(setup, "source-register-only");
    expect(submissions[1]).toMatchObject({ discover: false });
  } finally {
    setup.renderer.destroy();
  }
});

test("empty Collections suggest adding members before choosing catalog roots", () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete workspace");
  const workspace = {
    ...base,
    installedSkills: [
      {
        address: { source: "mine", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "mine", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" as const },
        aliases: [],
        problems: [],
      },
    ],
    effective: {
      ...base.effective,
      use: [],
      collections: ["frontend"],
      collectionsView: [
        {
          id: "frontend",
          members: [],
          declared: [],
          references: [],
          links: [],
          repository: { derived: false, producers: [] },
        },
      ],
    },
  };
  expect(skillsStatus(workspace)).toMatchObject({
    action: "organize-collection",
    collection: "frontend",
  });
});

test("Source candidates support search and Space selection without losing checked paths", async () => {
  let selected!: () => readonly string[];
  const setup = await testRender(
    () => {
      const [paths, setPaths] = createSignal<readonly string[]>([]);
      const [query, setQuery] = createSignal("");
      selected = paths;
      return (
        <SourceSelectionOverlay
          review={{
            kind: "discovery",
            id: "test",
            intent: { kind: "source-discovery", source: "mine" },
            observation: {
              source: "mine",
              kind: "local",
              candidates: ["alpha", "beta"].map((name) => ({
                name,
                path: name,
                description: name,
              })),
            },
          }}
          installed={new Set()}
          selected={paths()}
          query={query()}
          onQuery={setQuery}
          pending={false}
          onToggle={(path) =>
            setPaths((items) =>
              items.includes(path) ? items.filter((item) => item !== path) : [...items, path],
            )
          }
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      );
    },
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-operation-search"));
    await focusLive(setup, "source-operation-selection");
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    await focusLive(setup, "source-operation-search");
    await setup.mockInput.typeText("beta");
    await setup.renderOnce();
    await focusLive(setup, "source-operation-selection");
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    expect(selected()).toEqual(["alpha", "beta"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection picker keeps checked Skills across searches and submits the explicit batch", async () => {
  const submitted: unknown[] = [];
  const skills = ["alpha", "beta", "existing"].map((name) => ({
    name,
    description: name,
    address: { source: "mine", path: name },
  }));
  const setup = await testRender(
    () => (
      <InstalledSkillChooserOverlay
        skills={skills}
        collection="frontend"
        owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/frontend" }}
        members={[{ name: "existing", address: skills[2]!.address }]}
        onSelect={(items) => submitted.push(items)}
        onClose={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-search"));
    await focusLive(setup, "installed-skill-choice");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-choice");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(submitted).toEqual([]);
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    await focusLive(setup, "installed-skill-search");
    await setup.mockInput.typeText("beta");
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-choice",
    ) as SelectRenderable;
    expect(list.options).toHaveLength(1);
    await focusLive(setup, "installed-skill-choice");
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    await enterLive(setup, "installed-skill-choice-submit");
    expect(submitted).toEqual([
      [
        { name: "alpha", address: skills[0]!.address },
        { name: "beta", address: skills[1]!.address },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection content editor writes only edited fields to its exact owner", async () => {
  const saved: unknown[] = [];
  const owner = {
    level: "project" as const,
    file: "/project/skctl.jsonc",
    pointer: "/collections/frontend",
  };
  const setup = await testRender(
    () => (
      <CollectionContentOverlay
        collection="frontend"
        owner={owner}
        description="Frontend tasks"
        instructions={"Read the description.\nChoose a member."}
        pending={false}
        onSave={(value) => saved.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await focusLive(setup, "collection-content-description");
    await setup.mockInput.typeText(" updated");
    await setup.renderOnce();
    await enterLive(setup, "collection-content-save");
    expect(saved).toEqual([
      {
        level: "project",
        collection: "frontend",
        expectedOwner: owner,
        description: "Frontend tasks updated",
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection target and submit stay visible above a long draft at 43 by 13", async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    name: `skill-${index}`,
    description: "Skill",
    address: { source: "mine", path: `skill-${index}` },
  }));
  const setup = await testRender(
    () => (
      <InstalledSkillChooserOverlay
        collection="frontend"
        owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/frontend" }}
        skills={items}
        initialSelected={items}
        onSelect={() => {}}
        onClose={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Add 20 Skills");
    await focusLive(setup, "installed-skill-name-19");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("frontend");
    expect(setup.captureCharFrame()).toContain("Add 20 Skills");
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection Source filter preserves checked Skills from other Sources", async () => {
  const submitted: unknown[] = [];
  const skills = ["alpha", "beta"].map((name) => ({
    name,
    description: name,
    address: { source: name, path: "guide" },
  }));
  const setup = await testRender(
    () => (
      <InstalledSkillChooserOverlay
        collection="team"
        owner={{ level: "project", file: "/project/skctl.jsonc", pointer: "/collections/team" }}
        skills={skills}
        onSelect={(items) => submitted.push(items)}
        onClose={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await enterLive(setup, "installed-skill-choice");
    const sources = (await focusLive(setup, "installed-skill-source")) as SelectRenderable;
    sources.setSelectedIndex(2);
    await setup.renderOnce();
    const candidates = setup.renderer.root.findDescendantById(
      "installed-skill-choice",
    ) as SelectRenderable;
    expect(candidates.options).toHaveLength(1);
    expect(candidates.options[0]!.name).toContain("beta");
    await enterLive(setup, "installed-skill-choice");
    await enterLive(setup, "installed-skill-choice-submit");
    expect(submitted).toEqual([
      [
        { name: "alpha", address: skills[0]!.address },
        { name: "beta", address: skills[1]!.address },
      ],
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
