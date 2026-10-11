import {
  type DiscoveryObservation,
  type ConfigSourceObservation,
  type ContentCapability,
  type ConfigurationCapability,
  type ConfigChange,
  type ConfigLevel,
  type AddToCollectionImpact,
  type MembershipBatchImpact,
  type MembershipRemovalImpact,
  type ImportImpact,
  type ReferenceImpact,
  type LinkChangeImpact,
  type CollectionUseImpact,
  type CollectionRemovalImpact,
  SkillCliError,
  type ManagementCapability,
  type SourceRemovalImpact,
  type RebindImpact,
  type UninstallImpact,
  type UpdateObservation,
  type WorkspaceCapability,
  type ConfigDeclarationOwner,
} from "@skill-cli/core";
import type { DirectSourceIntent, SourceOperationIntent } from "./actions";
import type { OperationState } from "./operation-state";
import type { Diagnostic } from "@skill-cli/core";
import type { ReaderEvent, ReaderRequest } from "./reader/state";
import type { ProjectionOutcomes } from "./projection";
import type { TaskState } from "./types";

interface ForegroundRequest {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly active: () => boolean;
}

export interface TuiCore {
  readonly workspace: Pick<WorkspaceCapability, "get">;
  readonly management: Pick<
    ManagementCapability,
    | "previewSourceRemoval"
    | "removeSource"
    | "discover"
    | "install"
    | "checkUpdate"
    | "update"
    | "previewUninstall"
    | "uninstall"
    | "previewRebind"
    | "rebind"
    | "observeConfig"
    | "previewAdoptConfig"
    | "adoptConfig"
    | "previewForgetConfig"
    | "forgetConfig"
    | "previewRemoveConfig"
    | "removeConfig"
  >;
  readonly content: Pick<
    ContentCapability,
    "loadInstalled" | "listInstalledResources" | "readInstalled"
  >;
  readonly configuration: Pick<
    ConfigurationCapability,
    | "change"
    | "previewAddToCollection"
    | "previewMembershipBatch"
    | "previewMembershipRemoval"
    | "previewImport"
    | "previewReference"
    | "previewLinkChange"
    | "previewCollectionUse"
    | "previewCollectionRemoval"
  >;
}

type CollectionAddress = { readonly source: string; readonly path: string };
export type CollectionIntent =
  | { readonly kind: "collection-create"; readonly level: ConfigLevel; readonly collection: string }
  | {
      readonly kind: "add-to-collection";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly address: CollectionAddress;
      readonly name?: string;
    }
  | {
      readonly kind: "membership-removal";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly expectedAddress: CollectionAddress;
      readonly expectedOwner?: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "membership-batch";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly expectedOwner?: ConfigDeclarationOwner;
      readonly additions: readonly {
        readonly name: string;
        readonly address: CollectionAddress;
      }[];
      readonly removals: readonly {
        readonly name: string;
        readonly expectedAddress: CollectionAddress;
      }[];
    }
  | {
      readonly kind: "collection-import";
      readonly level: ConfigLevel;
      readonly from: string;
      readonly into: string;
    }
  | {
      readonly kind: "reference";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly target: string;
      readonly description: string;
      readonly remove?: boolean;
    }
  | {
      readonly kind: "link-change";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly target: string;
      readonly linked: boolean;
    }
  | {
      readonly kind: "collection-use";
      readonly level: ConfigLevel;
      readonly collections: readonly string[];
    }
  | {
      readonly kind: "collection-removal";
      readonly level: ConfigLevel;
      readonly collection: string;
    };

export interface AuthorizedMembershipIntent {
  readonly kind: "add-to-collection";
  readonly level: ConfigLevel;
  readonly collection: string;
  readonly name: string;
  readonly address: CollectionAddress;
  readonly owner: ConfigDeclarationOwner;
}

export type AddMembershipPreviewRequest = Extract<
  CollectionIntent,
  { readonly kind: "add-to-collection" }
>;

export type CollectionReview =
  | {
      readonly kind: "add-to-collection";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "add-to-collection" }>;
      readonly impact: AddToCollectionImpact;
      readonly authorized?: AuthorizedMembershipIntent;
      readonly nextStep?: {
        readonly kind: "create-direct-contribution";
        readonly collection: string;
        readonly eligibleLevels: readonly ConfigLevel[];
      };
    }
  | {
      readonly kind: "membership-removal";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "membership-removal" }>;
      readonly impact: MembershipRemovalImpact;
    }
  | {
      readonly kind: "membership-batch";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "membership-batch" }>;
      readonly impact: MembershipBatchImpact;
    }
  | {
      readonly kind: "collection-import";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "collection-import" }>;
      readonly impact: ImportImpact;
    }
  | {
      readonly kind: "reference";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "reference" }>;
      readonly impact: ReferenceImpact;
    }
  | {
      readonly kind: "link-change";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "link-change" }>;
      readonly impact: LinkChangeImpact;
    }
  | {
      readonly kind: "collection-use";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "collection-use" }>;
      readonly impact: CollectionUseImpact;
    }
  | {
      readonly kind: "collection-removal";
      readonly id: string;
      readonly intent: Extract<CollectionIntent, { readonly kind: "collection-removal" }>;
      readonly impact: CollectionRemovalImpact;
    };

export interface SourceRemovalReview {
  readonly id: string;
  readonly intent: DirectSourceIntent;
  readonly impact: SourceRemovalImpact;
}
export interface DiscoveryReview {
  readonly kind: "discovery";
  readonly id: string;
  readonly intent: Extract<SourceOperationIntent, { readonly kind: "source-discovery" }>;
  readonly observation: DiscoveryObservation;
}
export interface UpdateReview {
  readonly kind: "update";
  readonly id: string;
  readonly intent: Extract<SourceOperationIntent, { readonly kind: "source-update" }>;
  readonly observation: UpdateObservation;
  readonly selectedPath?: string;
}
export type InstalledSkillReview =
  | {
      readonly kind: "uninstall";
      readonly id: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly impact: UninstallImpact;
    }
  | {
      readonly kind: "rebind";
      readonly id: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly owner: string;
      readonly ownerPath: string;
      readonly impact: RebindImpact;
    };

const diagnostic = (error: unknown) => ({
  code: error instanceof SkillCliError ? error.code : "INTERNAL",
  severity: "warning" as const,
  message: error instanceof Error ? error.message : "Operation failed",
});
const cancelled = (error: unknown) => error instanceof SkillCliError && error.code === "CANCELLED";

export function createTuiEffects(
  core: TuiCore,
  operation: OperationState,
  projection: ProjectionOutcomes,
  dispatchReader: (event: ReaderEvent) => void = () => {},
  beginReader: (
    address: { readonly source: string; readonly path: string },
    request: ReaderRequest,
    path?: string,
  ) => Extract<ReaderEvent, { readonly type: `${string}.start` }> = () => {
    throw new Error("Reader owner is required");
  },
) {
  let refreshController: AbortController | undefined;
  let readerContentController: AbortController | undefined;
  let readerResourceController: AbortController | undefined;
  let foreground:
    | {
        readonly id: string;
        readonly controller: AbortController;
        readonly kind: "preview" | "observe" | "execute";
      }
    | undefined;
  let liveReview: SourceRemovalReview | undefined;
  let liveDiscovery: DiscoveryReview | undefined;
  let liveUpdate: UpdateReview | undefined;
  let liveInstalledReview: InstalledSkillReview | undefined;
  let liveCollectionReview: CollectionReview | undefined;
  let sequence = 0;
  let closed = false;
  const next = () => `${++sequence}`;
  const report = (next: Diagnostic) => operation.report(next);
  const start = (task: TaskState) => operation.start(task);
  const settle = (id: string, status: string, error?: Diagnostic) =>
    operation.settle(id, status, error);

  // This owns only request lifetime. Review identity, authorization, mutations and
  // refresh decisions remain in each body. Aborting execution is not rollback.
  const withForeground = async <T>(
    kind: "preview" | "observe" | "execute",
    fallback: T,
    body: (request: ForegroundRequest) => Promise<T>,
    task?: Pick<TaskState, "title" | "semanticOwner">,
    reportCancellation = true,
  ): Promise<T> => {
    if (closed || foreground) return fallback;
    const id = next();
    const controller = new AbortController();
    const current = { id, controller, kind };
    foreground = current;
    const active = () => !closed && foreground === current;
    try {
      if (task) start({ ...task, id, cancellationRequested: false });
      return await body({ id, signal: controller.signal, active });
    } catch (error) {
      if (active()) {
        const problem = diagnostic(error);
        if (task)
          settle(
            id,
            cancelled(error)
              ? kind === "observe"
                ? "Observation cancelled"
                : "Operation cancelled"
              : problem.message,
            problem,
          );
        else if (reportCancellation || !cancelled(error)) report(problem);
      }
      return fallback;
    } finally {
      if (foreground === current) foreground = undefined;
    }
  };

  const refresh = async () => {
    if (closed) return undefined;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    projection.loading();
    try {
      const result = await core.workspace.get({ signal: controller.signal });
      if (!closed && refreshController === controller) projection.applyProjection(result.value);
      return result;
    } catch (error) {
      if (!closed && refreshController === controller && !cancelled(error))
        projection.failed(diagnostic(error));
      return undefined;
    } finally {
      if (refreshController === controller) refreshController = undefined;
    }
  };

  const loadReader = async (address: { readonly source: string; readonly path: string }) => {
    if (closed) return undefined;
    readerContentController?.abort();
    const controller = new AbortController();
    readerContentController = controller;
    const start = beginReader(address, "content");
    const epoch = start.epoch;
    try {
      const result = await core.content.loadInstalled({ address }, { signal: controller.signal });
      if (!closed) {
        dispatchReader({ type: "content.settle", address, epoch, value: result.value });
        for (const item of result.diagnostics)
          dispatchReader({ type: "failure", address, epoch, request: "content", diagnostic: item });
      }
      return result;
    } catch (error) {
      if (!closed && !cancelled(error))
        dispatchReader({
          type: "failure",
          address,
          epoch,
          request: "content",
          diagnostic: diagnostic(error),
        });
      return undefined;
    } finally {
      if (readerContentController === controller) readerContentController = undefined;
    }
  };
  const listResources = async (address: { readonly source: string; readonly path: string }) => {
    if (closed) return undefined;
    readerResourceController?.abort();
    const controller = new AbortController();
    readerResourceController = controller;
    const start = beginReader(address, "resources");
    const epoch = start.epoch;
    try {
      const result = await core.content.listInstalledResources(
        { address },
        { signal: controller.signal },
      );
      if (!closed) {
        dispatchReader({ type: "resources.settle", address, epoch, resources: result.value });
        for (const item of result.diagnostics)
          dispatchReader({
            type: "failure",
            address,
            epoch,
            request: "resources",
            diagnostic: item,
          });
      }
      return result;
    } catch (error) {
      if (!closed && !cancelled(error))
        dispatchReader({
          type: "failure",
          address,
          epoch,
          request: "resources",
          diagnostic: diagnostic(error),
        });
      return undefined;
    } finally {
      if (readerResourceController === controller) readerResourceController = undefined;
    }
  };
  const readResource = async (
    address: { readonly source: string; readonly path: string },
    path: string,
  ) => {
    if (closed) return undefined;
    readerResourceController?.abort();
    const controller = new AbortController();
    readerResourceController = controller;
    const start = beginReader(address, "resource", path);
    const epoch = start.epoch;
    try {
      const result = await core.content.readInstalled(
        { address, path },
        { signal: controller.signal },
      );
      if (!closed) {
        dispatchReader({ type: "resource.settle", address, epoch, value: result.value });
        for (const item of result.diagnostics)
          dispatchReader({
            type: "failure",
            address,
            epoch,
            request: "resource",
            diagnostic: item,
          });
      }
      return result;
    } catch (error) {
      if (!closed && !cancelled(error))
        dispatchReader({
          type: "failure",
          address,
          epoch,
          request: "resource",
          diagnostic: diagnostic(error),
        });
      return undefined;
    } finally {
      if (readerResourceController === controller) readerResourceController = undefined;
    }
  };

  const review = async (intent: DirectSourceIntent): Promise<SourceRemovalReview | undefined> => {
    return withForeground("preview", undefined, async ({ id, signal, active }) => {
      const result = await core.management.previewSourceRemoval(
        { source: intent.source },
        { signal },
      );
      if (!active()) return undefined;
      if (
        result.value.kind !== "source-removal" ||
        result.value.source !== intent.source ||
        result.value.owner === undefined ||
        result.value.owner.level !== intent.owner.level ||
        result.value.owner.file !== intent.owner.file ||
        result.value.owner.pointer !== intent.owner.pointer
      ) {
        report({
          code: "TRANSACTION_CONFLICT",
          severity: "warning",
          message: "Source removal preview no longer matches the selected declaration",
        });
        return undefined;
      }
      const reviewed = { id, intent, impact: result.value };
      liveReview = reviewed;
      return reviewed;
    });
  };

  const confirm = async (reviewed: SourceRemovalReview) => {
    if (closed || foreground || !reviewed.impact.allowed || liveReview !== reviewed) return false;
    return withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        await core.management.removeSource({ source: reviewed.intent.source }, { signal });
        const refreshed = await refresh();
        if (active())
          settle(id, refreshed ? "Source removed" : "Source removed; Workspace is stale");
        if (active() && liveReview === reviewed) liveReview = undefined;
        return true;
      },
      {
        title: "Removing Source",
        semanticOwner: { kind: "source", id: reviewed.intent.source },
      },
    );
  };

  const discover = async (
    intent: Extract<SourceOperationIntent, { readonly kind: "source-discovery" }>,
  ): Promise<DiscoveryReview | undefined> => {
    return withForeground(
      "observe",
      undefined,
      async ({ id, signal, active }) => {
        const result = await core.management.discover({ source: intent.source }, { signal });
        if (!active() || result.value.source !== intent.source) {
          if (active()) {
            const error = {
              code: "TRANSACTION_CONFLICT",
              severity: "warning" as const,
              message: "Observed Source no longer matches the selected Source",
            };
            settle(id, error.message, error);
          }
          return undefined;
        }
        const reviewed: DiscoveryReview = {
          kind: "discovery",
          id,
          intent,
          observation: result.value,
        };
        liveDiscovery = reviewed;
        settle(id, "Observation ready");
        return reviewed;
      },
      {
        title: "Observing Source",
        semanticOwner: { kind: "source", id: intent.source },
      },
    );
  };

  const checkUpdate = async (
    intent: Extract<SourceOperationIntent, { readonly kind: "source-update" }>,
  ): Promise<UpdateReview | undefined> => {
    return withForeground(
      "observe",
      undefined,
      async ({ id, signal, active }) => {
        const result = await core.management.checkUpdate({ source: intent.source }, { signal });
        if (!active() || result.value.source !== intent.source) {
          if (active()) {
            const error = {
              code: "TRANSACTION_CONFLICT",
              severity: "warning" as const,
              message: "Observed Source no longer matches the selected Source",
            };
            settle(id, error.message, error);
          }
          return undefined;
        }
        const reviewed: UpdateReview = {
          kind: "update",
          id,
          intent,
          observation: result.value,
          selectedPath: intent.selectedPath,
        };
        liveUpdate = reviewed;
        settle(id, "Observation ready");
        return reviewed;
      },
      {
        title: "Observing Updates",
        semanticOwner: { kind: "source", id: intent.source },
      },
    );
  };

  const install = async (reviewed: DiscoveryReview, paths: readonly string[]) => {
    if (closed || foreground || liveDiscovery !== reviewed || paths.length === 0) return false;
    const candidatePaths = new Set(
      reviewed.observation.candidates.map((candidate) => candidate.path),
    );
    if (new Set(paths).size !== paths.length || paths.some((path) => !candidatePaths.has(path)))
      return false;
    return withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        await core.management.install(
          {
            source: reviewed.observation.source,
            paths,
            exactRevision: reviewed.observation.exactRevision,
          },
          { signal },
        );
        const refreshed = await refresh();
        if (active()) liveDiscovery = undefined;
        if (active())
          settle(id, refreshed ? "Skills installed" : "Skills installed; Workspace is stale");
        return true;
      },
      {
        title: "Installing Skills",
        semanticOwner: { kind: "source", id: reviewed.intent.source },
      },
    );
  };

  const update = async (reviewed: UpdateReview, paths: readonly string[]) => {
    if (closed || foreground || liveUpdate !== reviewed || paths.length === 0) return false;
    const changedPaths = new Set(
      reviewed.observation.changed
        .filter((candidate) => !reviewed.selectedPath || candidate.path === reviewed.selectedPath)
        .map((candidate) => candidate.path),
    );
    if (new Set(paths).size !== paths.length || paths.some((path) => !changedPaths.has(path)))
      return false;
    return withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        await core.management.update(
          {
            source: reviewed.observation.source,
            paths,
            exactRevision: reviewed.observation.exactRevision,
          },
          { signal },
        );
        const refreshed = await refresh();
        if (active()) liveUpdate = undefined;
        if (active())
          settle(id, refreshed ? "Skills updated" : "Skills updated; Workspace is stale");
        return true;
      },
      {
        title: "Updating Skills",
        semanticOwner: { kind: "source", id: reviewed.intent.source },
      },
    );
  };

  const reviewInstalled = async (
    request:
      | {
          readonly kind: "uninstall";
          readonly address: { readonly source: string; readonly path: string };
        }
      | {
          readonly kind: "rebind";
          readonly address: { readonly source: string; readonly path: string };
          readonly owner: string;
          readonly ownerPath: string;
        },
  ): Promise<InstalledSkillReview | undefined> => {
    if (closed || foreground) return undefined;
    if (
      request.kind === "rebind" &&
      (!request.owner ||
        !request.ownerPath ||
        request.ownerPath.startsWith("/") ||
        request.ownerPath.split("/").some((segment) => segment === ".." || segment === ""))
    ) {
      report({
        code: "INVALID_ARGUMENT",
        severity: "warning",
        message: "Replacement Skill path must be Source-root-relative",
      });
      return undefined;
    }
    return withForeground("preview", undefined, async ({ id, signal, active }) => {
      if (request.kind === "uninstall") {
        const result = await core.management.previewUninstall(
          { source: request.address.source, paths: [request.address.path] },
          { signal },
        );
        if (!active()) return undefined;
        if (
          result.value.kind !== "uninstall" ||
          result.value.installed.length !== 1 ||
          result.value.installed[0]?.source !== request.address.source ||
          result.value.installed[0]?.path !== request.address.path
        ) {
          report({
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Uninstall preview no longer matches the selected structural address",
          });
          return undefined;
        }
        const review: InstalledSkillReview = {
          kind: "uninstall",
          id,
          address: request.address,
          impact: result.value,
        };
        liveInstalledReview = review;
        return review;
      }
      const result = await core.management.previewRebind(
        {
          source: request.address.source,
          path: request.address.path,
          owner: request.owner,
          ownerPath: request.ownerPath,
        },
        { signal },
      );
      if (!active()) return undefined;
      if (
        result.value.kind !== "rebind" ||
        result.value.address.source !== request.address.source ||
        result.value.address.path !== request.address.path ||
        result.value.owner !== request.owner ||
        result.value.ownerPath !== request.ownerPath
      ) {
        report({
          code: "TRANSACTION_CONFLICT",
          severity: "warning",
          message: "Rebind preview no longer matches the selected structural address",
        });
        return undefined;
      }
      const review: InstalledSkillReview = {
        kind: "rebind",
        id,
        address: request.address,
        owner: request.owner,
        ownerPath: request.ownerPath,
        impact: result.value,
      };
      liveInstalledReview = review;
      return review;
    });
  };

  const collectionImpactMatches = (
    intent: CollectionIntent,
    impact: CollectionReview["impact"],
  ) => {
    switch (intent.kind) {
      case "add-to-collection":
        return (
          impact.kind === intent.kind &&
          impact.collection === intent.collection &&
          impact.address.source === intent.address.source &&
          impact.address.path === intent.address.path &&
          (impact.decision.kind === "direct"
            ? impact.intent !== undefined &&
              impact.intent.owner.level === intent.level &&
              impact.decision.owner.level === impact.intent.owner.level &&
              impact.decision.owner.file === impact.intent.owner.file &&
              impact.decision.owner.pointer === impact.intent.owner.pointer &&
              impact.intent.address.source === intent.address.source &&
              impact.intent.address.path === intent.address.path &&
              impact.intent.stableEntryName === intent.name
            : impact.decision.kind === "repository-derived"
              ? impact.createDirectContribution?.collection === intent.collection
              : false)
        );
      case "membership-removal":
        return (
          impact.kind === intent.kind &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.decision.kind === "direct" &&
          impact.decision.owner.level === intent.level &&
          impact.affected.some(
            (affected) =>
              affected.address.source === intent.expectedAddress.source &&
              affected.address.path === intent.expectedAddress.path,
          )
        );
      case "membership-batch":
        return (
          impact.kind === intent.kind &&
          impact.collection === intent.collection &&
          impact.decision.kind === "direct" &&
          impact.decision.owner.level === intent.level &&
          (!intent.expectedOwner ||
            (impact.decision.owner.level === intent.expectedOwner.level &&
              impact.decision.owner.file === intent.expectedOwner.file &&
              impact.decision.owner.pointer === intent.expectedOwner.pointer)) &&
          JSON.stringify(impact.additions) === JSON.stringify(intent.additions) &&
          JSON.stringify(impact.removals) === JSON.stringify(intent.removals)
        );
      case "collection-import":
        // ImportImpact does not identify its target collection. Live review identity and Core
        // revalidation bind `into`; its direct owner still proves the requested config level.
        return (
          impact.kind === intent.kind &&
          impact.source === intent.from &&
          impact.destination === intent.into &&
          impact.owner?.level === intent.level
        );
      case "reference":
        // ReferenceImpact does not classify set versus remove. Its exact returned fields plus
        // live review identity bind the form intent; Core revalidates the mutation semantics.
        return (
          impact.kind === intent.kind &&
          impact.collection === intent.collection &&
          impact.name === intent.name &&
          impact.referencedCollection === intent.target &&
          impact.description === intent.description &&
          impact.owner?.level === intent.level
        );
      case "link-change":
        // LinkChangeImpact omits collection and target identity. A returned owner can validate
        // level; live review identity and Core revalidation retain the full structural intent.
        return (
          impact.kind === intent.kind &&
          impact.collection === intent.collection &&
          impact.target === intent.target &&
          impact.linked === intent.linked &&
          impact.owner !== undefined &&
          impact.owner.level === intent.level
        );
      case "collection-use":
        return (
          impact.kind === intent.kind &&
          impact.owner.level === intent.level &&
          impact.newCollections.length === intent.collections.length &&
          impact.newCollections.every((value, index) => value === intent.collections[index])
        );
      case "collection-removal":
        return (
          impact.kind === intent.kind &&
          impact.owner?.level === intent.level &&
          impact.decision?.kind === "direct" &&
          impact.decision.owner.level === intent.level
        );
      case "collection-create":
        return false;
    }
  };

  const reviewCollection = async (
    intent: Exclude<CollectionIntent, { readonly kind: "collection-create" }>,
  ): Promise<CollectionReview | undefined> => {
    if (closed || foreground) return undefined;
    if (
      intent.kind === "membership-removal" &&
      (!intent.expectedAddress.source || !intent.expectedAddress.path)
    ) {
      report({
        code: "INVALID_ARGUMENT",
        severity: "warning",
        message: "Remove Membership requires the exact expected structural address",
      });
      return undefined;
    }
    return withForeground(
      "preview",
      undefined,
      async ({ id, signal, active }) => {
        const result = await (intent.kind === "add-to-collection"
          ? core.configuration.previewAddToCollection(
              {
                level: intent.level,
                collection: intent.collection,
                address: intent.address,
                name: intent.name!,
              },
              { signal },
            )
          : intent.kind === "membership-removal"
            ? core.configuration.previewMembershipRemoval(
                {
                  level: intent.level,
                  collection: intent.collection,
                  name: intent.name,
                  ...(intent.expectedOwner ? { expectedOwner: intent.expectedOwner } : {}),
                },
                { signal },
              )
            : intent.kind === "membership-batch"
              ? core.configuration.previewMembershipBatch(
                  {
                    level: intent.level,
                    collection: intent.collection,
                    ...(intent.expectedOwner && intent.removals.length
                      ? { expectedOwner: intent.expectedOwner }
                      : {}),
                    additions: intent.additions,
                    removals: intent.removals,
                  },
                  { signal },
                )
              : intent.kind === "collection-import"
                ? core.configuration.previewImport(
                    { level: intent.level, from: intent.from, into: intent.into },
                    { signal },
                  )
                : intent.kind === "reference"
                  ? core.configuration.previewReference(
                      {
                        level: intent.level,
                        collection: intent.collection,
                        name: intent.name,
                        target: intent.target,
                        description: intent.description,
                        remove: intent.remove,
                      },
                      { signal },
                    )
                  : intent.kind === "link-change"
                    ? core.configuration.previewLinkChange(
                        {
                          level: intent.level,
                          collection: intent.collection,
                          target: intent.target,
                          linked: intent.linked,
                        },
                        { signal },
                      )
                    : intent.kind === "collection-use"
                      ? core.configuration.previewCollectionUse(
                          { level: intent.level, collections: intent.collections },
                          { signal },
                        )
                      : core.configuration.previewCollectionRemoval(
                          { level: intent.level, collection: intent.collection },
                          { signal },
                        ));
        if (!active()) return undefined;
        if (!collectionImpactMatches(intent, result.value)) {
          report({
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Collection preview no longer matches the selected structural intent",
          });
          return undefined;
        }
        const reviewed: CollectionReview = (
          intent.kind === "add-to-collection" &&
          result.value.kind === "add-to-collection" &&
          result.value.decision.kind === "direct" &&
          result.value.intent?.stableEntryName
            ? {
                kind: intent.kind,
                id,
                intent,
                impact: result.value,
                authorized: {
                  kind: "add-to-collection",
                  level: result.value.intent.owner.level,
                  collection: intent.collection,
                  name: result.value.intent.stableEntryName,
                  address: intent.address,
                  owner: result.value.intent.owner,
                },
              }
            : intent.kind === "add-to-collection" &&
                result.value.kind === "add-to-collection" &&
                result.value.decision.kind === "repository-derived" &&
                result.value.createDirectContribution
              ? {
                  kind: intent.kind,
                  id,
                  intent,
                  impact: result.value,
                  nextStep: {
                    kind: "create-direct-contribution",
                    collection: result.value.createDirectContribution.collection,
                    eligibleLevels: result.value.createDirectContribution.eligibleLevels,
                  },
                }
              : { kind: intent.kind, id, intent, impact: result.value }
        ) as CollectionReview;
        if (
          intent.kind === "add-to-collection" &&
          !("authorized" in reviewed || "nextStep" in reviewed)
        ) {
          report({
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Collection preview did not provide an executable membership or next step",
          });
          return undefined;
        }
        liveCollectionReview = reviewed;
        return reviewed;
      },
      undefined,
      false,
    );
  };

  const collectionChange = (
    intent:
      | Exclude<CollectionIntent, { readonly kind: "add-to-collection" }>
      | AuthorizedMembershipIntent,
    reviewedLevel?: ConfigLevel,
    reviewedAffected?: MembershipBatchImpact["affected"],
  ): ConfigChange => {
    switch (intent.kind) {
      case "collection-create":
        return { type: "collection.create", level: intent.level, collection: intent.collection };
      case "add-to-collection":
        return {
          type: "collection.member.set",
          level: reviewedLevel ?? intent.level,
          collection: intent.collection,
          name: intent.name,
          address: intent.address,
        };
      case "membership-removal":
        return {
          type: "collection.member.remove",
          level: reviewedLevel ?? intent.level,
          collection: intent.collection,
          name: intent.name,
          expectedAddress: intent.expectedAddress,
        };
      case "membership-batch":
        return {
          type: "collection.members.change",
          level: reviewedLevel ?? intent.level,
          collection: intent.collection,
          additions: intent.additions,
          removals: intent.removals,
          reviewedAffected: reviewedAffected!,
        };
      case "collection-import":
        return {
          type: "collection.import",
          level: intent.level,
          from: intent.from,
          into: intent.into,
        };
      case "reference":
        return intent.remove
          ? {
              type: "collection.reference.remove",
              level: reviewedLevel ?? intent.level,
              collection: intent.collection,
              name: intent.name,
              expected: { collection: intent.target, description: intent.description },
            }
          : {
              type: "collection.reference.set",
              level: reviewedLevel ?? intent.level,
              collection: intent.collection,
              name: intent.name,
              target: intent.target,
              description: intent.description,
            };
      case "link-change":
        return {
          type: "collection.link.set",
          level: intent.level,
          collection: intent.collection,
          target: intent.target,
          linked: intent.linked,
        };
      case "collection-use":
        return { type: "use.set", level: intent.level, collections: intent.collections };
      case "collection-removal":
        return { type: "collection.remove", level: intent.level, collection: intent.collection };
    }
  };

  const executeCollection = async (
    reviewed: CollectionReview | Extract<CollectionIntent, { readonly kind: "collection-create" }>,
  ) => {
    const creating = reviewed.kind === "collection-create";
    const intent:
      | Exclude<CollectionIntent, { readonly kind: "add-to-collection" }>
      | AuthorizedMembershipIntent
      | Extract<CollectionIntent, { readonly kind: "collection-create" }>
      | undefined = creating
      ? reviewed
      : reviewed.kind === "add-to-collection"
        ? reviewed.authorized
        : reviewed.intent;
    if (
      closed ||
      foreground ||
      (!creating &&
        (liveCollectionReview !== reviewed ||
          !reviewed.impact.allowed ||
          (reviewed.kind === "add-to-collection" && !reviewed.authorized)))
    )
      return false;
    if (!intent) return false;
    const semanticOwner =
      intent.kind === "collection-use"
        ? { kind: "config" as const, level: intent.level }
        : intent.kind === "collection-import"
          ? { kind: "collection" as const, id: intent.into }
          : { kind: "collection" as const, id: intent.collection };
    return withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        const reviewedLevel =
          !creating && reviewed.impact.kind === "add-to-collection"
            ? reviewed.impact.decision.kind === "direct"
              ? reviewed.impact.decision.owner.level
              : undefined
            : !creating && reviewed.impact.kind === "membership-removal"
              ? reviewed.impact.decision.kind === "direct"
                ? reviewed.impact.decision.owner.level
                : undefined
              : !creating && reviewed.impact.kind === "membership-batch"
                ? reviewed.impact.decision.kind === "direct"
                  ? reviewed.impact.decision.owner.level
                  : undefined
                : !creating && reviewed.impact.kind === "reference"
                  ? reviewed.impact.owner?.level
                  : undefined;
        await core.configuration.change(
          collectionChange(
            intent,
            reviewedLevel,
            !creating && reviewed.impact.kind === "membership-batch"
              ? reviewed.impact.affected
              : undefined,
          ),
          {
            signal,
          },
        );
        const refreshed = await refresh();
        if (active())
          settle(id, refreshed ? "Collection updated" : "Collection updated; Workspace is stale");
        if (active() && !creating && liveCollectionReview === reviewed)
          liveCollectionReview = undefined;
        return true;
      },
      { title: "Updating Collection", semanticOwner },
    );
  };

  const confirmInstalled = async (review: InstalledSkillReview) => {
    if (closed || foreground || liveInstalledReview !== review || !review.impact.allowed)
      return false;
    return withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        if (review.kind === "uninstall")
          await core.management.uninstall(
            { source: review.address.source, paths: [review.address.path] },
            { signal },
          );
        else
          await core.management.rebind(
            {
              source: review.address.source,
              path: review.address.path,
              owner: review.owner,
              ownerPath: review.ownerPath,
            },
            { signal },
          );
        const refreshed = await refresh();
        if (active())
          settle(
            id,
            refreshed
              ? review.kind === "uninstall"
                ? "Skill uninstalled"
                : "Skill rebound"
              : review.kind === "uninstall"
                ? "Skill uninstalled; Workspace is stale"
                : "Skill rebound; Workspace is stale",
          );
        if (active() && liveInstalledReview === review) liveInstalledReview = undefined;
        return true;
      },
      {
        title: review.kind === "uninstall" ? "Uninstalling Skill" : "Rebinding Skill",
        semanticOwner: { kind: "installed-skill", address: review.address },
      },
    );
  };

  const executeConfigLifecycle = async (
    title: string,
    owner: import("./types").ProjectionOwner,
    run: (signal: AbortSignal) => Promise<unknown>,
  ) => {
    if (closed || foreground) return false;
    return withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        await run(signal);
        const refreshed = await refresh();
        if (active())
          settle(id, refreshed ? `${title} complete` : `${title} complete; Workspace is stale`);
        return true;
      },
      { title, semanticOwner: owner },
    );
  };

  return {
    refresh,
    loadReader,
    listResources,
    readResource,
    review,
    confirm,
    discover,
    install,
    checkUpdate,
    update,
    reviewInstalled,
    confirmInstalled,
    observeConfig: async (id: string) => {
      return withForeground(
        "observe",
        undefined,
        async ({ signal, active }) => {
          const result = await core.management.observeConfig({ id }, { signal });
          return active() ? result.value : undefined;
        },
        undefined,
        false,
      );
    },
    previewConfig: async (
      request:
        | {
            readonly kind: "adopt";
            readonly id: string;
            readonly observation: ConfigSourceObservation;
          }
        | { readonly kind: "forget" | "remove"; readonly id: string },
    ) => {
      return withForeground(
        "preview",
        undefined,
        async ({ signal, active }) => {
          const result =
            request.kind === "adopt"
              ? await core.management.previewAdoptConfig(
                  {
                    id: request.id,
                    exactRevision: request.observation.exactRevision!,
                    observation: request.observation,
                  },
                  { signal },
                )
              : request.kind === "forget"
                ? await core.management.previewForgetConfig({ id: request.id }, { signal })
                : await core.management.previewRemoveConfig({ id: request.id }, { signal });
          return active() ? result.value : undefined;
        },
        undefined,
        false,
      );
    },
    adoptConfig: (id: string, exactRevision: string, observation: ConfigSourceObservation) =>
      executeConfigLifecycle(
        "Adopting Config Source",
        { kind: "config-source", id },
        async (signal) => {
          const preview = await core.management.previewAdoptConfig(
            { id, exactRevision, observation },
            { signal },
          );
          if (!preview.value.allowed)
            throw new SkillCliError("CONFIG_CONFLICT", "Config Source adoption is blocked");
          await core.management.adoptConfig({ id, exactRevision, observation }, { signal });
        },
      ),
    forgetConfig: (id: string) =>
      executeConfigLifecycle(
        "Forgetting Config Source",
        { kind: "config-source", id },
        async (signal) => {
          const preview = await core.management.previewForgetConfig({ id }, { signal });
          if (!preview.value.allowed)
            throw new SkillCliError("CONFIG_CONFLICT", "Config Source forget is blocked");
          await core.management.forgetConfig({ id }, { signal });
        },
      ),
    removeConfig: (id: string) =>
      executeConfigLifecycle(
        "Removing Config Source",
        { kind: "config-source", id },
        async (signal) => {
          const preview = await core.management.previewRemoveConfig({ id }, { signal });
          if (!preview.value.allowed)
            throw new SkillCliError("CONFIG_CONFLICT", "Config Source removal is blocked");
          await core.management.removeConfig({ id }, { signal });
        },
      ),
    setManagedOpenCode: (level: ConfigLevel, managed: boolean) =>
      executeConfigLifecycle(
        `${managed ? "Enabling" : "Disabling"} Managed OpenCode`,
        { kind: "config", level },
        (signal) =>
          core.configuration.change({ type: "agent.managed.set", level, managed }, { signal }),
      ),
    registerSource: (
      change: Extract<
        ConfigChange,
        { readonly type: "source.register" | "config-source.register" }
      >,
    ) =>
      executeConfigLifecycle(
        change.type === "source.register" ? "Registering Source" : "Registering Config Source",
        { kind: change.type === "source.register" ? "source" : "config-source", id: change.id },
        (signal) => core.configuration.change(change, { signal }),
      ),
    createCollection: (intent: Extract<CollectionIntent, { readonly kind: "collection-create" }>) =>
      executeCollection(intent),
    previewAddToCollection: (intent: AddMembershipPreviewRequest) => reviewCollection(intent),
    previewMembershipRemoval: (
      intent: Extract<CollectionIntent, { readonly kind: "membership-removal" }>,
    ) => reviewCollection(intent),
    previewMembershipBatch: (
      intent: Extract<CollectionIntent, { readonly kind: "membership-batch" }>,
    ) => reviewCollection(intent),
    previewImport: (intent: Extract<CollectionIntent, { readonly kind: "collection-import" }>) =>
      reviewCollection(intent),
    previewReference: (intent: Extract<CollectionIntent, { readonly kind: "reference" }>) =>
      reviewCollection(intent),
    previewLinkChange: (intent: Extract<CollectionIntent, { readonly kind: "link-change" }>) =>
      reviewCollection(intent),
    previewCollectionUse: (
      intent: Extract<CollectionIntent, { readonly kind: "collection-use" }>,
    ) => reviewCollection(intent),
    previewCollectionRemoval: (
      intent: Extract<CollectionIntent, { readonly kind: "collection-removal" }>,
    ) => reviewCollection(intent),
    confirmCollection: (reviewed: CollectionReview) => executeCollection(reviewed),
    pending: () => foreground !== undefined,
    pendingKind: () => foreground?.kind,
    cancel: () => {
      if (foreground && !foreground.controller.signal.aborted) {
        const current = foreground;
        if (foreground.kind === "execute" || foreground.kind === "observe")
          operation.requestCancel(foreground.id);
        current.controller.abort();
        // A cancelled preview has no visible surface to settle; ignore a provider that
        // resolves after observing cancellation so it cannot reopen confirmation.
        if (current.kind === "preview" && foreground === current) {
          foreground = undefined;
          liveReview = undefined;
          liveInstalledReview = undefined;
          liveCollectionReview = undefined;
        }
      }
    },
    discardReview: (reviewed: SourceRemovalReview) => {
      if (liveReview === reviewed) liveReview = undefined;
    },
    discardDiscovery: (reviewed: DiscoveryReview) => {
      if (liveDiscovery === reviewed) liveDiscovery = undefined;
    },
    discardUpdate: (reviewed: UpdateReview) => {
      if (liveUpdate === reviewed) liveUpdate = undefined;
    },
    discardInstalledReview: (reviewed: InstalledSkillReview) => {
      if (liveInstalledReview === reviewed) liveInstalledReview = undefined;
    },
    discardCollectionReview: (reviewed: CollectionReview) => {
      if (liveCollectionReview === reviewed) liveCollectionReview = undefined;
    },
    teardown: () => {
      if (!closed) {
        closed = true;
        refreshController?.abort();
        readerContentController?.abort();
        readerResourceController?.abort();
        foreground?.controller.abort();
        foreground = undefined;
        liveReview = undefined;
        liveDiscovery = undefined;
        liveUpdate = undefined;
        liveInstalledReview = undefined;
        liveCollectionReview = undefined;
      }
    },
  };
}
