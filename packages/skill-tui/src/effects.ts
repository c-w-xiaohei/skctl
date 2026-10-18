import {
  type DiscoveryObservation,
  type ConfigSourceObservation,
  type ContentCapability,
  type ConfigurationCapability,
  type ConfigChange,
  type ConfigLevel,
  SkillCliError,
  type ManagementCapability,
  type SourceRemovalImpact,
  type RebindImpact,
  type UninstallImpact,
  type ManagementProjection,
  type WorkspaceCapability,
} from "@skill-cli/core";
import { createSignal } from "solid-js";
import type { DirectSourceIntent, SourceOperationIntent } from "./actions";
import type { OperationState } from "./operation-state";
import type { Diagnostic } from "@skill-cli/core";
import type { ProjectionOutcomes } from "./projection";
import type { TaskState } from "./types";
import {
  buildUpdateScope,
  createUpdatesState,
  type UpdateAddress,
  type UpdateScopeEntry,
} from "./updates/model";
import { createUpdateController, type UpdateController } from "./updates/controller";
import type { UpdatesState } from "./updates/state";
import { createUpdateCheckService, type SourceUpdateCheck } from "./updates/check-service";
import { isFreshUpdateCheck } from "./updates/check-cache";
import {
  previewCollection,
  type CollectionIntent,
  type CollectionPreviewIntent,
  type CollectionReview,
} from "./collection-protocol";
export type {
  CollectionIntent,
  CollectionReview,
  AddMembershipPreviewRequest,
} from "./collection-protocol";

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
    | "previewUpdate"
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
  > & {
    /** Optional while existing test fakes transition to Core's baseline capability. */
    readonly getUpdateBaseline?: (
      request: { readonly source: string },
      options?: { readonly signal?: AbortSignal },
    ) => ReturnType<ManagementCapability["getUpdateBaseline"]>;
  };
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
) {
  let refreshController: AbortController | undefined;
  let foreground:
    | {
        readonly id: string;
        readonly controller: AbortController;
        readonly kind: "preview" | "observe" | "execute" | "updates";
      }
    | undefined;
  let liveReview: SourceRemovalReview | undefined;
  let liveDiscovery: DiscoveryReview | undefined;
  let liveInstalledReview: InstalledSkillReview | undefined;
  let liveCollection: Awaited<ReturnType<typeof previewCollection>> | undefined;
  let sequence = 0;
  let closed = false;
  let latestProjection: ManagementProjection | undefined;
  const [updates, setUpdates] = createSignal<UpdatesState>();
  const [updatesBlockedReason, setUpdatesBlockedReason] = createSignal<string>();
  const [updateTask, setUpdateTask] = createSignal<{
    readonly state: UpdatesState;
    readonly entry: UpdateScopeEntry;
    readonly controller: UpdateController;
  }>();
  const updatesActive = () => {
    const run = updateTask()?.controller.run();
    return !closed && run !== undefined && run.phase !== "settled";
  };
  const activeUpdateState = () => (updatesActive() ? updateTask()?.state : undefined);
  const [checkRevision, setCheckRevision] = createSignal(0);
  /** Bounded route-restorable drafts only; controllers/tasks are never retained per scope. */
  const updateDrafts = new Map<string, UpdatesState>();
  const submittingUpdateSources = new Set<string>();
  const applyUpdateCheck = (check: SourceUpdateCheck) => {
    const snapshot = latestProjection;
    for (const draft of updateDrafts.values()) {
      if (!draft.scope.sources.includes(check.source)) continue;
      // Preserve the exact reviewed observation the active controller is about to
      // submit. The service/cache and every other draft are still invalidated.
      if (draft === activeUpdateState() && submittingUpdateSources.has(check.source)) continue;
      draft.applyCheck(check);
      if (snapshot && check.observation && !check.stale)
        draft.rebaseCheckedScope(buildUpdateScope(snapshot, draft.scope.entry), check.source);
    }
  };
  const updateChecks = createUpdateCheckService(core.management, {
    onChange: (check) => {
      if (closed) return;
      applyUpdateCheck(check);
      setCheckRevision((revision) => revision + 1);
    },
    onActivity: () => {
      if (!closed) setCheckRevision((revision) => revision + 1);
    },
  });
  const next = () => `${++sequence}`;
  const reconcileDraftWithSnapshot = (draft: UpdatesState, snapshot: ManagementProjection) => {
    const fresh = buildUpdateScope(snapshot, draft.scope.entry);
    // Compare against the prior displayed/guarded facts before replacing current
    // membership. Otherwise a stale binding/revision could be hidden by a cached
    // Source observation replayed immediately after reconciliation.
    const invalidated = draft.reconcileRestoredScope(fresh);
    draft.reconcileCurrentScope(fresh);
    for (const source of fresh.sources) {
      if (invalidated.includes(source)) continue;
      const check = updateChecks.check(source);
      if (check) draft.applyCheck(check);
    }
  };
  const reconcileUpdateDraftScopes = (snapshot: ManagementProjection) => {
    for (const draft of updateDrafts.values()) {
      if (draft === activeUpdateState()) continue;
      reconcileDraftWithSnapshot(draft, snapshot);
    }
  };
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
    // Mutations win over session-owned, read-only checks. Their late result must not
    // re-authorize a draft after installation facts may have changed.
    if (kind === "execute") updateChecks.pause();
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
      if (kind === "execute") updateChecks.resume();
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
      if (!closed && refreshController === controller) {
        latestProjection = result.value;
        reconcileUpdateDraftScopes(result.value);
        projection.applyProjection(result.value);
      }
      return result;
    } catch (error) {
      if (!closed && refreshController === controller && !cancelled(error))
        projection.failed(diagnostic(error));
      return undefined;
    } finally {
      if (refreshController === controller) refreshController = undefined;
    }
  };
  const releaseUpdates = (current: NonNullable<typeof foreground>) => () => {
    if (foreground === current) foreground = undefined;
    submittingUpdateSources.clear();
    updateChecks.resume();
  };
  const updateScopeKey = (entry: UpdateScopeEntry) => JSON.stringify(entry);
  const createTaskController = (state: UpdatesState) => {
    const entry = state.scope.entry;
    const origin: UpdateScopeEntry = Object.freeze(
      entry.kind === "skill"
        ? { ...entry, address: Object.freeze({ ...entry.address }) }
        : { ...entry },
    );
    let created!: UpdateController;
    let checked = new Map<string, SourceUpdateCheck>();
    created = createUpdateController(core, state, {
      foreground: {
        request: () => {
          if (closed || foreground) return undefined;
          const currentForeground = {
            id: next(),
            controller: new AbortController(),
            kind: "updates" as const,
          };
          foreground = currentForeground;
          setUpdateTask({ state, entry: origin, controller: created });
          return releaseUpdates(currentForeground);
        },
      },
      onProjection: (snapshot) => {
        latestProjection = snapshot;
        reconcileUpdateDraftScopes(snapshot);
        projection.applyProjection(snapshot);
      },
      onSubmissionStarted: (addresses) => {
        checked = new Map(
          addresses.flatMap((address) => {
            const observation = updateChecks.check(address.source);
            return observation ? [[address.source, observation] as const] : [];
          }),
        );
        // This controller owns a mutation rather than a check. Pause the entire
        // session queue until its sequential source batches settle.
        const sources = [...new Set(addresses.map((address) => address.source))];
        for (const source of sources) {
          submittingUpdateSources.add(source);
          for (const retained of updateDrafts.values()) {
            if (retained === state) continue;
            const group = retained.group(source);
            if (!group?.observation || group.status === "succeeded") continue;
            retained.invalidateCheck(
              source,
              "failed",
              "Source was submitted from another scope; check updates again",
            );
          }
        }
        updateChecks.pause(sources);
      },
      observation: async (source, signal) => {
        const check = checked.get(source);
        if (
          !check?.observation ||
          check.stale ||
          check.checkedAt === undefined ||
          !isFreshUpdateCheck(
            {
              source,
              observation: check.observation,
              baseline: check.observation.baseline ?? "",
              checkedAt: check.checkedAt,
            },
            Date.now(),
          )
        )
          return undefined;
        if (core.management.getUpdateBaseline) {
          const baseline = (await core.management.getUpdateBaseline({ source }, { signal })).value;
          if (baseline !== check.observation.baseline) return undefined;
        }
        return check.observation;
      },
    });
    return created;
  };
  const activateUpdatesState = (state: UpdatesState) => {
    setUpdates(state);
    return state;
  };
  const selectUpdatesScope = (
    entry: UpdateScopeEntry,
    snapshot?: import("@skill-cli/core").ManagementProjection,
  ) => {
    const current = updates();
    const projectionSnapshot = snapshot;
    if (!projectionSnapshot || closed) return undefined;
    const nextScope = buildUpdateScope(projectionSnapshot, entry);
    if (current && updateScopeKey(current.scope.entry) === updateScopeKey(entry)) {
      if (current !== activeUpdateState()) reconcileDraftWithSnapshot(current, projectionSnapshot);
      void updateChecks.revalidate(current.scope.sources);
      return current;
    }
    const draftKey = updateScopeKey(entry);
    const retained = updateDrafts.get(draftKey);
    if (retained) {
      if (retained !== activeUpdateState()) {
        reconcileDraftWithSnapshot(retained, projectionSnapshot);
      }
      setUpdatesBlockedReason(undefined);
      return activateUpdatesState(retained);
    }
    const state = createUpdatesState(nextScope);
    for (const source of nextScope.sources) {
      const serviceCheck = updateChecks.check(source);
      if (serviceCheck) state.applyCheck(serviceCheck);
    }
    setUpdatesBlockedReason(undefined);
    updateDrafts.set(draftKey, state);
    void updateChecks.revalidate(nextScope.sources);
    return activateUpdatesState(state);
  };
  const restoreUpdatesScope = (
    state: UpdatesState,
    snapshot?: import("@skill-cli/core").ManagementProjection,
  ) => {
    if (!snapshot || closed) return undefined;
    const current = updates();
    if (current === state) return state;
    const key = updateScopeKey(state.scope.entry);
    if (updateDrafts.get(key) !== state) return undefined;
    if (state !== activeUpdateState()) reconcileDraftWithSnapshot(state, snapshot);
    void updateChecks.revalidate(state.scope.sources);
    setUpdatesBlockedReason(undefined);
    return activateUpdatesState(state);
  };
  const submitFromState = async (
    state: UpdatesState | undefined,
    addresses?: readonly UpdateAddress[],
  ) => {
    if (closed || foreground || !state) return false;
    const targets = [...(addresses ?? state.scope.addresses)];
    if (!targets.length) return false;
    return createTaskController(state).submit(targets);
  };
  const stopUpdates = () => (updatesActive() ? (updateTask()?.controller.stop() ?? false) : false);

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

  const reviewCollection = async (
    intent: CollectionPreviewIntent,
  ): Promise<CollectionReview | undefined> => {
    if (closed || foreground) return undefined;
    return withForeground(
      "preview",
      undefined,
      async ({ id, signal, active }) => {
        const prepared = await previewCollection(core.configuration, intent, id, signal);
        if (!active()) return undefined;
        liveCollection = prepared;
        return prepared.review;
      },
      undefined,
      false,
    );
  };

  const executeCollection = async (
    reviewed: CollectionReview | Extract<CollectionIntent, { readonly kind: "collection-create" }>,
  ) => {
    const creating = reviewed.kind === "collection-create";
    const intent = creating ? reviewed : reviewed.intent;
    const change = creating
      ? {
          type: "collection.create" as const,
          level: reviewed.level,
          collection: reviewed.collection,
        }
      : liveCollection?.change;
    if (
      closed ||
      foreground ||
      (!creating && (liveCollection?.review !== reviewed || !reviewed.impact.allowed)) ||
      !change
    )
      return false;
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
        await core.configuration.change(change, { signal });
        const refreshed = await refresh();
        if (active())
          settle(id, refreshed ? "Collection updated" : "Collection updated; Workspace is stale");
        if (active() && !creating && liveCollection?.review === reviewed)
          liveCollection = undefined;
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
    review,
    confirm,
    discover,
    install,
    selectUpdatesScope,
    restoreUpdatesScope,
    updates: () => updates(),
    updatesActive,
    updateRun: () => updateTask()?.controller.run(),
    updateTaskEntry: () => updateTask()?.entry,
    startUpdateChecks: (snapshot?: import("@skill-cli/core").ManagementProjection) => {
      if (snapshot && !latestProjection) latestProjection = snapshot;
      return snapshot ? updateChecks.start(snapshot) : Promise.resolve();
    },
    checkUpdates: async (sources?: readonly string[]) => {
      const state = updates();
      if (!state) return false;
      await updateChecks.refresh(
        state.scope.sources.filter((source) => !sources || sources.includes(source)),
      );
      return true;
    },
    submitUpdates: (addresses?: readonly UpdateAddress[]) => submitFromState(updates(), addresses),
    continueUpdates: () => {
      const task = updateTask();
      return submitFromState(task?.state, task?.controller.retryable() ?? []);
    },
    stopUpdates,
    updatesSubmittable: () => updates()?.eligible() ?? [],
    updatesRetryable: () => updateTask()?.controller.retryable() ?? [],
    updatesBlockedReason,
    updateCheck: (source: string) => {
      checkRevision();
      return updateChecks.check(source);
    },
    updateChecksWarning: () => {
      checkRevision();
      return updateChecks.cacheWarning();
    },
    checkingActive: () => {
      checkRevision();
      return updateChecks.checkingActive();
    },
    checkActivity: () => {
      checkRevision();
      return updateChecks.activity();
    },
    stopUpdateChecks: () => updateChecks.stop(),
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
    previewCollection: reviewCollection,
    confirmCollection: (reviewed: CollectionReview) => executeCollection(reviewed),
    pending: () => foreground !== undefined,
    pendingKind: () => foreground?.kind,
    cancel: () => {
      if (foreground?.kind === "updates") {
        // Overlay/navigation cancellation does not own a process task.
        // Only explicit Stop update or App teardown may cancel it.
        return;
      }
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
          liveCollection = undefined;
        }
      }
    },
    discardReview: (reviewed: SourceRemovalReview) => {
      if (liveReview === reviewed) liveReview = undefined;
    },
    discardDiscovery: (reviewed: DiscoveryReview) => {
      if (liveDiscovery === reviewed) liveDiscovery = undefined;
    },
    discardInstalledReview: (reviewed: InstalledSkillReview) => {
      if (liveInstalledReview === reviewed) liveInstalledReview = undefined;
    },
    discardCollectionReview: (reviewed: CollectionReview) => {
      if (liveCollection?.review === reviewed) liveCollection = undefined;
    },
    teardown: () => {
      if (!closed) {
        closed = true;
        refreshController?.abort();
        foreground?.controller.abort();
        updateChecks.teardown();
        updateTask()?.controller.teardown();
        updateDrafts.clear();
        foreground = undefined;
        liveReview = undefined;
        liveDiscovery = undefined;
        liveInstalledReview = undefined;
        liveCollection = undefined;
      }
    },
  };
}
