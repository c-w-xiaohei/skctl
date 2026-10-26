import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
import { snapshotId } from "../snapshot-fixture";
import { bindingDigest, canonicalRemoteOrigin } from "../../src/source/identity";
import { setContentHookForTest } from "../../src/content/operations";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skctl-use-"));
  const source = join(root, "source");
  const state = new StateCoordinator(join(root, "state"));
  await mkdir(source);
  await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\nbody\n");
  const digest = snapshotId();
  await state.publishSnapshot(digest, source);
  return { root, state, digest };
}
test("USE-001/USE-002 creates a synced use only for a validated immutable snapshot and removes it", async () => {
  const value = await fixture();
  try {
    let record: Record<string, unknown> | undefined;
    await value.state.withInstalledRoot(
      async () => ({
        source: "fixture",
        path: "",
        name: "fixture",
        description: "Fixture",
        kind: "remote",
        snapshotId: value.digest,
        adoptedRevision: "a".repeat(40),
        bindingDigest: "b".repeat(64),
        identityEvidence: { status: "unavailable" },
      }),
      async () => {
        const names = await readdir(join(value.state.root, "uses"));
        record = JSON.parse(await Bun.file(join(value.state.root, "uses", names[0]!)).text());
      },
    );
    expect(record).toMatchObject({ snapshotId: value.digest, pid: process.pid });
    expect(typeof record?.startToken).toBe("string");
    expect(typeof record?.nonce).toBe("string");
    expect(await readdir(join(value.state.root, "uses"))).toEqual([]);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("Snapshot allocation IDs reject collisions without overwriting content", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-digest-"));
  const state = join(root, "state");
  const source = join(root, "source");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\none\n");
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    process.env.SKCTL_STATE_DIR = state;
    const coordinator = new StateCoordinator(state);
    const digest = snapshotId();
    await expect(coordinator.publishSnapshot("../escape", source)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      await Bun.file(join(state, "snapshots", "0".repeat(64), "root", "SKILL.md")).exists(),
    ).toBe(false);
    await coordinator.publishSnapshot(digest, source);
    const original = await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text();
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\ntwo\n");
    await expect(coordinator.publishSnapshot(digest, source)).rejects.toMatchObject({
      code: "DESTINATION_EXISTS",
    });
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text()).toBe(
      original,
    );
    expect(await coordinator.snapshotRoot(digest)).toContain(digest);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("USE-001/GC-001 public content read holds a use barrier against public GC", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-use-process-"));
  const state = join(root, "state");
  const source = join(root, "source");
  const global = join(root, "global.jsonc");
  try {
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: remote\ndescription: Remote\n---\nbody\n",
    );
    await writeFile(global, "{}\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/repo", root: "", ref: "main" },
        },
        collections: { c: { members: { s: { source: "remote", path: "skill" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    const digest = snapshotId();
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).write(
      {
        configs: {},
        installed: [
          {
            source: "remote",
            path: "skill",
            name: "remote",
            description: "Remote",
            kind: "remote",
            snapshotId: digest,
            bindingDigest: bindingDigest({
              kind: "git",
              origin: canonicalRemoteOrigin("https://example.test/repo"),
              root: "",
              ref: "main",
            }),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/repo",
              originRelativeSkillRoot: "skill",
            },
          },
        ],
      },
      0,
    );
    const entry = join(import.meta.dir, "../../src/index.ts");
    const gcScript = `import { gc } from ${JSON.stringify(entry)}; await gc();`;
    setContentHookForTest(async () => {
      expect(await readdir(join(state, "uses"))).toHaveLength(1);
      // Remove the state reference during the read: only its live use protects it.
      const coordinator = new StateCoordinator(state),
        current = await coordinator.read();
      await coordinator.write({ configs: {}, installed: [] }, current.generation);
      const gc = Bun.spawn({
        cmd: [process.execPath, "-e", gcScript],
        env: { ...process.env, SKCTL_STATE_DIR: state },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await gc.exited).toBe(0);
      expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).exists()).toBe(
        true,
      );
    });
    try {
      expect(
        (
          await api.readResource(
            { cwd: root, userConfigPath: global },
            { selector: "c:s", path: "SKILL.md" },
          )
        ).text,
      ).toContain("body");
    } finally {
      setContentHookForTest();
    }
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).exists()).toBe(
      true,
    );
    process.env.SKCTL_STATE_DIR = state;
    await api.removeMember(
      { cwd: root, userConfigPath: global },
      {
        level: "project",
        collection: "c",
        name: "s",
      },
    );
    await api.gc();
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).exists()).toBe(
      false,
    );
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("GC-003 retains unknown tombstones and a later same-digest public publication is independent", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.state.root, "trash", "unknown"), { recursive: true });
    await writeFile(join(value.state.root, "trash", "unknown", "owner"), "unknown");
    await value.state.gc();
    expect(await Bun.file(join(value.state.root, "trash", "unknown", "owner")).exists()).toBe(true);
    await value.state.gc();
    await value.state.publishSnapshot(value.digest, join(value.root, "source"));
    expect(
      await Bun.file(
        join(value.state.root, "snapshots", value.digest, "root", "SKILL.md"),
      ).exists(),
    ).toBe(true);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("GC-003 public collection crash retains a recorded tombstone until a later collector proves ownership dead", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-trash-crash-"));
  const state = join(root, "state");
  const source = join(root, "source");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    process.env.SKCTL_STATE_DIR = state;
    const digest = snapshotId();
    await new StateCoordinator(state).publishSnapshot(digest, source);
    delete process.env.SKCTL_STATE_DIR;
    const entry = join(import.meta.dir, "../../src/index.ts");
    const script = `import {spyOn} from 'bun:test';import * as fs from 'node:fs/promises';
      import {gc} from ${JSON.stringify(entry)};const rename=fs.rename;
      spyOn(fs,'rename').mockImplementation(async(a,b)=>{await rename(a,b);if(String(b).endsWith('/content'))process.exit(97)});await gc();`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: { ...process.env, SKCTL_STATE_DIR: state },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(5000).then(() => {
          child.kill();
          return -1;
        }),
      ]),
    ).toBe(97);
    expect((await readdir(join(state, "trash"))).length).toBe(1);
    process.env.SKCTL_STATE_DIR = state;
    await api.gc();
    expect((await readdir(join(state, "trash")).catch(() => [])).length).toBe(0);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("GC-001..003 retains malformed uses conservatively and collects only after ownership is knowable", async () => {
  const value = await fixture();
  const deadSource = join(value.root, "dead");
  try {
    await mkdir(deadSource);
    await writeFile(join(deadSource, "SKILL.md"), "---\nname: dead\ndescription: Dead\n---\n");
    const dead = snapshotId();
    await value.state.publishSnapshot(dead, deadSource);
    expect(
      await Bun.file(join(value.state.root, "snapshots", dead, "root", "SKILL.md")).exists(),
    ).toBe(true);
    await mkdir(join(value.state.root, "uses"), { recursive: true });
    await writeFile(join(value.state.root, "uses", "malformed.json"), "not json");
    await value.state.gc();
    expect(
      await Bun.file(
        join(value.state.root, "snapshots", value.digest, "root", "SKILL.md"),
      ).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(value.state.root, "snapshots", dead, "root", "SKILL.md")).exists(),
    ).toBe(true);
    expect(await Bun.file(join(value.state.root, "uses", "malformed.json")).exists()).toBe(true);
    await rm(join(value.state.root, "uses", "malformed.json"));
    await value.state.gc();
    expect(
      await Bun.file(join(value.state.root, "snapshots", dead, "root", "SKILL.md")).exists(),
    ).toBe(false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
