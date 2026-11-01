import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SkctlError,
  type CoreOptions,
  type OperationResult,
  type UpdateObservation,
  type WorkspaceView,
} from "@skctl/core";
import { directSourceCore, testEffects, workspaceProjection } from "./direct-source.fixture";

let directory: string;
let prior: string | undefined;
const sessions: ReturnType<typeof testEffects>[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sktui-check-schedule-"));
  prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = directory;
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.teardown()));
  if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
  await rm(directory, { recursive: true, force: true });
});
function snapshot(sources = ["first"], paths = ["guide"]): WorkspaceView {
  const base = workspaceProjection({ includeContribution: false });
  return {
    ...base,
    effective: {
      ...base.effective,
      sources: sources.map((id) => ({ ...base.effective.sources[0]!, id })),
    },
    installedSkills: sources.flatMap((source) =>
      paths.map((path) => ({
        address: { source, path },
        name: path,
        description: "Installed",
        owner: { source, health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
  };
}
const observation = (source: string): UpdateObservation => ({
  source,
  kind: "github",
  baseline: `baseline:${source}`,
  exactRevision: "a".repeat(40),
  observedAt: 123,
  changed: [{ path: "guide", name: "guide", description: "Changed" }],
  added: [],
  removed: [],
  unchanged: [],
});
const result = <T>(value: T) => ({ value, diagnostics: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean | Promise<boolean>) {
  for (let count = 0; count < 200; count++) {
    if (await predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error("Expected session state did not settle");
}
function session(view: WorkspaceView, hooks: Parameters<typeof directSourceCore>[1] = {}) {
  const effects = testEffects(directSourceCore(view, hooks), { cwd: "/project" });
  effects.selectUpdatesScope({ kind: "workspace" }, view);
  sessions.push(effects);
  return effects;
}
const schedule = () =>
  readFile(join(directory, "update-schedule-v1.json"), "utf8").then(
    (text) => JSON.parse(text) as Record<string, number>,
  );
async function scheduleWritten() {
  await until(async () => {
    try {
      return Object.keys(await schedule()).length > 0;
    } catch {
      return false;
    }
  });
  return schedule();
}

test("checks are sequential, coalesce a Source, and keep the opaque Core baseline", async () => {
  const view = snapshot(["first", "second"]),
    pending = deferred<void>();
  const calls: string[] = [];
  const effects = session(view, {
    checkUpdate: async (_options, { source }) => {
      calls.push(source);
      if (source === "first") await pending.promise;
      return result(observation(source));
    },
  });
  const first = effects.checkUpdates(["first"]);
  const duplicate = effects.checkUpdates(["first"]);
  const second = effects.checkUpdates(["second"]);
  expect(calls).toEqual(["first"]);
  pending.resolve();
  expect(await Promise.all([first, duplicate, second])).toEqual([true, true, true]);
  expect(calls).toEqual(["first", "second"]);
  expect(effects.updates()!.group("first")!.observation!.baseline).toBe("baseline:first");
});

test("restart restores through Core retained observation; schedule contains timestamps only and does not slide", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await first.checkUpdates();
  const saved = await scheduleWritten();
  first.teardown();
  const calls: unknown[] = [];
  const second = session(view, {
    checkUpdate: async (_options, request) => {
      calls.push(request);
      return result({
        ...observation(request.source),
        baseline: "new-local-baseline",
        changed: [],
        unchanged: observation(request.source).changed,
      });
    },
    getUpdateBaseline: async () => result("new-local-baseline"),
  });
  await second.startUpdateChecks(view);
  await until(() => !second.checkingActive());
  expect(calls).toEqual([{ source: "first", observation: "retained" }]);
  expect(second.updates()!.group("first")!.observation!.baseline).toBe("new-local-baseline");
  expect(second.updates()!.group("first")!.status).toBe("no-changes");
  expect(await schedule()).toEqual(saved);
  expect(Object.keys(saved)).toHaveLength(1);
  expect(Object.values(saved).every((value) => typeof value === "number")).toBe(true);
  expect((await stat(join(directory, "update-schedule-v1.json"))).mode & 0o777).toBe(0o600);
  expect((await readdir(directory)).sort()).toEqual(["update-schedule-v1.json"]);
});

test.each(["expired", "future", "missing"])(
  "%s scheduling time causes a current check",
  async (kind) => {
    const view = snapshot();
    const first = session(view, {
      checkUpdate: async (_options, { source }) => result(observation(source)),
    });
    await first.checkUpdates();
    const saved = await scheduleWritten();
    first.teardown();
    const key = Object.keys(saved)[0]!;
    await writeFile(
      join(directory, "update-schedule-v1.json"),
      JSON.stringify(
        kind === "missing"
          ? {}
          : { [key]: kind === "future" ? Date.now() + 10000 : Date.now() - 8 * 60 * 60 * 1000 },
      ),
    );
    const calls: unknown[] = [];
    const next = session(view, {
      checkUpdate: async (_options, request) => {
        calls.push(request);
        return result(observation(request.source));
      },
    });
    await next.startUpdateChecks(view);
    await until(() => !next.checkingActive());
    expect(calls).toEqual([{ source: "first" }]);
  },
);

test("missing retained objects never bypass the eight-hour automatic interval", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await first.checkUpdates();
  await scheduleWritten();
  first.teardown();
  const calls: unknown[] = [];
  function checkUpdate(
    options: CoreOptions,
    request: { source: string; observation: "retained" },
  ): Promise<OperationResult<UpdateObservation | undefined>>;
  function checkUpdate(
    options: CoreOptions,
    request: { source: string; observation?: "current" },
  ): Promise<OperationResult<UpdateObservation>>;
  async function checkUpdate(
    _options: CoreOptions,
    request: { source: string; observation?: "current" | "retained" },
  ): Promise<OperationResult<UpdateObservation | undefined>> {
    calls.push(request);
    return result(request.observation === "retained" ? undefined : observation(request.source));
  }
  const next = session(view, {
    checkUpdate,
  });
  await next.startUpdateChecks(view);
  await until(() => !next.checkingActive());
  expect(calls).toEqual([{ source: "first", observation: "retained" }]);
});

test("retained metadata failure waits for an explicit or due check", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await first.checkUpdates();
  await scheduleWritten();
  await first.teardown();
  const calls: unknown[] = [];
  const next = session(view, {
    checkUpdate: async (_options, request) => {
      calls.push(request);
      if (request.observation === "retained")
        throw new SkctlError("PINNED_COMMIT_UNAVAILABLE", "objects reclaimed");
      return result(observation(request.source));
    },
  });
  await next.startUpdateChecks(view);
  await until(() => !next.checkingActive());
  expect(calls).toEqual([{ source: "first", observation: "retained" }]);
  expect(next.updatesSubmittable()).toEqual([]);
});

test("failed automatic attempts stay throttled across restart", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async () => {
      throw new Error("offline");
    },
  });
  await first.startUpdateChecks(view);
  await until(() => !first.checkingActive());
  await first.teardown();
  expect(Object.keys(await schedule())).toHaveLength(1);
  const calls: unknown[] = [];
  const next = session(view, {
    checkUpdate: async (_options, request) => {
      calls.push(request);
      throw new Error("no retained observation");
    },
  });
  await next.startUpdateChecks(view);
  await until(() => !next.checkingActive());
  expect(calls).toEqual([{ source: "first", observation: "retained" }]);
});

test("retained startup restores without showing checking activity", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await first.checkUpdates();
  await first.teardown();
  const started = deferred<void>();
  const held = deferred<void>();
  const next = session(view, {
    checkUpdate: async (_options, { source }) => {
      started.resolve();
      await held.promise;
      return result(observation(source));
    },
  });
  await next.startUpdateChecks(view);
  await started.promise;
  try {
    expect(next.checkActivity()).toBeUndefined();
  } finally {
    held.resolve();
  }
  await until(() => !next.checkingActive());
});

test("manual check interrupts retained-only startup and cannot accept its late observation", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await first.checkUpdates();
  await scheduleWritten();
  await first.teardown();
  const held = deferred<OperationResult<UpdateObservation>>(),
    started = deferred<void>();
  const calls: unknown[] = [];
  let signal: AbortSignal | undefined;
  const next = session(view, {
    checkUpdate: async (_options, request, operation) => {
      calls.push(request);
      if (request.observation === "retained") {
        signal = operation?.signal;
        started.resolve();
        return held.promise;
      }
      return result({ ...observation(request.source), exactRevision: "b".repeat(40) });
    },
  });
  await next.startUpdateChecks(view);
  await started.promise;
  const manual = next.checkUpdates();
  expect(signal!.aborted).toBe(true);
  held.resolve(result(observation("first")));
  expect(await manual).toBe(true);
  expect(calls).toEqual([{ source: "first", observation: "retained" }, { source: "first" }]);
  expect(next.updates()!.group("first")!.observation!.exactRevision).toBe("b".repeat(40));
});

test("Stop while Core validates a check cannot publish its late result or restart startup", async () => {
  const checked = deferred<OperationResult<UpdateObservation>>(),
    started = deferred<void>();
  const view = snapshot();
  const next = session(view, {
    checkUpdate: async () => {
      started.resolve();
      return checked.promise;
    },
  });
  await next.startUpdateChecks(view);
  await started.promise;
  next.stopUpdateChecks();
  checked.resolve(result(observation("first")));
  await until(() => !next.checkingActive());
  await next.startUpdateChecks(view);
  expect(next.updates()!.group("first")!.observation).toBeUndefined();
});

test("a successful manual check preceding startup is not replaced or queued twice", async () => {
  const view = snapshot();
  let checks = 0;
  const next = session(view, {
    checkUpdate: async (_options, { source }) => {
      checks++;
      return result(observation(source));
    },
  });
  await next.checkUpdates();
  await next.startUpdateChecks(view);
  expect(checks).toBe(1);
  expect(next.updates()!.group("first")!.status).toBe("changed");
});

test("schedule identity separates current environments and Source bindings", async () => {
  const view = snapshot();
  const first = session(view, {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await first.checkUpdates();
  await scheduleWritten();
  await first.teardown();
  const rebound: WorkspaceView = {
    ...view,
    effective: {
      ...view.effective,
      sources: view.effective.sources.map((source) => ({ ...source, ref: "other" })),
    },
  };
  const calls: unknown[] = [];
  const next = session(rebound, {
    checkUpdate: async (_options, request) => {
      calls.push(request);
      return result(observation(request.source));
    },
  });
  await next.startUpdateChecks(rebound);
  await until(() => !next.checkingActive());
  expect(calls).toEqual([{ source: "first" }]);
  await next.teardown();
  expect(Object.keys(await schedule())).toHaveLength(2);
});

test("Core baseline conflict fails closed without a redundant frontend baseline capture", async () => {
  let baselines = 0;
  const effects = session(snapshot(), {
    checkUpdate: async () => {
      throw new SkctlError("TRANSACTION_CONFLICT", "Installed comparison changed; check again");
    },
    getUpdateBaseline: async () => {
      baselines++;
      return result("changed");
    },
  });
  expect(await effects.checkUpdates()).toBe(false);
  expect(effects.updates()!.group("first")!.status).toBe("failed");
  expect(effects.updates()!.group("first")!.observation).toBeUndefined();
  expect(effects.updates()!.group("first")!.error).toContain("Installed comparison changed");
  expect(baselines).toBe(0);
});

test("refresh failure retains labelled facts with their original observation time and does not renew scheduling", async () => {
  let fail = false;
  const effects = session(snapshot(), {
    checkUpdate: async (_options, { source }) =>
      result({ ...observation(source), ...(fail ? { refreshError: "offline" } : {}) }),
  });
  await effects.checkUpdates();
  const saved = await scheduleWritten();
  fail = true;
  expect(await effects.checkUpdates()).toBe(false);
  expect(effects.updates()!.group("first")).toMatchObject({
    status: "failed",
    stale: true,
    checkedAt: 123,
    error: "offline",
  });
  expect(effects.updatesSubmittable()).toEqual([]);
  expect(await schedule()).toEqual(saved);
  expect(await effects.submitUpdates()).toBe(false);
});

test("provider timeout fails one Source but permits the serial queue to continue", async () => {
  const effects = session(snapshot(["first", "second"]), {
    checkUpdate: async (_options, { source }) => {
      if (source === "first") throw new SkctlError("PROVIDER_TIMEOUT", "check deadline expired");
      return result(observation(source));
    },
  });
  expect(await effects.checkUpdates()).toBe(false);
  expect(effects.updates()!.group("first")!.error).toBe("check deadline expired");
  expect(effects.updates()!.group("second")!.status).toBe("changed");
});

test("manual refresh promotes an automatic queued Source without duplicate work", async () => {
  const view = snapshot(["first", "second", "third"]),
    gate = deferred<void>(),
    started = deferred<void>();
  const calls: string[] = [];
  const effects = session(view, {
    checkUpdate: async (_options, { source }) => {
      calls.push(source);
      if (source === "first") {
        started.resolve();
        await gate.promise;
      }
      return result(observation(source));
    },
  });
  await effects.startUpdateChecks(view);
  await started.promise;
  const manual = effects.checkUpdates(["third"]);
  gate.resolve();
  await manual;
  await until(() => !effects.checkingActive());
  expect(calls).toEqual(["first", "third", "second"]);
});

test("concurrent automatic starts coalesce; Stop prevents restart and later manual checks remain usable", async () => {
  const view = snapshot(["first", "second"]),
    pending = deferred<OperationResult<UpdateObservation>>(),
    started = deferred<void>();
  let calls = 0;
  const effects = session(view, {
    checkUpdate: async (_options, { source }) => {
      if (++calls === 1) {
        started.resolve();
        return pending.promise;
      }
      return result(observation(source));
    },
  });
  await Promise.all([effects.startUpdateChecks(view), effects.startUpdateChecks(view)]);
  await started.promise;
  expect(effects.stopUpdateChecks()).toBe(true);
  pending.resolve(result(observation("first")));
  await until(() => !effects.checkingActive());
  await effects.startUpdateChecks(view);
  expect(calls).toBe(1);
  expect(effects.updates()!.group("second")!.status).toBe("cancelled");
  await effects.checkUpdates(["first"]);
  expect(calls).toBe(2);
});

test("Stop settles all queued check waiters and ignores a late fulfilled read", async () => {
  const gate = deferred<OperationResult<UpdateObservation>>();
  const effects = session(snapshot(["first", "second"]), { checkUpdate: () => gate.promise });
  const pending = effects.checkUpdates();
  expect(effects.checkActivity()).toMatchObject({ phase: "checking", source: "first" });
  effects.stopUpdateChecks();
  expect(effects.checkActivity()!.phase).toBe("stopping");
  gate.resolve(result(observation("first")));
  expect(await pending).toBe(false);
  await until(() => !effects.checkingActive());
  expect(effects.updates()!.group("first")!.observation).toBeUndefined();
  expect(effects.updates()!.group("second")!.status).toBe("cancelled");
});

test.each([false, true])(
  "mutation preempts checks; explicit Stop=%s controls whether they resume",
  async (stop) => {
    const gate = deferred<OperationResult<UpdateObservation>>(),
      mutation = deferred<void>(),
      started = deferred<void>();
    let calls = 0,
      signal: AbortSignal | undefined;
    const effects = session(snapshot(["first", "second"]), {
      checkUpdate: async (_options, { source }, operation) => {
        if (++calls === 1) {
          signal = operation?.signal;
          return gate.promise;
        }
        return result(observation(source));
      },
      createCollection: async () => {
        started.resolve();
        await mutation.promise;
        return result({ level: "project" as const, file: "skctl.jsonc", changed: true });
      },
    });
    const checking = effects.checkUpdates();
    const changing = effects.createCollection({
      kind: "collection-create",
      level: "project",
      collection: "new",
    });
    await started.promise;
    expect(signal!.aborted).toBe(true);
    expect(effects.checkActivity()!.phase).toBe("paused");
    if (stop) effects.stopUpdateChecks();
    gate.resolve(result(observation("first")));
    mutation.resolve();
    expect(await changing).toBe(true);
    expect(await checking).toBe(!stop);
    await until(() => !effects.checkingActive());
    expect(calls).toBe(stop ? 1 : 3);
  },
);

test("queued checks stay visible while mutation owns the lane and Stop does not start IO", async () => {
  const mutation = deferred<void>(),
    started = deferred<void>();
  let checks = 0;
  const effects = session(snapshot(), {
    checkUpdate: async (_options, { source }) => {
      checks++;
      return result(observation(source));
    },
    createCollection: async () => {
      started.resolve();
      await mutation.promise;
      return result({ level: "project" as const, file: "skctl.jsonc", changed: true });
    },
  });
  const changing = effects.createCollection({
    kind: "collection-create",
    level: "project",
    collection: "new",
  });
  await started.promise;
  const checking = effects.checkUpdates();
  expect(effects.checkActivity()).toEqual({ phase: "paused", source: "first" });
  effects.stopUpdateChecks();
  expect(await checking).toBe(false);
  mutation.resolve();
  await changing;
  expect(checks).toBe(0);
});

test("teardown suppresses late check publication and drains queued waiters", async () => {
  const gate = deferred<OperationResult<UpdateObservation>>();
  let signal: AbortSignal | undefined;
  const effects = session(snapshot(["first", "second"]), {
    checkUpdate: (_options, _request, operation) => {
      signal = operation?.signal;
      return gate.promise;
    },
  });
  const checking = effects.checkUpdates();
  const state = effects.updates()!,
    groups = state.groups();
  effects.teardown();
  expect(signal!.aborted).toBe(true);
  gate.resolve(result(observation("first")));
  expect(await checking).toBe(false);
  expect(state.groups()).toBe(groups);
});

test("schedule write errors are nonfatal and never hide a valid live check", async () => {
  await writeFile(join(directory, "blocked"), "not a directory");
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = join(directory, "blocked");
  const effects = session(snapshot(), {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  expect(await effects.checkUpdates()).toBe(true);
  await until(() => !!effects.updateChecksWarning());
  expect(effects.updates()!.group("first")!.status).toBe("changed");
});

test("malformed schedule data cannot authorize restoration or submission", async () => {
  await writeFile(
    join(directory, "update-schedule-v1.json"),
    '{"not-an-identity":{"changed":["guide"]}}',
  );
  const view = snapshot(),
    calls: unknown[] = [];
  const effects = session(view, {
    checkUpdate: async (_options, request) => {
      calls.push(request);
      return result(observation(request.source));
    },
  });
  expect(effects.updatesSubmittable()).toEqual([]);
  await effects.startUpdateChecks(view);
  await until(() => !effects.checkingActive());
  expect(calls).toEqual([{ source: "first" }]);
  expect(effects.updatesSubmittable()).toEqual([{ source: "first", path: "guide" }]);
});

test("saving schedule prunes expired timestamps without retaining result payloads", async () => {
  await writeFile(
    join(directory, "update-schedule-v1.json"),
    JSON.stringify({ ["0".repeat(64)]: Date.now() - 9 * 60 * 60 * 1000 }),
  );
  const effects = session(snapshot(), {
    checkUpdate: async (_options, { source }) => result(observation(source)),
  });
  await effects.checkUpdates();
  await effects.teardown();
  const saved = await schedule();
  expect(saved["0".repeat(64)]).toBeUndefined();
  expect(Object.values(saved).every((value) => typeof value === "number")).toBe(true);
  expect(JSON.stringify(saved)).not.toMatch(/baseline|changed|revision|observation|guide/);
});
