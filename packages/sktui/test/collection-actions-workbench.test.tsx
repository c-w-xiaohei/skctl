/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { ButtonRenderable } from "@tuiparts/core/button";
import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkctlError, type WorkspaceView, type SkillAddress } from "@skctl/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { collectionRelationRows } from "../src/collections-page";
import { collectionRelationKey } from "../src/collections/relationship-inspector";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import {
  enterLive,
  focusLive,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
function projection(): WorkspaceView {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const original = base.installedSkills[0]!;
  const names = [
    "guide",
    "reference",
    "audience-mapper",
    "brief-generator",
    "budget-optimizer",
    "campaign-planner",
    "competitor-tracker",
    "content-amplifier",
    "contract-reviewer",
    "creator-content-auditor",
    "fit-scorer",
    "influencer-discovery",
    "landing-optimizer",
    "outreach-manager",
    "performance-analyzer",
    "report-generator",
    "趋势观察-中文👨‍👩‍👧‍👦",
  ];
  const members = names.map((name) => ({
    name,
    address: { source: original.address.source, path: name },
    paths: [
      {
        kind: "direct" as const,
        collection: team.id,
        entryName: name,
        owner: { ...team.declared[0]!, pointer: `/collections/team/members/${name}` },
      },
    ],
  }));
  return {
    ...base,
    installedSkills: members.map((member) => ({
      ...original,
      address: member.address,
      name: member.name,
      description: `Installed ${member.name} instructions`,
      collections: [{ id: team.id, entry: member.name, paths: member.paths }],
    })),
    effective: {
      ...base.effective,
      collectionsView: [{ ...team, members }, ...base.effective.collectionsView.slice(1)],
    },
  };
}
type Setup = Awaited<ReturnType<typeof testRender>>;
async function mount(
  width: number,
  height: number,
  input: WorkspaceView = projection(),
  configuration: Partial<import("../src/session").TuiCore> = {},
) {
  const cache = await mkdtemp(join(tmpdir(), "collection-actions-"));
  const previous = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const reads: SkillAddress[] = [],
    changes: unknown[] = [],
    previews: unknown[] = [],
    usePreviews: unknown[] = [];
  const core = directSourceCore(input, {
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => {
      reads.push(address);
      const text = `# ${address.path}\n\nExact installed ${address.path} instructions.`;
      return {
        address,
        name: address.path,
        description: address.path,
        rawText: text,
        markdownText: text,
      };
    },
    ...configuration,
  });
  const preview = core.previewMembershipBatch;
  core.previewMembershipBatch = async (
    _environment: import("@skctl/core").CoreOptions,
    request,
    options,
  ) => {
    previews.push(request);
    return preview(_environment, request, options);
  };
  const previewUse = core.previewCollectionUse;
  core.previewCollectionUse = async (
    _environment: import("@skctl/core").CoreOptions,
    request,
    options,
  ) => {
    usePreviews.push(request);
    return previewUse(_environment, request, options);
  };
  const guardWrite = async () => {
    throw new Error("Unconfirmed row actions must not mutate Config");
  };
  core.addMember = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push({ method: "addMember", request });
    return guardWrite();
  };
  core.removeMember = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push({ method: "removeMember", request });
    return guardWrite();
  };
  core.editMembers = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push({ method: "editMembers", request });
    return guardWrite();
  };
  core.setUse = async (_environment: import("@skctl/core").CoreOptions, request) => {
    changes.push({ method: "use.set", request });
    return guardWrite();
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, { width, height });
  return {
    setup,
    reads,
    changes,
    previews,
    usePreviews,
    async dispose() {
      setup.renderer.destroy();
      if (previous === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = previous;
      await rm(cache, { recursive: true, force: true });
    },
  };
}
const descendants = (target: BaseRenderable): BaseRenderable[] => [
  target,
  ...target.getChildren().flatMap(descendants),
];
async function openActions(setup: Setup) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  return setup.renderer.currentFocusedRenderable as SelectRenderable;
}
async function chooseAction(setup: Setup, id: string) {
  const choices = await openActions(setup);
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let row = 0; row < index; row++) setup.mockInput.pressArrow("down");
  await parsedEnter(setup);
}
async function inspectRelation(setup: Setup, workspace: WorkspaceView, label: string) {
  const row = collectionRelationRows("team", workspace).find((item) => item.label === label);
  expect(row).toBeDefined();
  await enterLive(
    setup,
    `collection-included-remove-${encodeURIComponent(collectionRelationKey(row!))}`,
  );
}
async function selectRow(setup: Setup, down: number) {
  await focusLive(setup, "collection-relationships");
  for (let row = 0; row < down; row++) setup.mockInput.pressArrow("down");
  await setup.flush();
}
async function openContents(setup: Setup) {
  await openMainPage(setup, "collections");
  await enterLive(setup, "collection-browser");
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
  );
  await setup.flush();
}
test("Collection description opens the existing editor and saves to the selected declaration", async () => {
  const writes: unknown[] = [];
  const mounted = await mount(100, 24, projection(), {
    setCollectionContent: async (_environment, request) => {
      writes.push(request);
      return {
        value: { level: request.level, file: request.expectedOwner!.file, changed: true },
        diagnostics: [],
      };
    },
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, "collection-tabs-tab-description");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-description"));
    await enterLive(setup, "collection-action-edit-collection-content");
    await focusLive(setup, "collection-content-description");
    const input = setup.renderer.currentFocusedRenderable as InputRenderable;
    input.value = "Team workflows";
    await enterLive(setup, "collection-content-save");
    await setup.waitFor(() => writes.length === 1);
    const workspace = projection();
    if (workspace.effective.status !== "complete") throw new Error("Expected complete workspace");
    expect(writes[0]).toMatchObject({
      collection: "team",
      description: "Team workflows",
      expectedOwner: workspace.effective.collectionsView[0]!.declared[0],
    });
    expect(writes[0]).not.toHaveProperty("instructions");
  } finally {
    await mounted.dispose();
  }
});

test("Members and Settings expose Reference, Link, and Import at 43 by 13", async () => {
  const mounted = await mount(43, 13);
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, "collection-add");
    const reference = setup.renderer.root.findDescendantById("collection-action-add-reference");
    expect(reference).toBeDefined();
    expect(reference!.screenX + reference!.width).toBeLessThanOrEqual(42);
    await parsedEscape(setup);
    await enterLive(setup, "collection-tabs-tab-settings");
    await setup.flush();
    for (const id of ["add-link", "import-collection"]) {
      const control = setup.renderer.root.findDescendantById(`collection-action-${id}`);
      expect(!!control).toBe(true);
      expect(control!.screenX + control!.width).toBeLessThanOrEqual(42);
      expect(control!.screenY + control!.height).toBeLessThanOrEqual(11);
    }
    await enterLive(setup, "collection-action-add-link");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("link-target"));
  } finally {
    await mounted.dispose();
  }
});

test.each(["link", "reference", "import"] as const)(
  "%s review Back restores edited fields and repeats the same owner-bound preview",
  async (kind) => {
    const base = projection();
    if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
    const owner = base.effective.collectionsView[0]!.declared[0]!;
    const previews: unknown[] = [];
    const mounted = await mount(100, 24, base, {
      previewAddReference: async (_environment, request) => {
        previews.push(request);
        return {
          value: {
            kind: "reference",
            collection: request.collection,
            name: request.name,
            referencedCollection: request.target,
            description: request.description,
            owner,
            decision: { kind: "direct", owner },
            allowed: true,
          },
          diagnostics: [],
        };
      },
      previewImport: async (_environment, request) => {
        previews.push(request);
        return {
          value: {
            kind: "collection-import",
            source: request.from,
            destination: request.into,
            owner,
            additions: [],
            skipped: [],
            conflicts: [],
            allowed: true,
          },
          diagnostics: [],
        };
      },
      previewLinkChange: async (_environment, request) => {
        previews.push(request);
        return {
          value: {
            kind: "link-change",
            collection: request.collection,
            target: request.target,
            owner,
            linked: request.linked,
            members: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          },
          diagnostics: [],
        };
      },
    });
    const { setup } = mounted;
    try {
      await openContents(setup);
      if (kind !== "reference") await enterLive(setup, "collection-tabs-tab-settings");
      else await enterLive(setup, "collection-add");
      await enterLive(
        setup,
        kind === "import" ? "collection-action-import-collection" : `collection-action-add-${kind}`,
      );
      const fields =
        kind === "link"
          ? [["link-target", "docs"]]
          : kind === "reference"
            ? [
                ["reference-name", "read-docs"],
                ["reference-target", "docs"],
                ["reference-description", "Read this guidance"],
              ]
            : [
                ["collection-import-from", "docs"],
                ["collection-import-into", "team-copy"],
              ];
      const review = kind === "import" ? "collection-import-review" : `${kind}-review`;
      for (const [id, value] of fields) {
        await focusLive(setup, id!);
        (setup.renderer.currentFocusedRenderable as InputRenderable).value = value!;
      }
      await enterLive(setup, review);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-back"));
      await enterLive(setup, "collection-review-back");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(fields[0]![0]!));
      for (const [id, value] of fields)
        expect((setup.renderer.root.findDescendantById(id!) as InputRenderable).value).toBe(value!);
      await enterLive(setup, review);
      await setup.waitFor(() => previews.length === 2);
      expect(previews[1]).toEqual(previews[0]);
    } finally {
      await mounted.dispose();
    }
  },
);

test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "Collections task toolbar and current actions fit %ix%i with real-length content",
  async (width, height) => {
    const mounted = await mount(width, height);
    const { setup } = mounted;
    try {
      await openContents(setup);
      const output = process.env.COLLECTION_ACTION_CAPTURE_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await writeFile(
          join(output, `collections-actions-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
      }
      expect(setup.renderer.root.findDescendantById("collection-add")).toBeDefined();
      expect(
        setup.renderer.root.findDescendantById("collection-relationships-header-actions"),
      ).toBeUndefined();
      const body = setup.renderer.root.findDescendantById("collection-detail-pane")!;
      const cell = setup.renderer.root.findDescendantById("collection-current-actions-pane")!;
      expect(cell.screenX + cell.width).toBeLessThanOrEqual(body.screenX + body.width - 1);
      expect(cell.screenY + cell.height).toBeLessThanOrEqual(height - 2);
      expect(cell.width).toBeGreaterThan(0);
      for (const paneId of [
        "collection-content-controls-pane",
        "collections-search-controls-pane",
      ]) {
        const pane = setup.renderer.root.findDescendantById(paneId);
        if (!pane) continue;
        for (const button of descendants(pane).filter((node) => node instanceof ButtonRenderable)) {
          expect(button.screenX).toBeGreaterThanOrEqual(pane.screenX);
          expect(button.screenX + button.width).toBeLessThanOrEqual(pane.screenX + pane.width);
          expect(button.screenY + button.height).toBeLessThanOrEqual(pane.screenY + pane.height);
        }
      }
      expect(mounted.changes).toEqual([]);
      await setup.mockInput.typeText(" ");
      await setup.flush();
      expect(
        setup.renderer.root.findDescendantById("collection-relationships-header-actions"),
      ).toBeUndefined();
      const checkedCell = setup.renderer.root.findDescendantById(
        "collection-current-actions-pane",
      )!;
      expect(checkedCell.screenY + checkedCell.height).toBeLessThan(height - 1);
      if (output)
        await writeFile(
          join(output, `collections-batch-${width}x${height}.txt`),
          setup.captureCharFrame(),
        );
    } finally {
      await mounted.dispose();
    }
  },
);
test("multi-origin Membership has no implicit Remove and Manage preserves explicit origin choice", async () => {
  const base = projection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const member = team.members[0]!;
  const input = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...team,
          members: [
            {
              ...member,
              paths: [
                ...member.paths,
                {
                  kind: "repository-derived" as const,
                  repository: "fixture/repo",
                  source: "team-main",
                  path: "guide",
                },
              ],
            },
            ...team.members.slice(1),
          ],
        },
        ...base.effective.collectionsView.slice(1),
      ],
    },
  };
  const mounted = await mount(144, 40, input);
  const { setup } = mounted;
  try {
    await openContents(setup);
    const startupReads = [...mounted.reads];
    await selectRow(setup, 0);
    const current = await openActions(setup);
    expect(current.options.some((option) => option.value.id === "membership.remove")).toBe(true);
    await parsedEscape(setup);
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-origin"),
    );
    expect(mounted.previews).toEqual([]);
    expect(mounted.changes).toEqual([]);
    expect(mounted.reads).toEqual(startupReads);
  } finally {
    await mounted.dispose();
  }
});
test("Tab reaches a table with unavailable Read and still reaches its enabled Manage", async () => {
  const base = projection();
  const input = {
    ...base,
    installedSkills: base.installedSkills.filter((skill) => skill.address.path !== "guide"),
  };
  const mounted = await mount(144, 40, input);
  const { setup } = mounted;
  try {
    await openContents(setup);
    await selectRow(setup, 0);
    const actions = await openActions(setup);
    expect(
      actions.options.find((option) => option.value.id === "membership.open-skill")?.value,
    ).toMatchObject({ enabled: false, disabledReason: "Unavailable: installed Skill unavailable" });
    await parsedEscape(setup);
    await focusLive(setup, "collection-add");
    for (
      let i = 0;
      i < 20 && setup.renderer.currentFocusedRenderable?.id !== "collection-relationships";
      i++
    ) {
      setup.mockInput.pressTab();
      await setup.flush();
    }
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
    setup.mockInput.pressTab({ shift: true });
    await setup.flush();
    setup.mockInput.pressTab();
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
    );
    expect(mounted.reads.every((address) => address.path !== "guide")).toBe(true);
    expect(mounted.changes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Reference Manage to Link preserves action meaning without entering Unlink", async () => {
  const base = projection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const input = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        { ...team, links: [{ collection: "docs", owner: team.declared[0]! }] },
        ...base.effective.collectionsView.slice(1),
      ],
    },
  };
  const mounted = await mount(144, 40, input);
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, "collection-tabs-tab-settings");
    await inspectRelation(setup, input, "Link docs");
    expect(mounted.changes).toEqual([]);
    expect(mounted.previews).toEqual([]);
    expect(setup.captureCharFrame()).toContain("Stop including Collection");
  } finally {
    await mounted.dispose();
  }
});
test("unlinking a direct relation previews and executes with its enclosing Collection owner", async () => {
  const base = projection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const owner = team.declared[0]!;
  const input = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...team,
          links: [
            { collection: "docs", owner: { ...owner, pointer: "/collections/team/links/0" } },
          ],
        },
        ...base.effective.collectionsView.slice(1),
      ],
    },
  };
  const previews: unknown[] = [];
  const writes: unknown[] = [];
  const mounted = await mount(144, 40, input, {
    previewLinkChange: async (_environment: import("@skctl/core").CoreOptions, request) => {
      previews.push(request);
      return {
        value: {
          kind: "link-change",
          collection: request.collection,
          target: request.target,
          owner,
          linked: request.linked,
          members: [],
          disappearingSelectors: [],
          retainedSelectors: [],
          blockers: [],
          allowed: true,
        },
        diagnostics: [],
      };
    },
    setLink: async (_environment: import("@skctl/core").CoreOptions, request) => {
      writes.push(request);
      return { value: { level: owner.level, file: owner.file, changed: true }, diagnostics: [] };
    },
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, "collection-tabs-tab-settings");
    await inspectRelation(setup, input, "Link docs");
    await enterLive(setup, "link-review");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-choice"));
    expect(previews).toEqual([
      {
        level: "project",
        collection: "team",
        target: "docs",
        linked: false,
        expectedOwner: owner,
      },
    ]);
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => writes.length === 1);
    expect(writes).toEqual([
      {
        level: "project",
        collection: "team",
        target: "docs",
        linked: false,
        expectedOwner: owner,
      },
    ]);
  } finally {
    await mounted.dispose();
  }
});
test("removing a direct Reference preserves its expected value and enclosing Collection owner", async () => {
  const base = projection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = base.effective.collectionsView[0]!;
  const owner = team.declared[0]!;
  const input = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...team,
          references: [
            {
              name: "docs-ref",
              collection: "docs",
              description: "Team docs",
              owner: { ...owner, pointer: "/collections/team/references/docs-ref" },
            },
          ],
        },
        ...base.effective.collectionsView.slice(1),
      ],
    },
  };
  const previews: unknown[] = [];
  const writes: unknown[] = [];
  const mounted = await mount(144, 40, input, {
    previewRemoveReference: async (_environment: import("@skctl/core").CoreOptions, request) => {
      previews.push(request);
      return {
        value: {
          kind: "reference",
          collection: request.collection,
          name: request.name,
          referencedCollection: "docs",
          description: "Team docs",
          owner,
          decision: { kind: "direct", owner },
          allowed: true,
        },
        diagnostics: [],
      };
    },
    removeReference: async (_environment: import("@skctl/core").CoreOptions, request) => {
      writes.push(request);
      return { value: { level: owner.level, file: owner.file, changed: true }, diagnostics: [] };
    },
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    await selectRow(setup, team.members.length);
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-relationship.remove-reference");
    await enterLive(setup, "reference-review");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-choice"));
    const expected = {
      level: "project",
      collection: "team",
      name: "docs-ref",
      expected: { collection: "docs", description: "Team docs" },
      expectedOwner: owner,
    };
    expect(previews).toEqual([expected]);
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => writes.length === 1);
    expect(writes).toEqual([expected]);
  } finally {
    await mounted.dispose();
  }
});
test("inline Use edit retains the host Config's other roots and cancellation writes nothing", async () => {
  const base = projection();
  const input = {
    ...base,
    effective:
      base.effective.status === "complete"
        ? {
            ...base.effective,
            use: ["team", "docs"],
            agent: { ...base.effective.agent, status: "available" as const },
          }
        : base.effective,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: ["team", "docs"].map((collection, index) => ({
                collection,
                owner: {
                  level: "project" as const,
                  file: "/workspace/skctl/skctl.jsonc",
                  pointer: `/use/${index}`,
                },
              })),
            },
          }
        : config,
    ),
  };
  const mounted = await mount(144, 40, input);
  const { setup } = mounted;
  try {
    await openContents(setup);
    await openMainPage(setup, "agent");
    await enterLive(
      setup,
      setup.renderer.root.findDescendantById("agent-access-collections")
        ? "agent-access-collections"
        : "skills-setup-primary",
    );
    const scope = (await focusLive(setup, "scope-choices")) as SelectRenderable;
    scope.setSelectedIndex(scope.options.findIndex((item) => item.value === "project"));
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
    expect(
      (setup.renderer.root.findDescendantById("collection-use-values") as SelectRenderable).options
        .filter((option) => option.name.startsWith("[x]"))
        .map((option) => option.value),
    ).toEqual(["team", "docs"]);
    await enterLive(setup, "collection-use-review");
    await setup.waitFor(() => mounted.usePreviews.length === 1);
    expect(mounted.usePreviews[0]).toMatchObject({
      level: "project",
      collections: ["team", "docs"],
    });
    await parsedEscape(setup);
    expect(mounted.changes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("current-row Actions Remove previews only that Membership and leaves a different checked row untouched on cancel", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await openContents(setup);
    await selectRow(setup, 1);
    await setup.mockInput.typeText(" ");
    await setup.flush();
    await setup.mockInput.pressArrow("up");
    await setup.flush();
    await chooseAction(setup, "membership.remove");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership-removal-plan"));
    await setup.waitFor(() => mounted.previews.length === 1);
    expect(mounted.previews[0]).toMatchObject({
      collection: "team",
      removals: [{ name: "guide", expectedAddress: { source: "team-main", path: "guide" } }],
    });
    await parsedEscape(setup);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("1 items checked");
    expect(mounted.changes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("current-row Actions Read uses that row address and Back restores the Collection without changing checks", async () => {
  const mounted = await mount(144, 40);
  const { setup } = mounted;
  try {
    await openContents(setup);
    const startupReads = [...mounted.reads];
    await setup.mockInput.typeText(" ");
    await setup.flush();
    await selectRow(setup, 1);
    await chooseAction(setup, "membership.open-skill");
    await waitForReaderBody(setup, "Exact installed reference instructions.").catch((error) => {
      throw new Error(
        `${error}\nreads=${JSON.stringify(mounted.reads)} focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
      );
    });
    expect(mounted.reads.slice(startupReads.length)).toEqual([
      { source: "team-main", path: "reference" },
    ]);
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.root.findDescendantById("collection-relationships") instanceof BoxRenderable,
    );
    expect(setup.captureCharFrame()).toContain("1 items checked");
    expect(mounted.changes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Collection unified preview preserves mounted Reference draft on failure and retries the same review after a write conflict", async () => {
  const input = projection();
  if (input.effective.status !== "complete") throw new Error("Expected complete fixture");
  const owner = input.effective.collectionsView[0]!.declared[0]!;
  let previews = 0;
  let writes = 0;
  const mounted = await mount(144, 40, input, {
    previewAddReference: async (_environment: import("@skctl/core").CoreOptions, request) => {
      if (++previews === 1) throw new SkctlError("PROVIDER_UNAVAILABLE", "retry preview");
      return {
        value: {
          kind: "reference",
          collection: request.collection,
          name: request.name,
          referencedCollection: request.target,
          description: request.description,
          decision: { kind: "direct", owner },
          owner,
          allowed: true,
        },
        diagnostics: [],
      };
    },
    addReference: async (_environment: import("@skctl/core").CoreOptions, request) => {
      mounted.changes.push({ method: "addReference", request });
      if (++writes === 1) throw new SkctlError("CONFIG_CONFLICT", "changed after preview");
      return { value: { level: "project", file: owner.file, changed: true }, diagnostics: [] };
    },
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    await enterLive(setup, "collection-add");
    await enterLive(setup, "collection-action-add-reference");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reference-name"));
    const name = (await focusLive(setup, "reference-name")) as InputRenderable;
    await setup.mockInput.typeText("new-docs");
    await focusLive(setup, "reference-target");
    await setup.mockInput.typeText("docs");
    await focusLive(setup, "reference-description");
    await setup.mockInput.typeText("Read next");
    await enterLive(setup, "reference-review");
    await setup.waitForFrame((frame) => frame.includes("retry preview"));
    expect(setup.renderer.root.findDescendantById("reference-name")).toBe(name);
    expect(name.value).toBe("new-docs");
    expect(mounted.changes).toEqual([]);
    await enterLive(setup, "reference-review");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-review-choice",
    );
    expect(previews).toBe(2);
    await enterLive(setup, "collection-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("changed after preview"));
    expect(previews).toBe(2);
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("collection-review-confirm"));
    expect(mounted.changes).toEqual([
      {
        method: "addReference",
        request: {
          level: "project",
          collection: "team",
          name: "new-docs",
          target: "docs",
          description: "Read next",
        },
      },
      {
        method: "addReference",
        request: {
          level: "project",
          collection: "team",
          name: "new-docs",
          target: "docs",
          description: "Read next",
        },
      },
    ]);
    expect(previews).toBe(2);
  } finally {
    await mounted.dispose();
  }
});
test("Collection removal close and reopen ignores the previous session's late preview", async () => {
  const input = projection();
  if (input.effective.status !== "complete") throw new Error("Expected complete fixture");
  const owner = input.effective.collectionsView[0]!.declared[0]!;
  const pending: {
    readonly signal?: AbortSignal;
    readonly finish: () => void;
  }[] = [];
  const mounted = await mount(144, 40, input, {
    previewCollectionRemoval: (
      _environment: import("@skctl/core").CoreOptions,
      _request,
      options,
    ) =>
      new Promise((resolve) => {
        pending.push({
          signal: options?.signal,
          finish: () =>
            resolve({
              value: {
                kind: "collection-removal",
                owner,
                decision: { kind: "direct", owner },
                repository: { derived: false, producers: [] },
                disappearingSelectors: [],
                retainedSelectors: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            }),
        });
      }),
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    await chooseAction(setup, "remove-collection");
    await setup.waitFor(() => pending.length === 1);
    await parsedEscape(setup);
    expect(pending[0]!.signal?.aborted).toBe(true);
    await chooseAction(setup, "remove-collection");
    await setup.waitFor(() => pending.length === 2);
    pending[0]!.finish();
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
    expect(pending[1]!.signal?.aborted).toBe(false);
    pending[1]!.finish();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-review-choice",
    );
    await parsedEscape(setup);
    expect(mounted.changes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
test("Collection removal-plan dismissal retains checked origins when a cancelled batch preview resolves late", async () => {
  const input = projection();
  if (input.effective.status !== "complete") throw new Error("Expected complete fixture");
  const owner = input.effective.collectionsView[0]!.declared[0]!;
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  const mounted = await mount(144, 40, input, {
    previewMembershipBatch: (_environment: import("@skctl/core").CoreOptions, request, options) =>
      new Promise((resolve) => {
        signal = options?.signal;
        finish = () =>
          resolve({
            value: {
              kind: "membership-batch",
              collection: request.collection,
              decision: { kind: "direct", owner },
              additions: request.additions,
              removals: request.removals,
              affected: [],
              blockers: [],
              effectful: true,
              allowed: true,
            },
            diagnostics: [],
          });
      }),
  });
  const { setup } = mounted;
  try {
    await openContents(setup);
    await selectRow(setup, 1);
    await setup.mockInput.typeText(" ");
    await setup.flush();
    setup.mockInput.pressArrow("up");
    await setup.flush();
    await chooseAction(setup, "membership.remove");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership-removal-plan"));
    await setup.waitFor(() => signal !== undefined);
    await parsedEscape(setup);
    expect(signal?.aborted).toBe(true);
    finish();
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("membership-removal-plan"));
    await setup.waitForFrame(
      (frame) => frame.includes("Collections") && frame.includes("1 items checked"),
    );
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("1 items checked");
    expect(mounted.changes).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});
