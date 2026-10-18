import type { WorkspaceView, OperationResult } from "@skill-cli/core";
import type { TuiCore } from "../src/effects";
import type { testRender } from "@opentui/solid";
import { CodeRenderable, SelectRenderable, type BaseRenderable } from "@opentui/core";
import { createTuiEffects } from "../src/effects";
import { createOperationState } from "../src/operation-state";
import { createProjection } from "../src/projection";
import { createWorkspaceState } from "../src/workspace/state";
import { createCollectionsState } from "../src/collections/state";
import { createConfigState } from "../src/config/state";
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

export function testEffects(core: TuiCore) {
  const { projection, operation } = testProjection();
  return { ...createTuiEffects(core, operation, projection.outcomes), operation };
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
): WorkspaceView {
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
  projection: WorkspaceView,
  hooks: {
    readonly workspace?: Partial<TuiCore["workspace"]>;
    readonly sources?: Partial<TuiCore["sources"]>;
    readonly installed?: Partial<TuiCore["installed"]>;
    readonly configSources?: Partial<TuiCore["configSources"]>;
    readonly collections?: Partial<TuiCore["collections"]>;
    readonly use?: Partial<TuiCore["use"]>;
    readonly setManagedOpenCode?: TuiCore["setManagedOpenCode"];
  } = {},
): TuiCore {
  return {
    workspace: {
      get: (options) => hooks.workspace?.get?.(options) ?? Promise.resolve(result(projection)),
    },
    sources: {
      register:
        hooks.sources?.register ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      discover:
        hooks.sources?.discover ??
        (async ({ source }) => result({ source, kind: "github", candidates: [] })),
      previewRemoval:
        hooks.sources?.previewRemoval ??
        (async ({ source }) =>
          result({
            kind: "source-removal",
            source,
            owner: directOwner,
            installed: [],
            repairs: [],
            blockers: [],
            allowed: true,
          })),
      remove: hooks.sources?.remove ?? (async () => result(undefined)),
    },
    installed: {
      load:
        hooks.installed?.load ??
        (async ({ address }) => ({
          address,
          name: address.path,
          description: "",
          rawText: `# ${address.path}`,
          markdownText: `# ${address.path}`,
        })),
      listResources: hooks.installed?.listResources ?? (async () => []),
      read:
        hooks.installed?.read ??
        (async ({ path }) => ({
          kind: "not-text",
          path,
          reason: "unsupported",
          metadata: { path, kind: "file" },
        })),
      install: hooks.installed?.install ?? (async () => result([])),
      previewUninstall:
        hooks.installed?.previewUninstall ??
        (async ({ source, paths }) =>
          result({
            kind: "uninstall",
            installed: paths.map((path) => ({ source, path })),
            directMemberships: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          })),
      uninstall: hooks.installed?.uninstall ?? (async () => result(undefined)),
      previewRebind:
        hooks.installed?.previewRebind ??
        (async ({ source, path, owner, ownerPath }) =>
          result({
            kind: "rebind",
            address: { source, path },
            owner,
            ownerPath: ownerPath ?? path,
            proof: "proven",
            allowed: true,
          })),
      rebind: hooks.installed?.rebind ?? (async () => result(undefined)),
      checkUpdate:
        hooks.installed?.checkUpdate ??
        (async ({ source }) =>
          result({
            source,
            kind: "github",
            baseline: `baseline:${source}`,
            changed: [],
            added: [],
            removed: [],
            unchanged: [],
          })),
      updateBaseline:
        hooks.installed?.updateBaseline ?? (async ({ source }) => result(`baseline:${source}`)),
      previewUpdate:
        hooks.installed?.previewUpdate ??
        (async () => {
          throw new Error("Unexpected update preview");
        }),
      update: hooks.installed?.update ?? (async () => result(undefined)),
    },
    configSources: {
      register:
        hooks.configSources?.register ??
        (async () => result({ level: "global", file: configSourceOwner.file, changed: true })),
      observe:
        hooks.configSources?.observe ??
        (async ({ id }) =>
          result({
            id,
            kind: "github",
            exactRevision: "a".repeat(40),
            contributions: { sources: [], collections: [] },
          })),
      previewAdoption:
        hooks.configSources?.previewAdoption ??
        (async ({ id, exactRevision }) =>
          result({
            kind: "config-source-adopt",
            id,
            owner: configSourceOwner,
            binding: {
              kind: "github",
              origin: "https://github.com/team/config",
              root: "",
              ref: "main",
            },
            exactRevision,
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
          })),
      adopt: hooks.configSources?.adopt ?? (async () => result(undefined)),
      previewForget:
        hooks.configSources?.previewForget ??
        (async ({ id }) =>
          result({
            kind: "config-source-forget",
            id,
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
          })),
      forget: hooks.configSources?.forget ?? (async () => result(undefined)),
      previewRemoval:
        hooks.configSources?.previewRemoval ??
        (async ({ id }) =>
          result({
            kind: "config-source-removal",
            id,
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
          })),
      remove: hooks.configSources?.remove ?? (async () => result(undefined)),
    },
    collections: {
      create:
        hooks.collections?.create ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      remove:
        hooks.collections?.remove ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      addMember:
        hooks.collections?.addMember ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      removeMember:
        hooks.collections?.removeMember ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      editMembers:
        hooks.collections?.editMembers ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      importMembers:
        hooks.collections?.importMembers ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      addReference:
        hooks.collections?.addReference ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      removeReference:
        hooks.collections?.removeReference ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      setLink:
        hooks.collections?.setLink ??
        (async () => result({ level: "project", file: directOwner.file, changed: true })),
      previewAddMember:
        hooks.collections?.previewAddMember ??
        (async (request) =>
          result({
            kind: "add-to-collection",
            collection: request.collection,
            address: request.address,
            decision: { kind: "direct", owner: directOwner },
            intent: { owner: directOwner, stableEntryName: request.name, address: request.address },
            existing: [],
            blockers: [],
            allowed: true,
          })),
      previewRemoveMember:
        hooks.collections?.previewRemoveMember ??
        (async (request) =>
          result({
            kind: "membership-removal",
            collection: request.collection,
            name: request.name,
            decision: { kind: "direct", owner: directOwner },
            affected: request.expectedAddress
              ? [
                  {
                    selector: `${request.collection}:${request.name}`,
                    address: request.expectedAddress,
                    paths: [],
                  },
                ]
              : [],
            retained: [],
            disappearing: [],
            linkActions: [],
            allowed: true,
          })),
      previewMemberEdit:
        hooks.collections?.previewMemberEdit ??
        (async (request) =>
          result({
            kind: "membership-batch",
            collection: request.collection,
            decision: { kind: "direct", owner: directOwner },
            additions: request.additions,
            removals: request.removals,
            affected: [],
            blockers: [],
            effectful: true,
            allowed: true,
          })),
      previewImportMembers:
        hooks.collections?.previewImportMembers ??
        (async (request) =>
          result({
            kind: "collection-import",
            source: request.from,
            destination: request.into,
            owner: directOwner,
            additions: [],
            skipped: [],
            conflicts: [],
            allowed: true,
          })),
      previewAddReference:
        hooks.collections?.previewAddReference ??
        (async (request) =>
          result({
            kind: "reference",
            collection: request.collection,
            name: request.name,
            referencedCollection: request.target,
            description: request.description,
            owner: directOwner,
            decision: { kind: "direct", owner: directOwner },
            allowed: true,
          })),
      previewRemoveReference:
        hooks.collections?.previewRemoveReference ??
        (async (request) =>
          result({
            kind: "reference",
            collection: request.collection,
            name: request.name,
            referencedCollection: request.expected?.collection ?? "target",
            description: request.expected?.description ?? "",
            owner: directOwner,
            decision: { kind: "direct", owner: directOwner },
            allowed: true,
          })),
      previewSetLink:
        hooks.collections?.previewSetLink ??
        (async (request) =>
          result({
            kind: "link-change",
            collection: request.collection,
            target: request.target,
            owner: directOwner,
            linked: request.linked,
            members: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          })),
      previewRemoval:
        hooks.collections?.previewRemoval ??
        (async () =>
          result({
            kind: "collection-removal",
            owner: directOwner,
            decision: { kind: "direct", owner: directOwner },
            repository: { derived: false, producers: [] },
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          })),
    },
    use: {
      set:
        hooks.use?.set ??
        (async () =>
          result({
            level: "project",
            file: directOwner.file,
            changed: true,
            use: { before: [], after: [] },
          })),
      add:
        hooks.use?.add ??
        (async () =>
          result({
            level: "project",
            file: directOwner.file,
            changed: true,
            use: { before: [], after: [] },
          })),
      remove:
        hooks.use?.remove ??
        (async () =>
          result({
            level: "project",
            file: directOwner.file,
            changed: true,
            use: { before: [], after: [] },
          })),
      previewSet:
        hooks.use?.previewSet ??
        (async (request) =>
          result({
            kind: "collection-use",
            owner: directOwner,
            oldCollections: [],
            newCollections: request.collections,
            affectedSelectors: [],
            newlyExposed: [],
            removedAtOwner: [],
            retained: [],
            alternateOwners: [],
            currentComplete: true,
            proposedComplete: true,
            blockers: [],
            allowed: true,
          })),
    },
    setManagedOpenCode:
      hooks.setManagedOpenCode ??
      (async () => result({ level: "project", file: directOwner.file, changed: true })),
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
