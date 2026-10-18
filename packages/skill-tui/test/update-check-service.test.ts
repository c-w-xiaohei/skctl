import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdateCheckService } from "../src/updates/check-service";
import { SkillCliError, type OperationResult, type UpdateObservation } from "@skill-cli/core";
import {
  createUpdateCheckCache,
  isFreshUpdateCheck,
  UPDATE_CHECK_CACHE_RETENTION,
  type UpdateCheckCache,
  UPDATE_CHECK_CACHE_TTL,
} from "../src/updates/check-cache";

const observation = (source: string, baseline = "baseline"): UpdateObservation => ({
  source,
  kind: "github",
  baseline,
  exactRevision: "a".repeat(40),
  changed: [{ path: "guide", name: "guide", description: "guide" }],
  added: [],
  removed: [],
  unchanged: [],
});
const result = <T>(value: T): OperationResult<T> => ({ value, diagnostics: [] });
const projection = (source = "first") =>
  ({
    installedSkills: [{ address: { source, path: "guide" } }],
    effective: { sources: [{ id: source }] },
  }) as never;
const multiProjection = (sources: readonly string[]) =>
  ({
    installedSkills: sources.map((source) => ({ address: { source, path: "guide" } })),
    effective: { sources: sources.map((id) => ({ id })) },
  }) as never;

function management(
  checkUpdate: (
    source: string,
    signal?: AbortSignal,
  ) => Promise<OperationResult<UpdateObservation>>,
  baseline = "baseline",
): Pick<typeof import("@skill-cli/core"), "checkUpdate" | "getUpdateBaseline"> {
  return {
    checkUpdate: (_environment, { source }, options) => checkUpdate(source, options?.signal),
    getUpdateBaseline: async () => result(baseline),
  };
}

test("update checks are sequential, coalesce a source, and preserve the baseline for submission", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const service = createUpdateCheckService(
    management(async (source) => {
      calls.push(source);
      if (source === "first") await gate;
      return result(observation(source));
    }),
  );
  const first = service.refresh(["first"]);
  const duplicate = service.refresh(["first"]);
  const second = service.refresh(["second"]);
  expect(calls).toEqual(["first"]);
  release();
  await Promise.all([first, duplicate, second]);
  expect(calls).toEqual(["first", "second"]);
  expect(service.check("first")?.observation?.baseline).toBe("baseline");
});

test("a persisted entry is reused only when the Core baseline capability validates it", async () => {
  const cacheEntries: unknown[] = [];
  const cache: UpdateCheckCache = {
    read: async () => cacheEntries as never,
    write: async (entries) => {
      cacheEntries.splice(0, cacheEntries.length, ...entries);
    },
  };
  const first = createUpdateCheckService(
    management(async (source) => result(observation(source))),
    { cache },
  );
  await first.refresh(["first"]);
  await Promise.resolve();

  let checks = 0;
  const second = createUpdateCheckService(
    management(async (source) => {
      checks++;
      return result(observation(source));
    }),
    { cache },
  );
  await second.start(projection());
  expect(second.check("first")?.status).toBe("changed");
  expect(checks).toBe(0);
});

test("a baseline change fails closed and does not publish the check", async () => {
  let baseline = "before";
  const service = createUpdateCheckService({
    checkUpdate: async (_environment, { source }) => {
      baseline = "after";
      return result(observation(source, "before"));
    },
    getUpdateBaseline: async () => result(baseline),
  });
  await service.refresh(["first"]);
  expect(service.check("first")?.status).toBe("failed");
  expect(service.check("first")?.observation).toBeUndefined();
});

test("cache expiry and future timestamps are not fresh", () => {
  const now = 1_000_000;
  const entry = {
    source: "first",
    baseline: "baseline",
    observation: observation("first"),
    checkedAt: now,
  };
  expect(isFreshUpdateCheck(entry, now + UPDATE_CHECK_CACHE_TTL - 1)).toBe(true);
  expect(isFreshUpdateCheck(entry, now + UPDATE_CHECK_CACHE_TTL)).toBe(false);
  expect(isFreshUpdateCheck({ ...entry, checkedAt: now + 1 }, now)).toBe(false);
});

test("v1 discovery cache cannot hydrate when Core supplies a different opaque baseline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-tui-legacy-check-"));
  const path = join(directory, "checks.json");
  const legacyBaseline = "old-opaque-token";
  const currentBaseline = "current-opaque-token";
  const published: import("../src/updates/check-service").SourceUpdateCheck[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const checking = new Promise<void>((resolve) => (started = resolve));
  const calls: string[] = [];
  let service: ReturnType<typeof createUpdateCheckService> | undefined;
  try {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        entries: [
          {
            source: "first",
            baseline: legacyBaseline,
            checkedAt: Date.now(),
            observation: {
              ...observation("first", legacyBaseline),
              added: [{ path: "uninstalled", name: "uninstalled", description: "old discovery" }],
            },
          },
        ],
      }),
    );
    const cache = createUpdateCheckCache(path);
    expect((await cache.read())[0]?.observation.added).toHaveLength(1);
    service = createUpdateCheckService(
      management(async (source) => {
        calls.push(source);
        started();
        await pending;
        return result(observation(source, currentBaseline));
      }, currentBaseline),
      { cache, onChange: (check) => published.push(check) },
    );
    await service.start(projection());
    await checking;
    expect(service.check("first")?.observation).toBeUndefined();
    expect(published.some((check) => check.observation?.baseline === legacyBaseline)).toBe(false);
    const completed = service.refresh(["first"]);
    release();
    await completed;
    expect(calls).toEqual(["first"]);
    expect(service.check("first")?.observation).toMatchObject({
      baseline: currentBaseline,
      added: [],
    });
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
  } finally {
    release?.();
    service?.teardown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider timeout remains failed, retains success time, and lets the serial queue continue", async () => {
  let now = 100;
  let timeout = false;
  const calls: string[] = [];
  const service = createUpdateCheckService(
    management(async (source) => {
      calls.push(source);
      if (source === "first" && timeout)
        throw new SkillCliError("PROVIDER_TIMEOUT", "check deadline expired");
      return result(observation(source));
    }),
    { cache: { read: async () => [], write: async () => {} }, now: () => now },
  );
  try {
    await service.refresh(["first"]);
    now = 200;
    timeout = true;
    await service.refresh(["first", "second"]);
    expect(calls).toEqual(["first", "first", "second"]);
    expect(service.check("first")).toMatchObject({
      status: "failed",
      stale: true,
      checkedAt: 100,
      error: "check deadline expired",
    });
    expect(service.check("second")).toMatchObject({ status: "changed", checkedAt: 200 });
    expect(service.checkingActive()).toBe(false);
  } finally {
    service.teardown();
  }
});

test("disk cache rejects malformed observations and is private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-tui-checks-"));
  const cacheDirectory = join(directory, "private");
  const path = join(cacheDirectory, "checks.json");
  try {
    await mkdir(cacheDirectory, { mode: 0o755 });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        entries: [
          {
            source: "first",
            baseline: "a",
            checkedAt: 1,
            observation: { ...observation("first"), baseline: "b", changed: "not-an-array" },
          },
        ],
      }),
    );
    const cache = createUpdateCheckCache(path);
    expect(await cache.read()).toEqual([]);
    await cache.write([
      { source: "first", baseline: "baseline", checkedAt: 1, observation: observation("first") },
    ]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(cacheDirectory)).mode & 0o777).toBe(0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("disk cache survives a service restart only with the exact persisted baseline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-tui-check-restart-"));
  const path = join(directory, "checks.json");
  try {
    const cache = createUpdateCheckCache(path);
    const first = createUpdateCheckService(
      management(async (source) => result(observation(source))),
      { cache },
    );
    await first.refresh(["first"]);
    let checks = 0;
    const restarted = createUpdateCheckService(
      management(async (source) => {
        checks++;
        return result(observation(source));
      }),
      { cache },
    );
    await restarted.start(projection());
    expect(restarted.check("first")?.observation?.baseline).toBe("baseline");
    expect(checks).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cache retains distinct source-baseline identities instead of overwriting another environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-tui-check-identities-"));
  const path = join(directory, "checks.json");
  try {
    const cache = createUpdateCheckCache(path);
    const checkedAt = Date.now();
    await cache.write([
      {
        source: "shared",
        baseline: "environment-a",
        checkedAt,
        observation: observation("shared", "environment-a"),
      },
    ]);
    await cache.write([
      {
        source: "shared",
        baseline: "environment-b",
        checkedAt: checkedAt + 1,
        observation: observation("shared", "environment-b"),
      },
    ]);
    expect((await cache.read()).map((entry) => entry.baseline).sort()).toEqual([
      "environment-a",
      "environment-b",
    ]);
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.entries).toHaveLength(2);
    let aChecks = 0;
    const environmentA = createUpdateCheckService(
      management(async (source) => {
        aChecks++;
        return result(observation(source, "environment-a"));
      }, "environment-a"),
      { cache },
    );
    let bChecks = 0;
    const environmentB = createUpdateCheckService(
      management(async (source) => {
        bChecks++;
        return result(observation(source, "environment-b"));
      }, "environment-b"),
      { cache },
    );
    await environmentA.start(projection("shared"));
    await environmentB.start(projection("shared"));
    expect(environmentA.check("shared")?.observation?.baseline).toBe("environment-a");
    expect(environmentB.check("shared")?.observation?.baseline).toBe("environment-b");
    expect([aChecks, bChecks]).toEqual([0, 0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cache write prunes records older than bounded stale retention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-tui-check-retention-"));
  const path = join(directory, "checks.json");
  try {
    const cache = createUpdateCheckCache(path);
    await cache.write([
      {
        source: "old",
        baseline: "old",
        checkedAt: Date.now() - UPDATE_CHECK_CACHE_RETENTION - 1,
        observation: observation("old", "old"),
      },
      {
        source: "fresh",
        baseline: "fresh",
        checkedAt: Date.now(),
        observation: observation("fresh", "fresh"),
      },
    ]);
    // A subsequent write performs the bounded-history merge/prune.
    await cache.write([
      {
        source: "new",
        baseline: "new",
        checkedAt: Date.now(),
        observation: observation("new", "new"),
      },
    ]);
    expect((await cache.read()).map((entry) => entry.source).sort()).toEqual(["fresh", "new"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual refresh promotes a queued automatic source without a duplicate check", async () => {
  const calls: string[] = [];
  let releaseA!: () => void;
  let markAStarted!: () => void;
  const aStarted = new Promise<void>((resolve) => (markAStarted = resolve));
  const gateA = new Promise<void>((resolve) => (releaseA = resolve));
  const service = createUpdateCheckService(
    management(async (source) => {
      calls.push(source);
      if (source === "a") {
        markAStarted();
        await gateA;
      }
      return result(observation(source));
    }),
    { cache: { read: async () => [], write: async () => {} } },
  );
  await service.start(multiProjection(["a", "b", "c"]));
  await aStarted;
  const manualC = service.refresh(["c"]);
  releaseA();
  await manualC;
  await service.refresh(["b"]);
  expect(calls).toEqual(["a", "c", "b"]);
  expect(calls.filter((source) => source === "c")).toHaveLength(1);
});

test("delayed startup hydration never replaces a completed manual check or queues it again", async () => {
  let releaseRead!: (
    entries: readonly import("../src/updates/check-cache").CachedUpdateCheck[],
  ) => void;
  const reading = new Promise<readonly import("../src/updates/check-cache").CachedUpdateCheck[]>(
    (resolve) => (releaseRead = resolve),
  );
  let checks = 0;
  const cache: UpdateCheckCache = { read: async () => reading, write: async () => {} };
  const service = createUpdateCheckService(
    management(async (source) => {
      checks++;
      return result({
        ...observation(source),
        changed: [{ path: "manual", name: "manual", description: "manual" }],
      });
    }),
    { cache },
  );
  const hydrating = service.start(projection());
  await service.refresh(["first"]);
  releaseRead([
    {
      source: "first",
      baseline: "baseline",
      checkedAt: Date.now() - 1,
      observation: observation("first"),
    },
  ]);
  await hydrating;
  expect(service.check("first")?.observation?.changed[0]?.path).toBe("manual");
  expect(checks).toBe(1);
});

test("hydration rechecks after a blocked baseline read before publishing old disk state", async () => {
  let releaseBaseline!: () => void;
  let markBaselineStarted!: () => void;
  const baselineStarted = new Promise<void>((resolve) => (markBaselineStarted = resolve));
  const baselineBlocked = new Promise<void>((resolve) => (releaseBaseline = resolve));
  let baselineReads = 0;
  const cache: UpdateCheckCache = {
    read: async () => [
      {
        source: "first",
        baseline: "baseline",
        checkedAt: Date.now() - 1,
        observation: observation("first"),
      },
    ],
    write: async () => {},
  };
  let checks = 0;
  const service = createUpdateCheckService(
    {
      checkUpdate: async (_environment, { source }) => {
        checks++;
        return result({
          ...observation(source),
          changed: [{ path: "manual", name: "manual", description: "manual" }],
        });
      },
      getUpdateBaseline: async () => {
        if (++baselineReads === 1) {
          markBaselineStarted();
          await baselineBlocked;
        }
        return result("baseline");
      },
    },
    { cache },
  );
  const hydrating = service.start(projection());
  await baselineStarted;
  await service.refresh(["first"]);
  releaseBaseline();
  await hydrating;
  expect(service.check("first")?.observation?.changed[0]?.path).toBe("manual");
  expect(checks).toBe(1);
});

test("a failed refresh retains labelled old facts without renewing their timestamp", async () => {
  const cache: UpdateCheckCache = {
    read: async () => [],
    write: async () => {},
  };
  let attempt = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      if (++attempt === 2) throw new Error("offline");
      return result(observation(source));
    }),
    { cache, now: () => 100 },
  );
  await service.refresh(["first"]);
  await service.refresh(["first"]);
  expect(service.check("first")).toMatchObject({ status: "failed", stale: true, checkedAt: 100 });
  expect(service.check("first")?.observation?.baseline).toBe("baseline");
});

test("in-memory results expire on scope revalidation and schedule a replacement", async () => {
  let now = 100;
  let checks = 0;
  let release!: () => void;
  let markStarted!: () => void;
  const replacementStarted = new Promise<void>((resolve) => (markStarted = resolve));
  const replacement = new Promise<void>((resolve) => (release = resolve));
  const service = createUpdateCheckService(
    management(async (source) => {
      checks++;
      if (checks === 2) {
        markStarted();
        await replacement;
      }
      return result(observation(source));
    }),
    { cache: { read: async () => [], write: async () => {} }, now: () => now },
  );
  await service.refresh(["first"]);
  now += UPDATE_CHECK_CACHE_TTL;
  const revalidating = service.revalidate(["first"]);
  await replacementStarted;
  expect(service.check("first")?.stale).toBe(true);
  expect(service.check("first")?.status).toBe("checking");
  expect(checks).toBe(2);
  release();
  await revalidating;
  await service.refresh(["first"]);
  expect(service.check("first")).toMatchObject({ status: "changed", checkedAt: now });
  expect(checks).toBe(2);
});

test("mutation pause leaves unrelated snapshots selected and requeues its cancelled check", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<OperationResult<UpdateObservation>>((_resolve, no) => (reject = no));
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  let firstChecks = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      if (source !== "first" || ++firstChecks !== 1) return result(observation(source));
      markStarted();
      return pending;
    }),
  );
  await service.refresh(["second"]);
  const checking = service.refresh(["first"]);
  await started;
  service.pause(["first"]);
  reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
  expect(service.check("second")?.status).toBe("changed");
  service.resume();
  await checking;
  expect(firstChecks).toBe(2);
  expect(service.check("first")?.status).toBe("changed");
});

test("cache write failure leaves a live result and exposes a nonfatal warning", async () => {
  const service = createUpdateCheckService(
    management(async (source) => result(observation(source))),
    {
      cache: { read: async () => [], write: async () => Promise.reject(new Error("disk full")) },
    },
  );
  await service.refresh(["first"]);
  expect(service.check("first")?.status).toBe("changed");
  expect(service.cacheWarning()).toContain("cannot be saved");
});

test("check activity reports a precise running lifecycle and stop remains reusable", async () => {
  let reject!: (error: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const pending = new Promise<OperationResult<UpdateObservation>>((_resolve, no) => (reject = no));
  const active: boolean[] = [];
  let attempts = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      if (++attempts === 1) {
        markStarted();
        return pending;
      }
      return result(observation(source));
    }),
    { onActivity: () => active.push(service.checkingActive()) },
  );
  const first = service.refresh(["first"]);
  await started;
  expect(service.checkingActive()).toBe(true);
  expect(service.currentSource()).toBe("first");
  expect(service.stop()).toBe(true);
  reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
  await first;
  expect(service.checkingActive()).toBe(false);
  await service.refresh(["first"]);
  expect(attempts).toBe(2);
  expect(active).toContain(true);
  expect(active.at(-1)).toBe(false);
});

test("stopping queued sources settles every multi-source refresh waiter", async () => {
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => (started = resolve));
  const pending = new Promise<void>((resolve) => (release = resolve));
  const service = createUpdateCheckService(
    management(async (source) => {
      if (source === "first") {
        started();
        await pending;
      }
      return result(observation(source));
    }),
  );
  const refresh = service.refresh(["first", "second"]);
  await firstStarted;
  expect(service.stop()).toBe(true);
  release();
  await refresh;
  expect(service.check("second")?.status).toBe("cancelled");
});

test("concurrent automatic starts share valid-cache hydration without a network check", async () => {
  let releaseRead!: (
    entries: readonly import("../src/updates/check-cache").CachedUpdateCheck[],
  ) => void;
  const reading = new Promise<readonly import("../src/updates/check-cache").CachedUpdateCheck[]>(
    (resolve) => (releaseRead = resolve),
  );
  let checks = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      checks++;
      return result(observation(source));
    }),
    { cache: { read: async () => reading, write: async () => {} } },
  );
  const first = service.start(projection());
  const second = service.start(projection());
  releaseRead([
    {
      source: "first",
      baseline: "baseline",
      checkedAt: Date.now(),
      observation: observation("first"),
    },
  ]);
  await Promise.all([first, second]);
  expect(service.check("first")?.status).toBe("changed");
  expect(checks).toBe(0);
});

test("explicit Stop during mutation preemption never requeues the stopped check on resume", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<OperationResult<UpdateObservation>>((_resolve, no) => {
    reject = no;
  });
  let calls = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      if (++calls === 1) return pending;
      return result(observation(source));
    }),
    { cache: { read: async () => [], write: async () => {} } },
  );
  try {
    const checking = service.refresh(["first"]);
    service.pause(["first"]);
    expect(service.activity()?.phase).toBe("paused");
    expect(service.stop()).toBe(true);
    expect(service.activity()?.phase).toBe("stopping");
    reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
    await checking;
    service.resume();
    expect(calls).toBe(1);
    expect(service.activity()).toBeUndefined();
    await service.refresh(["first"]);
    expect(calls).toBe(2);
  } finally {
    service.teardown();
  }
});

test("paused queued checks remain process-visible and Stop settles their waiters without starting IO", async () => {
  let calls = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      calls++;
      return result(observation(source));
    }),
    { cache: { read: async () => [], write: async () => {} } },
  );
  try {
    service.pause();
    const checking = service.refresh(["first", "second"]);
    expect(service.checkingActive()).toBe(true);
    expect(service.activity()).toMatchObject({ phase: "paused", source: "second" });
    expect(service.stop()).toBe(true);
    await checking;
    service.resume();
    expect(calls).toBe(0);
    expect(service.activity()).toBeUndefined();
  } finally {
    service.teardown();
  }
});

test("late startup hydration cannot restart an explicitly stopped check", async () => {
  let releaseRead!: (
    entries: readonly import("../src/updates/check-cache").CachedUpdateCheck[],
  ) => void;
  const reading = new Promise<readonly import("../src/updates/check-cache").CachedUpdateCheck[]>(
    (resolve) => {
      releaseRead = resolve;
    },
  );
  let reject!: (error: unknown) => void;
  const pending = new Promise<OperationResult<UpdateObservation>>((_resolve, no) => {
    reject = no;
  });
  let calls = 0;
  const service = createUpdateCheckService(
    management(async (source) => {
      if (++calls === 1) return pending;
      return result(observation(source));
    }),
    { cache: { read: async () => reading, write: async () => {} } },
  );
  try {
    const hydrating = service.start(projection());
    const manual = service.refresh(["first"]);
    service.stop();
    reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
    await manual;
    releaseRead([]);
    await hydrating;
    expect(calls).toBe(1);
    expect(service.activity()).toBeUndefined();
    await service.refresh(["first"]);
    expect(calls).toBe(2);
  } finally {
    releaseRead([]);
    service.teardown();
  }
});
