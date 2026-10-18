import { expect, test } from "bun:test";
import {
  SkillCliError,
  type DiscoveryObservation,
  type WorkspaceView,
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
  baseline: `baseline:${source}`,
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
      installed: {
        ...core.installed,
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

test("UPDATES submission forwards Core's required installed-comparison baseline", async () => {
  const snapshot = projection();
  const core = directSourceCore(snapshot);
  const requests: unknown[] = [];
  const effects = testEffects({
    ...core,
    installed: {
      ...core.installed,
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
  expect(requests[0]).toHaveProperty("expectedBaseline", "baseline:team-main");
  effects.teardown();
});

test("MGMT-007/008 canonical Source submission updates only selected changed roots without install or removal", async () => {
  const snapshot = projection(["team-main"], ["guide", "reference", "old", "same"]);
  const calls: unknown[] = [];
  let unrelatedMutations = 0;
  const core = directSourceCore(snapshot, {
    installed: {
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
      update: async (request) => {
        calls.push(request);
        return { value: undefined, diagnostics: [] };
      },
    },
    sources: {
      remove: async () => {
        unrelatedMutations++;
        throw new Error("Updates must retain the Source");
      },
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
    {
      source: "team-main",
      paths: ["guide"],
      exactRevision: "observed-commit",
      expectedBaseline: "baseline:team-main",
    },
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

function projection(sources = ["team-main"], paths = ["guide"]): WorkspaceView {
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

test("UPDATES controller stops a read-only check without publishing its late result or checking later Sources", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  const check = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const checks: string[] = [];
  let signal: AbortSignal | undefined;
  let updates = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      installed: {
        checkUpdate: ({ source }, options) => {
          checks.push(source);
          signal = options?.signal;
          return check.promise;
        },
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );

  const running = controller.check();
  expect(checks).toEqual(["first"]);
  expect(state.group("first")?.status).toBe("checking");
  expect(controller.stop()).toBe(true);
  expect(signal?.aborted).toBe(true);
  check.resolve({ value: observation("first", ["guide"]), diagnostics: [] });
  expect(await running).toBe(false);
  expect(state.group("first")?.observation).toBeUndefined();
  expect(state.group("second")?.status).toBe("not-checked");
  expect(state.eligible()).toEqual([]);
  expect(checks).toEqual(["first"]);
  expect(updates).toBe(0);
  expect(controller.active()).toBe(false);
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
      installed: {
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
      installed: {
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

test("UPDATES failed rechecks revoke old observations without blocking another Source or a fresh submission", async () => {
  const initial = projection(["first", "second"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  let firstChecks = 0;
  const updates: unknown[] = [];
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: initial, diagnostics: [] }) },
      installed: {
        checkUpdate: async ({ source }) => {
          if (source === "first" && ++firstChecks === 2) throw new Error("upstream unavailable");
          return { value: observation(source, ["guide"]), diagnostics: [] };
        },
        update: async (request) => {
          updates.push(request);
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  await controller.check();
  expect(state.group("first")?.observation).toEqual(observation("first", ["guide"]));
  expect(state.eligible()).toEqual(initial.installedSkills.map((skill) => skill.address));
  await controller.check();
  expect(state.group("first")?.status).toBe("failed");
  expect(state.group("first")?.failure).toBe("check");
  expect(state.group("first")?.observation).toBeUndefined();
  expect(state.group("second")?.status).toBe("changed");
  expect(state.eligible()).toEqual([{ source: "second", path: "guide" }]);
  expect(state.selected()).toEqual([]);
  expect(updates).toEqual([]);
  expect(await controller.submit([{ source: "first", path: "guide" }])).toBe(true);
  expect(firstChecks).toBe(3);
  expect(updates).toEqual([
    {
      source: "first",
      paths: ["guide"],
      exactRevision: "a".repeat(40),
      expectedBaseline: "baseline:first",
    },
  ]);
  expect(state.group("first")).toMatchObject({ status: "succeeded", committed: true });
});

test.each(["before-check", "after-check"] as const)(
  "UPDATES refuses installed revision drift %s without blocking another selected Source",
  async (timing) => {
    const initial = projection(["first", "second"]);
    const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
    for (const skill of initial.installedSkills) state.toggle(skill.address);
    const revised = {
      ...initial,
      installedSkills: initial.installedSkills.map((skill) =>
        skill.address.source === "first"
          ? { ...skill, owner: { ...skill.owner, relevantRemoteRevision: "c".repeat(40) } }
          : skill,
      ),
    };
    const checks: string[] = [];
    const updates: unknown[] = [];
    const published: WorkspaceView[] = [];
    let reads = 0;
    const controller = createUpdateController(
      {
        workspace: {
          get: async () => ({
            value: ++reads >= (timing === "before-check" ? 1 : 2) ? revised : initial,
            diagnostics: [],
          }),
        },
        installed: {
          checkUpdate: async ({ source }) => {
            checks.push(source);
            return { value: observation(source, ["guide"]), diagnostics: [] };
          },
          update: async (request) => {
            expect(published).toEqual([]);
            updates.push(request);
            return { value: undefined, diagnostics: [] };
          },
        },
      },
      state,
      { onProjection: (snapshot) => published.push(snapshot) },
    );
    expect(await controller.submit()).toBe(false);
    expect(checks).toEqual(timing === "before-check" ? ["second"] : ["first", "second"]);
    expect(updates).toEqual([
      {
        source: "second",
        paths: ["guide"],
        exactRevision: "a".repeat(40),
        expectedBaseline: "baseline:second",
      },
    ]);
    expect(state.group("first")?.status).toBe("failed");
    expect(state.group("first")?.error).toContain("installed revision changed");
    expect(state.group("first")?.committed).toBeUndefined();
    expect(state.group("second")).toMatchObject({ status: "succeeded", committed: true });
    expect(controller.run()?.results.map((result) => result.status)).toEqual(["failed", "updated"]);
    expect(controller.run()?.results[0]).toMatchObject({
      status: "failed",
      issue: { kind: "scope" },
    });
    expect(state.scope.addresses).toEqual(initial.installedSkills.map((skill) => skill.address));
    expect(state.selected()).toEqual([{ source: "first", path: "guide" }]);
    expect(state.eligible()).toEqual([]);
    expect(published).toEqual([revised]);
  },
);

test("UPDATES controller teardown never publishes a late fulfilled update", async () => {
  const initial = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(initial, { kind: "workspace" }));
  state.toggle({ source: "first", path: "guide" });
  const pending = deferred<{ value: undefined; diagnostics: [] }>();
  const started = deferred<void>();
  let signal: AbortSignal | undefined;
  let reads = 0;
  const published: WorkspaceView[] = [];
  const controller = createUpdateController(
    {
      workspace: {
        get: async () => {
          reads++;
          return { value: initial, diagnostics: [] };
        },
      },
      installed: {
        checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
        update: (_request, options) => {
          signal = options?.signal;
          started.resolve();
          return pending.promise;
        },
      },
    },
    state,
    { onProjection: (snapshot) => published.push(snapshot) },
  );
  const running = controller.submit();
  await started.promise;
  expect(controller.active()).toBe(true);
  expect(signal?.aborted).toBe(false);
  expect(reads).toBe(2);
  const before = { run: controller.run(), groups: state.groups(), selected: state.selected() };
  controller.teardown();
  expect(signal?.aborted).toBe(true);
  expect(controller.active()).toBe(false);
  pending.resolve({ value: undefined, diagnostics: [] });
  expect(await running).toBe(false);
  expect(reads).toBe(2);
  expect(published).toEqual([]);
  expect(controller.run()).toBe(before.run);
  expect(state.groups()).toBe(before.groups);
  expect(state.selected()).toBe(before.selected);
  expect(state.group("first")?.committed).toBeUndefined();
  expect(controller.active()).toBe(false);
});

test("UPDATES effects own one persistent same-scope draft and do not check automatically", async () => {
  const snapshot = projection(["first"]);
  let checks = 0;
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    installed: {
      ...core.installed,
      checkUpdate: async () => {
        checks++;
        return { value: observation("first", ["guide"]), diagnostics: [] };
      },
    },
  });
  const first = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(checks).toBe(0);
  await effects.checkUpdates();
  expect(first.selected()).toEqual([]);
  first.toggle({ source: "first", path: "guide" });
  const same = effects.selectUpdatesScope({ kind: "workspace" }, snapshot)!;
  expect(same).toBe(first);
  expect(same.selected()).toEqual([{ source: "first", path: "guide" }]);
  expect(checks).toBe(1);
  effects.teardown();
});

test("UPDATES effects checks stay background and a late cancelled result cannot block foreground work", async () => {
  const snapshot = projection(["team-main"]);
  const core = directSourceCore(snapshot);
  const check = deferred<{ value: UpdateObservation; diagnostics: [] }>();
  const discovery = deferred<{ value: DiscoveryObservation; diagnostics: [] }>();
  let signal: AbortSignal | undefined;
  const effects = testEffects({
    ...core,
    installed: {
      ...core.installed,
      checkUpdate: () => check.promise,
    },
    sources: {
      ...core.sources,
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
    installed: {
      ...core.installed,
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
    installed: {
      ...core.installed,
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
  expect(state.selected()).toEqual([]);
  for (const skill of snapshot.installedSkills) state.toggle(skill.address);
  expect(state.selected()).toHaveLength(4);
  expect(
    await effects.submitUpdates([
      { source: "first", path: "guide" },
      { source: "first", path: "reference" },
    ]),
  ).toBe(true);
  expect(updates).toEqual([
    {
      source: "first",
      paths: ["guide", "reference"],
      exactRevision: "a".repeat(40),
      expectedBaseline: "baseline:first",
    },
  ]);
  expect(state.selected()).toEqual([
    { source: "second", path: "guide" },
    { source: "second", path: "reference" },
  ]);
  expect(state.group("second")?.status).toBe("changed");
  effects.teardown();
});

test("UPDATES controller rejects requested addresses outside the bounded draft without widening", async () => {
  const snapshot = projection(["first"]);
  const state = createUpdatesState(buildUpdateScope(snapshot, { kind: "workspace" }));
  state.observe(observation("first", ["guide"]));
  state.toggle({ source: "first", path: "guide" });
  let updates = 0;
  const controller = createUpdateController(
    {
      workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
      installed: {
        checkUpdate: async () => ({ value: observation("first", []), diagnostics: [] }),
        update: async () => {
          updates++;
          return { value: undefined, diagnostics: [] };
        },
      },
    },
    state,
  );
  expect(await controller.submit([{ source: "first", path: "outside-scope" }])).toBe(false);
  expect(updates).toBe(0);
  expect(state.selected()).toEqual([{ source: "first", path: "guide" }]);
});

test("UPDATES effects evict only attempted source cache after an ambiguous failed subset submit", async () => {
  const snapshot = projection(["first", "second"]);
  const core = directSourceCore(snapshot);
  const effects = testEffects({
    ...core,
    workspace: { get: async () => ({ value: snapshot, diagnostics: [] }) },
    installed: {
      ...core.installed,
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
    installed: {
      ...core.installed,
      checkUpdate: async () => ({ value: observation("first", ["guide"]), diagnostics: [] }),
    },
    sources: {
      ...core.sources,
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
    installed: {
      ...core.installed,
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
    installed: {
      ...core.installed,
      checkUpdate: async ({ source }) => ({
        value: {
          ...(source === "first" ? observation(source, ["guide"]) : observation(source, [])),
          baseline: "baseline",
        },
        diagnostics: [],
      }),
      updateBaseline: async () => {
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
