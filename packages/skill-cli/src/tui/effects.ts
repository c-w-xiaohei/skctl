import {
  type DiscoveryObservation,
  type ConfigSourceObservation,
  type ContentCapability,
  type ConfigurationCapability,
  type ConfigChange,
  type ConfigLevel,
  type AddToCollectionImpact,
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
} from "../core/api";
import type { DirectSourceIntent, SourceOperationIntent } from "./actions";
import type { TuiEvent } from "./model";

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

export function createTuiEffects(core: TuiCore, dispatch: (event: TuiEvent) => void = () => {}) {
  let refreshController: AbortController | undefined;
  let readerController: AbortController | undefined;
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

  const refresh = async () => {
    if (closed) return undefined;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    dispatch({ type: "workspace.loading" });
    try {
      const result = await core.workspace.get({ signal: controller.signal });
      if (!closed && refreshController === controller)
        dispatch({ type: "workspace.replace", workspace: result.value });
      return result;
    } catch (error) {
      if (!closed && refreshController === controller && !cancelled(error))
        dispatch({ type: "workspace.failure", diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (refreshController === controller) refreshController = undefined;
    }
  };

  const loadReader = async (address: { readonly source: string; readonly path: string }) => {
    if (closed) return undefined;
    readerController?.abort();
    const controller = new AbortController();
    readerController = controller;
    dispatch({ type: "reader.patch", value: { address, loading: true, error: undefined } });
    try {
      const result = await core.content.loadInstalled({ address }, { signal: controller.signal });
      if (!closed && readerController === controller) {
        dispatch({ type: "reader.loaded", address, value: result.value });
        for (const item of result.diagnostics)
          dispatch({ type: "reader.failure", address, diagnostic: item });
      }
      return result;
    } catch (error) {
      if (!closed && readerController === controller && !cancelled(error))
        dispatch({ type: "reader.failure", diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (readerController === controller) readerController = undefined;
    }
  };
  const listResources = async (address: { readonly source: string; readonly path: string }) => {
    if (closed) return undefined;
    readerController?.abort();
    const controller = new AbortController();
    readerController = controller;
    dispatch({
      type: "reader.patch",
      value: { address, loading: true, error: undefined, resourceLevel: "list" },
    });
    try {
      const result = await core.content.listInstalledResources(
        { address },
        { signal: controller.signal },
      );
      if (!closed && readerController === controller) {
        dispatch({ type: "reader.resources", address, resources: result.value });
        for (const item of result.diagnostics)
          dispatch({ type: "reader.failure", address, diagnostic: item });
      }
      return result;
    } catch (error) {
      if (!closed && readerController === controller && !cancelled(error))
        dispatch({ type: "reader.failure", address, diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (readerController === controller) readerController = undefined;
    }
  };
  const readResource = async (
    address: { readonly source: string; readonly path: string },
    path: string,
  ) => {
    if (closed) return undefined;
    readerController?.abort();
    const controller = new AbortController();
    readerController = controller;
    dispatch({
      type: "reader.patch",
      value: {
        address,
        selectedResource: path,
        resource: undefined,
        resourceLevel: "content",
        loading: true,
        error: undefined,
      },
    });
    try {
      const result = await core.content.readInstalled(
        { address, path },
        { signal: controller.signal },
      );
      if (!closed && readerController === controller) {
        dispatch({ type: "reader.resource.loaded", address, value: result.value });
        for (const item of result.diagnostics)
          dispatch({ type: "reader.failure", address, diagnostic: item });
      }
      return result;
    } catch (error) {
      if (!closed && readerController === controller && !cancelled(error))
        dispatch({ type: "reader.failure", address, diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (readerController === controller) readerController = undefined;
    }
  };

  const review = async (intent: DirectSourceIntent): Promise<SourceRemovalReview | undefined> => {
    if (closed || foreground) return undefined;
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "preview" };
    try {
      const result = await core.management.previewSourceRemoval(
        { source: intent.source },
        { signal: controller.signal },
      );
      if (closed || foreground?.id !== id) return undefined;
      if (
        result.value.kind !== "source-removal" ||
        result.value.source !== intent.source ||
        result.value.owner === undefined ||
        result.value.owner.level !== intent.owner.level ||
        result.value.owner.file !== intent.owner.file ||
        result.value.owner.pointer !== intent.owner.pointer
      ) {
        dispatch({
          type: "operation.failure",
          diagnostic: {
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Source removal preview no longer matches the selected declaration",
          },
        });
        return undefined;
      }
      const reviewed = { id, intent, impact: result.value };
      liveReview = reviewed;
      return reviewed;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({ type: "operation.failure", diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const confirm = async (reviewed: SourceRemovalReview) => {
    if (closed || foreground || !reviewed.impact.allowed || liveReview !== reviewed) return false;
    const id = next();
    const controller = new AbortController();
    let succeeded = false;
    foreground = { id, controller, kind: "execute" };
    dispatch({
      type: "task.start",
      task: {
        id,
        title: "Removing Source",
        cancellationRequested: false,
        semanticOwner: reviewed.intent.source,
      },
    });
    try {
      await core.management.removeSource(
        { source: reviewed.intent.source },
        { signal: controller.signal },
      );
      const refreshed = await refresh();
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: refreshed ? "Source removed" : "Source removed; Workspace is stale",
        });
      succeeded = true;
      return true;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Operation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return false;
    } finally {
      if (succeeded && liveReview === reviewed) liveReview = undefined;
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const discover = async (
    intent: Extract<SourceOperationIntent, { readonly kind: "source-discovery" }>,
  ): Promise<DiscoveryReview | undefined> => {
    if (closed || foreground) return undefined;
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "observe" };
    dispatch({
      type: "task.start",
      task: {
        id,
        title: "Observing Source",
        cancellationRequested: false,
        semanticOwner: intent.source,
      },
    });
    try {
      const result = await core.management.discover(
        { source: intent.source },
        { signal: controller.signal },
      );
      if (closed || foreground?.id !== id || result.value.source !== intent.source) {
        if (!closed && foreground?.id === id) {
          const error = {
            code: "TRANSACTION_CONFLICT",
            severity: "warning" as const,
            message: "Observed Source no longer matches the selected Source",
          };
          dispatch({ type: "task.settle", id, status: error.message, error });
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
      dispatch({ type: "task.settle", id, status: "Observation ready" });
      return reviewed;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Observation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return undefined;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const checkUpdate = async (
    intent: Extract<SourceOperationIntent, { readonly kind: "source-update" }>,
  ): Promise<UpdateReview | undefined> => {
    if (closed || foreground) return undefined;
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "observe" };
    dispatch({
      type: "task.start",
      task: {
        id,
        title: "Observing Updates",
        cancellationRequested: false,
        semanticOwner: intent.source,
      },
    });
    try {
      const result = await core.management.checkUpdate(
        { source: intent.source },
        { signal: controller.signal },
      );
      if (closed || foreground?.id !== id || result.value.source !== intent.source) {
        if (!closed && foreground?.id === id) {
          const error = {
            code: "TRANSACTION_CONFLICT",
            severity: "warning" as const,
            message: "Observed Source no longer matches the selected Source",
          };
          dispatch({ type: "task.settle", id, status: error.message, error });
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
      dispatch({ type: "task.settle", id, status: "Observation ready" });
      return reviewed;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Observation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return undefined;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const install = async (reviewed: DiscoveryReview, paths: readonly string[]) => {
    if (closed || foreground || liveDiscovery !== reviewed || paths.length === 0) return false;
    const candidatePaths = new Set(
      reviewed.observation.candidates.map((candidate) => candidate.path),
    );
    if (new Set(paths).size !== paths.length || paths.some((path) => !candidatePaths.has(path)))
      return false;
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "execute" };
    dispatch({
      type: "task.start",
      task: {
        id,
        title: "Installing Skills",
        cancellationRequested: false,
        semanticOwner: reviewed.intent.source,
      },
    });
    try {
      await core.management.install(
        {
          source: reviewed.observation.source,
          paths,
          exactRevision: reviewed.observation.exactRevision,
        },
        { signal: controller.signal },
      );
      const refreshed = await refresh();
      if (!closed && foreground?.id === id) liveDiscovery = undefined;
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: refreshed ? "Skills installed" : "Skills installed; Workspace is stale",
        });
      return true;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Operation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return false;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
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
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "execute" };
    dispatch({
      type: "task.start",
      task: {
        id,
        title: "Updating Skills",
        cancellationRequested: false,
        semanticOwner: reviewed.intent.source,
      },
    });
    try {
      await core.management.update(
        {
          source: reviewed.observation.source,
          paths,
          exactRevision: reviewed.observation.exactRevision,
        },
        { signal: controller.signal },
      );
      const refreshed = await refresh();
      if (!closed && foreground?.id === id) liveUpdate = undefined;
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: refreshed ? "Skills updated" : "Skills updated; Workspace is stale",
        });
      return true;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Operation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return false;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
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
      dispatch({
        type: "operation.failure",
        diagnostic: {
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: "Replacement Skill path must be Source-root-relative",
        },
      });
      return undefined;
    }
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "preview" };
    try {
      if (request.kind === "uninstall") {
        const result = await core.management.previewUninstall(
          { source: request.address.source, paths: [request.address.path] },
          { signal: controller.signal },
        );
        if (closed || foreground?.id !== id) return undefined;
        if (
          result.value.kind !== "uninstall" ||
          result.value.installed.length !== 1 ||
          result.value.installed[0]?.source !== request.address.source ||
          result.value.installed[0]?.path !== request.address.path
        ) {
          dispatch({
            type: "operation.failure",
            diagnostic: {
              code: "TRANSACTION_CONFLICT",
              severity: "warning",
              message: "Uninstall preview no longer matches the selected structural address",
            },
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
        { signal: controller.signal },
      );
      if (closed || foreground?.id !== id) return undefined;
      if (
        result.value.kind !== "rebind" ||
        result.value.address.source !== request.address.source ||
        result.value.address.path !== request.address.path ||
        result.value.owner !== request.owner ||
        result.value.ownerPath !== request.ownerPath
      ) {
        dispatch({
          type: "operation.failure",
          diagnostic: {
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Rebind preview no longer matches the selected structural address",
          },
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
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({ type: "operation.failure", diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
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
      dispatch({
        type: "operation.failure",
        diagnostic: {
          code: "INVALID_ARGUMENT",
          severity: "warning",
          message: "Remove Membership requires the exact expected structural address",
        },
      });
      return undefined;
    }
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "preview" };
    try {
      const result = await (intent.kind === "add-to-collection"
        ? core.configuration.previewAddToCollection(
            {
              level: intent.level,
              collection: intent.collection,
              address: intent.address,
              name: intent.name!,
            },
            { signal: controller.signal },
          )
        : intent.kind === "membership-removal"
          ? core.configuration.previewMembershipRemoval(
              { level: intent.level, collection: intent.collection, name: intent.name },
              { signal: controller.signal },
            )
          : intent.kind === "collection-import"
            ? core.configuration.previewImport(
                { level: intent.level, from: intent.from, into: intent.into },
                { signal: controller.signal },
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
                  { signal: controller.signal },
                )
              : intent.kind === "link-change"
                ? core.configuration.previewLinkChange(
                    {
                      level: intent.level,
                      collection: intent.collection,
                      target: intent.target,
                      linked: intent.linked,
                    },
                    { signal: controller.signal },
                  )
                : intent.kind === "collection-use"
                  ? core.configuration.previewCollectionUse(
                      { level: intent.level, collections: intent.collections },
                      { signal: controller.signal },
                    )
                  : core.configuration.previewCollectionRemoval(
                      { level: intent.level, collection: intent.collection },
                      { signal: controller.signal },
                    ));
      if (closed || foreground?.id !== id) return undefined;
      if (!collectionImpactMatches(intent, result.value)) {
        dispatch({
          type: "operation.failure",
          diagnostic: {
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Collection preview no longer matches the selected structural intent",
          },
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
        dispatch({
          type: "operation.failure",
          diagnostic: {
            code: "TRANSACTION_CONFLICT",
            severity: "warning",
            message: "Collection preview did not provide an executable membership or next step",
          },
        });
        return undefined;
      }
      liveCollectionReview = reviewed;
      return reviewed;
    } catch (error) {
      if (!closed && foreground?.id === id && !cancelled(error))
        dispatch({ type: "operation.failure", diagnostic: diagnostic(error) });
      return undefined;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const collectionChange = (
    intent:
      | Exclude<CollectionIntent, { readonly kind: "add-to-collection" }>
      | AuthorizedMembershipIntent,
    reviewedLevel?: ConfigLevel,
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
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "execute" };
    const semanticOwner =
      intent.kind === "collection-use"
        ? intent.level
        : intent.kind === "collection-import"
          ? intent.into
          : intent.collection;
    dispatch({
      type: "task.start",
      task: { id, title: "Updating Collection", cancellationRequested: false, semanticOwner },
    });
    try {
      const reviewedLevel =
        !creating && reviewed.impact.kind === "add-to-collection"
          ? reviewed.impact.decision.kind === "direct"
            ? reviewed.impact.decision.owner.level
            : undefined
          : !creating && reviewed.impact.kind === "membership-removal"
            ? reviewed.impact.decision.kind === "direct"
              ? reviewed.impact.decision.owner.level
              : undefined
            : !creating && reviewed.impact.kind === "reference"
              ? reviewed.impact.owner?.level
              : undefined;
      await core.configuration.change(collectionChange(intent, reviewedLevel), {
        signal: controller.signal,
      });
      const refreshed = await refresh();
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: refreshed ? "Collection updated" : "Collection updated; Workspace is stale",
        });
      if (!creating && liveCollectionReview === reviewed) liveCollectionReview = undefined;
      return true;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Operation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return false;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const confirmInstalled = async (review: InstalledSkillReview) => {
    if (closed || foreground || liveInstalledReview !== review || !review.impact.allowed)
      return false;
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "execute" };
    dispatch({
      type: "task.start",
      task: {
        id,
        title: review.kind === "uninstall" ? "Uninstalling Skill" : "Rebinding Skill",
        cancellationRequested: false,
        semanticOwner: `${review.address.source}/${review.address.path}`,
      },
    });
    try {
      if (review.kind === "uninstall")
        await core.management.uninstall(
          { source: review.address.source, paths: [review.address.path] },
          { signal: controller.signal },
        );
      else
        await core.management.rebind(
          {
            source: review.address.source,
            path: review.address.path,
            owner: review.owner,
            ownerPath: review.ownerPath,
          },
          { signal: controller.signal },
        );
      const refreshed = await refresh();
      if (!closed && foreground?.id === id && refreshed && review.kind === "rebind")
        dispatch({
          type: "selection.set",
          key: "skills",
          value: `${review.impact.owner}/${review.impact.ownerPath}`,
        });
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: refreshed
            ? review.kind === "uninstall"
              ? "Skill uninstalled"
              : "Skill rebound"
            : review.kind === "uninstall"
              ? "Skill uninstalled; Workspace is stale"
              : "Skill rebound; Workspace is stale",
        });
      liveInstalledReview = undefined;
      return true;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Operation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return false;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
  };

  const executeConfigLifecycle = async (
    title: string,
    owner: string,
    run: (signal: AbortSignal) => Promise<unknown>,
  ) => {
    if (closed || foreground) return false;
    const id = next();
    const controller = new AbortController();
    foreground = { id, controller, kind: "execute" };
    dispatch({
      type: "task.start",
      task: { id, title, cancellationRequested: false, semanticOwner: owner },
    });
    try {
      await run(controller.signal);
      const refreshed = await refresh();
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: refreshed ? `${title} complete` : `${title} complete; Workspace is stale`,
        });
      return true;
    } catch (error) {
      if (!closed && foreground?.id === id)
        dispatch({
          type: "task.settle",
          id,
          status: cancelled(error) ? "Operation cancelled" : diagnostic(error).message,
          error: diagnostic(error),
        });
      return false;
    } finally {
      if (foreground?.id === id) foreground = undefined;
    }
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
      if (closed || foreground) return undefined;
      const operation = next();
      const controller = new AbortController();
      foreground = { id: operation, controller, kind: "observe" };
      try {
        const result = await core.management.observeConfig({ id }, { signal: controller.signal });
        return foreground?.id === operation && !closed ? result.value : undefined;
      } catch (error) {
        if (!closed && foreground?.id === operation && !cancelled(error))
          dispatch({ type: "operation.failure", diagnostic: diagnostic(error) });
        return undefined;
      } finally {
        if (foreground?.id === operation) foreground = undefined;
      }
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
      if (closed || foreground) return undefined;
      const operation = next();
      const controller = new AbortController();
      foreground = { id: operation, controller, kind: "preview" };
      try {
        const result =
          request.kind === "adopt"
            ? await core.management.previewAdoptConfig(
                {
                  id: request.id,
                  exactRevision: request.observation.exactRevision!,
                  observation: request.observation,
                },
                { signal: controller.signal },
              )
            : request.kind === "forget"
              ? await core.management.previewForgetConfig(
                  { id: request.id },
                  { signal: controller.signal },
                )
              : await core.management.previewRemoveConfig(
                  { id: request.id },
                  { signal: controller.signal },
                );
        return foreground?.id === operation && !closed ? result.value : undefined;
      } catch (error) {
        if (!closed && foreground?.id === operation && !cancelled(error))
          dispatch({ type: "operation.failure", diagnostic: diagnostic(error) });
        return undefined;
      } finally {
        if (foreground?.id === operation) foreground = undefined;
      }
    },
    adoptConfig: (id: string, exactRevision: string, observation: ConfigSourceObservation) =>
      executeConfigLifecycle("Adopting Config Source", id, async (signal) => {
        const preview = await core.management.previewAdoptConfig(
          { id, exactRevision, observation },
          { signal },
        );
        if (!preview.value.allowed)
          throw new SkillCliError("CONFIG_CONFLICT", "Config Source adoption is blocked");
        await core.management.adoptConfig({ id, exactRevision, observation }, { signal });
      }),
    forgetConfig: (id: string) =>
      executeConfigLifecycle("Forgetting Config Source", id, async (signal) => {
        const preview = await core.management.previewForgetConfig({ id }, { signal });
        if (!preview.value.allowed)
          throw new SkillCliError("CONFIG_CONFLICT", "Config Source forget is blocked");
        await core.management.forgetConfig({ id }, { signal });
      }),
    removeConfig: (id: string) =>
      executeConfigLifecycle("Removing Config Source", id, async (signal) => {
        const preview = await core.management.previewRemoveConfig({ id }, { signal });
        if (!preview.value.allowed)
          throw new SkillCliError("CONFIG_CONFLICT", "Config Source removal is blocked");
        await core.management.removeConfig({ id }, { signal });
      }),
    setManagedOpenCode: (level: ConfigLevel, managed: boolean) =>
      executeConfigLifecycle(
        `${managed ? "Enabling" : "Disabling"} Managed OpenCode`,
        level,
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
        change.id,
        (signal) => core.configuration.change(change, { signal }),
      ),
    createCollection: (intent: Extract<CollectionIntent, { readonly kind: "collection-create" }>) =>
      executeCollection(intent),
    previewAddToCollection: (intent: AddMembershipPreviewRequest) => reviewCollection(intent),
    previewMembershipRemoval: (
      intent: Extract<CollectionIntent, { readonly kind: "membership-removal" }>,
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
    addToCollection: (
      reviewed: Extract<CollectionReview, { readonly kind: "add-to-collection" }>,
    ) => executeCollection(reviewed),
    removeMembership: (
      reviewed: Extract<CollectionReview, { readonly kind: "membership-removal" }>,
    ) => executeCollection(reviewed),
    importCollection: (
      reviewed: Extract<CollectionReview, { readonly kind: "collection-import" }>,
    ) => executeCollection(reviewed),
    changeReference: (reviewed: Extract<CollectionReview, { readonly kind: "reference" }>) =>
      executeCollection(reviewed),
    changeLink: (reviewed: Extract<CollectionReview, { readonly kind: "link-change" }>) =>
      executeCollection(reviewed),
    setCollectionUse: (reviewed: Extract<CollectionReview, { readonly kind: "collection-use" }>) =>
      executeCollection(reviewed),
    removeCollection: (
      reviewed: Extract<CollectionReview, { readonly kind: "collection-removal" }>,
    ) => executeCollection(reviewed),
    pending: () => foreground !== undefined,
    pendingKind: () => foreground?.kind,
    cancel: () => {
      if (foreground && !foreground.controller.signal.aborted) {
        const current = foreground;
        if (foreground.kind === "execute" || foreground.kind === "observe")
          dispatch({ type: "task.cancel.request", id: foreground.id });
        current.controller.abort();
        // A cancelled preview has no visible surface to settle; ignore a provider that
        // resolves after observing cancellation so it cannot reopen confirmation.
        if (current.kind === "preview" && foreground === current) foreground = undefined;
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
        readerController?.abort();
        foreground?.controller.abort();
        liveReview = undefined;
        liveDiscovery = undefined;
        liveUpdate = undefined;
        liveInstalledReview = undefined;
        liveCollectionReview = undefined;
      }
    },
  };
}
