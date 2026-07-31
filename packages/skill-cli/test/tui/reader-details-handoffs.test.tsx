import { expect, test } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import type {
  ConfigurationCapability,
  ConfigLevel,
  ConfigChange,
  ManagementProjection,
  OperationResult,
} from "../../src/core/api";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

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

function projection(): ManagementProjection {
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

function membershipConfiguration<L extends ConfigLevel>(
  base: ConfigurationCapability,
  owner: { readonly level: L; readonly file: string; readonly pointer: string },
  changes: ConfigChange[],
  previews: Parameters<ConfigurationCapability["previewAddToCollection"]>[0][],
  writing: ReturnType<
    typeof deferred<OperationResult<{ readonly level: L; readonly changed: true }>>
  >,
): ConfigurationCapability {
  return {
    ...base,
    previewAddToCollection: async (request) => {
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
    change: (change) => {
      changes.push(change);
      return writing.promise;
    },
  };
}

function agentProjection(): ManagementProjection {
  const base = projection();
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: [{ collection: "engineering", owner: globalOwner }],
            },
          }
        : {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: [{ collection: "engineering", owner: projectOwner }],
            },
          },
    ),
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        collections: [
          {
            id: "engineering",
            entry: "guide",
            paths: [
              {
                kind: "direct" as const,
                collection: "engineering",
                entryName: "guide",
                owner: projectOwner,
              },
              {
                kind: "repository-derived" as const,
                repository: "acme/main",
                source: "team-main",
                path: "guide",
              },
              {
                kind: "via-link" as const,
                links: [
                  { collection: "docs", linkedCollection: "engineering", owner: projectOwner },
                  { collection: "shared", linkedCollection: "docs", owner: globalOwner },
                ],
              },
            ],
          },
        ],
        selectors: ["engineering:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: [
                {
                  kind: "direct" as const,
                  collection: "engineering",
                  entryName: "guide",
                  owner: projectOwner,
                },
                {
                  kind: "repository-derived" as const,
                  repository: "acme/main",
                  source: "team-main",
                  path: "guide",
                },
                {
                  kind: "via-link" as const,
                  links: [
                    { collection: "docs", linkedCollection: "engineering", owner: projectOwner },
                    { collection: "shared", linkedCollection: "docs", owner: globalOwner },
                  ],
                },
              ],
              useOwners: [projectOwner, globalOwner],
            },
          ],
        },
      },
    ],
  };
}

function contributedProjection(): ManagementProjection {
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

function contributedAgentProjection(): ManagementProjection {
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

function localContributedProjection(): ManagementProjection {
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

async function openDetailsActions(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-tabs"));
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.renderOnce();
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
  );
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-action-menu");
}

async function choose(setup: Awaited<ReturnType<typeof testRender>>, count: number) {
  for (let index = 0; index < count; index++) {
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
  }
  setup.mockInput.pressEnter();
  await setup.renderOnce();
}

async function parsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
  await setup.renderOnce();
}

async function openRelationships(setup: Awaited<ReturnType<typeof testRender>>) {
  await openDetailsActions(setup);
  await parsedEscape(setup);
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "reader-details-relationships",
  );
}

test("Details Add to collection previews Core-authorized membership and commits the first direct owner once", async () => {
  const changes: ConfigChange[] = [];
  const previews: Parameters<ConfigurationCapability["previewAddToCollection"]>[0][] = [];
  const writing = deferred<OperationResult<{ readonly level: "global"; readonly changed: true }>>();
  const base = directSourceCore(projection());
  const core = {
    ...base,
    workspace: {
      get: async () => result(projection()),
    },
    configuration: membershipConfiguration(
      base.configuration,
      globalOwner,
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
    await openDetailsActions(setup);
    const actions = setup.renderer.root.findDescendantById("source-action-menu") as
      | SelectRenderable
      | undefined;
    expect(actions?.getSelectedIndex()).toBe(0);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    const chooser = setup.renderer.root.findDescendantById("collection-handoff-choice") as
      | SelectRenderable
      | undefined;
    expect(chooser?.getSelectedIndex()).toBe(0);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    expect(setup.renderer.root.findDescendantById("membership-add-choice")).toBeDefined();
    expect(previews).toEqual([
      { level: "global", collection: "engineering", address, name: "guide" },
    ]);
    expect(setup.captureCharFrame()).toContain("guide");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-choice",
    );
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(() =>
      ["collection-review-choice", "membership-add-choice"].includes(
        setup.renderer.currentFocusedRenderable?.id ?? "",
      ),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-review-choice");
    expect(changes).toEqual([]);
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(changes).toEqual([
      {
        type: "collection.member.set",
        level: "global",
        collection: "engineering",
        name: "guide",
        address,
      },
    ]);
    writing.resolve(result({ level: "global", changed: true }));
    await setup.renderOnce();
    expect(changes).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("Details Add to collection previews and commits the second same-ID direct owner", async () => {
  const changes: ConfigChange[] = [];
  const previews: Parameters<ConfigurationCapability["previewAddToCollection"]>[0][] = [];
  const writing =
    deferred<OperationResult<{ readonly level: "project"; readonly changed: true }>>();
  const base = directSourceCore(projection());
  const core = {
    ...base,
    workspace: {
      get: async () => result(projection()),
    },
    configuration: membershipConfiguration(
      base.configuration,
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
    await openDetailsActions(setup);
    await choose(setup, 0);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await choose(setup, 2);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    expect(setup.renderer.root.findDescendantById("membership-add-choice")).toBeDefined();
    expect(previews).toEqual([
      { level: "project", collection: "engineering", address, name: "guide" },
    ]);
    expect(setup.captureCharFrame()).toContain("guide");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-review-choice",
    );
    expect(changes).toEqual([]);
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(changes).toEqual([
      {
        type: "collection.member.set",
        level: "project",
        collection: "engineering",
        name: "guide",
        address,
      },
    ]);
    writing.resolve(result({ level: "project", changed: true }));
    await setup.renderOnce();
  } finally {
    setup.renderer.destroy();
  }
});

test("Details Add to collection owner cancellation leaves membership unchanged and restores its originating action focus", async () => {
  const changes: ConfigChange[] = [];
  const previews: Parameters<ConfigurationCapability["previewAddToCollection"]>[0][] = [];
  const writing = deferred<OperationResult<{ readonly level: "global"; readonly changed: true }>>();
  const base = directSourceCore(projection());
  const core = {
    ...base,
    configuration: membershipConfiguration(
      base.configuration,
      globalOwner,
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
    await openDetailsActions(setup);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await choose(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "membership-add-name",
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    expect(changes).toEqual([]);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-action-menu");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    expect(changes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Details disables Add to collection when no direct Collection exists", async () => {
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
            collections: ["derived"],
            use: [],
            managed: false,
            agent: noChoices.effective.agent,
            collectionsView: [
              {
                id: "derived",
                declared: [],
                repository: { derived: true, producers: [address] },
                members: [],
                references: [],
                links: [],
              },
            ],
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    expect(setup.captureCharFrame()).toContain(
      "No direct Collection is available for this Installed Skill",
    );
    setup.mockInput.pressEnter();
    await setup.renderOnce();
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
    await openRelationships(setup);
    await choose(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-browser",
    );
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Source declaration  team-main");
    expect(frame).toContain("/workspace/skill-cli/skill-cli.jsonc");
    expect(frame).toContain("/collections/engineering");
  } finally {
    setup.renderer.destroy();
  }
});

test("Details direct Source relationship mounts the exact Source", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const browser = setup.renderer.root.findDescendantById("source-browser");
    if (!browser) throw new Error("Source browser was not mounted");
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    expect(setup.captureCharFrame()).toContain("team-main");
  } finally {
    setup.renderer.destroy();
  }
});

test("Details contributed Config Source relationship mounts exact provenance", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(contributedProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup);
    await choose(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    const browser = setup.renderer.root.findDescendantById("config-config-source-browser");
    if (!browser) throw new Error("Config Source browser was not mounted");
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Config Source  team-config");
    expect(frame).toContain("/home/user/.config/skill-cli.jsonc");
    expect(frame).toContain("/configSources/team-config");
    expect(frame).toContain("/sources/lark");
    expect(frame).toContain("https://github.com/acme/config");
    expect(frame).toContain("abc123");
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
    await openDetailsActions(setup);
    await parsedEscape(setup);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Config Source ID  local-team");
    expect(frame).toContain("Host level  project");
    expect(frame).toContain("Host file  /workspace/skill-cli/skill-cli.jsonc");
    expect(frame).toContain("Host pointer  /configSources/local-team");
    expect(frame).toContain(
      "Contributed declaration file  /workspace/shared-skills/skill-cli.jsonc",
    );
    expect(frame).toContain("Contributed declaration  /sources/lark");
    expect(frame).toContain("Namespace  local-team");
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
    await openDetailsActions(setup);
    await choose(setup, 0);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-handoff-choice",
    );
    expect(setup.captureCharFrame()).not.toContain("contributed (global)");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-relationships",
    );
    await choose(setup, 1);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-relationships",
    );
    expect(setup.captureCharFrame()).toContain("Address  team-config/lark/guide");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [0, "Agent Membership handoff", "contributed:guide"],
  [1, "Agent Link handoff", "shared->contributed"],
])(
  "contributed selector row %d routes to its Config Source and returns to Details",
  async (_index, label, relation) => {
    const setup = await testRender(
      () => <App core={directSourceCore(contributedAgentProjection())} exit={() => {}} />,
      { width: 120, height: 40 },
    );
    try {
      await openDetailsActions(setup);
      await choose(setup, 1);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "agent-path-choice",
      );
      await choose(setup, _index);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
      );
      const frame = setup.captureCharFrame();
      expect(frame).toContain(label);
      expect(frame).toContain(relation);
      expect(frame).toContain("Config Source  team-config");
      expect(frame).toContain("/configSources/team-config");
      expect(frame).toContain("/collections/contributed");
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
      );
      expect(setup.captureCharFrame()).toContain("Address  team-config/lark/guide");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Details contributed Source relationship mounts the exact Source ID", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(contributedProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openRelationships(setup);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const browser = setup.renderer.root.findDescendantById("source-browser");
    if (!browser) throw new Error("Source browser was not mounted");
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    expect(setup.captureCharFrame()).toContain("team-config/lark");
  } finally {
    setup.renderer.destroy();
  }
});

test("For agents repository selector route lands its distinct Installed Skill in Workspace, Reader, and Details", async () => {
  const loads: string[] = [];
  const base = readerProjection();
  const projection = {
    ...base,
    installedSkills: base.installedSkills.map((skill) =>
      skill.address.path === "guide"
        ? {
            ...skill,
            selectorViews: {
              status: "complete" as const,
              values: [
                {
                  selector: "engineering:guide",
                  collection: "engineering",
                  entry: "guide",
                  paths: [
                    {
                      kind: "repository-derived" as const,
                      repository: "acme/main",
                      source: readerSecondAddress.source,
                      path: readerSecondAddress.path,
                    },
                  ],
                  useOwners: [],
                },
              ],
            },
          }
        : skill,
    ),
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return {
              value:
                request.address.path === readerSecondAddress.path
                  ? readerSecondContent
                  : readerContent,
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("const needle = true;"));
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("reader-details-relationships"),
    );
    const relationships = setup.renderer.root.findDescendantById("reader-details-relationships");
    relationships!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === relationships);
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "agent-path-choice");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
        )?.getSelectedOption()?.value === "team-main/reference" &&
        setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser" &&
        setup.captureCharFrame().includes("other needle"),
    );
    expect(loads).toEqual(["guide", "reference"]);
    expect(setup.renderer.root.findDescendantById("agent-path-choice")).toBeUndefined();
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(() => setup.captureCharFrame().includes("Address  team-main/reference"));
    expect(setup.renderer.root.findDescendantById("reader-details-actions")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [0, "config-collection-browser", "Agent Membership handoff", "engineering:guide"],
  [1, "installed-skill-browser", "Agent producer handoff", "team-main/guide"],
  [2, "config-collection-browser", "Agent Link handoff", "docs->engineering"],
  [3, "config-collection-browser", "Agent Link handoff", "shared->docs"],
  [
    4,
    "config-agent-use-browser",
    "Agent Collection Use handoff",
    "/workspace/skill-cli/skill-cli.jsonc",
  ],
  [
    5,
    "config-agent-use-browser",
    "Agent Collection Use handoff",
    "/home/user/.config/skill-cli.jsonc",
  ],
])("For agents mounts exact selector path row %d", async (_index, destination, evidence, exact) => {
  const setup = await testRender(
    () => <App core={directSourceCore(agentProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openDetailsActions(setup);
    await choose(setup, 1);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "agent-path-choice");
    await choose(setup, _index);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === destination);
    const frame = setup.captureCharFrame();
    expect(frame).toContain(evidence);
    expect(frame).toContain(exact);
  } finally {
    setup.renderer.destroy();
  }
});
