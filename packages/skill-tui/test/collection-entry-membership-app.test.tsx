import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { readFile } from "node:fs/promises";
import type { ManagementProjection, MembershipBatchImpact, OperationResult } from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, parsedEnter, parsedEscape } from "./reader-test-controls";

const result = <T,>(value: T): OperationResult<T> => ({
  value,
  diagnostics: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const owner = (file = "/workspace/skill-cli/skill-cli.jsonc", pointer = "/collections/team") => ({
  level: "project" as const,
  file,
  pointer,
});

type Origin =
  | {
      readonly kind: "direct";
      readonly entryName: string;
      readonly owner: ReturnType<typeof owner>;
      readonly slot?: number;
    }
  | {
      readonly kind: "via-link";
      readonly outer: string;
      readonly target: string;
      readonly slot?: number;
    };

function projection(origins: readonly Origin[]): ManagementProjection {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  return {
    ...base,
    effective: {
      ...base.effective,
      collections: ["team"],
      collectionsView: [
        {
          id: "team",
          declared: [owner()],
          repository: { derived: false, producers: [] },
          members: origins.map((origin, index) => {
            const slot = origin.slot ?? index + 1;
            return {
              name: origin.kind === "direct" ? origin.entryName : `linked-${slot}`,
              address: { source: "team-main", path: `skill-${slot}` },
              paths: [
                origin.kind === "direct"
                  ? {
                      kind: "direct" as const,
                      collection: "team",
                      entryName: origin.entryName,
                      owner: origin.owner,
                    }
                  : {
                      kind: "via-link" as const,
                      links: [
                        {
                          collection: origin.outer,
                          linkedCollection: origin.target,
                          owner: owner("/workspace/links.jsonc", "/collections/outer/links/team"),
                        },
                      ],
                    },
              ],
            };
          }),
          references: [],
          links: [],
        },
      ],
    },
  };
}

async function openEntries(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
  const section = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
  section.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
  await setup.renderOnce();
  setup.mockInput.pressArrow("right");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
  const browser = setup.renderer.root.findDescendantById("collection-browser") as SelectRenderable;
  await setup.waitFor(() => browser.focusable && browser.height > 0);
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
  const relationships = setup.renderer.root.findDescendantById(
    "collection-relationships",
  ) as SelectRenderable;
  relationships.focus();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
  );
}

test("RENDER immediate Collections navigation keeps shell focus when no detail follows", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection([]))} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    setup.renderer.root.findDescendantById("shell-section-tab-skills")!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-skills",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-collections",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER rapid Collections detail navigation does not let shell focus steal the detail", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          projection([{ kind: "direct", entryName: "guide-entry", owner: owner() }]),
        )}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    setup.renderer.root.findDescendantById("shell-section-tab-skills")!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-skills",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    const browser = setup.renderer.root.findDescendantById(
      "collection-browser",
    ) as SelectRenderable;
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-entries" ||
        setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
  } finally {
    setup.renderer.destroy();
  }
});

async function selectOrigins(setup: Awaited<ReturnType<typeof testRender>>, count: number) {
  for (let index = 0; index < count; index++) {
    const rows = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    rows.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === rows);
    await setup.mockInput.typeText(" ");
    await setup.flush();
    if (index < count - 1) {
      const liveRows = setup.renderer.root.findDescendantById(
        "collection-relationships",
      ) as SelectRenderable;
      liveRows.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === liveRows);
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
  }
}

async function activateRemove(setup: Awaited<ReturnType<typeof testRender>>) {
  await enterLive(setup, "remove-from-collection");
}

async function removeSelected(setup: Awaited<ReturnType<typeof testRender>>) {
  await activateRemove(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership-removal-plan"));
}

function batchImpact(request: {
  readonly collection: string;
  readonly additions: MembershipBatchImpact["additions"];
  readonly removals: MembershipBatchImpact["removals"];
}): MembershipBatchImpact {
  return {
    kind: "membership-batch",
    collection: request.collection,
    decision: { kind: "direct", owner: owner() },
    additions: request.additions,
    removals: request.removals,
    affected: [],
    blockers: [],
    effectful: true,
    allowed: true,
  };
}

test("RENDER Collection Entry Space selection is isolated from Relations and content loading", async () => {
  let loads = 0;
  const base = directSourceCore(
    projection([
      { kind: "direct", entryName: "guide-entry", owner: owner() },
      { kind: "direct", entryName: "review-entry", owner: owner() },
    ]),
  );
  const core = {
    ...base,
    content: {
      ...base.content,
      loadInstalled: async (request: Parameters<typeof base.content.loadInstalled>[0]) => {
        loads++;
        return result({
          address: request.address,
          name: request.address.path,
          description: "",
          rawText: "",
          markdownText: "",
        });
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openEntries(setup);
    expect(setup.renderer.root.findDescendantById("remove-from-collection")).toBeUndefined();
    await selectOrigins(setup, 1);
    expect(setup.captureCharFrame()).toContain("1 origins selected");
    expect(setup.captureCharFrame()).toContain("[x] guide-entry");
    expect(loads).toBe(0);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await selectOrigins(setup, 1);
    expect(setup.captureCharFrame()).toContain("2 origins selected");
    setup.renderer.root.findDescendantById("collection-tabs-tab-entries")!.focus();
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(() => setup.captureCharFrame().includes("KIND TARGET"));
    setup.renderer.root.findDescendantById("collection-relationships")!.focus();
    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("1 origins selected");
    expect(loads).toBe(0);
    setup.renderer.root.findDescendantById("collection-tabs-tab-relations")!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-relations",
    );
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.captureCharFrame().includes("2 origins selected"));
    expect(setup.renderer.root.findDescendantById("remove-from-collection")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER one Membership with multiple origins has one row and exact cardinality", async () => {
  const initial = projection([
    {
      kind: "direct",
      entryName: "guide-entry",
      owner: owner(undefined, "/collections/team/members/guide-entry"),
    },
  ]);
  if (initial.effective.status !== "complete") throw new Error("expected complete fixture");
  const member = initial.effective.collectionsView[0]!.members[0]!;
  const multiOrigin = {
    ...initial,
    effective: {
      ...initial.effective,
      collectionsView: [
        {
          ...initial.effective.collectionsView[0]!,
          members: [
            {
              ...member,
              paths: [
                ...member.paths,
                {
                  kind: "repository-derived" as const,
                  repository: "acme/team",
                  source: "team-main",
                  path: "skill-1",
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(multiOrigin)} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await openEntries(setup);
    await setup.waitForFrame((frame) => frame.includes("1 Membership"));
    const rows = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    expect(rows.options).toHaveLength(1);
    expect(rows.options[0]!.name).toContain("guide-entry");
    expect(setup.captureCharFrame()).toContain("1 Membership");
    expect(setup.captureCharFrame()).toContain("2 origins");
    expect(setup.captureCharFrame()).not.toContain("1 Entries");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Membership Enter opens a non-destructive origin inspector", async () => {
  let previews = 0;
  const base = projection([
    {
      kind: "direct",
      entryName: "guide-entry",
      owner: owner(undefined, "/collections/team/members/guide-entry"),
    },
  ]);
  const sourceCore = directSourceCore(base);
  const core = {
    ...sourceCore,
    configuration: {
      ...sourceCore.configuration,
      previewMembershipBatch: async (
        ...args: Parameters<typeof sourceCore.configuration.previewMembershipBatch>
      ) => {
        previews++;
        return sourceCore.configuration.previewMembershipBatch(...args);
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openEntries(setup);
    await setup.waitForFrame((frame) => frame.includes("guide-entry"));
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Membership guide-entry"));
    expect(previews).toBe(0);
    expect(setup.captureCharFrame()).toContain("Origin");
    expect(setup.renderer.root.findDescendantById("membership.remove")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [120, 40],
  [80, 24],
])(
  "RENDER direct Membership inspector keeps origin and Remove Membership controls in the native viewport at %ix%i",
  async (width, height) => {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(
            projection([
              {
                kind: "direct",
                entryName: "guide-entry",
                owner: owner(undefined, "/collections/team/members/guide-entry"),
              },
            ]),
          )}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await openEntries(setup);
      setup.mockInput.pressEnter();
      await setup.waitForFrame((frame) => frame.includes("Membership guide-entry"));
      const origin = setup.renderer.root.findDescendantById(
        "collection-membership-origin",
      ) as SelectRenderable;
      const remove = setup.renderer.root.findDescendantById("membership.remove")!;
      expect(setup.renderer.root.findDescendantById("membership.open-owner")).toBeDefined();
      for (const control of [origin, remove]) {
        expect(control.screenX).toBeGreaterThanOrEqual(0);
        expect(control.screenY).toBeGreaterThanOrEqual(0);
        expect(control.width).toBeGreaterThan(0);
        expect(control.height).toBeGreaterThan(0);
        expect(control.screenX + control.width).toBeLessThanOrEqual(width);
        expect(control.screenY + control.height).toBeLessThanOrEqual(height);
      }
      expect(remove.screenY).toBeGreaterThanOrEqual(origin.screenY + origin.height);
      remove.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === remove);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER cancelling direct Membership removal retains the inspector origin and does not mutate config", async () => {
  const initial = projection([
    {
      kind: "direct",
      entryName: "guide-entry",
      owner: owner(undefined, "/collections/team/members/guide-entry"),
    },
  ]);
  const changes: unknown[] = [];
  const previews: unknown[] = [];
  const base = directSourceCore(initial);
  const core = {
    ...base,
    configuration: {
      ...base.configuration,
      previewMembershipBatch: async (
        request: Parameters<typeof base.configuration.previewMembershipBatch>[0],
      ) => {
        previews.push(request);
        return result({
          ...batchImpact(request),
          decision: {
            kind: "direct" as const,
            owner: owner(),
          },
        });
      },
      change: async (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return result({ level: "project" as const, changed: true });
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openEntries(setup);
    await setup.waitForFrame((frame) => frame.includes("guide-entry"));
    // Contents Enter reads installed instructions; explicit Manage opens ownership.
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id.includes(".manage") === true,
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    await enterLive(setup, "membership.remove");
    await setup.waitForFrame((frame) => frame.includes("Remove from Collection"));
    await setup.waitFor(() => previews.length === 1);
    expect(setup.renderer.root.findDescendantById("collection-review-choice")).toBeDefined();
    await enterLive(setup, "collection-review-choice");
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("membership.remove");
    expect(setup.renderer.root.findDescendantById("collection-membership-inspector")).toBeDefined();
    expect(changes).toHaveLength(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("App has no Collection inspector Escape branch", async () => {
  const app = await readFile(new URL("../src/app.tsx", import.meta.url), "utf8");
  const priorityHandler = app.slice(
    app.indexOf("const interceptPriorityKey"),
    app.indexOf('renderer.keyInput.prependListener("keypress", interceptPriorityKey)'),
  );
  expect(priorityHandler).not.toContain("collectionsState.closeInspector()");
  expect(priorityHandler).not.toContain('requestFocus("collection-relationships")');
});

test("RENDER same-owner Collection Entry removals preview and change once, then clear removed origins", async () => {
  const initial = projection([
    {
      kind: "direct",
      entryName: "guide-entry",
      owner: owner(undefined, "/collections/team/members/guide-entry"),
    },
    {
      kind: "direct",
      entryName: "review-entry",
      owner: owner(undefined, "/collections/team/members/review-entry"),
    },
  ]);
  const refreshed = projection([]);
  const writing =
    deferred<OperationResult<{ readonly level: "project"; readonly changed: boolean }>>();
  const previews: unknown[] = [];
  const changes: unknown[] = [];
  let refreshes = 0;
  const base = directSourceCore(initial);
  const core = {
    ...base,
    workspace: {
      get: async () => result(++refreshes === 1 ? initial : refreshed),
    },
    configuration: {
      ...base.configuration,
      previewMembershipBatch: async (
        request: Parameters<typeof base.configuration.previewMembershipBatch>[0],
      ) => {
        previews.push(request);
        return result(batchImpact(request));
      },
      change: (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return writing.promise;
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openEntries(setup);
    await selectOrigins(setup, 2);
    await removeSelected(setup);
    expect(setup.captureCharFrame()).toContain("Remove: guide-entry team-main/skill-1");
    expect(setup.captureCharFrame()).toContain("Remove: review-entry team-main/skill-2");
    await enterLive(setup, "membership-removal-plan-continue");
    await setup.waitFor(() => previews.length === 1);
    expect(previews).toEqual([
      {
        level: "project",
        collection: "team",
        expectedOwner: owner(),
        additions: [],
        removals: [
          {
            name: "guide-entry",
            expectedAddress: { source: "team-main", path: "skill-1" },
          },
          {
            name: "review-entry",
            expectedAddress: { source: "team-main", path: "skill-2" },
          },
        ],
      },
    ]);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-choice"));
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => changes.length === 1);
    expect(changes).toEqual([
      {
        type: "collection.members.change",
        level: "project",
        collection: "team",
        additions: [],
        removals: [
          {
            name: "guide-entry",
            expectedAddress: { source: "team-main", path: "skill-1" },
          },
          {
            name: "review-entry",
            expectedAddress: { source: "team-main", path: "skill-2" },
          },
        ],
        reviewedAffected: [],
      },
    ]);
    writing.resolve(result({ level: "project", changed: true }));
    await setup.waitFor(() => refreshes === 2);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("collection-batch-pane"));
    expect(previews).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER mixed direct and linked Entry origins removes only the direct origin", async () => {
  const direct = {
    kind: "direct" as const,
    entryName: "guide-entry",
    owner: owner(undefined, "/collections/team/members/guide-entry"),
  };
  const linked = {
    kind: "via-link" as const,
    outer: "outer",
    target: "target",
    slot: 2,
  };
  const initial = projection([direct, linked]);
  const refreshed = projection([linked]);
  const previews: unknown[] = [];
  const changes: unknown[] = [];
  let refreshes = 0;
  const base = directSourceCore(initial);
  const core = {
    ...base,
    workspace: {
      get: async () => result(++refreshes === 1 ? initial : refreshed),
    },
    configuration: {
      ...base.configuration,
      previewMembershipBatch: async (
        request: Parameters<typeof base.configuration.previewMembershipBatch>[0],
      ) => {
        previews.push(request);
        return result(batchImpact(request));
      },
      change: async (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return result({ level: "project" as const, changed: true });
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openEntries(setup);
    await selectOrigins(setup, 2);
    await removeSelected(setup);
    expect(setup.captureCharFrame()).toContain("Remove: guide-entry team-main/skill-1");
    expect(setup.captureCharFrame()).toContain("linked-2: Link outer -> target owns this entry");
    await enterLive(setup, "membership-removal-plan-continue");
    await setup.waitFor(() => previews.length === 1);
    expect(previews[0]).toEqual({
      level: "project",
      collection: "team",
      expectedOwner: owner(),
      additions: [],
      removals: [
        {
          name: "guide-entry",
          expectedAddress: { source: "team-main", path: "skill-1" },
        },
      ],
    });
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => refreshes === 2);
    await setup.waitFor(() => setup.captureCharFrame().includes("1 origins checked"));
    expect(setup.captureCharFrame()).toContain("linked-2");
    expect(changes).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER multi-owner removal opens a no-write task and Escape preserves Entry selections", async () => {
  const one = owner("/workspace/one.jsonc", "/collections/team");
  const two = owner("/workspace/two.jsonc", "/collections/team");
  const initial = projection([
    {
      kind: "direct",
      entryName: "one",
      owner: { ...one, pointer: "/collections/team/members/one" },
    },
    {
      kind: "direct",
      entryName: "two",
      owner: { ...two, pointer: "/collections/team/members/two" },
    },
  ]);
  if (initial.effective.status !== "complete") throw new Error("expected complete fixture");
  const multiOwner = {
    ...initial,
    effective: {
      ...initial.effective,
      collectionsView: [{ ...initial.effective.collectionsView[0]!, declared: [one, two] }],
    },
  };
  const base = directSourceCore(multiOwner);
  let previews = 0;
  let changes = 0;
  const core = {
    ...base,
    configuration: {
      ...base.configuration,
      previewMembershipBatch: async () => (previews++, result({} as MembershipBatchImpact)),
      change: async () => (changes++, result({ level: "project" as const, changed: false })),
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 79,
    height: 24,
  });
  try {
    await openEntries(setup);
    await selectOrigins(setup, 2);
    await activateRemove(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership-impact-task"));
    expect(setup.captureCharFrame()).toContain("Membership impact requires multiple owners");
    expect(setup.captureCharFrame()).toContain(
      "Owner: project /workspace/one.jsonc /collections/team",
    );
    expect(setup.captureCharFrame()).toContain(
      "Owner: project /workspace/two.jsonc /collections/team",
    );
    expect(setup.captureCharFrame()).toContain("No changes were applied");
    expect(previews).toBe(0);
    expect(changes).toBe(0);
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("membership-impact-task"));
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.captureCharFrame()).toContain("2 origins checked");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER linked-only Entry removal is Cancel-only and retains selection", async () => {
  const base = directSourceCore(
    projection([{ kind: "via-link", outer: "outer", target: "target" }]),
  );
  let previews = 0;
  let changes = 0;
  const core = {
    ...base,
    configuration: {
      ...base.configuration,
      previewMembershipBatch: async () => (previews++, result({} as MembershipBatchImpact)),
      change: async () => (changes++, result({ level: "project" as const, changed: false })),
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openEntries(setup);
    await selectOrigins(setup, 1);
    await removeSelected(setup);
    const plan = setup.renderer.root.findDescendantById(
      "membership-removal-plan",
    ) as SelectRenderable;
    expect(plan).toBeDefined();
    expect(setup.captureCharFrame()).toContain("linked-1: Link outer -> target owns this entry");
    expect(previews).toBe(0);
    expect(changes).toBe(0);
    await enterLive(setup, "membership-removal-plan");
    await setup.waitForFrame(
      (frame) => frame.includes("1 origins checked") && !frame.includes("Remove from team"),
    );
  } finally {
    setup.renderer.destroy();
  }
});
