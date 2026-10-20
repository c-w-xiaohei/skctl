import { expect, test } from "bun:test";
import { SkctlError, type WorkspaceView, type UpdateObservation } from "@skctl/core";
import { createTuiSession } from "../src/session";
import { createOperationState } from "../src/operation-state";
import {
  directSourceCore,
  testEffects,
  testProjection,
  workspaceProjection,
} from "./direct-source.fixture";
function fixture(sources = ["team-main"], paths = ["first", "second"]) {
  const base = workspaceProjection({ includeContribution: false });
  const snapshot: WorkspaceView = {
    ...base,
    effective: {
      ...base.effective,
      sources: sources.map((id) => ({ ...base.effective.sources[0]!, id })),
    },
    installedSkills: sources.flatMap((source) =>
      paths.map((path) => ({
        address: { source, path },
        name: path,
        description: "Installed Skill",
        owner: { source, health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
  };
  const observation = (source: string): UpdateObservation => ({
    source,
    kind: "github",
    exactRevision: "a".repeat(40),
    baseline: `baseline:${source}`,
    changed: paths.map((path) => ({ path, name: path, description: "Installed Skill" })),
    unchanged: [],
    added: [],
    removed: [],
  });
  return { snapshot, observation };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("quiet updates start with no selection, check missing Sources and submit exact revisions", async () => {
  const { snapshot, observation } = fixture(["team-main", "other"]);
  const order: string[] = [];
  const requests: unknown[] = [];
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
        order.push(`check:${source}`);
        return { value: observation(source), diagnostics: [] };
      },
      updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
        order.push(`update:${request.source}`);
        requests.push(request);
        return { value: undefined, diagnostics: [] };
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  const state = controller.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(state.selected()).toEqual([]);
  expect(await controller.submitUpdates()).toBe(true);
  expect(order).toEqual(["check:team-main", "update:team-main", "check:other", "update:other"]);
  expect(requests).toEqual(
    ["team-main", "other"].map((source) => ({
      source,
      paths: ["first", "second"],
      exactRevision: "a".repeat(40),
      expectedBaseline: `baseline:${source}`,
    })),
  );
  expect(controller.updateRun()?.results.map((result) => result.status)).toEqual([
    "updated",
    "updated",
    "updated",
    "updated",
  ]);
});
test("single-item update neither requires selection nor consumes a different selected item", async () => {
  const { snapshot, observation } = fixture();
  const calls: unknown[] = [];
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
      updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
        calls.push(request);
        return { value: undefined, diagnostics: [] };
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  const state = controller.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  state.toggle({ source: "team-main", path: "second" });
  await controller.submitUpdates([{ source: "team-main", path: "first" }]);
  expect(calls).toEqual([
    {
      source: "team-main",
      paths: ["first"],
      exactRevision: "a".repeat(40),
      expectedBaseline: "baseline:team-main",
    },
  ]);
  expect(state.selected()).toEqual([{ source: "team-main", path: "second" }]);
  expect(controller.updateRun()?.results).toHaveLength(1);
});
test("a failed Source does not block others, and partial completion is not returned as success", async () => {
  const { snapshot, observation } = fixture(["broken", "healthy"]);
  const calls: string[] = [];
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
        if (source === "broken") throw new Error("Cannot reach Source");
        return { value: observation(source), diagnostics: [] };
      },
      updateSkills: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
        calls.push(source);
        return { value: undefined, diagnostics: [] };
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  controller.selectUpdatesScope({ kind: "workspace" }, snapshot);
  expect(await controller.submitUpdates()).toBe(false);
  expect(calls).toEqual(["healthy"]);
  expect(controller.updateRun()?.results.map((result) => result.status)).toEqual([
    "failed",
    "failed",
    "updated",
    "updated",
  ]);
});
test("unrelated current selection cannot retarget a request while its check awaits", async () => {
  const { snapshot, observation } = fixture();
  const pending = deferred<{
    value: UpdateObservation;
    diagnostics: [];
  }>();
  const calls: unknown[] = [];
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: () => pending.promise,
      updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
        calls.push(request);
        return { value: undefined, diagnostics: [] };
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  const state = controller.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  const request = controller.submitUpdates([{ source: "team-main", path: "first" }]);
  state.toggle({ source: "team-main", path: "second" });
  pending.resolve({ value: observation("team-main"), diagnostics: [] });
  await request;
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ paths: ["first"] });
  expect(state.selected()).toEqual([{ source: "team-main", path: "second" }]);
});
test("Stop during checking prevents mutation and keeps not-run targets for explicit continuation", async () => {
  const { snapshot, observation } = fixture();
  const pending = deferred<{
    value: UpdateObservation;
    diagnostics: [];
  }>();
  let calls = 0;
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: () => pending.promise,
      updateSkills: async () => {
        calls++;
        return { value: undefined, diagnostics: [] };
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  controller.selectUpdatesScope({ kind: "workspace" }, snapshot);
  const request = controller.submitUpdates();
  controller.stopUpdates();
  pending.resolve({ value: observation("team-main"), diagnostics: [] });
  expect(await request).toBe(false);
  expect(calls).toBe(0);
  expect(controller.updatesRetryable()).toEqual(
    snapshot.installedSkills.map((skill) => skill.address),
  );
});
test.each(["fulfilled", "rejected"] as const)(
  "Stop after %s mutation skips later Sources without inventing rollback",
  async (outcome) => {
    const { snapshot, observation } = fixture(["first-source", "second-source"], ["guide"]);
    const pending = deferred<{
      value: undefined;
      diagnostics: [];
    }>();
    const started = deferred<void>();
    const calls: string[] = [];
    const controller = createTuiSession(
      directSourceCore(snapshot, {
        getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
        checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
          value: observation(source),
          diagnostics: [],
        }),
        updateSkills: (_environment: import("@skctl/core").CoreOptions, { source }) => {
          calls.push(source);
          started.resolve();
          return pending.promise;
        },
      }),
      createOperationState(),
      testProjection().projection.outcomes,
    );
    const state = controller.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
    const request = controller.submitUpdates();
    await started.promise;
    controller.stopUpdates();
    if (outcome === "fulfilled") pending.resolve({ value: undefined, diagnostics: [] });
    else pending.reject(new SkctlError("CANCELLED", "cancelled"));
    expect(await request).toBe(false);
    expect(calls).toEqual(["first-source"]);
    expect(controller.updateRun()?.results.map((result) => result.status)).toEqual([
      outcome === "fulfilled" ? "updated" : "unknown",
      "not-run",
    ]);
    expect(state.group("first-source")?.status).toBe(
      outcome === "fulfilled" ? "succeeded" : "cancelled",
    );
    expect(state.group("first-source")?.committed).toBe(outcome === "fulfilled" ? true : undefined);
    expect(controller.updatesRetryable()).toEqual([{ source: "second-source", path: "guide" }]);
  },
);
test("a fulfilled Source stays committed when the next mutation is unknown and neither is retried", async () => {
  const { snapshot, observation } = fixture(["first-source", "second-source"], ["guide"]);
  const calls: string[] = [];
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
        value: observation(source),
        diagnostics: [],
      }),
      updateSkills: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
        calls.push(source);
        if (source === "first-source") return { value: undefined, diagnostics: [] };
        throw new Error("Publication outcome unknown");
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  const state = controller.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(await controller.submitUpdates()).toBe(false);
  expect(controller.updateRun()?.results.map((result) => result.status)).toEqual([
    "updated",
    "unknown",
  ]);
  expect(state.group("first-source")).toMatchObject({ status: "succeeded", committed: true });
  expect(state.group("second-source")?.status).toBe("partial");
  expect(state.group("second-source")?.committed).toBeUndefined();
  expect(controller.updatesRetryable()).toEqual([]);
  expect(await controller.submitUpdates(controller.updatesRetryable())).toBe(false);
  expect(calls).toEqual(["first-source", "second-source"]);
});
test("Effects retain a committed refresh-failure receipt across restoring a drifted Source draft", async () => {
  const { snapshot, observation } = fixture();
  const drifted = {
    ...snapshot,
    installedSkills: snapshot.installedSkills.map((skill) => ({
      ...skill,
      owner: { ...skill.owner, relevantRemoteRevision: "e".repeat(40) },
    })),
  };
  let reads = 0;
  let checks = 0;
  let updates = 0;
  const effects = testEffects(
    directSourceCore(snapshot, {
      getWorkspace: async () => {
        if (++reads === 3) throw new Error("refresh unavailable");
        return { value: snapshot, diagnostics: [] };
      },
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
        checks++;
        return { value: observation(source), diagnostics: [] };
      },
      updateSkills: async () => {
        expect(reads).toBe(2);
        updates++;
        return { value: undefined, diagnostics: [] };
      },
    }),
  );
  try {
    const state = effects.selectUpdatesScope({ kind: "source", source: "team-main" }, snapshot)!;
    await effects.checkUpdates();
    for (const skill of snapshot.installedSkills) state.toggle(skill.address);
    expect(state.selected()).toEqual(snapshot.installedSkills.map((skill) => skill.address));
    expect(await effects.submitUpdates()).toBe(true);
    expect(reads).toBe(3);
    expect(updates).toBe(1);
    expect(state.group("team-main")).toMatchObject({ status: "succeeded", committed: true });
    expect(state.group("team-main")?.committedMessage).toContain(
      "could not refresh workspace: refresh unavailable",
    );
    expect(effects.updateRun()?.results.map((result) => result.status)).toEqual([
      "updated",
      "updated",
    ]);
    const receipt = state.group("team-main")?.committedMessage;
    const checksAfterSubmit = checks;
    effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
    const restored = effects.restoreUpdatesScope(state, drifted)!;
    expect(restored).toBe(state);
    // A later local fact drift cannot erase a committed receipt.
    expect(restored.group("team-main")).toMatchObject({
      status: "succeeded",
      stale: true,
      committed: true,
    });
    expect(restored.group("team-main")?.committedMessage).toBe(receipt);
    expect(restored.selected()).toEqual([]);
    expect(effects.updatesSubmittable()).toEqual([]);
    expect(effects.updatesRetryable()).toEqual([]);
    expect(await effects.continueUpdates()).toBe(false);
    expect(checks).toBe(checksAfterSubmit);
    expect(reads).toBe(3);
    expect(updates).toBe(1);
  } finally {
    effects.teardown();
  }
});
test("Core's explicit pre-publication rejection is failed, not unknown; the atomic batch stays installed", async () => {
  const { snapshot, observation } = fixture();
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
      updateSkills: async () => {
        throw new SkctlError(
          "INVALID_ARGUMENT",
          "Invalid SKILL.md at second/SKILL.md: description must be a non-empty string",
          [
            {
              code: "UPDATE_NOT_APPLIED",
              severity: "warning",
              message: "Validation rejected this batch before publication",
              subject: {
                kind: "installed-skill",
                address: { source: "team-main", path: "second" },
              },
              suggestion: "Fix this Source file, then recheck updates.",
            },
          ],
        );
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  const state = controller.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  snapshot.installedSkills.forEach((skill) => state.toggle(skill.address));
  expect(await controller.submitUpdates()).toBe(false);
  expect(controller.updateRun()?.results.map((result) => result.status)).toEqual([
    "failed",
    "failed",
  ]);
  expect(controller.updateRun()?.results[0]?.message).toContain("second/SKILL.md");
  expect(controller.updateRun()?.results[0]?.message).toContain("installed Skills kept");
  expect(controller.updateRun()?.results[0]?.message).toContain("recheck");
  expect(state.selected()).toEqual(snapshot.installedSkills.map((skill) => skill.address));
  expect(controller.updatesRetryable()).toEqual([]);
});
test("an INVALID_ARGUMENT code without Core's no-publication evidence remains unknown", async () => {
  const { snapshot, observation } = fixture();
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
      checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
      updateSkills: async () => {
        throw new SkctlError("INVALID_ARGUMENT", "Unspecified rejected mutation");
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  controller.selectUpdatesScope({ kind: "workspace" }, snapshot);
  expect(await controller.submitUpdates()).toBe(false);
  expect(controller.updateRun()?.results.every((result) => result.status === "unknown")).toBe(true);
  expect(controller.updatesRetryable()).toEqual([]);
});
test("requests outside a bounded Skill scope and ownership drift are rejected before mutation", async () => {
  const { snapshot, observation } = fixture();
  const address = snapshot.installedSkills[0]!.address;
  let calls = 0;
  const controller = createTuiSession(
    directSourceCore(snapshot, {
      getWorkspace: async () => ({
        value: {
          ...snapshot,
          installedSkills: snapshot.installedSkills.map((skill) => ({
            ...skill,
            owner: { ...skill.owner, health: "drifted" as const },
          })),
        },
        diagnostics: [],
      }),
      checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
      updateSkills: async () => {
        calls++;
        return { value: undefined, diagnostics: [] };
      },
    }),
    createOperationState(),
    testProjection().projection.outcomes,
  );
  controller.selectUpdatesScope({ kind: "skill", address }, snapshot);
  expect(await controller.submitUpdates([snapshot.installedSkills[1]!.address])).toBe(false);
  expect(await controller.submitUpdates([address])).toBe(false);
  expect(calls).toBe(0);
});
test("Effects reuse a fresh baseline-valid check without a Review owner", async () => {
  const { snapshot, observation } = fixture();
  let checks = 0;
  const requests: unknown[] = [];
  const core = directSourceCore(snapshot, {
    checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
      checks++;
      return { value: observation(source), diagnostics: [] };
    },
    updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
      requests.push(request);
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = testEffects({
    ...core,
    getUpdateBaseline: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
      value: `baseline:${source}`,
      diagnostics: [],
    }),
  });
  try {
    effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
    await effects.checkUpdates();
    const before = checks;
    expect(await effects.submitUpdates()).toBe(true);
    expect(checks).toBe(before);
    expect(requests).toHaveLength(1);
    expect(effects.updateRun()?.results.every((result) => result.status === "updated")).toBe(true);
  } finally {
    effects.teardown();
  }
});
test.each(["fulfilled", "rejected"] as const)(
  "the %s process task retains its origin and Stop target after switching the displayed draft",
  async (outcome) => {
    const { snapshot, observation } = fixture(["first-source", "other-source"], ["guide"]);
    const started = deferred<void>();
    const pending = deferred<{
      value: undefined;
      diagnostics: [];
    }>();
    let signal: AbortSignal | undefined;
    const calls: string[] = [];
    const effects = testEffects(
      directSourceCore(snapshot, {
        checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
          value: observation(source),
          diagnostics: [],
        }),
        updateSkills: (_environment: import("@skctl/core").CoreOptions, request, options) => {
          calls.push(request.source);
          signal = options?.signal;
          started.resolve();
          return pending.promise;
        },
      }),
    );
    try {
      const origin = effects.selectUpdatesScope(
        { kind: "source", source: "first-source" },
        snapshot,
      )!;
      origin.toggle({ source: "first-source", path: "guide" });
      const request = effects.submitUpdates();
      await started.promise;
      const firstRun = effects.updateRun();
      const displayed = effects.selectUpdatesScope(
        { kind: "source", source: "other-source" },
        snapshot,
      )!;
      displayed.toggle({ source: "other-source", path: "guide" });
      expect(displayed.selected()).toEqual([{ source: "other-source", path: "guide" }]);
      expect(effects.selectUpdatesScope(origin.scope.entry, snapshot)).toBe(origin);
      expect(effects.updateTaskEntry()).toEqual({ kind: "source", source: "first-source" });
      expect(effects.updateRun()).toBe(firstRun);
      expect(effects.updatesActive()).toBe(true);
      expect(signal?.aborted).toBe(false);
      expect(effects.selectUpdatesScope(displayed.scope.entry, snapshot)).toBe(displayed);
      const displayedGroups = displayed.groups();
      const displayedSelection = displayed.selected();
      expect(displayedSelection).toEqual([{ source: "other-source", path: "guide" }]);
      expect(effects.updateTaskEntry()).toEqual({ kind: "source", source: "first-source" });
      expect(effects.updateRun() === firstRun).toBe(true);
      expect(effects.updatesActive()).toBe(true);
      expect(signal?.aborted).toBe(false);
      // Closing an unrelated view/overlay does not own this process task.
      effects.cancel();
      expect(signal?.aborted).toBe(false);
      expect(await effects.submitUpdates()).toBe(false);
      expect(effects.stopUpdates()).toBe(true);
      expect(effects.updateRun()?.phase).toBe("stopping");
      expect(signal?.aborted).toBe(true);
      if (outcome === "fulfilled") pending.resolve({ value: undefined, diagnostics: [] });
      else pending.reject(new SkctlError("CANCELLED", "cancelled"));
      expect(await request).toBe(false);
      expect(effects.updatesActive()).toBe(false);
      expect(effects.updateRun()?.results.map((result) => result.status)).toEqual([
        outcome === "fulfilled" ? "updated" : "unknown",
      ]);
      expect(origin.group("first-source")?.status).toBe(
        outcome === "fulfilled" ? "succeeded" : "cancelled",
      );
      expect(origin.group("first-source")?.committed).toBe(
        outcome === "fulfilled" ? true : undefined,
      );
      expect(origin.selected()).toEqual(
        outcome === "fulfilled" ? [] : [{ source: "first-source", path: "guide" }],
      );
      expect(effects.updatesRetryable()).toEqual([]);
      expect(effects.updates()?.scope.entry).toEqual({ kind: "source", source: "other-source" });
      expect(effects.updates()).toBe(displayed);
      expect(displayed.groups()).toBe(displayedGroups);
      expect(displayed.selected()).toBe(displayedSelection);
      expect(calls).toEqual(["first-source"]);
    } finally {
      pending.resolve({ value: undefined, diagnostics: [] });
      effects.teardown();
    }
  },
);
test("explicit continuation uses the task's not-run targets, not the currently displayed scope", async () => {
  const { snapshot, observation } = fixture(["first-source", "second-source"], ["guide"]);
  const started = deferred<void>();
  const pending = deferred<{
    value: undefined;
    diagnostics: [];
  }>();
  const calls: string[] = [];
  const effects = testEffects(
    directSourceCore(snapshot, {
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
        value: observation(source),
        diagnostics: [],
      }),
      updateSkills: (_environment: import("@skctl/core").CoreOptions, { source }) => {
        calls.push(source);
        if (source === "first-source") {
          started.resolve();
          return pending.promise;
        }
        return Promise.resolve({ value: undefined, diagnostics: [] });
      },
    }),
  );
  try {
    effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
    const first = effects.submitUpdates();
    await started.promise;
    effects.stopUpdates();
    pending.resolve({ value: undefined, diagnostics: [] });
    await first;
    effects.selectUpdatesScope({ kind: "source", source: "first-source" }, snapshot);
    expect(effects.updatesRetryable()).toEqual([{ source: "second-source", path: "guide" }]);
    expect(await effects.continueUpdates()).toBe(true);
    expect(calls).toEqual(["first-source", "second-source"]);
    expect(effects.updateTaskEntry()).toEqual({ kind: "workspace" });
    expect(effects.updateRun()?.addresses).toEqual([{ source: "second-source", path: "guide" }]);
    expect(effects.updates()?.scope.entry).toEqual({ kind: "source", source: "first-source" });
  } finally {
    pending.resolve({ value: undefined, diagnostics: [] });
    effects.teardown();
  }
});
test("App teardown aborts the process task and ignores a late fulfilled provider", async () => {
  const { snapshot, observation } = fixture();
  const started = deferred<void>();
  const pending = deferred<{
    value: undefined;
    diagnostics: [];
  }>();
  let signal: AbortSignal | undefined;
  let reads = 0;
  const effects = testEffects(
    directSourceCore(snapshot, {
      getWorkspace: async () => {
        reads++;
        return { value: snapshot, diagnostics: [] };
      },
      checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
        value: observation(source),
        diagnostics: [],
      }),
      updateSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) => {
        signal = options?.signal;
        started.resolve();
        return pending.promise;
      },
    }),
  );
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  const request = effects.submitUpdates();
  await started.promise;
  const before = effects.updateRun();
  effects.teardown();
  expect(signal?.aborted).toBe(true);
  pending.resolve({ value: undefined, diagnostics: [] });
  expect(await request).toBe(false);
  expect(effects.updateRun() === before).toBe(true);
  expect(reads).toBe(2);
  effects.teardown();
});
test("stopping read-only checks during an update does not cancel the mutation or restart the checks", async () => {
  const { snapshot, observation } = fixture(["first-source", "second-source"], ["guide"]);
  const checking = deferred<{
    value: UpdateObservation;
    diagnostics: [];
  }>();
  const updating = deferred<{
    value: undefined;
    diagnostics: [];
  }>();
  const started = deferred<void>();
  const checks: string[] = [];
  let updateSignal: AbortSignal | undefined;
  const effects = testEffects(
    directSourceCore(snapshot, {
      checkUpdate: (_environment: import("@skctl/core").CoreOptions, { source }) => {
        checks.push(source);
        return checks.length === 1
          ? checking.promise
          : Promise.resolve({ value: observation(source), diagnostics: [] });
      },
      updateSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) => {
        updateSignal = options?.signal;
        started.resolve();
        return updating.promise;
      },
    }),
  );
  try {
    effects.selectUpdatesScope({ kind: "source", source: "first-source" }, snapshot);
    await effects.startUpdateChecks(snapshot);
    const request = effects.submitUpdates();
    await started.promise;
    expect(effects.stopUpdateChecks()).toBe(true);
    expect(updateSignal?.aborted).toBe(false);
    checking.resolve({ value: observation("first-source"), diagnostics: [] });
    updating.resolve({ value: undefined, diagnostics: [] });
    expect(await request).toBe(true);
    expect(effects.updateRun()?.results.map((result) => result.status)).toEqual(["updated"]);
    expect(checks).toEqual(["first-source", "first-source"]);
    expect(effects.checkingActive()).toBe(false);
  } finally {
    checking.resolve({ value: observation("first-source"), diagnostics: [] });
    updating.resolve({ value: undefined, diagnostics: [] });
    effects.teardown();
  }
});
