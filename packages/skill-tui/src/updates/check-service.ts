import type {
  ManagementCapability,
  ManagementProjection,
  OperationResult,
  UpdateObservation,
} from "@skill-cli/core";
import {
  createUpdateCheckCache,
  isFreshUpdateCheck,
  type CachedUpdateCheck,
  type UpdateCheckCache,
} from "./check-cache";

export type CheckedUpdateObservation = UpdateObservation;

export interface UpdateBaselineCapability {
  getUpdateBaseline?(
    request: { readonly source: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<OperationResult<string>>;
}

export type UpdateCheckStatus =
  | "not-checked"
  | "checking"
  | "failed"
  | "no-changes"
  | "changed"
  | "cancelled";
export interface SourceUpdateCheck {
  readonly source: string;
  readonly status: UpdateCheckStatus;
  readonly checkedAt?: number;
  readonly observation?: CheckedUpdateObservation;
  readonly error?: string;
  readonly stale?: boolean;
}
export interface UpdateCheckActivity {
  readonly phase: "checking" | "paused" | "stopping";
  readonly source: string;
}

export interface UpdateCheckServiceOptions {
  readonly cache?: UpdateCheckCache;
  readonly now?: () => number;
  readonly onChange?: (check: SourceUpdateCheck) => void;
  /** Notifies session owners when running/queued/warning facts change. */
  readonly onActivity?: () => void;
}

type CheckManagement = Pick<ManagementCapability, "checkUpdate"> & UpdateBaselineCapability;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const cancelled = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "CANCELLED";

/**
 * Session-owned, serial Source checks. It deliberately has no UI or foreground-lane
 * ownership: callers publish its snapshots into whatever scopes currently exist.
 */
export function createUpdateCheckService(
  management: CheckManagement,
  options: UpdateCheckServiceOptions = {},
) {
  const cache = options.cache ?? createUpdateCheckCache();
  const now = options.now ?? Date.now;
  const checks = new Map<string, SourceUpdateCheck>();
  const pending: { source: string; force: boolean }[] = [];
  const queued = new Set<string>();
  const waiters = new Map<string, (() => void)[]>();
  const preempted = new Set<string>();
  let running: { source: string; controller: AbortController; stopRequested: boolean } | undefined;
  let stopped = false;
  let paused = false;
  // A late automatic-start hydration must not undo the user's newer Stop.
  let stopVersion = 0;
  let hydration: Promise<readonly CachedUpdateCheck[]> | undefined;
  let cacheWarning: string | undefined;

  const publish = (check: SourceUpdateCheck) => {
    checks.set(check.source, check);
    options.onChange?.(check);
  };
  const settleWaiters = (source: string) => {
    const waiting = waiters.get(source);
    waiters.delete(source);
    for (const resolve of waiting ?? []) resolve();
  };
  const cancelQueued = () => {
    const queuedSources = [...queued];
    pending.length = 0;
    queued.clear();
    for (const source of queuedSources) {
      const previous = checks.get(source);
      publish({
        ...previous,
        source,
        status: "cancelled",
        error: "Check was stopped",
        stale: previous?.observation !== undefined,
      });
      settleWaiters(source);
    }
  };
  const baseline = async (source: string, signal?: AbortSignal) => {
    if (!management.getUpdateBaseline) return undefined;
    return (await management.getUpdateBaseline({ source }, { signal })).value;
  };
  const persist = async () => {
    if (!management.getUpdateBaseline) return;
    const entries: CachedUpdateCheck[] = [...checks.values()].flatMap((check) =>
      check.observation && check.checkedAt !== undefined && check.observation.baseline !== undefined
        ? [
            {
              source: check.source,
              baseline: check.observation.baseline,
              checkedAt: check.checkedAt,
              observation: check.observation,
            },
          ]
        : [],
    );
    try {
      await cache.write(entries);
    } catch {
      // A live, baseline-validated result remains usable for this session.
      cacheWarning = "Update checks cannot be saved for the next session";
      options.onActivity?.();
    }
  };
  const run = async () => {
    if (running || stopped || paused) return;
    const request = pending.shift();
    if (!request) return;
    queued.delete(request.source);
    const controller = new AbortController();
    const task = { source: request.source, controller, stopRequested: false };
    running = task;
    options.onActivity?.();
    publish({ ...checks.get(request.source), source: request.source, status: "checking" });
    try {
      const result = await management.checkUpdate(
        { source: request.source },
        { signal: controller.signal },
      );
      if (result.value.source !== request.source)
        throw new Error("Observed Source no longer matches the requested Source");
      const after = await baseline(request.source, controller.signal);
      if (
        management.getUpdateBaseline &&
        (result.value.baseline === undefined ||
          after === undefined ||
          result.value.baseline !== after)
      )
        throw new Error("Installed Skills changed while checking; check updates again");
      if (controller.signal.aborted)
        throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
      const observation: CheckedUpdateObservation = result.value;
      publish({
        source: request.source,
        observation,
        checkedAt: now(),
        status: observation.changed.length ? "changed" : "no-changes",
      });
      await persist();
      settleWaiters(request.source);
    } catch (error) {
      const previous = checks.get(request.source);
      const invalidatedByMutation =
        previous?.error === "Installed Skills changed; check updates again";
      const wasPreempted = preempted.delete(request.source);
      if (wasPreempted && !invalidatedByMutation) {
        publish({
          ...previous,
          source: request.source,
          observation: undefined,
          stale: true,
          status: "failed",
          error: "Installed Skills changed; check updates again",
        });
      } else {
        publish({
          source: request.source,
          status: invalidatedByMutation
            ? "failed"
            : cancelled(error) || controller.signal.aborted
              ? "cancelled"
              : "failed",
          error: invalidatedByMutation ? previous.error : message(error),
          checkedAt: previous?.checkedAt,
          observation: previous?.observation,
          stale: previous?.observation !== undefined,
        });
      }
      // A read-only check preempted by a mutation is not a network failure. Keep
      // its single queue position so it is retried after the mutation releases.
      if (
        (paused || wasPreempted) &&
        !task.stopRequested &&
        !stopped &&
        !queued.has(request.source)
      ) {
        queued.add(request.source);
        pending.unshift(request);
      } else settleWaiters(request.source);
    } finally {
      if (running?.controller === controller) running = undefined;
      options.onActivity?.();
      void run();
    }
  };
  const enqueue = (source: string, force = false) => {
    if (stopped) return Promise.resolve();
    const done = new Promise<void>((resolve) => {
      const waiting = waiters.get(source) ?? [];
      waiting.push(resolve);
      waiters.set(source, waiting);
    });
    if (queued.has(source) && force) {
      const index = pending.findIndex((request) => request.source === source);
      if (index > 0) pending.unshift(pending.splice(index, 1)[0]!);
    } else if (!queued.has(source) && running?.source !== source) {
      queued.add(source);
      if (force) pending.unshift({ source, force });
      else pending.push({ source, force });
      void run();
    }
    options.onActivity?.();
    return done;
  };
  const invalidate = (sources?: readonly string[]) => {
    const selected = sources ? new Set(sources) : undefined;
    if (running && (!selected || selected.has(running.source))) running.controller.abort();
    for (const [source, check] of checks)
      if (!selected || selected.has(source))
        publish({
          ...check,
          observation: undefined,
          stale: true,
          status: "failed",
          error: "Installed Skills changed; check updates again",
        });
  };

  return {
    checks: () => [...checks.values()],
    check: (source: string) => checks.get(source),
    checkingActive: () => running !== undefined || pending.length > 0,
    activity: (): UpdateCheckActivity | undefined => {
      if (running)
        return {
          phase: running.stopRequested
            ? "stopping"
            : paused && preempted.has(running.source)
              ? "paused"
              : "checking",
          source: running.source,
        };
      const next = pending[0];
      return next ? { phase: paused ? "paused" : "checking", source: next.source } : undefined;
    },
    currentSource: () => running?.source,
    cacheWarning: () => cacheWarning,
    stop() {
      if (!running && pending.length === 0) return false;
      stopVersion++;
      cancelQueued();
      if (running) {
        running.stopRequested = true;
        running.controller.abort();
      }
      options.onActivity?.();
      return true;
    },
    async start(projection: ManagementProjection) {
      const startingVersion = stopVersion;
      const installedSources = new Set(
        projection.installedSkills.map((skill) => skill.address.source),
      );
      const configuredSources = new Set(projection.effective.sources.map((source) => source.id));
      // Automatic starts share cache hydration before either decides whether
      // remote work is required. Explicit refresh intentionally bypasses it.
      hydration ??= cache.read();
      const entries = await hydration;
      if (stopped || startingVersion !== stopVersion) return;
      for (const entry of entries) {
        // A fake/old Core cannot validate an opaque persisted baseline. Never let a
        // disk observation become submit-capable in that compatibility mode.
        if (!management.getUpdateBaseline) continue;
        if (!installedSources.has(entry.source) || !configuredSources.has(entry.source)) continue;
        // A manual/automatic session result always wins over delayed hydration.
        if (checks.has(entry.source)) continue;
        const current = await baseline(entry.source).catch(() => undefined);
        // Cache IO/baseline reads are deliberately asynchronous. Do not let a
        // manual completion or app teardown during either await publish old disk
        // state or schedule another request.
        if (stopped || startingVersion !== stopVersion) return;
        if (checks.has(entry.source)) continue;
        if (current !== entry.baseline) continue;
        if (!isFreshUpdateCheck(entry, now())) {
          // Preserve previous facts for UI context only; `stale` makes this
          // explicitly non-submittable while the replacement check is queued.
          publish({
            source: entry.source,
            observation: entry.observation,
            checkedAt: entry.checkedAt,
            status: "failed",
            stale: true,
            error: "Previous check expired; checking again",
          });
          continue;
        }
        publish({
          source: entry.source,
          observation: entry.observation,
          checkedAt: entry.checkedAt,
          status: entry.observation.changed.length ? "changed" : "no-changes",
        });
      }
      for (const source of installedSources)
        if (
          !stopped &&
          startingVersion === stopVersion &&
          configuredSources.has(source) &&
          (!checks.get(source)?.observation || checks.get(source)?.stale)
        )
          void enqueue(source);
    },
    refresh(sources: readonly string[]) {
      return Promise.all(sources.map((source) => enqueue(source, true))).then(() => undefined);
    },
    async revalidate(sources: readonly string[]) {
      for (const source of sources) {
        const check = checks.get(source);
        if (!check?.observation || check.stale) continue;
        const current = await baseline(source).catch(() => undefined);
        // Never let a delayed baseline read invalidate a newer check for the
        // same Source (or publish after teardown).
        if (stopped || checks.get(source) !== check) continue;
        if (
          (management.getUpdateBaseline && current !== check.observation.baseline) ||
          (check.checkedAt !== undefined &&
            !isFreshUpdateCheck(
              {
                source,
                baseline: check.observation.baseline ?? "",
                checkedAt: check.checkedAt,
                observation: check.observation,
              },
              now(),
            ))
        ) {
          publish({
            ...check,
            status: "failed",
            stale: true,
            error: "Previous check is no longer current; checking again",
          });
          void enqueue(source);
        }
      }
    },
    invalidate,
    pause(sources?: readonly string[]) {
      paused = true;
      // Generic mutations may affect any installed Source. A targeted update passes
      // its precise source list, preserving unrelated successful observations.
      const selected = sources ? new Set(sources) : undefined;
      if (running && (!selected || selected.has(running.source))) {
        preempted.add(running.source);
        running.controller.abort();
      }
      invalidate(sources);
      options.onActivity?.();
    },
    resume() {
      paused = false;
      options.onActivity?.();
      void run();
    },
    teardown() {
      stopped = true;
      cancelQueued();
      running?.controller.abort();
      options.onActivity?.();
    },
  };
}

export type UpdateCheckService = ReturnType<typeof createUpdateCheckService>;
