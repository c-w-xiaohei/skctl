import {
  SkillCliError,
  type ManagementCapability,
  type ManagementProjection,
  type WorkspaceCapability,
} from "@skill-cli/core";
import { buildUpdateScope, updateSubmission } from "./model";
import { createSignal } from "solid-js";
import type { UpdatesState, UpdateRun, UpdateIssue } from "./state";
import type { UpdateAddress } from "./scope";
import type { CheckedUpdateObservation } from "./check-service";

export interface UpdateForegroundLane {
  request(owner: "updates"): (() => void) | undefined;
}
export interface UpdateCore {
  readonly workspace: Pick<WorkspaceCapability, "get">;
  readonly management: Pick<ManagementCapability, "checkUpdate" | "update">;
}
export interface UpdateControllerOptions {
  readonly foreground?: UpdateForegroundLane;
  readonly onProjection?: (projection: ManagementProjection) => void;
  readonly onSubmissionStarted?: (addresses: readonly UpdateAddress[]) => void;
  /** The session validates freshness/baseline; a missing result triggers a fresh check. */
  readonly observation?: (
    source: string,
    signal: AbortSignal,
  ) => Promise<CheckedUpdateObservation | undefined>;
}
const key = (address: UpdateAddress) => `${address.source}\u0000${address.path}`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const cancelled = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "CANCELLED";

/** One bounded request owns check, exact-revision submission, Stop and its receipts. */
export function createUpdateController(
  core: UpdateCore,
  state: UpdatesState,
  options: UpdateControllerOptions = {},
) {
  // The executing task owns its run. Browsing drafts never own or replace it.
  const [run, setRun] = createSignal<UpdateRun>();
  let closed = false;
  let active: { abort: AbortController; release?: () => void } | undefined;
  const begin = () => {
    if (closed || active) return undefined;
    const release = options.foreground?.request("updates");
    if (options.foreground && !release) return undefined;
    active = { abort: new AbortController(), release };
    return active;
  };
  const patchRun = (patch: Partial<UpdateRun>) =>
    setRun((current) => (current ? { ...current, ...patch } : current));
  const record = (
    addresses: readonly UpdateAddress[],
    status: UpdateRun["results"][number]["status"],
    detail?: string,
    issue?: UpdateIssue,
  ) => {
    const targets = new Set(addresses.map(key));
    setRun((current) =>
      current
        ? {
            ...current,
            results: current.results.map((result) =>
              targets.has(key(result.address))
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
  const stop = () => {
    if (!active) return false;
    patchRun({ phase: "stopping" });
    active.abort.abort();
    return true;
  };
  return {
    run,
    active: () => active !== undefined,
    stop,
    teardown() {
      closed = true;
      active?.abort.abort();
      active?.release?.();
      active = undefined;
    },
    submittable: () => state.eligible(),
    retryable: () =>
      run()
        ?.results.filter((result) => result.status === "not-run")
        .map((result) => result.address) ?? [],
    async check() {
      const task = begin();
      if (!task) return false;
      try {
        for (const source of state.scope.sources) {
          if (closed || task.abort.signal.aborted) return false;
          state.setStatus(source, "checking");
          try {
            const result = await core.management.checkUpdate(
              { source },
              { signal: task.abort.signal },
            );
            if (closed || task.abort.signal.aborted) return false;
            state.observe(result.value, Date.now());
          } catch (error) {
            if (closed) return false;
            state.invalidateCheck(
              source,
              task.abort.signal.aborted ? "cancelled" : "failed",
              message(error),
            );
          }
        }
        return !task.abort.signal.aborted;
      } finally {
        if (active === task) {
          active = undefined;
          task.release?.();
        }
      }
    },
    async submit(requested?: readonly UpdateAddress[]) {
      const addresses = [
        ...(requested ?? (state.selected().length ? state.selected() : state.scope.addresses)),
      ].map((address) => Object.freeze({ ...address }));
      const keys = new Set(addresses.map(key));
      const scope = state.scopeSnapshot();
      if (
        !addresses.length ||
        keys.size !== addresses.length ||
        scope.unavailableReason ||
        addresses.some(
          (address) => !scope.addresses.some((candidate) => key(candidate) === key(address)),
        )
      )
        return false;
      const task = begin();
      if (!task) return false;
      const signal = task.abort.signal;
      setRun({
        addresses: Object.freeze(addresses),
        phase: "checking",
        results: addresses.map((address) => ({ address, status: "not-run" as const })),
      });
      options.onSubmissionStarted?.(addresses);
      try {
        for (const source of new Set(addresses.map((address) => address.source))) {
          if (closed || signal.aborted) break;
          const targets = addresses.filter((address) => address.source === source);
          patchRun({ phase: "checking", source });
          let observation: CheckedUpdateObservation;
          let guardIssue: UpdateIssue | undefined;
          try {
            const projection = (await core.workspace.get({ signal })).value;
            if (closed || signal.aborted) break;
            const allowed = updateSubmission(scope, targets, projection);
            if ("reason" in allowed) {
              guardIssue = allowed.issue ?? { kind: "scope" };
              if (guardIssue.kind === "ownership") options.onProjection?.(projection);
              throw new Error(allowed.reason);
            }
            const cached = await options.observation?.(source, signal);
            if (closed || signal.aborted) break;
            if (!cached) state.setStatus(source, "checking");
            observation =
              cached ?? (await core.management.checkUpdate({ source }, { signal })).value;
            if (closed || signal.aborted) break;
            if (observation.source !== source) throw new Error("Check returned a different Source");
            state.observe(observation, Date.now());
            const fresh = (await core.workspace.get({ signal })).value;
            if (closed || signal.aborted) break;
            const checked = updateSubmission(scope, targets, fresh);
            if ("reason" in checked) {
              guardIssue = checked.issue ?? { kind: "scope" };
              if (guardIssue.kind === "ownership") options.onProjection?.(fresh);
              throw new Error(checked.reason);
            }
            state.rebaseCheckedScope(buildUpdateScope(fresh, scope.entry), source);
          } catch (error) {
            if (closed || signal.aborted || cancelled(error)) break;
            state.invalidateCheck(source, "failed", message(error));
            record(targets, "failed", message(error), guardIssue);
            continue;
          }
          const changed = new Set(observation.changed.map((candidate) => candidate.path));
          const removed = new Set(observation.removed.map((candidate) => candidate.path));
          const unchanged = new Set(observation.unchanged.map((candidate) => candidate.path));
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
          if (observation.kind !== "local" && !observation.exactRevision) {
            record(paths, "failed", "Remote check lacks an exact revision");
            continue;
          }
          patchRun({ phase: "updating", source });
          state.setStatus(source, "updating");
          try {
            await core.management.update(
              {
                source,
                paths: paths.map((address) => address.path),
                ...(observation.kind === "local"
                  ? {}
                  : { exactRevision: observation.exactRevision }),
                ...(observation.baseline !== undefined
                  ? { expectedBaseline: observation.baseline }
                  : {}),
              },
              { signal },
            );
            if (closed) return false;
            // A fulfilled call committed even when Stop arrived at the same instant.
            record(paths, "updated");
            state.setResult(source, "succeeded");
            if (signal.aborted) break;
            try {
              const projection = (await core.workspace.get({ signal })).value;
              if (closed) return false;
              state.reconcileCurrentScope(buildUpdateScope(projection, scope.entry));
              options.onProjection?.(projection);
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
              error instanceof SkillCliError &&
              error.diagnostics.find((diagnostic) => {
                const subject = diagnostic.subject;
                return (
                  diagnostic.code === "UPDATE_NOT_APPLIED" &&
                  subject?.kind === "installed-skill" &&
                  paths.some(
                    (address) =>
                      address.source === subject.address.source &&
                      address.path === subject.address.path,
                  )
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
          state.completeSelection(
            run()
              ?.results.filter(
                (result) => result.status === "updated" || result.status === "unchanged",
              )
              .map((result) => result.address) ?? [],
          );
          patchRun({ phase: "settled" });
        }
        if (active === task) {
          active = undefined;
          task.release?.();
        }
      }
    },
  };
}
export type UpdateController = ReturnType<typeof createUpdateController>;
