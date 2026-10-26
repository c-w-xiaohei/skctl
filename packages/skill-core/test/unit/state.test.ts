import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveStateRoot, StateCoordinator } from "../../src/storage/state";
import { snapshotId } from "../snapshot-fixture";
import { withFileLock } from "../../src/storage/file-lock";
import { processStatus, runProcess } from "../../src/runtime/process";
import type { InstalledMaterialization } from "../../src/storage/schema";

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
  expect(() => resolveStateRoot({ SKCTL_STATE_DIR: "relative" })).toThrow();
  expect(resolveStateRoot({ XDG_STATE_HOME: "/state", HOME: "/home/test" })).toBe("/state/skctl");
});

test("coordinator rejects symlinked managed entries and writes a private state file", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-state-security-"));
  try {
    const coordinator = new StateCoordinator(root);
    await coordinator.withLock(async () => {
      const current = await coordinator.read();
      await coordinator.write({ installed: [], configs: {} }, current.generation);
    });
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8")).generation).toBe(1);
    await rm(join(root, "staging"), { recursive: true });
    await symlink(root, join(root, "staging"));
    await expect(coordinator.withLock(() => coordinator.read())).rejects.toMatchObject({
      code: "CONFIG_SYMLINK",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coordinator rejects a symlink in an existing lexical state-root parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-state-parent-"));
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
  const root = await mkdtemp(join(tmpdir(), "skctl-state-shape-"));
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
    ).resolves.toMatchObject({
      version: 4,
      generation: 2,
      installed: [{ kind: "local" }, { kind: "remote", snapshotId: "c".repeat(64) }],
    });
    for (const mutation of [
      { ...valid, generation: 0.5 },
      { ...valid, extra: true },
      { ...valid, installed: [{ ...valid.installed[1], adoptedRevision: undefined }] },
      { ...valid, installed: [{ ...valid.installed[0], source: "e\u0301" }] },
      { ...valid, installed: [{ ...valid.installed[0], path: "" }] },
      { ...valid, configs: { "": { commit: "e".repeat(40), digest: "f".repeat(64) } } },
      {
        ...valid,
        configs: { upstream: { commit: "e".repeat(40), digest: "f".repeat(64), extra: true } },
      },
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
  const root = await mkdtemp(join(tmpdir(), "skctl-state-v2-shape-"));
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
      version: 4,
      installed: [{ kind: "local", identityEvidence: { status: "unavailable" } }],
    });
    expect(await readFile(state, "utf8")).toBe(legacy);
    await expect(
      coordinator.withLock(async () =>
        coordinator.write({ installed: [legacyLocal] as never, configs: {} }, 2),
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
  const root = await mkdtemp(join(tmpdir(), "skctl-state-migration-"));
  const state = join(root, "state.json");
  try {
    await writeFile(
      state,
      `${JSON.stringify({ version: 1, generation: 7, installed: [legacyLocal], configs: {} })}\n`,
    );
    const coordinator = new StateCoordinator(root);
    await coordinator.withLock(async () => {
      const current = await coordinator.read();
      await coordinator.write(
        {
          configs: current.configs,
          installed: [
            {
              ...current.installed[0]!,
              identityEvidence: {
                status: "known",
                canonicalOrigin: "/skills",
                originRelativeSkillRoot: "review",
              },
            } satisfies InstalledMaterialization,
          ],
        },
        current.generation,
      );
    });
    expect(JSON.parse(await readFile(state, "utf8"))).toMatchObject({
      version: 4,
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

test("v3 persists exact Root tree evidence and retains literal legacy records without read migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-state-v3-"));
  const file = join(root, "state.json");
  const identityEvidence = {
    status: "known" as const,
    canonicalOrigin: "https://example.test/repo.git",
    originRelativeSkillRoot: "skills/review",
  };
  const remote = {
    kind: "remote" as const,
    source: "team",
    path: "review",
    name: "review",
    description: "Review",
    digest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    adoptedRevision: "c".repeat(40),
    identityEvidence,
  };
  const treeIdentity = { objectFormat: "sha1", objectId: "d".repeat(40) };
  try {
    const coordinator = new StateCoordinator(root);
    for (const version of [1, 2]) {
      const { identityEvidence: _identity, ...v1 } = remote;
      const bytes = JSON.stringify({
        version,
        generation: 7,
        installed: [version === 1 ? v1 : remote],
        configs: {},
      });
      await writeFile(file, bytes);
      await expect(coordinator.withLock(() => coordinator.read())).resolves.toMatchObject({
        version: 4,
        generation: 7,
      });
      expect(await readFile(file, "utf8")).toBe(bytes);
      await writeFile(
        file,
        JSON.stringify({
          version,
          generation: 7,
          installed: [{ ...remote, treeIdentity }],
          configs: {},
        }),
      );
      await expect(coordinator.read()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    }
    const installed = [
      { ...remote, treeIdentity },
      {
        ...remote,
        path: "",
        identityEvidence: { ...identityEvidence, originRelativeSkillRoot: "" },
        treeIdentity,
      },
    ];
    await writeFile(file, JSON.stringify({ version: 3, generation: 7, installed, configs: {} }));
    await expect(coordinator.withLock(() => coordinator.read())).resolves.toMatchObject({
      installed: installed.map(({ digest, ...item }) => ({ ...item, snapshotId: digest })),
    });
    await coordinator.withLock(async () => {
      const current = await coordinator.read();
      const next = await coordinator.write({ installed: current.installed, configs: {} }, 7);
      expect(next).toMatchObject({ version: 4, generation: 8, installed: current.installed });
    });
    // Absent tree evidence is retained legacy state, not invented on a mutation.
    await writeFile(
      file,
      JSON.stringify({
        version: 3,
        generation: 0,
        installed: [
          remote,
          { ...remote, adoptedRevision: undefined, revisionStatus: "unresolved" },
        ],
        configs: {},
      }),
    );
    await expect(coordinator.read()).resolves.toMatchObject({ version: 4 });
    const unresolved = { ...remote, adoptedRevision: undefined, revisionStatus: "unresolved" };
    await writeFile(
      file,
      JSON.stringify({ version: 2, generation: 0, installed: [unresolved], configs: {} }),
    );
    await expect(coordinator.read()).resolves.toMatchObject({
      version: 4,
      installed: [{ revisionStatus: "unresolved" }],
    });
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        generation: 0,
        installed: [{ ...unresolved, identityEvidence: undefined }],
        configs: {},
      }),
    );
    await expect(coordinator.read()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    for (const bad of [
      { ...remote, treeIdentity: { ...treeIdentity, objectFormat: "sha256" } },
      { ...remote, treeIdentity: { ...treeIdentity, objectId: "D".repeat(40) } },
      { ...remote, treeIdentity: { ...treeIdentity, objectId: "d".repeat(64) } },
      { ...remote, treeIdentity: { ...treeIdentity, extra: true } },
      { ...remote, treeIdentity, extra: true },
      { ...remote, treeIdentity, identityEvidence: { status: "unavailable" } },
      { ...remote, treeIdentity, adoptedRevision: undefined, revisionStatus: "unresolved" },
      { ...remote, treeIdentity, revisionStatus: "unresolved" },
      { ...legacyLocal, identityEvidence, treeIdentity },
      { ...remote, treeIdentity, path: "../review" },
    ]) {
      await writeFile(
        file,
        JSON.stringify({ version: 3, generation: 0, installed: [bad], configs: {} }),
      );
      await expect(coordinator.read()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("STA-LOCK-ABA stale observer cannot detach a replacement owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-stale-lock-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "mutation.lock"),
      JSON.stringify({ pid: 999_999_999, nonce: "stale" }),
    );
    const module = join(import.meta.dir, "../../src/storage/file-lock.ts");
    const script = `import {withFileLock} from ${JSON.stringify(module)};
      import {open,rm} from 'node:fs/promises';
      await withFileLock(${JSON.stringify(join(root, "mutation.lock"))},async()=>{
        const guard=${JSON.stringify(join(root, "exclusive"))};
        const file=await open(guard,'wx');
        try {await Bun.sleep(25)} finally {await file.close();await rm(guard)}
      });`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => runProcess({ cmd: [process.execPath, "-e", script] })),
    );
    for (const result of results) if (result.status) throw new Error(result.stderr.toString());
    expect(results.map((result) => result.status)).toEqual([0, 0, 0, 0]);
    expect(await Bun.file(join(root, "mutation.lock")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale lock reclaimers serialize and clean their unique fences", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-guard-prepare-"));
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
    expect(
      (await readdir(root)).filter(
        (name) => name.includes("owner") || name.includes("fence") || name.endsWith(".election"),
      ),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live and unverifiable locks time out without removing ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-live-guard-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "mutation.lock"),
      JSON.stringify({ pid: process.pid, nonce: "live" }),
    );
    await expect(
      withFileLock(join(root, "mutation.lock"), async () => undefined, { timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    expect(await Bun.file(join(root, "mutation.lock")).exists()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PID-only ownership is unprovable while normal use records are removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-portable-token-"));
  const source = join(root, "source");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    const coordinator = new StateCoordinator(root);
    const digest = snapshotId();
    await coordinator.publishSnapshot(digest, source);
    let record: Record<string, unknown> | undefined;
    await coordinator.withInstalledRoot(
      async () => ({
        source: "fixture",
        path: "",
        name: "fixture",
        description: "Fixture",
        kind: "remote",
        snapshotId: digest,
        adoptedRevision: "a".repeat(40),
        bindingDigest: "b".repeat(64),
        identityEvidence: { status: "unavailable" },
      }),
      async () => {
        const [name] = await Array.fromAsync(
          new Bun.Glob("*.json").scan({ cwd: join(root, "uses") }),
        );
        record = JSON.parse(await Bun.file(join(root, "uses", name!)).text());
      },
    );
    expect(record).toMatchObject({ snapshotId: digest, pid: process.pid });
    expect(await processStatus({ pid: process.pid })).toBe("unknown");
    expect(await readdir(join(root, "uses"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
