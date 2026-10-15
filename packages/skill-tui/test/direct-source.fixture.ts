import type {
  DiscoveryObservation,
  ManagementProjection,
  OperationResult,
  RebindImpact,
  UninstallImpact,
  UpdateObservation,
  ResourceDescriptor,
} from "@skill-cli/core";
import type { TuiCore } from "../src/effects";
import type { testRender } from "@opentui/solid";
import { CodeRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { createTuiEffects } from "../src/effects";
import { createOperationState } from "../src/operation-state";
import { createProjection } from "../src/projection";
import { createWorkspaceState } from "../src/workspace/state";
import { createCollectionsState } from "../src/collections/state";
import { createConfigState } from "../src/config/state";
import {
  beginReaderRequest,
  createReaderState,
  reduceReaderState,
  type ReaderOwnerState,
} from "../src/reader/state";
import { focusLive, parsedEnter } from "./reader-test-controls";

export function testProjection() {
  const operation = createOperationState();
  const projection = createProjection(operation, {
    workspace: createWorkspaceState(),
    collections: createCollectionsState(),
    config: createConfigState(),
  });
  return { projection, operation };
}

export function testEffects(
  core: TuiCore,
  dispatchReader: (event: import("../src/reader/state").ReaderEvent) => void = () => {},
) {
  const { projection, operation } = testProjection();
  let reader: ReaderOwnerState = createReaderState();
  const effects = createTuiEffects(
    core,
    operation,
    projection.outcomes,
    (event) => {
      reader = reduceReaderState(reader, event);
      dispatchReader(event);
    },
    (address, request, path) => {
      const begun = beginReaderRequest(reader, address, request, path);
      reader = begun.state;
      dispatchReader(begun.event);
      return begun.event;
    },
  );
  return { ...effects, operation };
}

export const directOwner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/sources/team-main",
};

export const configSourceOwner = {
  level: "global" as const,
  file: "/home/user/.config/skill-cli.jsonc",
  pointer: "/configSources/team-config",
};

export function workspaceProjection(
  options: {
    readonly includeDirect?: boolean;
    readonly includeContribution?: boolean;
  } = {},
): ManagementProjection {
  const includeDirect = options.includeDirect ?? true;
  const includeContribution = options.includeContribution ?? true;
  const sources = [
    ...(includeDirect
      ? [
          {
            id: "team-main",
            kind: "github" as const,
            origin: "https://github.com/acme/main",
            root: "skills",
            ref: "main",
            provenance: { level: "global" as const },
            selectors: [],
          },
        ]
      : []),
    ...(includeContribution
      ? [
          {
            id: "team-config/lark",
            kind: "github" as const,
            origin: "https://github.com/acme/config",
            root: "skills",
            ref: "main",
            provenance: { level: "global" as const },
            contribution: {
              configSource: configSourceOwner,
              declaration: {
                level: "global" as const,
                pointer: "/sources/lark",
              },
            },
            selectors: [],
          },
        ]
      : []),
  ];
  return {
    project: { root: "/workspace/skill-cli", resolution: "explicit" },
    configs: [
      {
        level: "global",
        file: { status: "valid", file: configSourceOwner.file },
        direct: {
          sources: [],
          configSources: [
            {
              id: "team-config",
              owner: configSourceOwner,
              binding: { kind: "local", path: "/shared/config", root: "." },
              adoption: { status: "live" },
              contributed: { sources: [], collections: [] },
            },
          ],
          collections: [],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: [] },
      },
      {
        level: "project",
        file: { status: "valid", file: directOwner.file },
        direct: {
          sources: includeDirect
            ? [
                {
                  ...sources[0]!,
                  trackedRef: sources[0]!.ref,
                  ref: { id: "team-main", owner: directOwner },
                },
              ]
            : [],
          configSources: [],
          collections: [],
          collectionUse: [],
          integrations: [],
        },
        contributed: {
          sources: includeContribution ? [sources.at(-1)!] : [],
          collections: [],
        },
      },
    ],
    effective: {
      status: "complete",
      sources,
      collections: [],
      use: [],
      managed: false,
      collectionsView: [],
      agent: {
        status: "unavailable",
        integration: [],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
    installedSkills: [],
    diagnostics: [],
  };
}

const result = <T>(value: T): OperationResult<T> => ({
  value,
  diagnostics: [],
});

export function directSourceCore(
  projection: ManagementProjection,
  hooks: {
    readonly preview?: (options?: { readonly signal?: AbortSignal }) => Promise<
      OperationResult<{
        readonly kind: "source-removal";
        readonly source: string;
        readonly owner?: typeof directOwner;
        readonly installed: readonly {
          readonly source: string;
          readonly path: string;
        }[];
        readonly repairs: readonly {
          readonly address: { readonly source: string; readonly path: string };
          readonly actions: readonly ["rebind", "uninstall"];
        }[];
        readonly blockers: readonly {
          readonly reason: "installed";
          readonly address: { readonly source: string; readonly path: string };
        }[];
        readonly allowed: boolean;
      }>
    >;
    readonly remove?: (options?: {
      readonly signal?: AbortSignal;
    }) => Promise<OperationResult<void>>;
    readonly get?: (options?: {
      readonly signal?: AbortSignal;
    }) => Promise<OperationResult<ManagementProjection>>;
    readonly discover?: (
      request: { readonly source: string },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<DiscoveryObservation>>;
    readonly install?: (
      request: {
        readonly source: string;
        readonly paths: readonly string[];
        readonly exactRevision?: string;
      },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<readonly never[]>>;
    readonly checkUpdate?: (
      request: { readonly source: string },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<UpdateObservation>>;
    readonly previewUpdate?: TuiCore["management"]["previewUpdate"];
    readonly update?: (
      request: {
        readonly source: string;
        readonly paths: readonly string[];
        readonly remove?: readonly string[];
        readonly exactRevision?: string;
      },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<void>>;
    readonly previewUninstall?: (
      request: { readonly source: string; readonly paths: readonly string[] },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<UninstallImpact>>;
    readonly uninstall?: (
      request: { readonly source: string; readonly paths: readonly string[] },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<void>>;
    readonly previewRebind?: (
      request: {
        readonly source: string;
        readonly path: string;
        readonly owner: string;
        readonly ownerPath?: string;
      },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<RebindImpact>>;
    readonly rebind?: (
      request: {
        readonly source: string;
        readonly path: string;
        readonly owner: string;
        readonly ownerPath?: string;
      },
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OperationResult<void>>;
    readonly observeConfig?: TuiCore["management"]["observeConfig"];
    readonly previewAdoptConfig?: TuiCore["management"]["previewAdoptConfig"];
    readonly adoptConfig?: TuiCore["management"]["adoptConfig"];
    readonly previewForgetConfig?: TuiCore["management"]["previewForgetConfig"];
    readonly forgetConfig?: TuiCore["management"]["forgetConfig"];
    readonly previewRemoveConfig?: TuiCore["management"]["previewRemoveConfig"];
    readonly removeConfig?: TuiCore["management"]["removeConfig"];
    readonly loadInstalled?: TuiCore["content"]["loadInstalled"];
    readonly listInstalledResources?: TuiCore["content"]["listInstalledResources"];
    readonly readInstalled?: TuiCore["content"]["readInstalled"];
    readonly configuration?: TuiCore["configuration"];
  } = {},
): TuiCore {
  return {
    workspace: {
      get: (options) => hooks.get?.(options) ?? Promise.resolve(result(projection)),
    },
    management: {
      previewUpdate:
        hooks.previewUpdate ??
        (async () => {
          throw new Error("Unexpected update preview");
        }),
      previewSourceRemoval: (_request, options) =>
        hooks.preview?.(options) ??
        Promise.resolve(
          result({
            kind: "source-removal",
            source: "team-main",
            owner: directOwner,
            installed: [],
            repairs: [],
            blockers: [],
            allowed: true,
          }),
        ),
      removeSource: (_request, options) =>
        hooks.remove?.(options) ?? Promise.resolve(result(undefined)),
      discover: (request, options) =>
        hooks.discover?.(request, options) ??
        Promise.resolve(result({ source: request.source, kind: "github", candidates: [] })),
      install: (request, options) =>
        hooks.install?.(request, options) ?? Promise.resolve(result([])),
      checkUpdate: (request, options) =>
        hooks.checkUpdate?.(request, options) ??
        Promise.resolve(
          result({
            source: request.source,
            kind: "github",
            changed: [],
            added: [],
            removed: [],
            unchanged: [],
          }),
        ),
      update: (request, options) =>
        hooks.update?.(request, options) ?? Promise.resolve(result(undefined)),
      previewUninstall: (request, options) =>
        hooks.previewUninstall?.(request, options) ??
        Promise.resolve(
          result({
            kind: "uninstall" as const,
            installed: request.paths.map((path) => ({ source: request.source, path })),
            directMemberships: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          }),
        ),
      uninstall: (request, options) =>
        hooks.uninstall?.(request, options) ?? Promise.resolve(result(undefined)),
      previewRebind: (request, options) =>
        hooks.previewRebind?.(request, options) ??
        Promise.resolve(
          result({
            kind: "rebind" as const,
            address: { source: request.source, path: request.path },
            owner: request.owner,
            ownerPath: request.ownerPath ?? request.path,
            proof: "proven" as const,
            allowed: true,
          }),
        ),
      rebind: (request, options) =>
        hooks.rebind?.(request, options) ?? Promise.resolve(result(undefined)),
      observeConfig: (request, options) =>
        hooks.observeConfig?.(request, options) ??
        Promise.resolve(
          result({
            id: request.id,
            kind: "github",
            exactRevision: "a".repeat(40),
            contributions: { sources: [], collections: [] },
          }),
        ),
      previewAdoptConfig: (request, options) =>
        hooks.previewAdoptConfig?.(request, options) ??
        Promise.resolve(
          result({
            kind: "config-source-adopt",
            id: request.id,
            owner: configSourceOwner,
            binding: {
              kind: "github",
              origin: "https://github.com/team/config",
              root: "",
              ref: "main",
            },
            exactRevision: request.exactRevision,
            declarationRetained: true,
            contributions: { sources: [], collections: [] },
            delta: {
              addedSources: [],
              changedSources: [],
              removedSources: [],
              addedCollections: [],
              changedCollections: [],
              removedCollections: [],
            },
            affectedInstalled: [],
            disappearingSelectors: [],
            blockers: [],
            allowed: true,
          }),
        ),
      adoptConfig: (request, options) =>
        hooks.adoptConfig?.(request, options) ?? Promise.resolve(result(undefined)),
      previewForgetConfig: (request, options) =>
        hooks.previewForgetConfig?.(request, options) ??
        Promise.resolve(
          result({
            kind: "config-source-forget",
            id: request.id,
            owner: configSourceOwner,
            binding: {
              kind: "github",
              origin: "https://github.com/team/config",
              root: "",
              ref: "main",
            },
            declarationRetained: true,
            contributions: { sources: [], collections: [] },
            delta: {
              addedSources: [],
              changedSources: [],
              removedSources: [],
              addedCollections: [],
              changedCollections: [],
              removedCollections: [],
            },
            affectedInstalled: [],
            disappearingSelectors: [],
            blockers: [],
            allowed: true,
          }),
        ),
      forgetConfig: (request, options) =>
        hooks.forgetConfig?.(request, options) ?? Promise.resolve(result(undefined)),
      previewRemoveConfig: (request, options) =>
        hooks.previewRemoveConfig?.(request, options) ??
        Promise.resolve(
          result({
            kind: "config-source-removal",
            id: request.id,
            owner: configSourceOwner,
            binding: {
              kind: "github",
              origin: "https://github.com/team/config",
              root: "",
              ref: "main",
            },
            declarationRetained: false,
            contributions: { sources: [], collections: [] },
            delta: {
              addedSources: [],
              changedSources: [],
              removedSources: [],
              addedCollections: [],
              changedCollections: [],
              removedCollections: [],
            },
            affectedInstalled: [],
            disappearingSelectors: [],
            blockers: [],
            allowed: true,
          }),
        ),
      removeConfig: (request, options) =>
        hooks.removeConfig?.(request, options) ?? Promise.resolve(result(undefined)),
    },
    content: {
      loadInstalled: (request, options) =>
        hooks.loadInstalled?.(request, options) ??
        Promise.resolve(
          result({
            address: request.address,
            name: request.address.path,
            description: "",
            rawText: `# ${request.address.path}`,
            markdownText: `# ${request.address.path}`,
          }),
        ),
      listInstalledResources: (request, options) =>
        hooks.listInstalledResources?.(request, options) ??
        Promise.resolve(result([] as readonly ResourceDescriptor[])),
      readInstalled: (request, options) =>
        hooks.readInstalled?.(request, options) ??
        Promise.resolve(
          result({
            kind: "not-text" as const,
            path: request.path,
            reason: "unsupported" as const,
            metadata: { path: request.path, kind: "file" as const },
          }),
        ),
    },
    configuration:
      hooks.configuration ??
      ({
        change: async () => result({ level: "project", changed: true }),
        previewMembershipBatch: async (request) =>
          result({
            kind: "membership-batch",
            collection: request.collection,
            decision: { kind: "missing" },
            additions: request.additions,
            removals: request.removals,
            affected: [],
            blockers: [],
            effectful: false,
            allowed: false,
          }),
        previewAddToCollection: async (request) =>
          result({
            kind: "add-to-collection",
            collection: request.collection,
            address: request.address,
            decision: { kind: "missing" },
            existing: [],
            blockers: [],
            allowed: false,
          }),
        previewMembershipRemoval: async (request) =>
          result({
            kind: "membership-removal",
            collection: request.collection,
            name: request.name,
            decision: { kind: "missing" },
            affected: [],
            retained: [],
            disappearing: [],
            linkActions: [],
            allowed: false,
          }),
        previewImport: async (request) =>
          result({
            kind: "collection-import",
            source: request.from,
            destination: request.into,
            additions: [],
            skipped: [],
            conflicts: [],
            allowed: false,
          }),
        previewReference: async (request) =>
          result({
            kind: "reference",
            collection: request.collection,
            name: request.name,
            referencedCollection: request.target,
            description: request.description,
            decision: { kind: "missing" },
            exposure: [],
            allowed: false,
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
            allowed: false,
          }),
        previewCollectionUse: async (request) =>
          result({
            kind: "collection-use",
            owner: { level: request.level, file: "", pointer: "/use" },
            oldCollections: [],
            newCollections: request.collections,
            affectedSelectors: [],
            newlyExposed: [],
            removedAtOwner: [],
            retained: [],
            alternateOwners: [],
            currentComplete: false,
            proposedComplete: false,
            blockers: [],
            allowed: false,
          }),
        previewCollectionRemoval: async () =>
          result({
            kind: "collection-removal",
            repository: { derived: false, producers: [] },
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: false,
          }),
      } satisfies TuiCore["configuration"]),
  };
}

async function settleReaderHighlighting(node: BaseRenderable): Promise<void> {
  if (node instanceof CodeRenderable) await node.highlightingDone;
  for (const child of node.getChildren()) await settleReaderHighlighting(child);
}

/** Focuses the directly mounted Reader, entering it from the browser when visible. */
export async function openReaderFromInspector(setup: Awaited<ReturnType<typeof testRender>>) {
  const browserNode = setup.renderer.root.findDescendantById("installed-skill-browser");
  if (browserNode instanceof SelectRenderable && browserNode.options.length > 0) {
    const browser = await focusLive(setup, "installed-skill-browser");
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable !== browser &&
        !!setup.renderer.root.findDescendantById("reader-views"),
    );
  } else {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    const current = setup.renderer.root.findDescendantById("reader-scrollbox");
    if (current) await focusLive(setup, "reader-scrollbox");
    else await focusLive(setup, "reader-tabs");
  }
  await setup.waitFor(() => {
    const readerTargets = [
      "reader-scrollbox",
      "resource-browser",
      "reader-details",
      "reader-resources-status",
      "reader-tabs",
    ];
    return readerTargets.some((id) => !!setup.renderer.root.findDescendantById(id));
  });
  const target = [
    "reader-scrollbox",
    "resource-browser",
    "reader-details",
    "reader-resources-status",
    "reader-tabs",
  ].find((id) => !!setup.renderer.root.findDescendantById(id));
  if (target) await focusLive(setup, target);
  await settleReaderHighlighting(setup.renderer.root);
  await setup.renderOnce();
  await setup.waitFor(() => {
    const views = setup.renderer.root.findDescendantById("reader-views");
    const skillTab = setup.renderer.root.findDescendantById("reader-tabs-tab-skill");
    const resourcesTab = setup.renderer.root.findDescendantById("reader-tabs-tab-resources");
    const detailsTab = setup.renderer.root.findDescendantById("reader-tabs-tab-details");
    return !!views && !!skillTab && !!resourcesTab && !!detailsTab;
  });
}
