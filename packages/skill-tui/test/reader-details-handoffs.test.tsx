import { expect, test } from "bun:test";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextBufferRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import type { ConfigLevel, WorkspaceView, OperationResult } from "@skill-cli/core";
import { directSourceCore } from "./direct-source.fixture";
import type { TuiCore } from "../src/effects";
import {
  enterInstalledAddress,
  enterReaderDetailsRelationship,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  openReaderManagement,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
} from "./reader-test-controls";

const address = { source: "team-main", path: "guide" };
const projectOwner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/collections/engineering",
};
const globalOwner = {
  level: "global" as const,
  file: "/home/user/.config/skill-cli.jsonc",
  pointer: "/collections/engineering",
};

function projection(): WorkspaceView {
  const source = {
    id: "team-main",
    kind: "github" as const,
    origin: "https://github.com/acme/main",
    root: "skills",
    ref: "main",
    provenance: { level: "project" as const },
    selectors: [],
  };
  return {
    project: { root: "/workspace/skill-cli", resolution: "explicit" },
    configs: [
      {
        level: "global",
        file: { status: "valid", file: globalOwner.file },
        direct: {
          sources: [],
          configSources: [],
          collections: [{ id: "engineering", owner: globalOwner }],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: [] },
      },
      {
        level: "project",
        file: { status: "valid", file: projectOwner.file },
        direct: {
          sources: [{ ...source, ref: { id: "team-main", owner: projectOwner } }],
          configSources: [],
          collections: [{ id: "engineering", owner: projectOwner }],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: ["contributed"] },
      },
    ],
    effective: {
      status: "complete",
      sources: [source],
      collections: ["engineering", "contributed", "derived"],
      use: [],
      managed: false,
      collectionsView: [
        {
          id: "engineering",
          declared: [globalOwner, projectOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "contributed",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "derived",
          declared: [],
          repository: { derived: true, producers: [address] },
          members: [],
          references: [],
          links: [],
        },
      ],
      agent: { status: "unavailable", integration: [], use: [], reasons: [], catalog: [] },
    },
    installedSkills: [
      {
        address,
        name: "guide",
        description: "Guide",
        owner: { source: "team-main", health: "healthy", relevantRemoteRevision: "abcdef" },
        source,
        collections: [],
        selectors: [],
        selectorViews: { status: "unavailable" },
        aliases: [],
        problems: [],
      },
    ],
    diagnostics: [],
  };
}

const result = <T,>(value: T): OperationResult<T> => ({ value, diagnostics: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderableText(node: { getChildren(): readonly unknown[] }): string {
  return node
    .getChildren()
    .flatMap((child) =>
      child instanceof TextBufferRenderable
        ? [child.plainText]
        : child && typeof child === "object" && "getChildren" in child
          ? renderableText(child as { getChildren(): readonly unknown[] })
          : [],
    )
    .join("\n");
}

function membershipConfiguration<L extends ConfigLevel>(
  base: TuiCore["collections"],
  owner: { readonly level: L; readonly file: string; readonly pointer: string },
  changes: unknown[],
  previews: unknown[],
  writing: ReturnType<
    typeof deferred<
      OperationResult<{ readonly level: L; readonly file: string; readonly changed: true }>
    >
  >,
): TuiCore["collections"] {
  return {
    ...base,
    previewMemberEdit: async (request) => {
      previews.push(request);
      return result({
        kind: "membership-batch" as const,
        collection: request.collection,
        decision: { kind: "direct" as const, owner },
        additions: request.additions,
        removals: request.removals,
        affected: [],
        blockers: [],
        effectful: true,
        allowed: true,
      });
    },
    previewAddMember: async (request) => {
      previews.push(request);
      return result({
        kind: "add-to-collection" as const,
        collection: request.collection,
        address: request.address,
        decision: { kind: "direct" as const, owner },
        intent: {
          owner,
          stableEntryName: request.name,
          address: request.address,
        },
        existing: [],
        blockers: [],
        allowed: true,
      });
    },
    editMembers: (request) => {
      changes.push({ method: "editMembers", request });
      return writing.promise;
    },
  };
}

function contributedProjection(): WorkspaceView {
  const base = projection();
  if (base.effective.status !== "complete") throw new Error("Missing effective Collections");
  const configSourceOwner = {
    level: "global" as const,
    file: "/home/user/.config/skill-cli.jsonc",
    pointer: "/configSources/team-config",
  };
  const source = {
    id: "team-config/lark",
    kind: "github" as const,
    origin: "https://github.com/acme/lark",
    root: "skills",
    ref: "main",
    provenance: { level: "global" as const },
    contribution: {
      configSource: configSourceOwner,
      declaration: { level: "global" as const, pointer: "/sources/lark" },
    },
    selectors: [],
  };
  const collectionOwner = {
    level: "global" as const,
    file: configSourceOwner.file,
    pointer: "/collections/contributed",
    contribution: {
      configSource: configSourceOwner,
      declaration: { level: "global" as const, pointer: "/collections/contributed" },
    },
  };
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            direct: {
              ...config.direct,
              configSources: [
                {
                  id: "team-config",
                  owner: configSourceOwner,
                  binding: {
                    kind: "github" as const,
                    origin: "https://github.com/acme/config",
                    root: ".",
                    ref: "main",
                  },
                  adoption: { status: "adopted" as const, commit: "abc123" },
                  contributed: {
                    sources: [source],
                    collections: [{ id: "contributed", owner: collectionOwner }],
                  },
                },
              ],
            },
          }
        : {
            ...config,
            contributed: { ...config.contributed, sources: [source], collections: ["contributed"] },
          },
    ),
    effective: {
      ...base.effective,
      sources: [source],
      collections: ["engineering", "contributed"],
      collectionsView: base.effective.collectionsView.map((collection) =>
        collection.id === "contributed"
          ? { ...collection, declared: [collectionOwner] }
          : collection,
      ),
    },
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        address: { source: "team-config/lark", path: "guide" },
        owner: { source: "team-config/lark", health: "healthy", relevantRemoteRevision: "abcdef" },
        source,
      },
    ],
  };
}

function contributedAgentProjection(): WorkspaceView {
  const base = contributedProjection();
  if (base.effective.status !== "complete") throw new Error("Missing effective Collections");
  const owner = base.effective.collectionsView.find((collection) => collection.id === "contributed")
    ?.declared[0];
  if (!owner) throw new Error("Missing contributed Collection owner");
  return {
    ...base,
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        collections: [
          {
            id: "contributed",
            entry: "guide",
            paths: [
              {
                kind: "direct" as const,
                collection: "contributed",
                entryName: "guide",
                owner,
              },
              {
                kind: "via-link" as const,
                links: [{ collection: "shared", linkedCollection: "contributed", owner }],
              },
            ],
          },
        ],
        selectors: ["contributed:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "contributed:guide",
              collection: "contributed",
              entry: "guide",
              paths: [
                {
                  kind: "direct" as const,
                  collection: "contributed",
                  entryName: "guide",
                  owner,
                },
                {
                  kind: "via-link" as const,
                  links: [{ collection: "shared", linkedCollection: "contributed", owner }],
                },
              ],
              useOwners: [],
            },
          ],
        },
      },
    ],
  };
}

function localContributedProjection(): WorkspaceView {
  const base = projection();
  const configSourceOwner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/configSources/local-team",
  };
  const source = {
    id: "local-team/lark",
    kind: "local" as const,
    origin: "/workspace/shared-skills",
    root: "skills",
    provenance: { level: "project" as const },
    contribution: {
      configSource: configSourceOwner,
      declaration: {
        level: "local" as const,
        file: "/workspace/shared-skills/skill-cli.jsonc",
        pointer: "/sources/lark",
        namespace: "local-team",
      },
    },
    selectors: [],
  };
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              configSources: [
                {
                  id: "local-team",
                  owner: configSourceOwner,
                  binding: { kind: "local" as const, path: "/workspace/shared-skills", root: "." },
                  adoption: { status: "live" as const },
                  contributed: { sources: [source], collections: [] },
                },
              ],
            },
            contributed: { ...config.contributed, sources: [source] },
          }
        : config,
    ),
    effective: { ...base.effective, sources: [source] },
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        address: { source: "local-team/lark", path: "guide" },
        owner: {
          source: "local-team/lark",
          health: "healthy",
          relevantLocalRoot: "/workspace/shared-skills/skills/guide",
        },
        source,
      },
    ],
  };
}

async function openDetailsActions(
  setup: Awaited<ReturnType<typeof testRender>>,
  focusAction = true,
  expectedAddress = address,
) {
  await openAllInstalledSkills(setup);
  await enterInstalledAddress(setup, expectedAddress);
  await openReaderTab(setup, 2);
  await openReaderManagement(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("reader-details-action-skill-add-to-collection"),
  );
  if (focusAction) await focusLive(setup, "reader-details-action-skill-add-to-collection");
}

async function chooseCollection(setup: Awaited<ReturnType<typeof testRender>>, count: number) {
  await focusLive(setup, "collection-handoff-choice");
  await setup.mockInput.pressKeys(Array.from({ length: count }, () => "ARROW_DOWN"));
  setup.mockInput.pressEnter();
  await setup.renderOnce();
}

async function openRelationships(
  setup: Awaited<ReturnType<typeof testRender>>,
  value: string,
  expectedAddress = address,
) {
  await openAllInstalledSkills(setup);
  await enterInstalledAddress(setup, expectedAddress);
  await openReaderTab(setup, 2);
  await enterReaderDetailsRelationship(setup, value);
}

async function confirmReview(setup: Awaited<ReturnType<typeof testRender>>) {
  live(setup, "collection-review-confirm").focus();
  await parsedEnter(setup);
}

async function returnToReaderDetails(
  setup: Awaited<ReturnType<typeof testRender>>,
  relationship: string,
  expectedAddress = address,
) {
  await parsedEscape(setup);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(
    `reader-details-relationship-${relationship}`,
  );
  expect(live(setup, `reader-details-relationship-${relationship}`).focused).toBe(true);
  expect(selectedReaderTab(setup)).toBe(2);
  expect((live(setup, "reader-details") as ScrollBoxRenderable).scrollTop).toBe(0);
  expect(renderableText(live(setup, "reader-details"))).toContain(
    `Address\n${expectedAddress.source}/${expectedAddress.path}`,
  );
}

test("Details Add to collection previews Core-authorized membership and commits the first direct owner once", async () => {
  const changes: unknown[] = [];
  const previews: Parameters<TuiCore["collections"]["previewMemberEdit"]>[0][] = [];
  const writing =
    deferred<
      OperationResult<{ readonly level: "global"; readonly file: string; readonly changed: true }>
    >();
  const base = directSourceCore(projection());
  const core = {
    ...base,
    workspace: {
      get: async () => result(projection()),
    },
    collections: membershipConfiguration(base.collections, globalOwner, changes, previews, writing),
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openDetailsActions(setup, false);
    await focusLive(setup, "reader-details-action-skill-add-to-collection");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "reader-details-action-skill-add-to-collection",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    const chooser = setup.renderer.root.findDescendantById("collection-handoff-choice") as
      | SelectRenderable
      | undefined;
    expect(chooser?.getSelectedIndex()).toBe(0);
    await chooseCollection(setup, 0);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    expect(setup.renderer.root.findDescendantById("membership-batch-review")).toBeDefined();
    expect(previews).toEqual([]);
    expect(setup.captureCharFrame()).toContain("guide");
    await focusLive(setup, "membership-batch-review");
    await parsedEnter(setup);
    await setup.waitFor(() => previews.length === 1);
    expect(previews).toEqual([
      {
        level: "global",
        collection: "engineering",
        additions: [{ name: "guide", address }],
        removals: [],
        expectedOwner: globalOwner,
      },
    ]);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-choice"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-review-choice");
    expect(changes).toEqual([]);
    await confirmReview(setup);
    await setup.waitFor(() => changes.length === 1);
    expect(changes).toEqual([
      {
        method: "editMembers",
        request: {
          level: "global",
          collection: "engineering",
          additions: [{ name: "guide", address }],
          removals: [],
          expectedOwner: globalOwner,
          reviewedAffected: [],
        },
      },
    ]);
    expect(changes).toHaveLength(1);
    writing.resolve(result({ level: "global", file: "skill-cli.jsonc", changed: true }));
  } finally {
    setup.renderer.destroy();
  }
});

test("Details Add to collection previews and commits the second same-ID direct owner", async () => {
  const changes: unknown[] = [];
  const previews: Parameters<TuiCore["collections"]["previewMemberEdit"]>[0][] = [];
  const writing =
    deferred<
      OperationResult<{ readonly level: "project"; readonly file: string; readonly changed: true }>
    >();
  const base = directSourceCore(projection());
  const core = {
    ...base,
    workspace: {
      get: async () => result(projection()),
    },
    collections: membershipConfiguration(
      base.collections,
      projectOwner,
      changes,
      previews,
      writing,
    ),
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openDetailsActions(setup, false);
    await focusLive(setup, "reader-details-action-skill-add-to-collection");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "reader-details-action-skill-add-to-collection",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await chooseCollection(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    expect(setup.renderer.root.findDescendantById("membership-batch-review")).toBeDefined();
    expect(previews).toEqual([]);
    expect(setup.captureCharFrame()).toContain("guide");
    await focusLive(setup, "membership-batch-review");
    await parsedEnter(setup);
    await setup.waitFor(() => previews.length === 1);
    expect(previews).toEqual([
      {
        level: "project",
        collection: "engineering",
        additions: [{ name: "guide", address }],
        removals: [],
        expectedOwner: projectOwner,
      },
    ]);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-review-choice",
    );
    expect(changes).toEqual([]);
    await confirmReview(setup);
    await setup.waitFor(() => changes.length === 1);
    expect(changes).toEqual([
      {
        method: "editMembers",
        request: {
          level: "project",
          collection: "engineering",
          additions: [{ name: "guide", address }],
          removals: [],
          expectedOwner: projectOwner,
          reviewedAffected: [],
        },
      },
    ]);
    writing.resolve(result({ level: "project", file: "skill-cli.jsonc", changed: true }));
  } finally {
    setup.renderer.destroy();
  }
});

test("Details Add to collection owner cancellation leaves membership unchanged and restores its originating action focus", async () => {
  const changes: unknown[] = [];
  const previews: Parameters<TuiCore["collections"]["previewMemberEdit"]>[0][] = [];
  const writing =
    deferred<
      OperationResult<{ readonly level: "global"; readonly file: string; readonly changed: true }>
    >();
  const base = directSourceCore(projection());
  const core = {
    ...base,
    collections: membershipConfiguration(base.collections, globalOwner, changes, previews, writing),
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openDetailsActions(setup);
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await chooseCollection(setup, 0);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-batch-name-0",
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id ===
        "reader-details-action-skill-add-to-collection",
    );
    expect(changes).toEqual([]);
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id ===
        "reader-details-action-skill-add-to-collection",
    );
    expect(changes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Details disables Add to collection when no editable Collection destination exists", async () => {
  const noChoices = projection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...noChoices,
          configs: noChoices.configs.map((config) => ({
            ...config,
            direct: { ...config.direct, collections: [] },
          })),
          effective: {
            status: "complete",
            sources: noChoices.effective.sources,
            collections: [],
            use: [],
            managed: false,
            agent: noChoices.effective.agent,
            collectionsView: [],
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup, false);
    const action = live(setup, "reader-details-action-skill-add-to-collection");
    expect(action.focusable).toBe(false);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = live(setup, "palette-choices") as SelectRenderable;
    const disabled = choices.options.find(
      (option) => option.value.id === "skill-add-to-collection",
    );
    expect(disabled?.value.enabled).toBe(false);
    expect(disabled?.value.disabledReason).toContain("No direct or repository-derived Collection");
    const disabledIndex = choices.options.findIndex(
      (option) => option.value.id === "skill-add-to-collection",
    );
    expect(disabledIndex).toBeGreaterThanOrEqual(0);
    choices.setSelectedIndex(disabledIndex);
    await setup.renderOnce();
    expect((live(setup, "palette-action-reason") as TextRenderable).plainText).toContain(
      disabled!.value.disabledReason!,
    );
    expect(setup.renderer.root.findDescendantById("collection-handoff-choice")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("Details direct Config relationship mounts its exact declaration owner", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup, "config");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-browser",
    );
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Source declaration  team-main");
    expect(frame).toContain("/workspace/skill-cli/skill-cli.jsonc");
    expect(frame).toContain("https://github.com/acme/main");
    await returnToReaderDetails(setup, "config");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [120, 40],
  [80, 24],
  [43, 30],
] as const)(
  "Details direct Source keeps its exact selection and Reader/browser return at %ix%i",
  async (width, height) => {
    const setup = await testRender(
      () => <App core={directSourceCore(projection())} exit={() => {}} />,
      { width, height },
    );
    try {
      await openRelationships(setup, "source");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-details-toggle",
      );
      expect(live(setup, "source-details-pane").height).toBeGreaterThan(0);
      expect(live(setup, "source-details-toggle").focused).toBe(true);
      expect((live(setup, "source-details-pane") as BoxRenderable).title).toBe("team-main");
      if (width >= 100)
        expect((live(setup, "source-browser") as SelectRenderable).getSelectedOption()?.value).toBe(
          "team-main",
        );
      expect(setup.captureCharFrame()).toContain("team-main");
      expect(setup.renderer.root.findDescendantById("source-command-config")).toBeUndefined();
      await returnToReaderDetails(setup, "source");
      expect(renderableText(live(setup, "reader-details-summary"))).toContain(
        "Address\nteam-main/guide",
      );
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
      expect(selectedReaderTab(setup)).toBe(2);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Details contributed Config Source relationship mounts exact provenance", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(contributedProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup, "config-source", { source: "team-config/lark", path: "guide" });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    const browser = setup.renderer.root.findDescendantById("config-config-source-browser");
    if (!browser) throw new Error("Config Source browser was not mounted");
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-command-config-remove"),
    );
    setup.renderer.root.findDescendantById("config-command-config-remove")!.focus();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Config Source  team-config");
    expect(frame).toContain("Config Source host");
    const metadata = live(setup, "config-declaration-metadata");
    expect(renderableText(metadata)).toContain(
      "Config Source host  /home/user/.config/skill-cli.jsonc /configSources/team-config",
    );
    expect(frame).toContain("configSources/team-config");
    expect(frame).toContain("Contributed Source  team-config/lark");
    expect(frame).toContain("Contributed declaration  /sources/lark");
    expect(frame).toContain("Canonical Origin  https://github.com/acme/config");
    expect(frame).toContain("Applied commit  abc123");
    expect(frame).not.toContain("Snapshot");
    expect(frame).not.toContain("Registry");
  } finally {
    setup.renderer.destroy();
  }
});

test("Details discloses the Local Config Source contributed declaration file", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(localContributedProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup, true, { source: "local-team/lark", path: "guide" });
    await focusLive(setup, "reader-details-metadata");
    await parsedEnter(setup);
    const details = setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable;
    const labels = (
      node: import("@opentui/core").BaseRenderable,
    ): import("@opentui/core").BaseRenderable[] => [node, ...node.getChildren().flatMap(labels)];
    const declaration = labels(details).find(
      (node) => node instanceof TextRenderable && node.plainText === "Contributed declaration file",
    )!;
    details.scrollChildIntoView(declaration.id);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(renderableText(details)).toContain("Config Source ID\nlocal-team");
    expect(renderableText(details)).toContain("Host level\nproject");
    expect(frame).toContain("Contributed");
    expect(frame).toContain("/workspace/shared-skills/skill-cli.jsonc");
    expect(renderableText(details)).toContain("Contributed declaration\n/sources/lark");
    expect(renderableText(details)).toContain("Namespace\nlocal-team");
    expect(renderableText(details)).toContain("Host file\n/workspace/skill-cli/skill-cli.jsonc");
    expect(renderableText(details)).toContain("Host pointer\n/configSources/local-team");
    expect(renderableText(details)).toContain(
      "Contributed declaration file\n/workspace/shared-skills/skill-cli.jsonc",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("Details only offers direct Collection owners and restores Details focus after a direct Config handoff", async () => {
  const contributed = contributedProjection();
  const setup = await testRender(
    () => <App core={directSourceCore(contributed)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup, true, { source: "team-config/lark", path: "guide" });
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    expect(setup.captureCharFrame()).not.toContain("contributed (global)");
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id ===
        "reader-details-action-skill-add-to-collection",
    );
    await openRelationships(setup, "config-source", { source: "team-config/lark", path: "guide" });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    await returnToReaderDetails(setup, "config-source", {
      source: "team-config/lark",
      path: "guide",
    });
  } finally {
    setup.renderer.destroy();
  }
});

test("Details Collection relation routes to its owning contributed Config Source and returns", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(contributedAgentProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup, "collection:contributed", {
      source: "team-config/lark",
      path: "guide",
    });
    const browser = setup.renderer.root.findDescendantById("config-config-source-browser");
    if (!browser) throw new Error("Config Source browser was not mounted");
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    expect((browser as SelectRenderable).getSelectedOption()?.value).toBe(
      "/configSources/team-config",
    );
    await parsedEnter(setup);
    await setup.renderOnce();
    if (!setup.renderer.root.findDescendantById("config-source-inspector"))
      throw new Error(`Config Source inspector did not mount\n${setup.captureCharFrame()}`);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-command-config-remove"),
    );
    const metadata = renderableText(live(setup, "config-declaration-metadata"));
    expect(metadata).toContain("/home/user/.config/skill-cli.jsonc");
    expect(metadata).toContain("/configSources/team-config");
    const contributions = live(setup, "config-source-contributions") as SelectRenderable;
    expect(
      contributions.options.map((option) => [option.name.trimEnd(), option.value]),
    ).toContainEqual(["Collection  contributed", "collection:0"]);
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === contributions);
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => contributions.getSelectedOption()?.value === "collection:0");
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(renderableText(live(setup, "config-source-inspector"))).toContain(
      "Config Source  team-config",
    );
    expect(renderableText(live(setup, "config-source-inspector"))).toContain(
      "configSources/team-config",
    );
    expect(frame).toContain("Collection  contributed");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    expect(
      setup.renderer.root.findDescendantById("reader-details-relationship-source"),
    ).toBeUndefined();
    await returnToReaderDetails(setup, "collection:contributed", {
      source: "team-config/lark",
      path: "guide",
    });
  } finally {
    setup.renderer.destroy();
  }
});

test("Details contributed Source relationship focuses the mounted Source surface with the exact Source ID", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(contributedProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup, "source", { source: "team-config/lark", path: "guide" });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-details-toggle",
    );
    expect(
      (
        setup.renderer.root.findDescendantById("source-browser") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe("team-config/lark");
    expect(setup.captureCharFrame()).toContain("team-config/lark");
    expect(live(setup, "source-details-pane").height).toBeGreaterThan(0);
    expect(live(setup, "source-details-toggle").focused).toBe(true);
    expect(setup.renderer.root.findDescendantById("source-command-config-source")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
