import { expect, test } from "bun:test";
import {
  SkillCliError,
  type DiscoveryObservation,
  type ManagementProjection,
  type UpdateObservation,
} from "@skill-cli/core";
import { createUpdateController } from "../src/updates/controller";
import { testEffects } from "./direct-source.fixture";
import { directOwner, directSourceCore } from "./direct-source.fixture";
import { buildUpdateScope, createUpdatesState } from "../src/updates/model";
import { workspaceProjection } from "./direct-source.fixture";

const observation = (source: string, paths: string[], exactRevision = "a".repeat(40)) => ({
  source,
  kind: "github" as const,
  exactRevision,
  changed: paths.map((path) => ({ path, name: path, description: path })),
  added: [],
  removed: [],
  unchanged: [],
});

for (const kind of ["github", "local"] as const) {
  test(`UPDATES Skill submission forwards each fresh opaque ${kind} baseline with its exact selection`, async () => {
    const snapshot = projection(["team-main"], ["guide", "reference"]);
    const core = directSourceCore(snapshot);
    let captured: UpdateObservation = {
      ...observation("team-main", ["guide", "reference"]),
      kind,
      exactRevision: kind === "local" ? undefined : "c".repeat(40),
      baseline: "opaque-reviewed-token",
    };
    const requests: unknown[] = [];
    const effects = testEffects({
      ...core,
      management: {
        ...core.management,
        checkUpdate: async () => ({ value: captured, diagnostics: [] }),
        update: async (request) => {
          requests.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    });
    const address = { source: "team-main", path: "guide" };
    effects.selectUpdatesScope({ kind: "skill", address }, snapshot);
    expect(await effects.submitUpdates([{ ...address, path: "reference" }])).toBe(false);
    expect(await effects.submitUpdates([address, address])).toBe(false);
    expect(requests).toEqual([]);
    expect(await effects.submitUpdates([address])).toBe(true);
    expect(requests).toEqual([
      {
        source: "team-main",
        paths: ["guide"],
        ...(kind === "local" ? {} : { exactRevision: captured.exactRevision }),
        expectedBaseline: captured.baseline,
      },
    ]);
    captured = {
      ...captured,
      exactRevision: kind === "local" ? undefined : "d".repeat(40),
      baseline: "new-opaque-token",
    };
    expect(await effects.submitUpdates([address])).toBe(true);
    expect(requests[1]).toEqual({
      source: "team-main",
      paths: ["guide"],
      ...(kind === "local" ? {} : { exactRevision: "d".repeat(40) }),
      expectedBaseline: "new-opaque-token",
    });
    effects.teardown();
  });
}

test("UPDATES submission remains compatible when Core omits the optional baseline", async () => {
  const snapshot = projection();
  const core = directSourceCore(snapshot);
  const requests: unknown[] = [];
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("team-main", ["guide"]), diagnostics: [] }),
      update: async (request) => {
        requests.push(request);
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  effects.selectUpdatesScope({ kind: "source", source: "team-main" }, snapshot);
  expect(await effects.submitUpdates([{ source: "team-main", path: "guide" }])).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    source: "team-main",
    paths: ["guide"],
    exactRevision: "a".repeat(40),
  });
  expect(requests[0]).not.toHaveProperty("expectedBaseline");
  effects.teardown();
});

test("MGMT-007/008 canonical Source submission updates only selected changed roots without install or removal", async () => {
  const snapshot = projection(["team-main"], ["guide", "reference", "old", "same"]);
  const calls: unknown[] = [];
  let unrelatedMutations = 0;
  const core = directSourceCore(snapshot, {
    checkUpdate: async () => ({
      value: {
        ...observation("team-main", ["guide", "reference"], "observed-commit"),
        added: [{ path: "new", name: "new", description: "New" }],
        removed: [{ path: "old", name: "old", description: "Removed" }],
        unchanged: [{ path: "same", name: "same", description: "Unchanged" }],
      },
      diagnostics: [],
    }),
    install: async () => {
      unrelatedMutations++;
      throw new Error("Updates must not install roots");
    },
    uninstall: async () => {
      unrelatedMutations++;
      throw new Error("Updates must retain removed roots");
    },
    remove: async () => {
      unrelatedMutations++;
      throw new Error("Updates must retain the Source");
    },
    update: async (request) => {
      calls.push(request);
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = testEffects(core);
  const state = effects.selectUpdatesScope({ kind: "source", source: "team-main" }, snapshot)!;
  await effects.checkUpdates();
  expect(effects.updatesSubmittable()).toEqual([
    { source: "team-main", path: "guide" },
    { source: "team-main", path: "reference" },
  ]);
  expect(await effects.submitUpdates([])).toBe(false);
  expect(await effects.submitUpdates([{ source: "team-main", path: "new" }])).toBe(false);
  expect(calls).toEqual([]);
  expect(
    await effects.submitUpdates([
      { source: "team-main", path: "guide" },
      { source: "team-main", path: "old" },
      { source: "team-main", path: "same" },
    ]),
  ).toBe(false);
  expect(calls).toEqual([
    { source: "team-main", paths: ["guide"], exactRevision: "observed-commit" },
  ]);
  expect(effects.updateRun()?.results.map((result) => result.status)).toEqual([
    "updated",
    "failed",
    "unchanged",
  ]);
  expect(state.scope.addresses).toEqual(snapshot.installedSkills.map((skill) => skill.address));
  expect(unrelatedMutations).toBe(0);
  effects.teardown();
});

function projection(sources = ["team-main"], paths = ["guide"]): ManagementProjection {
  const base = workspaceProjection({ includeContribution: false });
  return {
    ...base,
    installedSkills: sources.flatMap((source) =>
      paths.map((path) => ({
        address: { source, path },
        name: "guide",
        description: "Guide",
        owner: { source, health: "healthy" as const, relevantRemoteRevision: "b".repeat(40) },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
    effective: {
      ...base.effective,
      sources: sources.map((id) => ({ ...base.effective.sources[0]!, id })),
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    resolve,
    reject,
  };
}

test("UPDATES controller stops active request, marks later groups not-run, and ignores late success", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  const check = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: () => check.promise,
        update: async () => ({ value: undefined, diagnostics: [] }),
      },
    },
    state,
  );

  const running = controller.check();
  expect(state.group("first")?.status).toBe("checking");
  controller.stop();
  expect(state.group("second")?.status).toBe("not-run");
  check.resolve({ value: observation("first", ["guide"]), diagnostics: [] });
  await running;
  expect(state.group("first")?.status).toBe("cancelled");
  expect(state.group("second")?.status).toBe("not-run");
});

test("UPDATES controller executes sources sequentially, preserves success when refresh fails, and does not retry it", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  state.observe(observation("second", ["guide"]));
  const updates: string[] = [];
  let reads = 0;
  const controller = createUpdateController(
    {
      workspace: {
        get: async () => {
          if (++reads === 2) throw new Error("refresh unavailable");
          return { value: initial, diagnostics: [] };
        },
      },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async ({ source }) => {
          updates.push(source);
          if (source === "second") throw new Error("network failed");
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );

  await controller.submit();
  expect(updates).toEqual(["first", "second"]);
  expect(state.group("first")?.status).toBe("succeeded");
  expect(state.group("first")?.error).toContain("Workspace is stale");
  expect(state.group("second")?.status).toBe("partial");
  expect(controller.retryable()).toEqual([]);
});

test("UPDATES controller blocks stale public scope before update and never submits an unchecked source", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  const stale = projection([]);
  let updates = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: stale, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.submit();
  expect(updates).toBe(0);
  expect(state.group("first")?.error).toContain("no longer installed");

  const unchecked = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  const second = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    unchecked,
  );
  await second.submit();
  expect(updates).toBe(0);
});

test("UPDATES controller treats cancelled and unknown thrown batches as non-retryable until a fresh check", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async () => {
          throw new SkillCliError("CANCELLED", "cancelled");
        },
      },
    },
    state,
  );
  await controller.submit();
  expect(state.group("first")?.status).toBe("cancelled");
  expect(controller.retryable()).toEqual([]);
});

test("UPDATES controller stops an active update and does not start later selected groups", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  state.observe(observation("second", ["guide"]));
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  const calls: string[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: ({ source }) => {
          calls.push(source);
          return pending.promise;
        },
      },
    },
    state,
  );
  const running = controller.submit();
  await Promise.resolve();
  controller.stop();
  pending.reject(new SkillCliError("CANCELLED", "cancelled"));
  await running;
  expect(calls).toEqual(["first"]);
  expect(state.group("first")?.status).toBe("cancelled");
  expect(state.group("second")?.status).toBe("not-run");
});

test("UPDATES controller records failed checks without treating them as current observations", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async ({ source }) => {
          if (source === "first") throw new Error("upstream unavailable");
          return { value: observation(source, ["guide"]), diagnostics: [] };
        },
        update: async () => ({ value: undefined, diagnostics: [] }),
      },
    },
    state,
  );
  await controller.check();
  expect(state.group("first")?.status).toBe("failed");
  expect(state.group("first")?.failure).toBe("check");
  expect(state.group("first")?.observation).toBeUndefined();
  expect(state.group("second")?.status).toBe("changed");
});

test("UPDATES controller rejects a stale observation after a failed recheck without calling Core update", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  let checks = 0;
  let updates = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => {
          if (++checks === 2) throw new Error("upstream unavailable");
          return { value: observation("first", ["guide"]), diagnostics: [] };
        },
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.check();
  await controller.check();
  await controller.submit();
  expect(state.group("first")?.status).toBe("failed");
  expect(state.group("first")?.observation).toBeUndefined();
  expect(state.selected()).toEqual([]);
  expect(updates).toBe(0);
});

test("UPDATES controller rechecks public facts without widening scope or restoring a custom exclusion", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  state.toggle({ source: "first", path: "guide" });
  const revised = {
    ...initial,
    installedSkills: initial.installedSkills.map((skill) => ({
      ...skill,
      owner: { ...skill.owner, relevantRemoteRevision: "c".repeat(40) },
    })),
  };
  let checks = 0;
  let updates = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: revised, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({
          value: observation("first", ["guide"], ++checks === 1 ? "a".repeat(40) : "d".repeat(40)),
          diagnostics: [],
        }),
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.check();
  expect(state.checkedScope().observed[0]?.relevantRemoteRevision).toBe("c".repeat(40));
  expect(state.selected()).toEqual([]);
  await controller.submit();
  expect(updates).toBe(0);
});

test("UPDATES controller rebases checked public facts per source without blocking another source", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  state.observe(observation("second", ["guide"]));
  const firstRevised = {
    ...initial,
    installedSkills: initial.installedSkills.map((skill) =>
      skill.address.source === "first"
        ? { ...skill, owner: { ...skill.owner, relevantRemoteRevision: "c".repeat(40) } }
        : skill,
    ),
  };
  const updates: string[] = [];
  let reads = 0;
  const controller = createUpdateController(
    {
      workspace: {
        get: async () => ({ value: ++reads >= 2 ? firstRevised : initial, diagnostics: [] }),
      },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async ({ source }) => {
          updates.push(source);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.submit();
  expect(updates).toEqual(["first", "second"]);
});

test("UPDATES controller teardown never publishes a late fulfilled update", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: () => pending.promise,
      },
    },
    state,
  );
  const running = controller.submit();
  await Promise.resolve();
  controller.teardown();
  pending.resolve({ value: undefined, diagnostics: [] });
  await running;
  expect(state.group("first")?.status).toBe("updating");
});

test("UPDATES effects own one persistent same-scope draft and do not check automatically", async () => {
  const snapshot = projection(["first"]);
  let checks = 0;
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: async () => {
        checks++;
        return { value: observation("first", ["guide"]), diagnostics: [] };
      },
    },
  });
  const first = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  first.observe(observation("first", ["guide"]));
  first.toggle({ source: "first", path: "guide" });
  const same = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(same).toBe(first);
  expect(same.selected()).toEqual([]);
  expect(checks).toBe(0);
  await effects.checkUpdates();
  expect(checks).toBe(1);
});

test("UPDATES effects checks stay background and a late cancelled result cannot block foreground work", async () => {
  const snapshot = projection(["team-main"]);
  const core = directSourceCore(snapshot);
  const check = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const discovery = deferred<{ value: DiscoveryObservation; diagnostics: [] }>();
  let signal: AbortSignal | undefined;
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: () => check.promise,
      discover: (_request, options) => {
        signal = options?.signal;
        return discovery.promise;
      },
    },
  });
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  const running = effects.checkUpdates();
  expect(effects.pending()).toBe(false);
  const foreground = effects.discover({ kind: "source-discovery", source: "team-main" });
  expect(effects.pending()).toBe(true);
  effects.cancel();
  expect(signal?.aborted).toBe(true);
  effects.stopUpdateChecks();
  check.resolve({ value: observation("team-main", ["guide"]), diagnostics: [] });
  discovery.reject(new SkillCliError("CANCELLED", "cancelled"));
  await Promise.all([running, foreground]);
  expect(effects.pending()).toBe(false);
  const source = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(source.group("team-main")?.observation).toBeUndefined();
  expect(effects.updatesSubmittable()).toEqual([]);
  expect(
    await effects.review({ kind: "source-removal", source: "team-main", owner: directOwner }),
  ).toBeDefined();
  expect(effects.pending()).toBe(false);
  effects.teardown();
});

test("UPDATES effects do not revive cached changed work after an update attempt or public revision drift", async () => {
  const original = projection(["first"]);
  const drifted = {
    ...original,
    installedSkills: original.installedSkills.map((skill) => ({
      ...skill,
      owner: { ...skill.owner, relevantRemoteRevision: "c".repeat(40) },
    })),
  };
  const core = directSourceCore(original);
  let updates = 0;
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: original, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
      update: async () => {
        updates++;
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  effects.selectUpdatesScope({ kind: "workspace" }, original);
  await effects.checkUpdates();
  await effects.submitUpdates();
  expect(updates).toBe(1);
  const afterAttempt = effects.selectUpdatesScope({ kind: "source", source: "first" }, original)!;
  expect(afterAttempt.group("first")?.observation).toBeUndefined();

  effects.selectUpdatesScope({ kind: "workspace" }, original);
  await effects.checkUpdates();
  const driftedScope = effects.selectUpdatesScope({ kind: "source", source: "first" }, drifted)!;
  expect(driftedScope.group("first")?.status).toBe("failed");
  expect(effects.updatesSubmittable()).toEqual([]);
});

test("UPDATES effects submit only an explicit current-group subset and preserve other selected sources", async () => {
  const snapshot = projection(["first", "second"], ["guide", "reference"]);
  const core = directSourceCore(snapshot);
  const updates: unknown[] = [];
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async ({ source }) => ({
        value: observation(
          source,
          ["guide", "reference"],
          source === "first" ? "a".repeat(40) : "b".repeat(40),
        ),
        diagnostics: [],
      }),
      update: async (request) => {
        updates.push(request);
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  const state = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  expect(state.selected()).toHaveLength(4);
  await effects.submitUpdates([
    { source: "first", path: "guide" },
    { source: "first", path: "reference" },
  ]);
  expect(updates).toEqual([
    {
      source: "first",
      paths: ["guide", "reference"],
      exactRevision: "a".repeat(40),
    },
  ]);
  expect(state.selected()).toEqual([
    { source: "second", path: "guide" },
    { source: "second", path: "reference" },
  ]);
  expect(state.group("second")?.status).toBe("changed");
});

test("UPDATES controller rejects requested addresses outside the reviewed draft without widening", async () => {
  const snapshot = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  let updates = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  expect(await controller.submit([{ source: "first", path: "not-reviewed" }])).toBe(false);
  expect(updates).toBe(0);
  expect(state.selected()).toEqual([{ source: "first", path: "guide" }]);
});

test("UPDATES effects evict only attempted source cache after an ambiguous failed subset submit", async () => {
  const snapshot = projection(["first", "second"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async ({ source }) => ({
        value: observation(source, ["guide"]),
        diagnostics: [],
      }),
      update: async ({ source }) => {
        if (source === "first") throw new Error("publication outcome unknown");
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  const state = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  await effects.submitUpdates([{ source: "first", path: "guide" }]);
  expect(state.group("first")?.status).toBe("partial");
  expect(state.group("second")?.status).toBe("changed");
  const secondScope = effects.selectUpdatesScope({ kind: "source", source: "second" }, snapshot)!;
  expect(secondScope.group("second")?.observation).toBeDefined();
  const firstScope = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  expect(firstScope.group("first")?.observation).toBeUndefined();
  expect(effects.updatesSubmittable()).toEqual([]);
});

test("UPDATES effects retain cache when a valid subset is refused before foreground-lane acquisition", async () => {
  const snapshot = projection(["first"]);
  const core = directSourceCore(snapshot);
  const competing = deferred<{ value: DiscoveryObservation; diagnostics: [] }>();
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
      discover: () => competing.promise,
    },
  });
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  await effects.checkUpdates();

  const foregroundRequest = effects.discover({ kind: "source-discovery", source: "first" });
  expect(effects.pending()).toBe(true);
  expect(await effects.submitUpdates([{ source: "first", path: "guide" }])).toBe(false);
  competing.resolve({
    value: { source: "first", kind: "github", candidates: [] },
    diagnostics: [],
  });
  await foregroundRequest;

  const reentered = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  expect(reentered.group("first")?.observation).toBeDefined();
  expect(effects.updatesSubmittable()).toEqual([{ source: "first", path: "guide" }]);
  effects.teardown();
});

test("UPDATES effects preserve a source exclusion across an intervening Skill scope and restore the exact prior draft", () => {
  const snapshot = projection(["first"], ["guide", "reference"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects(core);
  const source = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  source.observe(observation("first", ["guide", "reference"]));
  source.toggle({ source: "first", path: "guide" });
  expect(source.selected()).toEqual([{ source: "first", path: "guide" }]);

  const skill = effects.selectUpdatesScope(
    { kind: "skill", address: { source: "first", path: "guide" } },
    snapshot,
  )!;
  expect(skill).not.toBe(source);
  const restored = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  expect(restored).toBe(source);
  expect(restored.selected()).toEqual([{ source: "first", path: "guide" }]);
  expect(restored.draftTouched()).toBe(true);
});

test("UPDATES Effects restore rejects a retained draft whose checked public facts drift", () => {
  const snapshot = projection(["first"]);
  const drifted = {
    ...snapshot,
    installedSkills: snapshot.installedSkills.map((skill) => ({
      ...skill,
      owner: { ...skill.owner, relevantRemoteRevision: "d".repeat(40) },
    })),
  };
  const effects = testEffects(directSourceCore(snapshot));
  const source = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  source.observe(observation("first", ["guide"]));
  source.rebaseCheckedScope(buildUpdateScope(snapshot, source.scope.entry), "first");
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  const restored = effects.restoreUpdatesScope(source, drifted)!;
  expect(restored).toBe(source);
  expect(restored.group("first")?.status).toBe("failed");
  expect(restored.selected()).toEqual([]);
});

test("UPDATES Effects invalidate another retained scope after an actual source submission", async () => {
  const snapshot = projection(["first"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
      update: async () => ({ value: undefined, diagnostics: [] }),
    },
  });
  const source = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  await effects.checkUpdates();
  source.toggle({ source: "first", path: "guide" });
  const skill = effects.selectUpdatesScope(
    { kind: "skill", address: { source: "first", path: "guide" } },
    snapshot,
  )!;
  await effects.submitUpdates([{ source: "first", path: "guide" }]);
  expect(skill.group("first")?.status).toBe("succeeded");
  const restored = effects.restoreUpdatesScope(source, snapshot)!;
  expect(restored.group("first")?.observation).toBeUndefined();
  expect(restored.group("first")?.status).toBe("failed");
  expect(effects.updatesSubmittable()).toEqual([]);
});

test("UPDATES Effects preserve a committed success when refresh fails and restored public facts drift", async () => {
  const snapshot = projection(["first"]);
  const drifted = {
    ...snapshot,
    installedSkills: snapshot.installedSkills.map((skill) => ({
      ...skill,
      owner: { ...skill.owner, relevantRemoteRevision: "e".repeat(40) },
    })),
  };
  const core = directSourceCore(snapshot);
  let reads = 0;
  const effects = testEffects({
    ...core,
    workspace: {
      get: async () => {
        if (++reads === 2) throw new Error("refresh unavailable");
        return { value: snapshot, diagnostics: [] };
      },
    },
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
      update: async () => ({ value: undefined, diagnostics: [] }),
    },
  });
  const source = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  await effects.checkUpdates();
  source.toggle({ source: "first", path: "guide" });
  await effects.submitUpdates([{ source: "first", path: "guide" }]);
  expect(source.group("first")?.status).toBe("succeeded");
  expect(source.group("first")?.error).toContain("Workspace is stale");
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  const restored = effects.restoreUpdatesScope(source, drifted)!;
  expect(restored.group("first")?.committed).toBe(true);
  expect(restored.group("first")?.status).toBe("failed");
  expect(restored.group("first")?.committedMessage).toContain("Workspace is stale");
  expect(restored.selected()).toEqual([]);
  expect(effects.updatesSubmittable()).toEqual([]);
});

test("UPDATES active mutation survives navigation to another source draft and back", async () => {
  const snapshot = projection(["first", "second"]);
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  const calls: string[] = [];
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      update: ({ source }) => {
        calls.push(source);
        return pending.promise;
      },
    },
  });
  const workspace = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  workspace.observe(observation("first", ["guide"]));
  workspace.observe(observation("second", ["guide"]));
  const running = effects.submitUpdates([{ source: "first", path: "guide" }]);
  await Promise.resolve();
  expect(effects.updatesActive()).toBe(true);
  const second = effects.selectUpdatesScope({ kind: "source", source: "second" }, snapshot)!;
  expect(second).not.toBe(workspace);
  const restored = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(restored).toBe(workspace);
  pending.resolve({ value: undefined, diagnostics: [] });
  await running;
  expect(calls).toEqual(["first"]);
  expect(workspace.group("first")?.status).toBe("succeeded");
});

test("UPDATES submit keeps its initiating workspace targets while baseline revalidation awaits navigation", async () => {
  const snapshot = projection(["first", "second"]);
  let baselineCalls = 0;
  let releaseBaseline!: () => void;
  let markBaselineStarted!: () => void;
  const baselineHeld = new Promise<void>((resolve) => (releaseBaseline = resolve));
  const baselineStarted = new Promise<void>((resolve) => (markBaselineStarted = resolve));
  const updates: unknown[] = [];
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async ({ source }) => ({
        value: {
          ...(source === "first" ? observation(source, ["guide"]) : observation(source, [])),
          baseline: "baseline",
        },
        diagnostics: [],
      }),
      getUpdateBaseline: async () => {
        if (++baselineCalls === 3) {
          markBaselineStarted();
          await baselineHeld;
        }
        return { value: "baseline", diagnostics: [] };
      },
      update: async (request) => {
        updates.push(request);
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  await effects.checkUpdates();
  const submitting = effects.submitUpdates();
  await baselineStarted;
  const sourceB = effects.selectUpdatesScope({ kind: "source", source: "second" }, snapshot)!;
  sourceB.toggle({ source: "second", path: "guide" });
  releaseBaseline();
  await submitting;
  expect(updates).toEqual([
    {
      source: "first",
      paths: ["guide"],
      exactRevision: "a".repeat(40),
      expectedBaseline: "baseline",
    },
  ]);
});

test("UPDATES controller forwards a remote observation revision unchanged and omits it for Local", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe(observation("first", ["guide"], "c".repeat(40)));
  const requests: unknown[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async (request) => {
          requests.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.submit();
  expect(requests[0]).toEqual({ source: "first", paths: ["guide"], exactRevision: "c".repeat(40) });

  const local = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  local.observe({ ...observation("first", ["guide"]), kind: "local", exactRevision: undefined });
  const localController = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async (request) => {
          requests.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    local,
  );
  await localController.submit();
  expect(requests[1]).toEqual({ source: "first", paths: ["guide"] });
});

test("UPDATES controller forwards Core's captured baseline unchanged", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.observe({ ...observation("first", ["guide"]), baseline: "captured-baseline" });
  const requests: unknown[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      management: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async (request) => {
          requests.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.submit();
  expect(requests[0]).toEqual({
    source: "first",
    paths: ["guide"],
    exactRevision: "a".repeat(40),
    expectedBaseline: "captured-baseline",
  });
});

test("UPDATES review snapshots an explicit workspace subset without changing the draft", async () => {
  const snapshot = projection(["first"], ["guide", "reference"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: async () => ({
        value: observation("first", ["guide", "reference"]),
        diagnostics: [],
      }),
    },
  });
  const workspace = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  workspace.toggle({ source: "first", path: "reference" });
  const before = workspace.selected();
  const review = await effects.reviewUpdates([{ source: "first", path: "guide" }]);
  expect(review?.addresses).toEqual([{ source: "first", path: "guide" }]);
  expect(review?.excluded).toEqual([{ source: "first", path: "reference" }]);
  expect(Object.isFrozen(review)).toBe(true);
  expect(Object.isFrozen(review?.addresses)).toBe(true);
  expect(workspace.selected()).toEqual(before);
});

test("UPDATES review accepts an explicit whole-Source list while Source precision draft stays empty", async () => {
  const snapshot = projection(["first"], ["guide", "reference", "third"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: async () => ({
        value: observation("first", ["guide", "reference", "third"]),
        diagnostics: [],
      }),
    },
  });
  const source = effects.selectUpdatesScope({ kind: "source", source: "first" }, snapshot)!;
  await effects.checkUpdates();
  const review = await effects.reviewUpdates([
    { source: "first", path: "guide" },
    { source: "first", path: "reference" },
    { source: "first", path: "third" },
  ]);
  expect(review?.addresses).toHaveLength(3);
  expect(source.selected()).toEqual([]);
});

test("UPDATES explicit Source review works without a mounted Updates draft", async () => {
  const snapshot = projection(["first"], ["guide", "reference", "third"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: async () => ({
        value: observation("first", ["guide", "reference", "third"]),
        diagnostics: [],
      }),
    },
  });
  await effects.refresh();
  await effects.startUpdateChecks(snapshot);
  for (
    let attempt = 0;
    attempt < 20 && effects.updateCheck("first")?.status !== "changed";
    attempt++
  )
    await Promise.resolve();
  expect(effects.updateCheck("first")?.status).toBe("changed");
  expect(effects.sourceReviewAvailability("first")).toMatchObject({ available: true });
  const review = await effects.reviewSourceUpdates("first");
  expect(review?.scope).toEqual({ kind: "source", source: "first" });
  expect(review?.addresses).toHaveLength(3);
  expect(effects.updates()).toBeUndefined();
});

test("UPDATES discarded review cannot execute and never mutates Core", async () => {
  const snapshot = projection(["first"]);
  const updates: unknown[] = [];
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
      update: async (request) => {
        updates.push(request);
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  effects.selectUpdatesScope({ kind: "workspace" }, snapshot);
  await effects.checkUpdates();
  const review = await effects.reviewUpdates([{ source: "first", path: "guide" }]);
  expect(review).toBeDefined();
  effects.discardUpdateReview(review!);
  expect(await effects.submitReviewedUpdates(review!)).toBe(false);
  expect(updates).toEqual([]);
});

test("UPDATES reviewed partial batch preserves only its fulfilled source as committed", async () => {
  const snapshot = projection(["first", "second"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async ({ source }) => ({
        value: observation(source, ["guide"]),
        diagnostics: [],
      }),
      update: async ({ source }) => {
        if (source === "second") throw new Error("second failed");
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  const state = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  const review = await effects.reviewUpdates([
    { source: "first", path: "guide" },
    { source: "second", path: "guide" },
  ]);
  expect(await effects.submitReviewedUpdates(review!)).toBe(true);
  expect(state.group("first")?.committed).toBe(true);
  expect(state.group("second")?.committed).toBeUndefined();
  expect(state.group("second")?.status).toBe("partial");
});

test("UPDATES stopping a reviewed batch marks its initiating draft unknown without retargeting navigation", async () => {
  const snapshot = projection(["first", "second"]);
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async ({ source }) => ({
        value: observation(source, ["guide"]),
        diagnostics: [],
      }),
      update: () => {
        markStarted();
        return pending.promise;
      },
    },
  });
  const workspace = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  const review = await effects.reviewUpdates([{ source: "first", path: "guide" }]);
  const running = effects.submitReviewedUpdates(review!);
  await started;
  effects.selectUpdatesScope({ kind: "source", source: "second" }, snapshot);
  expect(effects.stopUpdates()).toBe(true);
  pending.reject(new SkillCliError("CANCELLED", "cancelled"));
  await running;
  expect(workspace.group("first")?.status).toBe("cancelled");
  expect(workspace.selected()).toEqual([{ source: "second", path: "guide" }]);
});

test("UPDATES reviewed Stop mirrors later reviewed source as not-run without calling it", async () => {
  const snapshot = projection(["first", "second"]);
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => (started = resolve));
  const calls: string[] = [];
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    management: {
      ...core.management,
      checkUpdate: async ({ source }) => ({
        value: observation(source, ["guide"]),
        diagnostics: [],
      }),
      update: ({ source }) => {
        calls.push(source);
        if (source === "first") {
          started();
          return pending.promise;
        }
        return Promise.resolve({ value: undefined, diagnostics: [] });
      },
    },
  });
  const owner = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  const review = await effects.reviewUpdates([
    { source: "first", path: "guide" },
    { source: "second", path: "guide" },
  ]);
  const running = effects.submitReviewedUpdates(review!);
  await firstStarted;
  effects.stopUpdates();
  pending.reject(new SkillCliError("CANCELLED", "cancelled"));
  await running;
  expect(calls).toEqual(["first"]);
  expect(owner.group("first")?.status).toBe("cancelled");
  expect(owner.group("second")?.status).toBe("not-run");
});

test("UPDATES reviewed success transfers workspace refresh failure detail", async () => {
  const snapshot = projection(["first"]);
  const core = directSourceCore(snapshot);
  let reads = 0;
  const effects = testEffects({
    ...core,
    workspace: {
      get: async () => {
        if (++reads === 2) throw new Error("refresh unavailable");
        return { value: snapshot, diagnostics: [] };
      },
    },
    management: {
      ...core.management,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
      update: async () => ({ value: undefined, diagnostics: [] }),
    },
  });
  const owner = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  await effects.checkUpdates();
  const review = await effects.reviewUpdates([{ source: "first", path: "guide" }]);
  expect(await effects.submitReviewedUpdates(review!)).toBe(true);
  expect(owner.group("first")?.committed).toBe(true);
  expect(owner.group("first")?.committedMessage).toContain("Workspace is stale");
});
