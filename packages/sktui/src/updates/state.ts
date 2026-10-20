import { createSignal } from "solid-js";
import type { UpdateAddress, UpdateScope } from "./scope";
import type { UpdateObservation } from "@skctl/core";

export type UpdateGroupStatus =
  | "not-checked"
  | "checking"
  | "failed"
  | "no-changes"
  | "changed"
  | "updating"
  | "partial"
  | "succeeded"
  | "cancelled"
  | "not-run";
export interface SourceUpdateCheck {
  readonly source: string;
  readonly status: "not-checked" | "checking" | "failed" | "changed" | "no-changes" | "cancelled";
  readonly checkedAt?: number;
  readonly observation?: UpdateObservation;
  readonly error?: string;
  readonly stale?: boolean;
}
export interface UpdateGroup {
  readonly source: string;
  readonly observation?: UpdateObservation;
  readonly checkedAt?: number;
  readonly stale?: boolean;
  readonly status: UpdateGroupStatus;
  readonly expanded: boolean;
  readonly error?: string;
  readonly failure?: "check" | "update";
  /** A fulfilled Core update batch; survives later check attempts. */
  readonly committed?: true;
  /** Detail belonging to the fulfilled batch, independent of later check errors. */
  readonly committedMessage?: string;
}
export interface UpdateRun {
  readonly addresses: readonly UpdateAddress[];
  readonly phase: "checking" | "updating" | "stopping" | "settled";
  readonly source?: string;
  readonly results: readonly {
    readonly address: UpdateAddress;
    readonly status: "updated" | "unchanged" | "failed" | "unknown" | "not-run";
    readonly message?: string;
    readonly issue?: UpdateIssue;
  }[];
}
/** Display cause captured where it is known; never inferred from error prose. */
export interface UpdateIssue {
  readonly kind: "ownership" | "scope" | "metadata" | "removed";
  readonly address?: UpdateAddress;
}
const key = (address: UpdateAddress) => `${address.source}\u0000${address.path}`;

export function createUpdatesState(scope: UpdateScope) {
  const [scopeSnapshot, setScopeSnapshot] = createSignal(scope);
  const [groups, setGroups] = createSignal<readonly UpdateGroup[]>(
    scope.sources.map((source) => ({ source, status: "not-checked", expanded: false })),
  );
  const [selected, setSelected] = createSignal<readonly UpdateAddress[]>([]);
  const [focusedRowKey, setFocusedRowKey] = createSignal(
    scope.sources[0] ? `group:${scope.sources[0]}` : undefined,
  );
  const [browserScroll, setBrowserScroll] = createSignal(0);
  const [sourcePositions, setSourcePositions] = createSignal<
    Readonly<
      Record<
        string,
        {
          readonly currentKey?: string;
          readonly scrollTop: number;
        }
      >
    >
  >({});
  const [checkedScope, setCheckedScope] = createSignal(scope);
  const [query, setQuery] = createSignal("");
  const [showAll, setShowAll] = createSignal(false);
  const group = (source: string) => groups().find((item) => item.source === source);
  const scopedChanged = (item: UpdateGroup) =>
    item.observation?.changed.filter((candidate) =>
      scopeSnapshot().addresses.some(
        (address) => address.source === item.source && address.path === candidate.path,
      ),
    ) ?? [];
  const eligible = () =>
    groups().flatMap((item) =>
      (item.status === "changed" || item.status === "not-run") && !item.stale
        ? scopedChanged(item).map((candidate) => ({ source: item.source, path: candidate.path }))
        : [],
    );
  const replace = (source: string, update: (item: UpdateGroup) => UpdateGroup) =>
    setGroups((items) => items.map((item) => (item.source === source ? update(item) : item)));
  const invalidateCheck = (
    source: string,
    status: Extract<UpdateGroupStatus, "failed" | "cancelled">,
    error?: string,
  ) => {
    replace(source, (item) => ({
      ...item,
      observation: undefined,
      status,
      error,
      failure: "check",
    }));
  };
  return {
    get scope() {
      return scopeSnapshot();
    },
    scopeSnapshot,
    checkedScope,
    query,
    setQuery,
    showAll,
    setShowAll,
    groups,
    selected,
    focusedRowKey,
    setFocusedRowKey,
    browserScroll,
    setBrowserScroll,
    sourcePosition: (source: string) => sourcePositions()[source],
    setSourcePosition(
      source: string,
      position: { readonly currentKey?: string; readonly scrollTop: number },
    ) {
      setSourcePositions((current) => ({ ...current, [source]: position }));
    },
    group,
    scopedChanged,
    eligible,
    observe(observation: UpdateObservation, checkedAt?: number, stale = false) {
      replace(observation.source, (item) => ({
        ...item,
        observation,
        checkedAt,
        stale,
        status: scopedChanged({ ...item, observation }).length ? "changed" : "no-changes",
        error: undefined,
        failure: undefined,
      }));
    },
    /** A check never changes selection; stale/failed observations cannot authorize submit. */
    applyCheck(check: SourceUpdateCheck) {
      if (
        check.observation &&
        !check.stale &&
        (check.status === "changed" || check.status === "no-changes")
      )
        this.observe(check.observation, check.checkedAt);
      else if (check.status === "checking") this.setStatus(check.source, "checking");
      else if (check.status === "failed" || check.status === "cancelled") {
        replace(check.source, (item) => ({
          ...item,
          observation: check.observation ?? item.observation,
          checkedAt: check.checkedAt ?? item.checkedAt,
          stale: item.committed ? (check.stale ?? item.stale) : true,
          status: check.status,
          error: check.error,
          failure: "check",
        }));
      }
    },
    /** A failed/cancelled check makes its former observation unsafe to submit. */
    invalidateCheck,
    /** Refreshes public guard facts for one checked Source without changing this draft's scope. */
    rebaseCheckedScope(fresh: UpdateScope, source: string) {
      const currentAddresses = new Set(scopeSnapshot().addresses.map(key));
      setCheckedScope((current) => ({
        ...current,
        observed: [
          ...current.observed.filter((skill) => skill.address.source !== source),
          ...fresh.observed.filter(
            (skill) => skill.address.source === source && currentAddresses.has(key(skill.address)),
          ),
        ],
      }));
    },
    /** Update display membership only; checkedScope remains the immutable submit guard. */
    reconcileCurrentScope(fresh: UpdateScope) {
      const allowed = new Set(fresh.addresses.map(key));
      setScopeSnapshot(fresh);
      setGroups((current) => {
        const previous = new Map(current.map((item) => [item.source, item]));
        return fresh.sources.map(
          (source) => previous.get(source) ?? { source, status: "not-checked", expanded: false },
        );
      });
      setSelected((current) => current.filter((address) => allowed.has(key(address))));
    },
    /**
     * Restore this bounded session draft only when its checked public facts still
     * describe the same immutable addresses. Drift invalidates the affected
     * source instead of selecting a new candidate or widening this scope.
     */
    reconcileRestoredScope(fresh: UpdateScope) {
      const original = new Set(scopeSnapshot().addresses.map(key));
      const invalidated: string[] = [];
      for (const source of scopeSnapshot().sources) {
        // A fulfilled Core batch is a known committed Source result. A later
        // public-fact drift cannot turn it into a failed/retryable observation.
        if (group(source)?.committed) continue;
        const before = checkedScope().observed.filter((skill) => skill.address.source === source);
        if (before.length === 0) continue;
        const after = fresh.observed.filter(
          (skill) => skill.address.source === source && original.has(key(skill.address)),
        );
        const matches =
          before.length === after.length &&
          before.every((previous) => {
            const current = after.find((skill) => key(skill.address) === key(previous.address));
            return (
              current &&
              current.owner.source === previous.owner.source &&
              current.owner.health === previous.owner.health &&
              current.owner.relevantRemoteRevision === previous.owner.relevantRemoteRevision &&
              current.binding === previous.binding
            );
          });
        if (!matches) {
          invalidated.push(source);
          invalidateCheck(source, "failed", "Update scope changed; check updates again");
        }
      }
      return invalidated;
    },
    setStatus(
      source: string,
      status: UpdateGroupStatus,
      error?: string,
      failure?: "check" | "update",
    ) {
      replace(source, (item) => ({
        ...item,
        status,
        error,
        failure,
        ...(status === "succeeded" && error ? { committedMessage: error } : {}),
      }));
    },
    setResult(
      source: string,
      status: Extract<UpdateGroupStatus, "succeeded" | "failed" | "cancelled" | "not-run">,
    ) {
      replace(source, (item) => ({
        ...item,
        status,
        ...(status === "succeeded" ? { committed: true as const, stale: true } : {}),
      }));
    },
    /** Records a fulfilled Core batch without rewriting a later check/result status. */
    markCommitted(source: string, committedMessage?: string) {
      replace(source, (item) => ({
        ...item,
        committed: true,
        ...(committedMessage
          ? { committedMessage }
          : item.status === "succeeded" && item.error
            ? { committedMessage: item.error }
            : {}),
      }));
      setSelected((current) => current.filter((address) => address.source !== source));
    },
    toggle(address: UpdateAddress) {
      if (
        !scopeSnapshot().observed.some(
          (item) => key(item.address) === key(address) && item.owner.health === "healthy",
        )
      )
        return;
      setSelected((current) =>
        current.some((item) => key(item) === key(address))
          ? current.filter((item) => key(item) !== key(address))
          : [...current, address],
      );
    },
    clearSelection() {
      setSelected([]);
    },
    completeSelection(addresses: readonly UpdateAddress[]) {
      const completed = new Set(addresses.map(key));
      setSelected((current) => current.filter((address) => !completed.has(key(address))));
    },
    toggleExpanded(source: string) {
      replace(source, (item) => ({ ...item, expanded: !item.expanded }));
    },
  };
}
export type UpdatesState = ReturnType<typeof createUpdatesState>;
