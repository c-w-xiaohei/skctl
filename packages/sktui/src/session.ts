import type * as api from "@skctl/core";
import { SkctlError } from "@skctl/core";
import { createSignal } from "solid-js";
import * as v from "valibot";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DirectSourceIntent, SourceOperationIntent } from "./actions";
import type { OperationState } from "./operation-state";
import type { ProjectionOutcomes } from "./projection";
import type { ProjectionOwner, TaskState } from "./types";
import {
  deriveUpdateScope as buildUpdateScope,
  updateSubmission,
  type UpdateAddress,
  type UpdateScopeEntry,
} from "./updates/scope";
import {
  createUpdatesState,
  type SourceUpdateCheck,
  type UpdatesState,
  type UpdateRun,
  type UpdateIssue,
} from "./updates/state";
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

export type TuiCore = Pick<
  typeof api,
  | "getWorkspace"
  | "inspectCollection"
  | "createCollection"
  | "setCollectionContent"
  | "removeCollection"
  | "previewCollectionRename"
  | "renameCollection"
  | "addMember"
  | "removeMember"
  | "editMembers"
  | "importMembers"
  | "addReference"
  | "removeReference"
  | "setLink"
  | "previewAddToCollection"
  | "previewMembershipRemoval"
  | "previewMembershipBatch"
  | "previewImport"
  | "previewAddReference"
  | "previewRemoveReference"
  | "previewLinkChange"
  | "previewCollectionRemoval"
  | "setUse"
  | "addUse"
  | "removeUse"
  | "previewCollectionUse"
  | "registerSource"
  | "discoverSkills"
  | "previewSourceRemoval"
  | "removeSource"
  | "registerConfigSource"
  | "observeConfigSource"
  | "adoptConfigSource"
  | "previewConfigAdoption"
  | "forgetConfig"
  | "previewConfigForget"
  | "removeConfig"
  | "previewConfigRemoval"
  | "loadInstalledSkill"
  | "listInstalledResources"
  | "readInstalledResource"
  | "installSkills"
  | "uninstallSkills"
  | "rebindSkill"
  | "previewUninstall"
  | "previewRebind"
  | "checkUpdate"
  | "getUpdateBaseline"
  | "previewUpdate"
  | "updateSkills"
>;
export interface SourceRemovalReview {
  readonly id: string;
  readonly intent: DirectSourceIntent;
  readonly impact: api.SourceRemovalImpact;
}
export interface DiscoveryReview {
  readonly kind: "discovery";
  readonly id: string;
  readonly intent: Extract<SourceOperationIntent, { readonly kind: "source-discovery" }>;
  readonly observation: api.DiscoveryObservation;
}
export type InstalledSkillReview = {
  readonly id: string;
  readonly address: UpdateAddress;
} & (
  | { readonly kind: "uninstall"; readonly impact: api.UninstallImpact }
  | {
      readonly kind: "rebind";
      readonly owner: string;
      readonly ownerPath: string;
      readonly impact: api.RebindImpact;
    }
);
export type IdentityApplyOutcome =
  | { readonly status: "applied"; readonly workspace: "fresh" | "stale" }
  | { readonly status: "blocked" }
  | { readonly status: "stale"; readonly diagnostic: api.Diagnostic }
  | { readonly status: "uncertain"; readonly diagnostic: api.Diagnostic };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const cancelled = (error: unknown) => error instanceof SkctlError && error.code === "CANCELLED";
const diagnostic = (error: unknown): api.Diagnostic => ({
  code: error instanceof SkctlError ? error.code : "INTERNAL",
  severity: "warning",
  message: message(error),
});
const addressKey = (address: UpdateAddress) => `${address.source}\0${address.path}`;
const AUTO_CHECK_INTERVAL = 8 * 60 * 60 * 1000;
const scheduleSchema = v.record(
  v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  v.pipe(v.number(), v.finite(), v.minValue(0)),
);

/** App lifetime owns background checks and update tasks; routes retain only UI drafts. */
export function createTuiSession(
  core: TuiCore,
  operation: OperationState,
  projection: ProjectionOutcomes,
  environment: api.CoreOptions = { cwd: process.cwd() },
) {
  let closed = false;
  let sequence = 0;
  let refreshController: AbortController | undefined;
  let latestProjection: api.WorkspaceView | undefined;
  let foreground:
    | {
        readonly id: string;
        readonly kind: "preview" | "observe" | "execute" | "updates";
        readonly controller: AbortController;
      }
    | undefined;
  let liveReview: SourceRemovalReview | undefined;
  let liveDiscovery: DiscoveryReview | undefined;
  let liveInstalledReview: InstalledSkillReview | undefined;
  let liveCollection: CollectionReview | undefined;
  const [updates, setUpdates] = createSignal<UpdatesState>();
  const drafts = new Map<string, UpdatesState>();
  const [run, setRun] = createSignal<UpdateRun>();
  let taskState: UpdatesState | undefined;
  const [taskEntry, setTaskEntry] = createSignal<UpdateScopeEntry>();
  const updatesActive = () => !closed && !!run() && run()!.phase !== "settled";
  const [checkActivity, setCheckActivity] = createSignal<{
    source: string;
    phase: "checking" | "paused" | "stopping";
  }>();
  const [scheduleWarning, setScheduleWarning] = createSignal<string>();
  type CheckRequest = {
    source: string;
    mode: "current" | "auto";
    resolve: (ok: boolean) => void;
    promise: Promise<boolean>;
  };
  const queue = new Map<string, CheckRequest>();
  let checking:
    | { request: CheckRequest; controller: AbortController; ignored: boolean }
    | undefined;
  let paused = false;
  let checksStopped = false;
  let autoStarted = false;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

  // Scheduling facts only. Core owns all remote objects, observations and classifications.
  const schedulePath = join(
    process.env.SKTUI_UPDATE_SCHEDULE_DIR ||
      join(process.env.XDG_CACHE_HOME || join(process.env.HOME || ".", ".cache"), "skctl"),
    "update-schedule-v1.json",
  );
  const lastCheck = new Map<string, number>();
  const manualChecks = new Set<string>();
  const scheduleKey = (source: string) => {
    const binding = latestProjection?.effective.sources.find((item) => item.id === source);
    return createHash("sha256")
      .update(
        JSON.stringify([
          environment.cwd,
          environment.project,
          environment.userConfigPath,
          source,
          binding?.kind,
          binding?.origin,
          binding?.root,
          binding?.ref,
        ]),
      )
      .digest("hex");
  };
  let scheduleLoaded: Promise<void> | undefined;
  let scheduleWrite = Promise.resolve();
  const loadSchedule = () =>
    (scheduleLoaded ??= (async () => {
      try {
        if ((await lstat(schedulePath)).isSymbolicLink())
          throw new Error("Schedule file is a symlink");
        const entries: unknown = JSON.parse(await readFile(schedulePath, "utf8"));
        if (!v.is(scheduleSchema, entries)) return;
        for (const [key, value] of Object.entries(entries))
          if (value <= Date.now() && !lastCheck.has(key)) lastCheck.set(key, value);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT") && !closed)
          setScheduleWarning(`Automatic check schedule unavailable: ${message(error)}`);
      }
    })());
  const saveSchedule = () => {
    scheduleWrite = scheduleWrite
      .then(async () => {
        await loadSchedule();
        const directory = dirname(schedulePath);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if ((await lstat(directory)).isSymbolicLink())
          throw new Error("Schedule directory is a symlink");
        await chmod(directory, 0o700);
        const temporary = `${schedulePath}.${randomUUID()}.tmp`;
        try {
          const cutoff = Date.now() - AUTO_CHECK_INTERVAL;
          const timestamps = Object.fromEntries(
            [...lastCheck].filter(([, time]) => time >= cutoff),
          );
          await writeFile(temporary, JSON.stringify(timestamps), { mode: 0o600, flag: "wx" });
          await rename(temporary, schedulePath);
        } finally {
          await unlink(temporary).catch(() => {});
        }
      })
      .catch((error) => {
        if (!closed)
          setScheduleWarning(`Automatic check schedule could not be saved: ${message(error)}`);
      });
  };
  const applyCheck = (check: SourceUpdateCheck) => {
    for (const draft of drafts.values()) {
      if (draft === taskState && updatesActive()) continue;
      draft.applyCheck(check);
      if (latestProjection && check.observation && !check.stale)
        draft.rebaseCheckedScope(
          buildUpdateScope(latestProjection, draft.scope.entry),
          check.source,
        );
    }
  };
  const pumpChecks = async () => {
    if (closed || paused || checking) return;
    while (!closed && !paused && queue.size) {
      const request = queue.values().next().value!;
      const current = { request, controller: new AbortController(), ignored: false };
      const scheduleIdentity = scheduleKey(request.source);
      checking = current;
      const signal = current.controller.signal;
      let ok = false;
      try {
        let observation: api.UpdateObservation | undefined;
        let restored = false;
        const checkedAt = lastCheck.get(scheduleIdentity);
        const recent =
          checkedAt !== undefined &&
          checkedAt <= Date.now() &&
          Date.now() - checkedAt < AUTO_CHECK_INTERVAL;
        if (request.mode === "auto" && recent) {
          observation = (
            await core.checkUpdate(
              environment,
              { source: request.source, observation: "retained" },
              { signal },
            )
          ).value;
          restored = !!observation;
          if (closed || current.ignored) continue;
          if (!observation) {
            applyCheck({ source: request.source, status: "not-checked" });
            continue;
          }
        }
        if (!observation) {
          setCheckActivity({ source: request.source, phase: "checking" });
          applyCheck({ source: request.source, status: "checking" });
          // Persist attempts before network work so failure or application exit
          // cannot turn restart into an automatic retry inside the interval.
          lastCheck.set(scheduleIdentity, Date.now());
          saveSchedule();
          observation = (
            await core.checkUpdate(environment, { source: request.source }, { signal })
          ).value;
          if (closed || current.ignored) continue;
        }
        if (observation.source !== request.source)
          throw new Error("Check returned a different Source");
        // Core validates its baseline before returning a new observation.
        // Only reuse of an older displayed review needs a separate baseline read.
        if (!observation.refreshError && !restored) {
          lastCheck.set(scheduleIdentity, Date.now());
          saveSchedule();
        }
        applyCheck({
          source: observation.source,
          observation,
          checkedAt: observation.observedAt ?? Date.now(),
          stale: !!observation.refreshError,
          error: observation.refreshError,
          status: observation.refreshError
            ? "failed"
            : observation.changed.length
              ? "changed"
              : "no-changes",
        });
        ok = !observation.refreshError;
      } catch (error) {
        if (!closed && !current.ignored)
          applyCheck({
            source: request.source,
            status: "failed",
            error: message(error),
            stale: true,
          });
      } finally {
        checking = undefined;
        if (!current.ignored || queue.get(request.source) !== request || closed) {
          if (queue.get(request.source) === request) queue.delete(request.source);
          request.resolve(ok);
        }
        if (!closed) {
          setCheckActivity(undefined);
        }
      }
    }
  };
  const enqueueChecks = (sources: readonly string[], mode: CheckRequest["mode"]) => {
    if (closed) return Promise.resolve(false);
    const waiting = sources.map((source) => {
      if (mode === "current") manualChecks.add(source);
      const existing = queue.get(source);
      if (existing) {
        // A manual check must not settle with a retained-only read. Cancel that
        // read, then run the same queued request as current after it drains.
        if (mode === "current" && existing.mode === "auto") {
          existing.mode = "current";
          if (checking?.request === existing) {
            checking.ignored = true;
            checking.controller.abort();
          }
        }
        if (mode === "current" && checking?.request !== existing) {
          queue.delete(source);
          const pending = [...queue.entries()];
          queue.clear();
          queue.set(source, existing);
          for (const [key, request] of pending) queue.set(key, request);
        }
        return existing.promise;
      }
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>((done) => {
        resolve = done;
      });
      queue.set(source, { source, mode, promise, resolve });
      return promise;
    });
    if (paused && queue.size)
      setCheckActivity({ source: queue.keys().next().value!, phase: "paused" });
    void pumpChecks();
    return Promise.all(waiting).then((results) => results.every(Boolean));
  };
  const pauseChecks = () => {
    paused = true;
    if (checking) {
      checking.ignored = true;
      checking.controller.abort();
    }
    if (queue.size) setCheckActivity({ source: queue.keys().next().value!, phase: "paused" });
  };
  const resumeChecks = () => {
    paused = false;
    void pumpChecks();
  };
  const stopUpdateChecks = () => {
    const active = !!checking || queue.size > 0;
    checksStopped = true;
    if (autoTimer) clearTimeout(autoTimer);
    for (const request of queue.values()) {
      if (!closed)
        applyCheck({
          source: request.source,
          status: "cancelled",
          error: "Check stopped",
          stale: true,
        });
      if (checking?.request !== request) request.resolve(false);
    }
    queue.clear();
    if (checking) {
      checking.ignored = true;
      checking.controller.abort();
      if (!closed) setCheckActivity({ source: checking.request.source, phase: "stopping" });
    } else if (!closed) setCheckActivity(undefined);
    return active;
  };
  const reconcileDraft = (draft: UpdatesState, snapshot: api.WorkspaceView) => {
    const fresh = buildUpdateScope(snapshot, draft.scope.entry);
    draft.reconcileRestoredScope(fresh);
    draft.reconcileCurrentScope(fresh);
  };
  const applyProjection = (snapshot: api.WorkspaceView) => {
    latestProjection = snapshot;
    for (const draft of drafts.values())
      if (draft !== taskState || !updatesActive()) reconcileDraft(draft, snapshot);
    projection.applyProjection(snapshot);
  };
  const refresh = async () => {
    if (closed) return undefined;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    projection.loading();
    try {
      const result = await core.getWorkspace(environment, { signal: controller.signal });
      if (closed || refreshController !== controller) return undefined;
      applyProjection(result.value);
      return result;
    } catch (error) {
      if (!closed && refreshController === controller && !cancelled(error))
        projection.failed(diagnostic(error));
      return undefined;
    } finally {
      if (refreshController === controller) refreshController = undefined;
    }
  };
  // Only lifetime mechanics are shared; each operation keeps its own review and submit rules.
  const withForeground = async <T>(
    kind: "preview" | "observe" | "execute",
    fallback: T,
    body: (request: { id: string; signal: AbortSignal; active: () => boolean }) => Promise<T>,
    task?: Pick<TaskState, "title" | "semanticOwner">,
    reportCancellation = true,
  ): Promise<T> => {
    if (closed || foreground) return fallback;
    const current = { id: `${++sequence}`, kind, controller: new AbortController() };
    foreground = current;
    if (kind === "execute") pauseChecks();
    const active = () => !closed && foreground === current;
    try {
      if (task) operation.start({ ...task, id: current.id, cancellationRequested: false });
      return await body({ id: current.id, signal: current.controller.signal, active });
    } catch (error) {
      if (active()) {
        const problem = diagnostic(error);
        if (task) {
          const title = cancelled(error)
            ? kind === "observe"
              ? "Observation cancelled"
              : "Operation cancelled"
            : problem.message;
          operation.settle(current.id, title, problem);
        } else if (reportCancellation || !cancelled(error)) operation.report(problem);
      }
      return fallback;
    } finally {
      if (foreground === current) foreground = undefined;
      if (kind === "execute" && !closed) resumeChecks();
    }
  };
  const execute = (
    title: string,
    semanticOwner: ProjectionOwner,
    body: (signal: AbortSignal) => Promise<unknown>,
    completed = `${title} complete`,
    consumeReview?: () => void,
  ) =>
    withForeground(
      "execute",
      false,
      async ({ id, signal, active }) => {
        await body(signal);
        if (!active()) return false;
        const refreshed = await refresh();
        if (active()) {
          consumeReview?.();
          operation.settle(id, refreshed ? completed : `${completed}; Workspace is stale`);
        }
        return true;
      },
      { title, semanticOwner },
    );
  const applyIdentity = (
    title: string,
    semanticOwner: ProjectionOwner,
    body: (signal: AbortSignal) => Promise<unknown>,
    consume: () => void,
    completed: string,
    reviewed = true,
  ): Promise<IdentityApplyOutcome> =>
    withForeground<IdentityApplyOutcome>(
      "execute",
      { status: "blocked" },
      async ({ id, signal, active }) => {
        try {
          await body(signal);
        } catch (error) {
          consume();
          const problem = diagnostic(error);
          if (active()) operation.settle(id, problem.message, problem);
          return reviewed && error instanceof SkctlError && error.code === "CONFIG_CONFLICT"
            ? { status: "stale", diagnostic: problem }
            : { status: "uncertain", diagnostic: problem };
        }
        consume();
        const refreshed = active() ? await refresh() : undefined;
        if (active())
          operation.settle(id, refreshed ? completed : `${completed}; Workspace is stale`);
        return { status: "applied", workspace: refreshed ? "fresh" : "stale" };
      },
      { title, semanticOwner },
    );
  const selectUpdatesScope = (entry: UpdateScopeEntry, snapshot?: api.WorkspaceView) => {
    if (closed || !snapshot) return undefined;
    latestProjection = snapshot;
    const key = JSON.stringify(entry);
    let draft = drafts.get(key);
    if (draft) {
      if (draft !== taskState || !updatesActive()) reconcileDraft(draft, snapshot);
    } else {
      draft = createUpdatesState(buildUpdateScope(snapshot, entry));
      // Reuse only an existing route's displayed review, with its original time
      // and guard facts. Persistent restoration always goes through Core.
      for (const source of draft.scope.sources) {
        for (const previous of drafts.values()) {
          const group = previous.group(source);
          if (
            !group?.observation ||
            group.committed ||
            group.stale ||
            !["changed", "no-changes"].includes(group.status)
          )
            continue;
          const targets = draft.scope.addresses.filter((address) => address.source === source);
          const guard = updateSubmission(previous.checkedScope(), targets, snapshot);
          if ("reason" in guard) {
            draft.invalidateCheck(source, "failed", guard.reason);
            continue;
          }
          draft.observe(group.observation, group.checkedAt);
          break;
        }
      }
      drafts.set(key, draft);
      // When no displayed review is available, recompute through Core.
      if (autoStarted && !checksStopped)
        void enqueueChecks(
          draft.scope.sources.filter(
            (source) =>
              draft!.group(source)?.status === "not-checked" &&
              !run()?.addresses.some((address) => address.source === source),
          ),
          "auto",
        );
    }
    setUpdates(draft);
    return draft;
  };
  const patchRun = (patch: Partial<UpdateRun>) =>
    setRun((current) => (current ? { ...current, ...patch } : current));
  const record = (
    addresses: readonly UpdateAddress[],
    status: UpdateRun["results"][number]["status"],
    detail?: string,
    issue?: UpdateIssue,
  ) => {
    const keys = new Set(addresses.map(addressKey));
    setRun((current) =>
      current
        ? {
            ...current,
            results: current.results.map((result) =>
              keys.has(addressKey(result.address))
                ? {
                    address: result.address,
                    status,
                    ...(detail ? { message: detail } : {}),
                    ...(issue ? { issue } : {}),
                  }
                : result,
            ),
          }
        : current,
    );
  };
  const submitFromState = async (
    state: UpdatesState | undefined,
    requested?: readonly UpdateAddress[],
  ) => {
    if (closed || foreground || !state) return false;
    const scope = state.scopeSnapshot();
    const addresses = (
      requested ?? (state.selected().length ? state.selected() : scope.addresses)
    ).map((address) => Object.freeze({ ...address }));
    if (
      !addresses.length ||
      scope.unavailableReason ||
      new Set(addresses.map(addressKey)).size !== addresses.length ||
      addresses.some(
        (address) => !scope.addresses.some((item) => addressKey(item) === addressKey(address)),
      )
    )
      return false;
    const current = {
      id: `${++sequence}`,
      kind: "updates" as const,
      controller: new AbortController(),
    };
    foreground = current;
    taskState = state;
    setTaskEntry(structuredClone(scope.entry));
    const signal = current.controller.signal;
    setRun({
      addresses,
      phase: "checking",
      results: addresses.map((address) => ({ address, status: "not-run" as const })),
    });
    pauseChecks();
    try {
      for (const source of new Set(addresses.map((address) => address.source))) {
        if (closed || signal.aborted) break;
        const targets = addresses.filter((address) => address.source === source);
        patchRun({ phase: "checking", source });
        let observation: api.UpdateObservation;
        let issue: UpdateIssue | undefined;
        try {
          const snapshot = (await core.getWorkspace(environment, { signal })).value;
          if (closed || signal.aborted) break;
          const guard = updateSubmission(scope, targets, snapshot);
          if ("reason" in guard) {
            issue = guard.issue ?? { kind: "scope" };
            if (issue.kind === "ownership") applyProjection(snapshot);
            throw new Error(guard.reason);
          }
          const group = state.group(source);
          const recent =
            group?.checkedAt !== undefined &&
            group.checkedAt <= Date.now() &&
            Date.now() - group.checkedAt < AUTO_CHECK_INTERVAL;
          let reviewed =
            !group?.stale &&
            !group?.committed &&
            recent &&
            (group?.status === "changed" || group?.status === "no-changes")
              ? group.observation
              : undefined;
          if (reviewed) {
            const baseline = (await core.getUpdateBaseline(environment, { source }, { signal }))
              .value;
            if (closed || signal.aborted) break;
            if (baseline !== reviewed.baseline) reviewed = undefined;
          }
          if (!reviewed) state.setStatus(source, "checking");
          observation =
            reviewed ?? (await core.checkUpdate(environment, { source }, { signal })).value;
          if (closed || signal.aborted) break;
          if (observation.source !== source) throw new Error("Check returned a different Source");
          if (observation.refreshError) {
            state.applyCheck({
              source,
              observation,
              status: "failed",
              stale: true,
              checkedAt: observation.observedAt,
              error: observation.refreshError,
            });
            throw new Error(observation.refreshError);
          }
          state.observe(observation, observation.observedAt ?? Date.now());
          const fresh = (await core.getWorkspace(environment, { signal })).value;
          if (closed || signal.aborted) break;
          const checked = updateSubmission(scope, targets, fresh);
          if ("reason" in checked) {
            issue = checked.issue ?? { kind: "scope" };
            if (issue.kind === "ownership") applyProjection(fresh);
            throw new Error(checked.reason);
          }
          state.rebaseCheckedScope(checked.scope, source);
        } catch (error) {
          if (closed || signal.aborted || cancelled(error)) break;
          if (issue) state.invalidateCheck(source, "failed", message(error));
          else state.applyCheck({ source, status: "failed", stale: true, error: message(error) });
          record(targets, "failed", message(error), issue);
          continue;
        }
        const changed = new Set(observation.changed.map((item) => item.path));
        const removed = new Set(observation.removed.map((item) => item.path));
        const unchanged = new Set(observation.unchanged.map((item) => item.path));
        const paths = targets.filter((address) => changed.has(address.path));
        record(
          targets.filter((address) => unchanged.has(address.path)),
          "unchanged",
        );
        record(
          targets.filter((address) => removed.has(address.path)),
          "failed",
          "Removed upstream; installed content was kept",
          { kind: "removed" },
        );
        record(
          targets.filter(
            (address) =>
              !changed.has(address.path) &&
              !removed.has(address.path) &&
              !unchanged.has(address.path),
          ),
          "failed",
          "No check result for this installed Skill",
        );
        if (!paths.length) continue;
        if (!observation.baseline || (observation.kind !== "local" && !observation.exactRevision)) {
          record(paths, "failed", "Check lacks comparison evidence; check updates again");
          continue;
        }
        // Invalidate only attempted Sources, before entering the mutation; ambiguous failures cannot authorize retry.
        const queued = queue.get(source);
        if (queued) {
          queue.delete(source);
          queued.resolve(false);
        }
        for (const draft of drafts.values())
          if (draft !== state && draft.group(source)?.observation)
            draft.invalidateCheck(
              source,
              "failed",
              "Source was submitted from another scope; check updates again",
            );
        patchRun({ phase: "updating", source });
        state.setStatus(source, "updating");
        try {
          await core.updateSkills(
            environment,
            {
              source,
              paths: paths.map((address) => address.path),
              ...(observation.kind === "local" ? {} : { exactRevision: observation.exactRevision }),
              expectedBaseline: observation.baseline,
            },
            { signal },
          );
          if (closed) return false;
          // Fulfilment is a committed receipt even when Stop races with publication.
          record(paths, "updated");
          state.setResult(source, "succeeded");
          if (signal.aborted) break;
          try {
            const snapshot = (await core.getWorkspace(environment, { signal })).value;
            if (closed) return false;
            state.reconcileCurrentScope(buildUpdateScope(snapshot, scope.entry));
            applyProjection(snapshot);
          } catch (error) {
            if (!closed)
              state.markCommitted(
                source,
                `Updated; could not refresh workspace: ${message(error)}`,
              );
          }
        } catch (error) {
          if (closed) return false;
          const notApplied =
            error instanceof SkctlError &&
            error.diagnostics.find((item) => {
              const subject = item.subject;
              return (
                item.code === "UPDATE_NOT_APPLIED" &&
                subject?.kind === "installed-skill" &&
                paths.some((address) => addressKey(address) === addressKey(subject.address))
              );
            });
          const detail = notApplied
            ? `${message(error)}. Update not applied; installed Skills kept. ${notApplied.suggestion ?? "Fix the Source file, then recheck updates."}`
            : `Update outcome needs verification: ${message(error)}`;
          record(
            paths,
            notApplied ? "failed" : "unknown",
            detail,
            notApplied && notApplied.subject?.kind === "installed-skill"
              ? { kind: "metadata", address: notApplied.subject.address }
              : undefined,
          );
          state.setStatus(
            source,
            notApplied ? "failed" : signal.aborted || cancelled(error) ? "cancelled" : "partial",
            detail,
            "update",
          );
          if (signal.aborted || cancelled(error)) break;
        }
      }
      return (
        !signal.aborted &&
        run()!.results.every(
          (result) => result.status === "updated" || result.status === "unchanged",
        )
      );
    } finally {
      if (!closed) {
        if (signal.aborted) {
          for (const source of new Set(addresses.map((address) => address.source)))
            if (state.group(source)?.status === "checking")
              state.invalidateCheck(source, "cancelled", "Update check stopped");
        }
        state.completeSelection(
          run()
            ?.results.filter(
              (result) => result.status === "updated" || result.status === "unchanged",
            )
            .map((result) => result.address) ?? [],
        );
        patchRun({ phase: "settled" });
      }
      if (foreground === current) foreground = undefined;
      if (!closed) resumeChecks();
    }
  };

  const review = (intent: DirectSourceIntent): Promise<SourceRemovalReview | undefined> => {
    const stable = structuredClone(intent);
    return withForeground("preview", undefined, async ({ id, signal, active }) => {
      liveReview = undefined;
      operation.clearProblem();
      const { value: impact } = await core.previewSourceRemoval(
        environment,
        {
          source: stable.source,
          level: stable.owner.level,
          expectedOwner: stable.owner,
        },
        { signal },
      );
      if (!active()) return undefined;
      if (
        impact.kind !== "source-removal" ||
        impact.source !== stable.source ||
        !impact.owner ||
        impact.owner.level !== stable.owner.level ||
        impact.owner.file !== stable.owner.file ||
        impact.owner.pointer !== stable.owner.pointer
      )
        throw new SkctlError(
          "TRANSACTION_CONFLICT",
          "Source removal preview no longer matches the selected declaration",
        );
      liveReview = { id, intent: stable, impact };
      return liveReview;
    });
  };
  const confirm = (reviewed: SourceRemovalReview) => {
    if (liveReview !== reviewed || !reviewed.impact.allowed) return Promise.resolve(false);
    return execute(
      "Removing Source",
      { kind: "source", id: reviewed.intent.source },
      (signal) =>
        core.removeSource(
          environment,
          {
            source: reviewed.intent.source,
            level: reviewed.intent.owner.level,
            expectedOwner: reviewed.intent.owner,
          },
          { signal },
        ),
      "Source removed",
      () => {
        liveReview = undefined;
      },
    );
  };
  const discover = (intent: DiscoveryReview["intent"]): Promise<DiscoveryReview | undefined> => {
    const stable = structuredClone(intent);
    return withForeground(
      "observe",
      undefined,
      async ({ id, signal, active }) => {
        const result = await core.discoverSkills(
          environment,
          { source: stable.source },
          { signal },
        );
        if (!active()) return undefined;
        if (result.value.source !== stable.source)
          throw new SkctlError(
            "TRANSACTION_CONFLICT",
            "Observed Source no longer matches the selected Source",
          );
        liveDiscovery = { kind: "discovery", id, intent: stable, observation: result.value };
        operation.settle(id, "Observation ready");
        return liveDiscovery;
      },
      { title: "Observing Source", semanticOwner: { kind: "source", id: stable.source } },
    );
  };
  const install = (reviewed: DiscoveryReview, paths: readonly string[]) => {
    if (
      liveDiscovery !== reviewed ||
      !paths.length ||
      new Set(paths).size !== paths.length ||
      paths.some((path) => !reviewed.observation.candidates.some((item) => item.path === path))
    )
      return Promise.resolve(false);
    return execute(
      "Installing Skills",
      { kind: "source", id: reviewed.intent.source },
      (signal) =>
        core.installSkills(
          environment,
          {
            source: reviewed.observation.source,
            paths: [...paths],
            exactRevision: reviewed.observation.exactRevision,
          },
          { signal },
        ),
      "Skills installed",
      () => {
        liveDiscovery = undefined;
      },
    );
  };
  const reviewInstalled = (
    request:
      | { readonly kind: "uninstall"; readonly address: UpdateAddress }
      | {
          readonly kind: "rebind";
          readonly address: UpdateAddress;
          readonly owner: string;
          readonly ownerPath: string;
        },
  ): Promise<InstalledSkillReview | undefined> => {
    if (closed || foreground) return Promise.resolve(undefined);
    if (
      request.kind === "rebind" &&
      (!request.owner ||
        !request.ownerPath ||
        request.ownerPath.startsWith("/") ||
        request.ownerPath.split("/").some((part) => part === ".." || part === ""))
    ) {
      operation.report(
        diagnostic(
          new SkctlError("INVALID_ARGUMENT", "Replacement Skill path must be Source-root-relative"),
        ),
      );
      return Promise.resolve(undefined);
    }
    const stable = structuredClone(request);
    return withForeground("preview", undefined, async ({ id, signal, active }) => {
      liveInstalledReview = undefined;
      if (stable.kind === "uninstall") {
        const { value: impact } = await core.previewUninstall(
          environment,
          { source: stable.address.source, paths: [stable.address.path] },
          { signal },
        );
        if (!active()) return undefined;
        if (
          impact.kind !== "uninstall" ||
          impact.installed.length !== 1 ||
          addressKey(impact.installed[0]!) !== addressKey(stable.address)
        )
          throw new SkctlError(
            "TRANSACTION_CONFLICT",
            "Uninstall preview no longer matches the selected structural address",
          );
        liveInstalledReview = { kind: "uninstall", id, address: stable.address, impact };
      } else {
        const { value: impact } = await core.previewRebind(
          environment,
          { ...stable.address, owner: stable.owner, ownerPath: stable.ownerPath },
          { signal },
        );
        if (!active()) return undefined;
        if (
          impact.kind !== "rebind" ||
          addressKey(impact.address) !== addressKey(stable.address) ||
          impact.owner !== stable.owner ||
          impact.ownerPath !== stable.ownerPath
        )
          throw new SkctlError(
            "TRANSACTION_CONFLICT",
            "Rebind preview no longer matches the selected structural address",
          );
        liveInstalledReview = {
          kind: "rebind",
          id,
          address: stable.address,
          owner: stable.owner,
          ownerPath: stable.ownerPath,
          impact,
        };
      }
      return liveInstalledReview;
    });
  };
  const applyRebind = (reviewed: InstalledSkillReview): Promise<IdentityApplyOutcome> => {
    if (reviewed.kind !== "rebind" || liveInstalledReview !== reviewed || !reviewed.impact.allowed)
      return Promise.resolve({ status: "blocked" });
    return applyIdentity(
      "Rebinding Skill",
      { kind: "installed-skill", address: reviewed.address },
      (signal) =>
        core.rebindSkill(
          environment,
          {
            ...reviewed.address,
            owner: reviewed.owner,
            ownerPath: reviewed.ownerPath,
            reviewedImpact: reviewed.impact,
          },
          { signal },
        ),
      () => {
        if (liveInstalledReview === reviewed) liveInstalledReview = undefined;
      },
      "Skill rebound",
    );
  };
  const confirmInstalled = (reviewed: InstalledSkillReview) => {
    if (reviewed.kind === "rebind")
      return applyRebind(reviewed).then((outcome) => outcome.status === "applied");
    if (liveInstalledReview !== reviewed || !reviewed.impact.allowed) return Promise.resolve(false);
    return execute(
      "Uninstalling Skill",
      { kind: "installed-skill", address: reviewed.address },
      (signal) =>
        core.uninstallSkills(
          environment,
          { source: reviewed.address.source, paths: [reviewed.address.path] },
          { signal },
        ),
      "Skill uninstalled",
      () => {
        liveInstalledReview = undefined;
      },
    );
  };
  const reviewCollection = (
    intent: CollectionPreviewIntent,
  ): Promise<CollectionReview | undefined> => {
    const stable = structuredClone(intent);
    return withForeground(
      "preview",
      undefined,
      async ({ id, signal, active }) => {
        liveCollection = undefined;
        const result = await previewCollection(core, stable, id, signal, environment);
        if (!active()) return undefined;
        liveCollection = result;
        return result;
      },
      undefined,
      false,
    );
  };
  const executeCollection = (
    reviewed: CollectionReview | Extract<CollectionIntent, { readonly kind: "collection-create" }>,
  ) => {
    if (reviewed.kind === "collection-rename")
      return applyCollectionRename(reviewed).then((outcome) => outcome.status === "applied");
    const intent = reviewed.kind === "collection-create" ? reviewed : reviewed.intent;
    if (
      reviewed.kind !== "collection-create" &&
      (liveCollection !== reviewed || !reviewed.impact.allowed)
    )
      return Promise.resolve(false);
    const semanticOwner: ProjectionOwner =
      intent.kind === "collection-use"
        ? { kind: "config", level: intent.level }
        : {
            kind: "collection",
            id: intent.kind === "collection-import" ? intent.into : intent.collection,
          };
    return execute(
      "Updating Collection",
      semanticOwner,
      async (signal) => {
        if (reviewed.kind === "collection-create") {
          const { kind: _, ...request } = reviewed;
          await core.createCollection(environment, request, { signal });
        } else
          switch (reviewed.kind) {
            case "add-to-collection": {
              const { kind: _, ...request } = reviewed.intent;
              await core.addMember(environment, request, { signal });
              break;
            }
            case "membership-removal": {
              const { intent, impact } = reviewed;
              const level =
                intent.level ??
                intent.expectedOwner?.level ??
                (impact.decision.kind === "direct" ? impact.decision.owner.level : undefined);
              if (!level)
                throw new SkctlError("CONFIG_CONFLICT", "Membership owner is no longer available");
              const { kind: _, ...request } = intent;
              await core.removeMember(environment, { ...request, level }, { signal });
              break;
            }
            case "membership-batch": {
              const { kind: _, ...request } = reviewed.intent;
              await core.editMembers(
                environment,
                { ...request, reviewedAffected: reviewed.impact.affected },
                { signal },
              );
              break;
            }
            case "collection-import": {
              const { kind: _, ...request } = reviewed.intent;
              await core.importMembers(environment, request, { signal });
              break;
            }
            case "reference-add": {
              const { kind: _, ...request } = reviewed.intent;
              await core.addReference(environment, request, { signal });
              break;
            }
            case "reference-remove": {
              const { kind: _, ...request } = reviewed.intent;
              await core.removeReference(environment, request, { signal });
              break;
            }
            case "link-change": {
              const { kind: _, ...request } = reviewed.intent;
              await core.setLink(environment, request, { signal });
              break;
            }
            case "collection-use": {
              const { kind: _, ...request } = reviewed.intent;
              await core.setUse(environment, request, { signal });
              break;
            }
            case "collection-removal": {
              const { kind: _, ...request } = reviewed.intent;
              await core.removeCollection(environment, request, { signal });
              break;
            }
          }
      },
      "Collection updated",
      () => {
        liveCollection = undefined;
      },
    );
  };
  const applyCollectionRename = (reviewed: CollectionReview): Promise<IdentityApplyOutcome> => {
    if (
      reviewed.kind !== "collection-rename" ||
      liveCollection !== reviewed ||
      !reviewed.impact.allowed
    )
      return Promise.resolve({ status: "blocked" });
    return applyIdentity(
      "Renaming Collection",
      { kind: "collection", id: reviewed.intent.collection },
      (signal) =>
        core.renameCollection(
          environment,
          {
            collection: reviewed.intent.collection,
            target: reviewed.intent.target,
            reviewedImpact: reviewed.impact,
          },
          { signal },
        ),
      () => {
        if (liveCollection === reviewed) liveCollection = undefined;
      },
      "Collection renamed",
    );
  };
  return {
    refresh,
    review,
    confirm,
    discover,
    install,
    reviewInstalled,
    confirmInstalled,
    applyRebind,
    previewCollection: reviewCollection,
    confirmCollection: (reviewed: CollectionReview) => executeCollection(reviewed),
    applyCollectionRename,
    createCollection: (intent: Extract<CollectionIntent, { readonly kind: "collection-create" }>) =>
      executeCollection(intent),
    setCollectionContent: (request: api.SetCollectionContentRequest) =>
      execute(
        "Saving Collection content",
        { kind: "collection", id: request.collection },
        (signal) => core.setCollectionContent(environment, request, { signal }),
      ),
    selectUpdatesScope,
    restoreUpdatesScope: (state: UpdatesState, snapshot?: api.WorkspaceView) => {
      if (drafts.get(JSON.stringify(state.scope.entry)) !== state) return undefined;
      return selectUpdatesScope(state.scope.entry, snapshot);
    },
    updates,
    updatesActive,
    updateRun: run,
    updateTaskEntry: taskEntry,
    updatesSubmittable: () => updates()?.eligible() ?? [],
    updatesRetryable: () =>
      run()
        ?.results.filter((result) => result.status === "not-run")
        .map((result) => result.address) ?? [],
    submitUpdates: (addresses?: readonly UpdateAddress[]) => submitFromState(updates(), addresses),
    continueUpdates: () =>
      submitFromState(
        taskState,
        run()
          ?.results.filter((result) => result.status === "not-run")
          .map((result) => result.address) ?? [],
      ),
    stopUpdates: () => {
      if (!updatesActive() || foreground?.kind !== "updates") return false;
      patchRun({ phase: "stopping" });
      foreground.controller.abort();
      return true;
    },
    startUpdateChecks: async (snapshot?: api.WorkspaceView) => {
      if (closed || !snapshot || checksStopped || autoStarted) return;
      latestProjection = snapshot;
      if (!drafts.has(JSON.stringify({ kind: "workspace" }))) {
        drafts.set(
          JSON.stringify({ kind: "workspace" }),
          createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" })),
        );
      }
      await loadSchedule();
      if (closed || checksStopped || autoStarted) return;
      const startupSources = [
        ...new Set(snapshot.installedSkills.map((skill) => skill.address.source)),
      ];
      const starting = enqueueChecks(
        startupSources.filter((source) => !manualChecks.has(source)),
        "auto",
      );
      autoStarted = true;
      const checkWhenDue = () => {
        if (closed || checksStopped || !latestProjection) return;
        const sources = [
          ...new Set(latestProjection.installedSkills.map((skill) => skill.address.source)),
        ];
        const due = sources.filter((source) => {
          const time = lastCheck.get(scheduleKey(source));
          return (
            time === undefined || time > Date.now() || Date.now() - time >= AUTO_CHECK_INTERVAL
          );
        });
        // Failed automatic checks wait another interval, not a hot retry loop.
        if (due.length) {
          void enqueueChecks(due, "auto").then(() => {
            if (closed || checksStopped) return;
            autoTimer = setTimeout(checkWhenDue, AUTO_CHECK_INTERVAL);
            autoTimer.unref?.();
          });
          return;
        }
        const next = Math.min(
          ...sources.map(
            (source) => (lastCheck.get(scheduleKey(source)) ?? Date.now()) + AUTO_CHECK_INTERVAL,
          ),
        );
        autoTimer = setTimeout(
          checkWhenDue,
          Math.max(1000, Number.isFinite(next) ? next - Date.now() : AUTO_CHECK_INTERVAL),
        );
        autoTimer.unref?.();
      };
      void starting.then(() => {
        if (closed || checksStopped) return;
        const next = Math.min(
          ...startupSources.map(
            (source) => (lastCheck.get(scheduleKey(source)) ?? Date.now()) + AUTO_CHECK_INTERVAL,
          ),
        );
        autoTimer = setTimeout(
          checkWhenDue,
          Math.max(1000, Number.isFinite(next) ? next - Date.now() : AUTO_CHECK_INTERVAL),
        );
        autoTimer.unref?.();
      });
    },
    checkUpdates: (sources?: readonly string[]) => {
      const state = updates();
      if (!state) return Promise.resolve(false);
      return enqueueChecks(
        state.scope.sources.filter((source) => !sources || sources.includes(source)),
        "current",
      );
    },
    checkActivity,
    checkingActive: () => !closed && (!!checking || queue.size > 0),
    updateChecksWarning: scheduleWarning,
    stopUpdateChecks,
    observeConfig: (id: string) =>
      withForeground(
        "observe",
        undefined,
        async ({ signal, active }) => {
          const result = await core.observeConfigSource(environment, { id }, { signal });
          return active() ? result.value : undefined;
        },
        undefined,
        false,
      ),
    previewConfig: (
      request:
        | {
            readonly kind: "adopt";
            readonly id: string;
            readonly observation: api.ConfigSourceObservation;
          }
        | { readonly kind: "forget" | "remove"; readonly id: string },
    ) =>
      withForeground(
        "preview",
        undefined,
        async ({ signal, active }) => {
          let result: api.OperationResult<api.ConfigSourceImpact>;
          if (request.kind === "adopt") {
            const exactRevision = request.observation.exactRevision;
            if (!exactRevision)
              throw new SkctlError(
                "INVALID_ARGUMENT",
                "Config Source observation lacks an exact revision",
              );
            result = await core.previewConfigAdoption(
              environment,
              { id: request.id, exactRevision, observation: request.observation },
              { signal },
            );
          } else
            result =
              request.kind === "forget"
                ? await core.previewConfigForget(environment, { id: request.id }, { signal })
                : await core.previewConfigRemoval(environment, { id: request.id }, { signal });
          return active() ? result.value : undefined;
        },
        undefined,
        false,
      ),
    adoptConfig: (id: string, exactRevision: string, observation: api.ConfigSourceObservation) =>
      execute("Adopting Config Source", { kind: "config-source", id }, (signal) =>
        core.adoptConfigSource(environment, { id, exactRevision, observation }, { signal }),
      ),
    forgetConfig: (id: string) =>
      execute("Forgetting Config Source", { kind: "config-source", id }, (signal) =>
        core.forgetConfig(environment, { id }, { signal }),
      ),
    removeConfig: (id: string) =>
      execute("Removing Config Source", { kind: "config-source", id }, (signal) =>
        core.removeConfig(environment, { id }, { signal }),
      ),
    registerSource: (
      registration: { readonly kind: "source" | "config-source" } & api.RegisterSourceRequest,
    ) =>
      execute(
        registration.kind === "source" ? "Registering Source" : "Registering Config Source",
        { kind: registration.kind === "source" ? "source" : "config-source", id: registration.id },
        (signal) => {
          const { kind, ...request } = registration;
          return kind === "source"
            ? core.registerSource(environment, request, { signal })
            : core.registerConfigSource(environment, request, { signal });
        },
      ),
    registerReplacementSource: (request: api.RegisterSourceRequest) =>
      applyIdentity(
        "Registering replacement Source",
        { kind: "source", id: request.id },
        (signal) => core.registerSource(environment, request, { signal }),
        () => {},
        "Replacement Source registered",
        false,
      ),
    pending: () => foreground !== undefined,
    pendingKind: () => foreground?.kind,
    cancel: () => {
      const current = foreground;
      if (!current || current.kind === "updates" || current.controller.signal.aborted) return;
      if (current.kind === "execute" || current.kind === "observe")
        operation.requestCancel(current.id);
      current.controller.abort();
      if (current.kind === "preview") {
        foreground = undefined;
        liveReview = undefined;
        liveInstalledReview = undefined;
        liveCollection = undefined;
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
      if (liveCollection === reviewed) liveCollection = undefined;
    },
    teardown: () => {
      if (closed) return scheduleWrite;
      closed = true;
      refreshController?.abort();
      foreground?.controller.abort();
      if (autoTimer) clearTimeout(autoTimer);
      stopUpdateChecks();
      foreground = undefined;
      drafts.clear();
      liveReview = undefined;
      liveDiscovery = undefined;
      liveInstalledReview = undefined;
      liveCollection = undefined;
      return scheduleWrite;
    },
  };
}
