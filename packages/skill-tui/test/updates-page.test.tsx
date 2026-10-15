/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { KeyCodes } from "@opentui/core/testing";
import { createSignal } from "solid-js";
import { createFocusRegistry } from "../src/focus";
import { SourceUpdatesPage, UpdatesPage, type SourceUpdatesPageProps } from "../src/updates/page";
import { buildUpdateScope, createUpdatesState } from "../src/updates/model";
import { workspaceProjection } from "./direct-source.fixture";

test("RENDER UpdatesPage registers commands and lets its browser own local row navigation", async () => {
  const address = { source: "team-main", path: "guide" };
  const snapshot = workspaceProjection();
  const state = createUpdatesState(
    buildUpdateScope(
      {
        ...snapshot,
        installedSkills: [
          {
            address,
            name: "guide",
            description: "A useful guide",
            owner: { source: "team-main", health: "healthy" as const },
            collections: [],
            selectors: [],
            selectorViews: { status: "complete" as const, values: [] },
            aliases: [],
            problems: [],
          },
        ],
      },
      { kind: "workspace" },
    ),
  );
  state.observe({
    source: "team-main",
    kind: "github",
    changed: [{ path: "guide", name: "guide", description: "A useful guide" }],
    added: [],
    removed: [],
    unchanged: [],
  });
  const registry = createFocusRegistry();
  const registered: string[] = [];
  const executors = new Map<string, () => void>();
  const dispatchRegistered = (id: string) => executors.get(id)?.();
  const submitted: (readonly (typeof address)[])[] = [];
  const opened: string[] = [];
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={state}
        onCheck={() => {}}
        onUpdate={(items) => submitted.push(items)}
        onStop={() => {}}
        onRetry={() => {}}
        onOpenSource={(source) => opened.push(source)}
        submittable={() => state.eligible()}
        retryable={() => []}
        focusRegistry={registry}
        registerCommand={(record, owner, _control, execute) => {
          registered.push(`${record.id}:${owner}`);
          executors.set(record.id, execute);
          return () => executors.delete(record.id);
        }}
        executeCommand={dispatchRegistered}
      />
    ),
    { width: 80, height: 16 },
  );
  try {
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById("updates-browser")!;
    browser.focus();
    expect(
      registry.dispatchMode(browser, { name: "enter", ctrl: false, shift: false, alt: false }),
    ).toBe("consumed");
    expect(opened).toEqual(["team-main"]);
    expect(state.group("team-main")?.expanded).toBe(false);
    expect(registry.ownerOf(browser)).toBe("browser");
    expect(registered).toContain("updates.update-all:command:updates.update-all");
    executors.get("updates.update-all")!();
    expect(submitted).toEqual([[address]]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER SourceUpdatesPage keeps its precise draft empty until a changed Skill is selected", async () => {
  const address = { source: "team-main", path: "guide" };
  const snapshot = workspaceProjection();
  const state = createUpdatesState(
    buildUpdateScope(
      {
        ...snapshot,
        installedSkills: [
          {
            address,
            name: "guide",
            description: "A useful guide",
            owner: { source: "team-main", health: "healthy" as const },
            collections: [],
            selectors: [],
            selectorViews: { status: "complete" as const, values: [] },
            aliases: [],
            problems: [],
          },
        ],
      },
      { kind: "source", source: "team-main" },
    ),
  );
  state.observe({
    source: "team-main",
    kind: "github",
    changed: [{ path: "guide", name: "guide", description: "A useful guide" }],
    added: [],
    removed: [],
    unchanged: [],
  });
  expect(state.selected()).toEqual([]);
  const setup = await testRender(
    () => (
      <SourceUpdatesPage
        state={state}
        source="team-main"
        skills={[{ address, name: "guide", description: "A useful guide" }]}
        query=""
        filter="all"
        onQuery={() => {}}
        onFilter={() => {}}
        onOpenSkill={() => {}}
        onSourceDetails={() => {}}
        onCheck={() => {}}
        onUpdate={() => {}}
        onStop={() => {}}
        onRetry={() => {}}
        submittable={() => state.eligible()}
      />
    ),
    { width: 80, height: 16 },
  );
  try {
    await setup.renderOnce();
    const initialReview = setup.renderer.root.findDescendantById("source-updates-submit");
    expect(initialReview).toBeDefined();
    expect(initialReview?.focusable).toBe(false);
    expect(setup.captureCharFrame()).toContain("Review selected 0 Skills");
    expect(setup.renderer.root.findDescendantById("source-updates-select-all")).toBeDefined();
    state.toggle(address);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("source-updates-submit")?.focusable).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

function sourceUpdatesFixture(count: number) {
  const skills = Array.from({ length: count + 1 }, (_, index) => {
    const path = `skill-${String(index + 1).padStart(3, "0")}`;
    return {
      address: { source: "team-main", path },
      name: path,
      description: `Description for ${path}`,
      owner: { source: "team-main", health: "healthy" as const },
      collections: [],
      selectors: [],
      selectorViews: { status: "complete" as const, values: [] },
      aliases: [],
      problems: [],
    };
  });
  const state = createUpdatesState(
    buildUpdateScope(
      { ...workspaceProjection(), installedSkills: skills },
      { kind: "source", source: "team-main" },
    ),
    { selection: "explicit" },
  );
  state.observe({
    source: "team-main",
    kind: "github",
    changed: skills.slice(0, count).map(({ address, name, description }) => ({
      path: address.path,
      name,
      description,
    })),
    added: [],
    removed: [],
    unchanged: [
      {
        path: skills[count]!.address.path,
        name: skills[count]!.name,
        description: skills[count]!.description,
      },
    ],
  });
  return {
    state,
    skills: skills.map(({ address, name, description }) => ({ address, name, description })),
  };
}

function sourcePage(
  state: ReturnType<typeof createUpdatesState>,
  skills: ReturnType<typeof sourceUpdatesFixture>["skills"],
  overrides: Partial<SourceUpdatesPageProps> = {},
) {
  return (
    <SourceUpdatesPage
      state={state}
      source="team-main"
      skills={skills}
      query=""
      filter="all"
      onQuery={() => {}}
      onFilter={() => {}}
      onOpenSkill={() => {}}
      onSourceDetails={() => {}}
      onCheck={() => {}}
      onUpdate={() => {}}
      onStop={() => {}}
      onRetry={() => {}}
      submittable={() => state.eligible()}
      {...overrides}
    />
  );
}

test("RENDER Updates overview uses separate Source, Status and quantity cells with fixed actions", async () => {
  const { state } = sourceUpdatesFixture(120);
  const opened: string[] = [],
    submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <UpdatesPage
        state={state}
        onCheck={() => {}}
        onUpdate={(addresses) => submitted.push(addresses)}
        onStop={() => {}}
        onRetry={() => {}}
        onOpenSource={(source) => opened.push(source)}
        submittable={() => state.eligible()}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("updates-browser-header-source"),
    );
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const rowId = "updates-browser-row-group%3Ateam-main";
    const status = setup.renderer.root.findDescendantById(`${rowId}:cell-status`) as TextRenderable;
    const quantity = setup.renderer.root.findDescendantById(
      `${rowId}:cell-updates`,
    ) as TextRenderable;
    expect(status).toBeInstanceOf(TextRenderable);
    expect(quantity).toBeInstanceOf(TextRenderable);
    expect(setup.renderer.root.findDescendantById("updates-browser-body")).toBeInstanceOf(
      ScrollBoxRenderable,
    );
    expect(setup.captureCharFrame()).not.toContain("team-main ·");
    const source = setup.renderer.root.findDescendantById(`${rowId}:cell-source`)!;
    await setup.mockMouse.click(source.screenX + 1, source.screenY);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-browser");
    expect(opened).toEqual([]);
    expect(submitted).toEqual([]);
    setup.mockInput.pressEnter();
    expect(opened).toEqual(["team-main"]);
    const check = setup.renderer.root.findDescendantById("updates-check")!;
    const body = setup.renderer.root.findDescendantById(
      "updates-browser-body",
    ) as ScrollBoxRenderable;
    body.scrollTo(100);
    await setup.renderOnce();
    expect(check.screenY + check.height).toBeLessThan(24);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source table retains guarded selection, hidden drafts and exact activation after native scrolling", async () => {
  const { state, skills } = sourceUpdatesFixture(120);
  const registry = createFocusRegistry();
  const opened: unknown[] = [];
  const [query, setQuery] = createSignal("");
  const safe = [skills[64]!.address];
  state.setFocusedRowKey(`source-skill:team-main\u0000${skills[64]!.address.path}`);
  state.setBrowserScroll(60);
  const setup = await testRender(
    () =>
      sourcePage(state, skills, {
        get query() {
          return query();
        },
        onQuery: setQuery,
        submittable: () => safe,
        focusRegistry: registry,
        onOpenSkill: (address) => opened.push(address),
      }),
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-updates-browser-header-skill"),
    );
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    const table = setup.renderer.root.findDescendantById("source-updates-browser") as BoxRenderable;
    const body = setup.renderer.root.findDescendantById(
      "source-updates-browser-body",
    ) as ScrollBoxRenderable;
    expect(body.scrollTop).toBe(60);
    table.focus();
    setup.mockInput.pressKey(" ");
    expect(state.selected()).toEqual(safe);
    setup.mockInput.pressKey(KeyCodes.HOME);
    setup.mockInput.pressKey(" ");
    expect(state.selected()).toEqual(safe);
    setQuery("skill-001");
    for (let i = 0; i < 3; i++) await setup.renderOnce();
    expect(state.selected()).toEqual(safe);
    expect(setup.captureCharFrame()).toContain("1 selected Skills hidden");
    setup.mockInput.pressEnter();
    expect(opened).toEqual([skills[0]!.address]);
    expect(registry.ownerOf(table)).toBe("browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source updates filter is only a filter and select-all reviews the explicit eligible set", async () => {
  const { state, skills } = sourceUpdatesFixture(3);
  const filtered: string[] = [];
  const updated: unknown[] = [];
  const reviewed: (readonly { source: string; path: string }[])[] = [];
  const setup = await testRender(
    () =>
      sourcePage(state, skills, {
        onFilter: (filter) => filtered.push(filter),
        onUpdate: (addresses) => updated.push(addresses),
        onReview: (addresses) => reviewed.push(addresses),
      }),
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(state.selected()).toEqual([]);
    const filter = setup.renderer.root.findDescendantById("source-updates-filter");
    expect(filter).toBeDefined();
    await setup.mockMouse.click(filter!.screenX + 1, filter!.screenY);
    expect(filtered).toEqual(["updates"]);
    expect(updated).toEqual([]);
    expect(reviewed).toEqual([]);

    const selectAll = setup.renderer.root.findDescendantById("source-updates-select-all");
    expect(selectAll).toBeDefined();
    await setup.mockMouse.click(selectAll!.screenX + 1, selectAll!.screenY);
    await setup.renderOnce();
    expect(state.selected()).toEqual(skills.slice(0, 3).map(({ address }) => address));
    expect(updated).toEqual([]);

    const review = setup.renderer.root.findDescendantById("source-updates-submit");
    expect(review?.focusable).toBe(true);
    review!.focus();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(reviewed).toEqual([skills.slice(0, 3).map(({ address }) => address)]);
    expect(updated).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [80, 24],
  [40, 12],
])(
  "RENDER Source updates actions remain in the viewport with 120 Skills at %ix%i",
  async (width, height) => {
    const { state, skills } = sourceUpdatesFixture(120);
    const setup = await testRender(() => sourcePage(state, skills), { width, height });
    try {
      await setup.renderOnce();
      const scroll = setup.renderer.root.findDescendantById("source-updates-scroll-region");
      const action = setup.renderer.root.findDescendantById("source-updates-select-all");
      expect(scroll).toBeDefined();
      expect(action).toBeDefined();
      expect(action!.screenY).toBeGreaterThanOrEqual(scroll!.screenY);
      expect(action!.screenY + action!.height).toBeLessThanOrEqual(
        scroll!.screenY + scroll!.height,
      );
      expect(action!.screenY + action!.height).toBeLessThanOrEqual(height);

      state.setStatus("team-main", "updating");
      await setup.renderOnce();
      const progress = setup.renderer.root.findDescendantById("source-updates-progress");
      const stop = setup.renderer.root.findDescendantById("source-updates-stop");
      expect(progress).toBeDefined();
      expect(stop).toBeDefined();
      expect(progress!.screenY).toBeGreaterThanOrEqual(scroll!.screenY);
      expect(progress!.screenY + progress!.height).toBeLessThanOrEqual(
        scroll!.screenY + scroll!.height,
      );
      expect(stop!.screenY).toBeGreaterThanOrEqual(scroll!.screenY);
      expect(stop!.screenY + stop!.height).toBeLessThanOrEqual(scroll!.screenY + scroll!.height);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Source update pending, stop, success, and failure are observable state", async () => {
  const { state, skills } = sourceUpdatesFixture(1);
  let stops = 0;
  const setup = await testRender(
    () =>
      sourcePage(state, skills, {
        active: () => state.group("team-main")?.status === "updating",
        onStop: () => stops++,
      }),
    { width: 80, height: 24 },
  );
  try {
    state.setStatus("team-main", "updating");
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("source-updates-progress")).toBeDefined();
    expect(setup.captureCharFrame()).toContain("Updating");
    const stop = setup.renderer.root.findDescendantById("source-updates-stop");
    expect(stop).toBeDefined();
    await setup.mockMouse.click(stop!.screenX + 1, stop!.screenY);
    expect(stops).toBe(1);

    state.setResult("team-main", "succeeded");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Recheck required");

    state.setStatus("team-main", "failed", "Update failed: remote rejected the change", "update");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Update failed: remote rejected the change");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER committed workspace refresh failure remains visible in Updates and Source", async () => {
  const snapshot = {
    ...workspaceProjection(),
    installedSkills: [
      {
        address: { source: "team-main", path: "guide" },
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      },
    ],
  };
  for (const surface of ["updates", "source"] as const) {
    const state = createUpdatesState(
      buildUpdateScope(snapshot, { kind: "source", source: "team-main" }),
    );
    state.setStatus(
      "team-main",
      "failed",
      "Installed Skills changed; check updates again",
      "check",
    );
    state.markCommitted("team-main", "Updated; Workspace is stale: fixture refresh failed");
    const setup = await testRender(
      () =>
        surface === "updates" ? (
          <UpdatesPage
            state={state}
            onCheck={() => {}}
            onUpdate={() => {}}
            onStop={() => {}}
            onRetry={() => {}}
          />
        ) : (
          <SourceUpdatesPage
            state={state}
            source="team-main"
            skills={[]}
            query=""
            filter="all"
            onQuery={() => {}}
            onFilter={() => {}}
            onOpenSkill={() => {}}
            onSourceDetails={() => {}}
            onCheck={() => {}}
            onUpdate={() => {}}
            onStop={() => {}}
            onRetry={() => {}}
          />
        ),
      { width: 80, height: 24 },
    );
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Workspace is stale: fixture refresh failed");
      expect(setup.captureCharFrame()).not.toContain("Up to date");
    } finally {
      setup.renderer.destroy();
    }
  }
});
