import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type InstalledMaterialization,
  resolveStateRoot,
  setCoordinatorHookForTest,
  StateCoordinator,
} from "../../src/core/internal/state";

const legacyLocal = {
  kind: "local" as const,
  source: "team",
  path: "review",
  root: "/skills/review",
  name: "review",
  description: "Review",
  digest: "a".repeat(64),
  bindingDigest: "b".repeat(64),
};

test("requires an absolute state override and uses the state-home fallback", () => {
  expect(() => resolveStateRoot({ SKILL_CLI_STATE_DIR: "relative" })).toThrow();
  expect(resolveStateRoot({ XDG_STATE_HOME: "/state", HOME: "/home/test" })).toBe(
    "/state/skill-cli",
  );
});

test("coordinator rejects symlinked managed entries and writes a private state file", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-state-security-"));
  try {
    const coordinator = new StateCoordinator(root);
    await coordinator.withLock(async () => {
      const current = await coordinator.read();
      await coordinator.write({ installed: [], configs: {} }, current.generation);
    });
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8")).generation).toBe(1);
    await rm(join(root, "staging"), { recursive: true });
    await symlink(root, join(root, "staging"));
    await expect(coordinator.withLock(async () => coordinator.recover())).rejects.toMatchObject({
      code: "CONFIG_SYMLINK",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coordinator rejects a symlink in an existing lexical state-root parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-state-parent-"));
  try {
    await symlink(root, join(root, "linked"));
    await expect(
      new StateCoordinator(join(root, "linked", "state")).withLock(async () => undefined),
    ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state accepts only exact Local and Remote materialization facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-state-shape-"));
  const state = join(root, "state.json");
  const valid = {
    version: 1 as const,
    generation: 2,
    installed: [
      {
        kind: "local" as const,
        source: "team",
        path: "review",
        root: "/skills/review",
        name: "review",
        description: "Review",
        digest: "a".repeat(64),
        bindingDigest: "b".repeat(64),
      },
      {
        kind: "remote" as const,
        source: "remote",
        path: "review",
        digest: "c".repeat(64),
        bindingDigest: "d".repeat(64),
        adoptedRevision: "e".repeat(40),
        name: "review",
        description: "Review",
      },
    ],
    configs: { upstream: { commit: "e".repeat(40), digest: "f".repeat(64) } },
  };
  try {
    await writeFile(state, JSON.stringify(valid));
    await expect(
      new StateCoordinator(root).withLock(async () => new StateCoordinator(root).read()),
    ).resolves.toEqual(valid);
    for (const mutation of [
      { ...valid, installed: [{ ...valid.installed[0], selectors: ["x:y"] }] },
      { ...valid, installed: [{ ...valid.installed[0], bindingDigest: undefined }] },
      { ...valid, installed: [{ ...valid.installed[1], root: "/must-not-be-remote" }] },
      { ...valid, configs: { upstream: { commit: "bad", digest: "f".repeat(64) } } },
    ]) {
      await writeFile(state, JSON.stringify(mutation));
      await expect(
        new StateCoordinator(root).withLock(async () => new StateCoordinator(root).read()),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state reads literal v1 bytes without rewriting and requires exact v2 identity evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-state-v2-shape-"));
  const state = join(root, "state.json");
  const legacy = `${JSON.stringify({
    version: 1,
    generation: 2,
    installed: [legacyLocal],
    configs: {},
  })}\n`;
  try {
    await writeFile(state, legacy);
    const coordinator = new StateCoordinator(root);
    await expect(coordinator.withLock(() => coordinator.read())).resolves.toMatchObject({
      version: 1,
      installed: [legacyLocal],
    });
    expect(await readFile(state, "utf8")).toBe(legacy);
    await expect(
      coordinator.withLock(async () =>
        coordinator.write({ installed: [legacyLocal], configs: {} }, 2),
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await readFile(state, "utf8")).toBe(legacy);
    await writeFile(
      state,
      JSON.stringify({ version: 2, generation: 2, installed: [legacyLocal], configs: {} }),
    );
    await expect(coordinator.withLock(() => coordinator.read())).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    await writeFile(
      state,
      JSON.stringify({
        version: 2,
        generation: 2,
        installed: [
          {
            ...legacyLocal,
            identityEvidence: {
              status: "known",
              canonicalOrigin: "/skills",
              originRelativeSkillRoot: "review",
              extra: true,
            },
          },
        ],
        configs: {},
      }),
    );
    await expect(coordinator.withLock(() => coordinator.read())).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state publishes a derived v1 migration atomically with one generation advance", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-state-migration-"));
  const state = join(root, "state.json");
  try {
    await writeFile(
      state,
      `${JSON.stringify({ version: 1, generation: 7, installed: [legacyLocal], configs: {} })}\n`,
    );
    const coordinator = new StateCoordinator(root);
    await coordinator.withLock(async () => {
      const current = await coordinator.read();
      await coordinator.migrateLegacy(current, [
        {
          ...legacyLocal,
          identityEvidence: {
            status: "known",
            canonicalOrigin: "/skills",
            originRelativeSkillRoot: "review",
          },
        } satisfies InstalledMaterialization,
      ]);
    });
    expect(JSON.parse(await readFile(state, "utf8"))).toMatchObject({
      version: 2,
      generation: 8,
      installed: [
        {
          identityEvidence: {
            status: "known",
            canonicalOrigin: "/skills",
            originRelativeSkillRoot: "review",
          },
        },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("STA-LOCK-ABA stale observer cannot detach a replacement owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-stale-lock-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "mutation.lock"),
      JSON.stringify({ pid: 999_999_999, nonce: "stale" }),
    );
    let observed = false;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    setCoordinatorHookForTest(async (name) => {
      if (name !== "lock-stale-observed" || observed) return;
      observed = true;
      await paused;
    });
    let active = 0;
    let maximum = 0;
    const staleObserver = new StateCoordinator(root).withLock(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      active -= 1;
    });
    for (let i = 0; i < 100 && !observed; i += 1) await Bun.sleep(5);
    expect(observed).toBe(true);
    const replacement = new StateCoordinator(root).withLock(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Bun.sleep(25);
      active -= 1;
    });
    await Bun.sleep(10);
    release();
    await Promise.all([staleObserver, replacement]);
    expect(maximum).toBe(1);
    expect(await Bun.file(join(root, "mutation.lock")).exists()).toBe(false);
  } finally {
    setCoordinatorHookForTest();
    await rm(root, { recursive: true, force: true });
  }
});

test("stale lock reclaimers serialize and clean their unique fences", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-guard-prepare-"));
  try {
    let active = 0;
    let maximum = 0;
    await Promise.all(
      [new StateCoordinator(root), new StateCoordinator(root)].map((coordinator) =>
        coordinator.withLock(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await Bun.sleep(10);
          active -= 1;
        }),
      ),
    );
    expect(maximum).toBe(1);
    expect(await readdir(join(root, "locks"))).toEqual([]);
  } finally {
    setCoordinatorHookForTest();
    await rm(root, { recursive: true, force: true });
  }
});

test("live and unverifiable locks time out without removing ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-live-guard-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "mutation.lock"),
      JSON.stringify({ pid: process.pid, nonce: "live" }),
    );
    await expect(
      new StateCoordinator(root, { platform: "darwin", lockTimeoutMs: 20 }).withLock(
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    expect(await Bun.file(join(root, "mutation.lock")).exists()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-Linux process tokens allow normal use cleanup and retain unverifiable owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-portable-token-"));
  const source = join(root, "source");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    const coordinator = new StateCoordinator(root, { platform: "darwin" });
    const digest = await coordinator.snapshotDigest(source);
    await coordinator.publishSnapshot(digest, source);
    let record: Record<string, unknown> | undefined;
    await coordinator.withRemoteUse(digest, async () => {
      const [name] = await Array.fromAsync(
        new Bun.Glob("*.json").scan({ cwd: join(root, "uses") }),
      );
      record = JSON.parse(await Bun.file(join(root, "uses", name!)).text());
    });
    expect(record).toMatchObject({ digest, pid: process.pid });
    expect(record?.startToken).toBeUndefined();
    expect(await Bun.file(join(root, "uses")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
