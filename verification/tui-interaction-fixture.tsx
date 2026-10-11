/** @jsxImportSource @opentui/solid */
// Native production App, isolated Core seam. No createSkillCliCore, real files, or transports.
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { appendFile, mkdir } from "node:fs/promises";
import { App } from "../packages/skill-tui/src/app";
import {
  SkillCliError,
  type CollectionView,
  type ConfigSourceImpact,
  type ManagementProjection,
  type OperationResult,
  type SourceBindingView,
} from "@skill-cli/core";
import type { TuiCore } from "../packages/skill-tui/src/effects";

const output = "tmp/tui-interaction-audit/fixture-calls.ndjson";
await mkdir("tmp/tui-interaction-audit", { recursive: true });
const result = <T,>(value: T): OperationResult<T> => ({ value, diagnostics: [] });
const owner = (pointer: string, level: "project" | "global" | "local" = "project") => ({
  level,
  file: `/virtual/${level}/skill-cli.jsonc`,
  pointer,
});
const configOwner = owner("/configSources/team-config", "global");
const contribution = {
  configSource: configOwner,
  declaration: { level: "global" as const, pointer: "/collections/shared" },
};
const guide = { source: "team-main", path: "guide" };
const second = { source: "other", path: "guide" };
const sources: SourceBindingView[] = [
  {
    id: "team-main",
    kind: "github",
    origin: "https://github.com/fixture/main",
    root: "skills",
    ref: "main",
    provenance: { level: "project" },
    selectors: [],
  },
  {
    id: "other",
    kind: "local",
    origin: "/virtual/other",
    root: ".",
    provenance: { level: "local" },
    selectors: [],
  },
  {
    id: "team-config/shared",
    kind: "git",
    origin: "https://fixture.invalid/shared.git",
    root: "skills",
    ref: "main",
    provenance: { level: "global" },
    contribution,
    selectors: [],
  },
];
const collections: CollectionView[] = [
  {
    id: "team",
    declared: [owner("/collections/team")],
    repository: { derived: false, producers: [] },
    members: [
      {
        name: "guide",
        address: guide,
        paths: [
          {
            kind: "direct",
            collection: "team",
            entryName: "guide",
            owner: owner("/collections/team/members/guide"),
          },
        ],
      },
    ],
    references: [
      {
        name: "docs",
        collection: "documentation",
        description: "Nested reading",
        owner: owner("/collections/team/references/docs"),
      },
    ],
    links: [],
  },
  {
    id: "documentation",
    declared: [owner("/collections/documentation")],
    repository: { derived: false, producers: [] },
    members: [
      {
        name: "other-guide",
        address: second,
        paths: [
          {
            kind: "direct",
            collection: "documentation",
            entryName: "other-guide",
            owner: owner("/collections/documentation/members/other-guide"),
          },
        ],
      },
    ],
    references: [],
    links: [],
  },
  {
    id: "shared",
    declared: [{ ...owner("/collections/shared", "global"), contribution }],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  },
  {
    id: "repository",
    declared: [],
    repository: { derived: true, producers: [guide] },
    members: [
      {
        name: "guide",
        address: guide,
        paths: [
          {
            kind: "repository-derived",
            repository: "repository",
            source: guide.source,
            path: guide.path,
          },
        ],
      },
    ],
    references: [],
    links: [],
  },
];
const useOwner = owner("/use/0");
let projection: ManagementProjection = {
  project: { root: "/virtual/project", resolution: "explicit" },
  configs: (["global", "project", "local"] as const).map(
    (level): ManagementProjection["configs"][number] => ({
      level,
      file: { status: "valid", file: owner("", level).file },
      direct: {
        sources: sources
          .filter((source) => !source.contribution && source.provenance.level === level)
          .map((source) => ({
            ...source,
            trackedRef: source.ref,
            ref: { id: source.id, owner: owner(`/sources/${source.id}`, level) },
          })),
        configSources:
          level === "global"
            ? [
                {
                  id: "team-config",
                  owner: configOwner,
                  binding: { kind: "local", path: "/virtual/config", root: "." },
                  adoption: { status: "live" },
                  contributed: {
                    sources: [sources[2]!],
                    collections: [
                      {
                        id: "shared",
                        owner: { ...owner("/collections/shared", "global"), contribution },
                      },
                    ],
                  },
                },
                {
                  id: "remote-git",
                  owner: owner("/configSources/remote-git", level),
                  binding: {
                    kind: "git",
                    origin: "https://fixture.invalid/config.git",
                    root: ".",
                    ref: "main",
                  },
                  adoption: { status: "not-adopted" },
                  contributed: { sources: [], collections: [] },
                },
                {
                  id: "remote-github",
                  owner: owner("/configSources/remote-github", level),
                  binding: {
                    kind: "github",
                    origin: "https://github.com/fixture/config",
                    root: ".",
                    ref: "main",
                  },
                  adoption: { status: "adopted", commit: "a".repeat(40) },
                  contributed: { sources: [], collections: [] },
                },
              ]
            : [],
        collections: collections.flatMap((collection) =>
          collection.declared
            .filter((item) => item.level === level && !item.contribution)
            .map((item) => ({ id: collection.id, owner: item })),
        ),
        collectionUse: level === "project" ? [{ collection: "team", owner: useOwner }] : [],
        integrations:
          level === "project" ? [{ kind: "opencode", owner: owner("/agent/integration/0") }] : [],
      },
      contributed: {
        sources: level === "global" ? [sources[2]!] : [],
        collections: level === "global" ? ["shared"] : [],
      },
    }),
  ),
  effective: {
    status: "complete",
    sources,
    collections: collections.map((item) => item.id),
    use: ["team"],
    managed: true,
    collectionsView: collections,
    agent: {
      status: "available",
      integration: [owner("/agent/integration/0")],
      use: [useOwner],
      reasons: [],
      catalog: [
        { selector: "team:guide", name: "guide", description: "Primary guide", aliases: [] },
        {
          selector: "team/docs:other-guide",
          name: "guide",
          description: "Reference guide",
          aliases: [],
        },
      ],
    },
  },
  installedSkills: [
    guide,
    second,
    { source: "team-config/shared", path: "shared-guide" },
    ...Array.from({ length: 28 }, (_, index) => ({
      source: "team-main",
      path: `sample-${String(index).padStart(2, "0")}`,
    })),
  ].map((address, index): ManagementProjection["installedSkills"][number] => ({
    address,
    name: index < 2 ? "guide" : address.path,
    description: index === 1 ? "Same name, different source" : `Fixture Skill ${index}`,
    owner: { source: address.source, health: "healthy", relevantRemoteRevision: "a".repeat(40) },
    source: sources.find((source) => source.id === address.source),
    collections:
      index === 0
        ? [{ id: "team", entry: "guide", paths: collections[0]!.members[0]!.paths }]
        : index === 1
          ? [
              {
                id: "documentation",
                entry: "other-guide",
                paths: collections[1]!.members[0]!.paths,
              },
            ]
          : [],
    selectors: index === 0 ? ["team:guide"] : [],
    selectorViews:
      index === 0
        ? {
            status: "complete",
            values: [
              {
                selector: "team:guide",
                collection: "team",
                entry: "guide",
                paths: collections[0]!.members[0]!.paths,
                useOwners: [useOwner],
                exposurePaths: [{ owner: useOwner, segments: [{ collection: "team" }] }],
              },
            ],
          }
        : { status: "unavailable" },
    aliases: [],
    problems: [],
  })),
  diagnostics: [],
};

// Unsupported operations fail visibly rather than silently simulate completed domain changes.
const unsupported = async (): Promise<never> => {
  throw new SkillCliError(
    "INVALID_ARGUMENT",
    "Fixture does not implement this operation; use a focused isolated App test",
  );
};
const decision = (collection: string) => ({
  kind: "direct" as const,
  owner: owner(`/collections/${collection}`),
});
const emptyDelta: ConfigSourceImpact["delta"] = {
  addedSources: [],
  changedSources: [],
  removedSources: [],
  addedCollections: [],
  changedCollections: [],
  removedCollections: [],
};
const core: TuiCore = {
  workspace: { get: async () => result(structuredClone(projection)) },
  content: {
    loadInstalled: async ({ address }) => {
      const markdownText =
        `# ${address.source} / ${address.path}\n\nneedle first\n\n` +
        Array.from(
          { length: 65 },
          (_, index) => `Line ${index}: ${index % 8 === 0 ? "needle" : "content"}\n`,
        ).join("\n") +
        "\n```ts\nconst needle = true;\n```\n";
      return result({
        address,
        name: address.path,
        description: "Fixture content",
        rawText: `---\ntitle: ${address.path}\n---\n${markdownText}`,
        markdownText,
      });
    },
    listInstalledResources: async () =>
      result([
        { path: "docs", kind: "directory" },
        { path: "docs/guide.md", kind: "file", size: 100 },
        { path: "notes.txt", kind: "file", size: 50 },
        { path: "blob.bin", kind: "file", size: 8 },
        { path: "image.png", kind: "file", size: 64 },
        { path: "large.txt", kind: "file", size: 30_000_000 },
        { path: "link", kind: "symlink" },
        { path: "submodule", kind: "gitlink", gitlinkCommit: "a".repeat(40) },
      ]),
    readInstalled: async ({ path }) =>
      path.endsWith(".md") || path === "notes.txt"
        ? result({
            kind: "text" as const,
            path,
            format: path.endsWith(".md") ? ("markdown" as const) : ("text" as const),
            text: `# ${path}\n\nresource needle\n\n${"Long content\n".repeat(60)}`,
          })
        : result({
            kind: "not-text" as const,
            path,
            reason:
              path === "blob.bin"
                ? ("binary" as const)
                : path === "large.txt"
                  ? ("too-large" as const)
                  : ("unsupported" as const),
            metadata: {
              path,
              kind:
                path === "link"
                  ? ("symlink" as const)
                  : path === "submodule"
                    ? ("gitlink" as const)
                    : ("file" as const),
            },
          }),
  },
  management: {
    previewSourceRemoval: async ({ source }) =>
      result({
        kind: "source-removal",
        source,
        owner: owner(`/sources/${source}`),
        installed: [],
        repairs: [],
        blockers: [],
        allowed: true,
      }),
    removeSource: unsupported,
    discover: async ({ source }) =>
      result({
        source,
        kind: "github",
        exactRevision: "a".repeat(40),
        candidates: [{ path: "new-guide", name: "new-guide", description: "Discoverable fixture" }],
      }),
    install: unsupported,
    // A real changed candidate makes the selection/review path reachable; update itself remains forbidden.
    checkUpdate: async ({ source }) =>
      result({
        source,
        kind: "github",
        exactRevision: "b".repeat(40),
        changed: [{ path: "guide", name: "guide", description: "Fixture update available" }],
        added: [],
        removed: [],
        unchanged: [],
      }),
    update: unsupported,
    previewUninstall: async ({ source, paths }) =>
      result({
        kind: "uninstall",
        installed: paths.map((path) => ({ source, path })),
        directMemberships: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      }),
    uninstall: async ({ source, paths }) => {
      projection = {
        ...projection,
        installedSkills: projection.installedSkills.filter(
          (skill) => skill.address.source !== source || !paths.includes(skill.address.path),
        ),
      };
      return result(undefined);
    },
    previewRebind: async ({ source, path, owner: nextOwner, ownerPath }) =>
      result({
        kind: "rebind",
        address: { source, path },
        owner: nextOwner,
        ownerPath: ownerPath ?? path,
        proof: "proven",
        allowed: true,
      }),
    rebind: unsupported,
    observeConfig: async ({ id }) =>
      result({
        id,
        kind: "github",
        exactRevision: "a".repeat(40),
        contributions: { sources: [], collections: [] },
      }),
    previewAdoptConfig: async ({ id, exactRevision, observation }) => {
      const source = projection.configs
        .flatMap((config) => config.direct.configSources)
        .find((item) => item.id === id);
      if (!source || source.binding.kind === "local") return unsupported();
      return result({
        kind: "config-source-adopt",
        id,
        owner: source.owner,
        binding: source.binding,
        exactRevision,
        declarationRetained: true,
        contributions: observation?.contributions ?? { sources: [], collections: [] },
        delta: emptyDelta,
        affectedInstalled: [],
        disappearingSelectors: [],
        blockers: [],
        allowed: true,
      });
    },
    adoptConfig: unsupported,
    previewForgetConfig: unsupported,
    forgetConfig: unsupported,
    previewRemoveConfig: unsupported,
    removeConfig: unsupported,
  },
  configuration: {
    change: async (change) => {
      if (change.type !== "agent.managed.set") return unsupported();
      if (projection.effective.status !== "complete") return unsupported();
      projection = {
        ...projection,
        effective: { ...projection.effective, managed: change.managed },
      };
      return result({ level: change.level, changed: true });
    },
    previewMembershipBatch: async (request) =>
      result({
        kind: "membership-batch",
        collection: request.collection,
        decision: decision(request.collection),
        additions: request.additions,
        removals: request.removals,
        affected: [],
        blockers: [],
        effectful: true,
        allowed: true,
      }),
    previewAddToCollection: unsupported,
    previewMembershipRemoval: unsupported,
    previewImport: unsupported,
    previewReference: async (request) =>
      result({
        kind: "reference",
        collection: request.collection,
        name: request.name,
        referencedCollection: request.target,
        description: request.description,
        decision: decision(request.collection),
        exposure: [],
        allowed: true,
      }),
    previewLinkChange: async (request) =>
      result({
        kind: "link-change",
        collection: request.collection,
        target: request.target,
        linked: request.linked,
        members: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [],
        allowed: true,
      }),
    previewCollectionUse: unsupported,
    previewCollectionRemoval: unsupported,
  },
};
// Installed effects are intercepted before mounting. No pass-through to a real Core.
// Failure/delay is selected by exact `family.method`, so no fixture-only UI keys steal inputs.
const failOnce = new Set((process.env.TUI_FIXTURE_FAIL_ONCE ?? "").split(",").filter(Boolean));
const delay = Number(process.env.TUI_FIXTURE_DELAY_MS ?? 0);
if (!Number.isFinite(delay) || delay < 0 || delay > 10_000)
  throw new Error("Invalid fixture delay");
const ignoreAbort = process.env.TUI_FIXTURE_IGNORE_ABORT === "1";
const counts = new Map<string, number>();
let sequence = 0;
let writes = Promise.resolve();
function record(event: object) {
  writes = writes.then(() =>
    appendFile(output, JSON.stringify({ pid: process.pid, ...event }) + "\n"),
  );
  return writes;
}
async function waitForResponse(
  options: { readonly signal?: AbortSignal } | undefined,
  method: string,
) {
  const signal = ignoreAbort ? undefined : options?.signal;
  if (signal?.aborted) throw new SkillCliError("CANCELLED", `Fixture request cancelled: ${method}`);
  if (!delay) return;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    abort = () => finish(new SkillCliError("CANCELLED", `Fixture request cancelled: ${method}`));
    timer = setTimeout(() => finish(), delay);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
await record({ phase: "start", failOnce: [...failOnce], delay, ignoreAbort });
function traced<T extends object>(family: string, port: T): T {
  return new Proxy(port, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const method = `${family}.${String(property)}`;
        const call = ++sequence;
        counts.set(method, (counts.get(method) ?? 0) + 1);
        await record({ phase: "call", call, method, request: args[0], count: counts.get(method) });
        try {
          await waitForResponse(args[1] as { readonly signal?: AbortSignal } | undefined, method);
          if (failOnce.delete(method))
            throw new SkillCliError("PROVIDER_UNAVAILABLE", `Fixture fail-once: ${method}`);
          const valueResult = await value.apply(target, args);
          await record({ phase: "success", call, method });
          return valueResult;
        } catch (error) {
          await record({ phase: "failure", call, method, error: String(error) });
          throw error;
        }
      };
    },
  });
}
// Deliberately does not honor AbortSignal: late completion probes App's stale-request guards.
const isolated: TuiCore = {
  workspace: traced("workspace", core.workspace),
  content: traced("content", core.content),
  management: traced("management", core.management),
  configuration: traced("configuration", core.configuration),
};
const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  exitOnCtrlC: false,
  useMouse: true,
  consoleMode: "disabled",
});
renderer.on("focused_renderable", (target) => {
  void record({ phase: "focus", id: target && "id" in target ? target.id : undefined });
});
let exiting = false;
const exit = () => {
  if (!exiting) {
    exiting = true;
    renderer.destroy();
  }
};
const destroyed = new Promise<void>((resolve) => renderer.on("destroy", resolve));
try {
  await render(() => <App core={isolated} exit={exit} />, renderer);
  await destroyed;
} finally {
  exit();
  await record({ phase: "exit", counts: Object.fromEntries(counts) });
}
