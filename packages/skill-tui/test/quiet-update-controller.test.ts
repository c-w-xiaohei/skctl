import { expect, test } from "bun:test";
import { SkillCliError, type ManagementProjection, type UpdateObservation } from "@skill-cli/core";
import { createUpdateController } from "../src/updates/controller";
import { buildUpdateScope, createUpdatesState } from "../src/updates/model";
import { directSourceCore, testEffects, workspaceProjection } from "./direct-source.fixture";

function fixture(sources = ["team-main"], paths = ["first", "second"]) {
  const base = workspaceProjection({ includeContribution: false });
  const snapshot: ManagementProjection = {
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
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test("quiet updates start with no selection, check missing Sources and submit exact revisions", async () => {
  const { snapshot, observation } = fixture(["team-main", "other"]);
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  const order: string[] = [];
  const requests: unknown[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async ({ source }) => {
          order.push(`check:${source}`);
          return { value: observation(source), diagnostics: [] };
        },
        update: async (request) => {
          order.push(`update:${request.source}`);
          requests.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  expect(state.selected()).toEqual([]);
  expect(await controller.submit()).toBe(true);
  expect(order).toEqual(["check:team-main", "update:team-main", "check:other", "update:other"]);
  expect(requests).toEqual(
    ["team-main", "other"].map((source) => ({
      source,
      paths: ["first", "second"],
      exactRevision: "a".repeat(40),
      expectedBaseline: `baseline:${source}`,
    })),
  );
  expect(controller.run()?.results.map((result) => result.status)).toEqual([
    "updated",
    "updated",
    "updated",
    "updated",
  ]);
});

test("single-item update neither requires selection nor consumes a different selected item", async () => {
  const { snapshot, observation } = fixture();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  state.toggle({ source: "team-main", path: "second" });
  const calls: unknown[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
        update: async (request) => {
          calls.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.submit([{ source: "team-main", path: "first" }]);
  expect(calls).toEqual([
    {
      source: "team-main",
      paths: ["first"],
      exactRevision: "a".repeat(40),
      expectedBaseline: "baseline:team-main",
    },
  ]);
  expect(state.selected()).toEqual([{ source: "team-main", path: "second" }]);
  expect(controller.run()?.results).toHaveLength(1);
});

test("a failed Source does not block others, and partial completion is not returned as success", async () => {
  const { snapshot, observation } = fixture(["broken", "healthy"]);
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  const calls: string[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async ({ source }) => {
          if (source === "broken") throw new Error("Cannot reach Source");
          return { value: observation(source), diagnostics: [] };
        },
        update: async ({ source }) => {
          calls.push(source);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  expect(await controller.submit()).toBe(false);
  expect(calls).toEqual(["healthy"]);
  expect(controller.run()?.results.map((result) => result.status)).toEqual([
    "failed",
    "failed",
    "updated",
    "updated",
  ]);
});

test("unrelated current selection cannot retarget a request while its check awaits", async () => {
  const { snapshot, observation } = fixture();
  const pending = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  const calls: unknown[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: () => pending.promise,
        update: async (request) => {
          calls.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  const request = controller.submit([{ source: "team-main", path: "first" }]);
  state.toggle({ source: "team-main", path: "second" });
  pending.resolve({ value: observation("team-main"), diagnostics: [] });
  await request;
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ paths: ["first"] });
  expect(state.selected()).toEqual([{ source: "team-main", path: "second" }]);
});

test("Stop during checking prevents mutation and keeps not-run targets for explicit continuation", async () => {
  const { snapshot, observation } = fixture();
  const pending = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  let calls = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: () => pending.promise,
        update: async () => {
          calls++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  const request = controller.submit();
  controller.stop();
  pending.resolve({ value: observation("team-main"), diagnostics: [] });
  expect(await request).toBe(false);
  expect(calls).toBe(0);
  expect(controller.retryable()).toEqual(snapshot.installedSkills.map((skill) => skill.address));
});

test("Stop after fulfilled publication retains the committed receipt and skips later Sources", async () => {
  const { snapshot, observation } = fixture(["first-source", "second-source"], ["guide"]);
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  const started = deferred<void>();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  const calls: string[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async ({ source }) => ({ value: observation(source), diagnostics: [] }),
        update: ({ source }) => {
          calls.push(source);
          started.resolve();
          return pending.promise;
        },
      },
    },
    state,
  );
  const request = controller.submit();
  await started.promise;
  controller.stop();
  pending.resolve({ value: undefined, diagnostics: [] });
  expect(await request).toBe(false);
  expect(calls).toEqual(["first-source"]);
  expect(controller.run()?.results.map((result) => result.status)).toEqual(["updated", "not-run"]);
});

test("unknown mutation outcomes are not offered as automatic continuation", async () => {
  const { snapshot, observation } = fixture();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
        update: async () => {
          throw new Error("Publication outcome unknown");
        },
      },
    },
    state,
  );
  expect(await controller.submit()).toBe(false);
  expect(controller.run()?.results.every((result) => result.status === "unknown")).toBe(true);
  expect(controller.retryable()).toEqual([]);
});

test("Core's explicit pre-publication rejection is failed, not unknown; the atomic batch stays installed", async () => {
  const { snapshot, observation } = fixture();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  snapshot.installedSkills.forEach((skill) => state.toggle(skill.address));
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
        update: async () => {
          throw new SkillCliError(
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
      },
    },
    state,
  );
  expect(await controller.submit()).toBe(false);
  expect(controller.run()?.results.map((result) => result.status)).toEqual(["failed", "failed"]);
  expect(controller.run()?.results[0]?.message).toContain("second/SKILL.md");
  expect(controller.run()?.results[0]?.message).toContain("installed Skills kept");
  expect(controller.run()?.results[0]?.message).toContain("recheck");
  expect(state.selected()).toEqual(snapshot.installedSkills.map((skill) => skill.address));
  expect(controller.retryable()).toEqual([]);
});

test("an INVALID_ARGUMENT code without Core's no-publication evidence remains unknown", async () => {
  const { snapshot, observation } = fixture();
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
        update: async () => {
          throw new SkillCliError("INVALID_ARGUMENT", "Unspecified rejected mutation");
        },
      },
    },
    state,
  );
  expect(await controller.submit()).toBe(false);
  expect(controller.run()?.results.every((result) => result.status === "unknown")).toBe(true);
  expect(controller.retryable()).toEqual([]);
});

test("requests outside a bounded Skill scope and ownership drift are rejected before mutation", async () => {
  const { snapshot, observation } = fixture();
  const address = snapshot.installedSkills[0]!.address;
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "skill", address }));
  let calls = 0;
  const controller = createUpdateController(
    {
      workspace: {
        get: async () => ({
          value: {
            ...snapshot,
            installedSkills: snapshot.installedSkills.map((skill) => ({
              ...skill,
              owner: { ...skill.owner, health: "drifted" as const },
            })),
          },
          diagnostics: [],
        }),
      },
      management: {
        checkUpdate: async () => ({ value: observation("team-main"), diagnostics: [] }),
        update: async () => {
          calls++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  expect(await controller.submit([snapshot.installedSkills[1]!.address])).toBe(false);
  expect(await controller.submit([address])).toBe(false);
  expect(calls).toBe(0);
});

test("Effects reuse a fresh baseline-valid check without a Review owner", async () => {
  const { snapshot, observation } = fixture();
  let checks = 0;
  const requests: unknown[] = [];
  const core = directSourceCore(snapshot, {
    checkUpdate: async ({ source }) => {
      checks++;
      return { value: observation(source), diagnostics: [] };
    },
    update: async (request) => {
      requests.push(request);
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      getUpdateBaseline: async ({ source }) => ({ value: `baseline:${source}`, diagnostics: [] }),
    },
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

test("the process task retains its origin and Stop target after switching the displayed draft", async () => {
  const { snapshot, observation } = fixture(["first-source", "other-source"], ["guide"]);
  const started = deferred<void>();
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  let signal: AbortSignal | undefined;
  const calls: string[] = [];
  const effects = testEffects(
    directSourceCore(snapshot, {
      checkUpdate: async ({ source }) => ({ value: observation(source), diagnostics: [] }),
      update: (request, options) => {
        calls.push(request.source);
        signal = options?.signal;
        started.resolve();
        return pending.promise;
      },
    }),
  );
  try {
    effects.selectUpdatesScope({ kind: "source", source: "first-source" }, snapshot);
    const request = effects.submitUpdates();
    await started.promise;
    const firstRun = effects.updateRun();
    effects.selectUpdatesScope({ kind: "source", source: "other-source" }, snapshot);
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
    pending.resolve({ value: undefined, diagnostics: [] });
    await request;
    expect(effects.updatesActive()).toBe(false);
    expect(effects.updateRun()?.results.map((result) => result.status)).toEqual(["updated"]);
    expect(effects.updates()?.scope.entry).toEqual({ kind: "source", source: "other-source" });
    expect(calls).toEqual(["first-source"]);
  } finally {
    pending.resolve({ value: undefined, diagnostics: [] });
    effects.teardown();
  }
});

test("explicit continuation uses the task's not-run targets, not the currently displayed scope", async () => {
  const { snapshot, observation } = fixture(["first-source", "second-source"], ["guide"]);
  const started = deferred<void>();
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  const calls: string[] = [];
  const effects = testEffects(
    directSourceCore(snapshot, {
      checkUpdate: async ({ source }) => ({ value: observation(source), diagnostics: [] }),
      update: ({ source }) => {
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
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  let signal: AbortSignal | undefined;
  let reads = 0;
  const effects = testEffects(
    directSourceCore(snapshot, {
      get: async () => {
        reads++;
        return { value: snapshot, diagnostics: [] };
      },
      checkUpdate: async ({ source }) => ({ value: observation(source), diagnostics: [] }),
      update: (_request, options) => {
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
  const checking = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const updating = deferred<{ value: undefined; diagnostics: [] }>();
  const started = deferred<void>();
  const checks: string[] = [];
  let updateSignal: AbortSignal | undefined;
  const effects = testEffects(
    directSourceCore(snapshot, {
      checkUpdate: ({ source }) => {
        checks.push(source);
        return checks.length === 1
          ? checking.promise
          : Promise.resolve({ value: observation(source), diagnostics: [] });
      },
      update: (_request, options) => {
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
