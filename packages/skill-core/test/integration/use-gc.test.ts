import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
import { bindingDigest, canonicalRemoteOrigin } from "../../src/source/identity";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-use-"));
  const source = join(root, "source");
  const state = new StateCoordinator(join(root, "state"));
  await mkdir(source);
  await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\nbody\n");
  const digest = await state.snapshotDigest(source);
  await state.publishSnapshot(digest, source);
  return { root, state, digest };
}
test("USE-001/USE-002 creates a synced use only for a validated immutable snapshot and removes it", async () => {
  const value = await fixture();
  try {
    let record: Record<string, unknown> | undefined;
    await value.state.withRemoteUse(value.digest, async () => {
      const names = await readdir(join(value.state.root, "uses"));
      record = JSON.parse(await Bun.file(join(value.state.root, "uses", names[0]!)).text());
    });
    expect(record).toMatchObject({ digest: value.digest, pid: process.pid });
    expect(typeof record?.startToken).toBe("string");
    expect(typeof record?.nonce).toBe("string");
    expect(await readdir(join(value.state.root, "uses"))).toEqual([]);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
test("USE-001 public Snapshot publication requires the canonical digest and rejects collisions without changing state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-digest-"));
  const state = join(root, "state");
  const source = join(root, "source");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\none\n");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    process.env.SKILL_CLI_STATE_DIR = state;
    const coordinator = new StateCoordinator(state);
    const digest = await coordinator.snapshotDigest(source);
    await expect(coordinator.publishSnapshot("0".repeat(64), source)).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    expect(
      await Bun.file(join(state, "snapshots", "0".repeat(64), "root", "SKILL.md")).exists(),
    ).toBe(false);
    await coordinator.publishSnapshot(digest, source);
    const original = await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text();
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\ntwo\n");
    await expect(coordinator.publishSnapshot(digest, source)).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text()).toBe(
      original,
    );
    expect(
      await new StateCoordinator(state).snapshotDigest(join(state, "snapshots", digest, "root")),
    ).toBe(digest);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("USE-001/GC-001 public content read holds a use barrier against public GC", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-use-process-"));
  const state = join(root, "state");
  const source = join(root, "source");
  const release = join(root, "release");
  const global = join(root, "global.jsonc");
  try {
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: remote\ndescription: Remote\n---\nbody\n",
    );
    await writeFile(global, "{}\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/repo", root: "", ref: "main" },
        },
        collections: { c: { members: { s: { source: "remote", path: "skill" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const digest = await new StateCoordinator(state).snapshotDigest(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).installRemoteForTest({
      source: "remote",
      path: "skill",
      name: "remote",
      description: "Remote",
      kind: "remote",
      digest,
      bindingDigest: bindingDigest({
        kind: "git",
        origin: canonicalRemoteOrigin("https://example.test/repo"),
        root: "",
        ref: "main",
      }),
      adoptedRevision: "a".repeat(40),
    });
    delete process.env.SKILL_CLI_STATE_DIR;
    const entry = join(import.meta.dir, "../../src/index.ts");
    const readScript = `import { readResource } from ${JSON.stringify(entry)}; await readResource({cwd:${JSON.stringify(root)},userConfigPath:${JSON.stringify(global)}}, {selector:"c:s",path:"SKILL.md"});`;
    const gcScript = `import { gc } from ${JSON.stringify(entry)}; await gc();`;
    const reader = Bun.spawn({
      cmd: [process.execPath, "--eval", readScript],
      env: {
        ...process.env,
        SKILL_CLI_STATE_DIR: state,
        SKILL_CLI_TEST_BARRIER_AT: "use-created",
        SKILL_CLI_TEST_BARRIER_RELEASE: release,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let i = 0; i < 500 && !(await Bun.file(join(state, "mutation.lock")).exists()); i += 1)
      await Bun.sleep(10);
    expect(await Bun.file(join(state, "mutation.lock")).exists()).toBe(true);
    const gc = Bun.spawn({
      cmd: [process.execPath, "--eval", gcScript],
      env: { ...process.env, SKILL_CLI_STATE_DIR: state },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      await Promise.race([gc.exited.then(() => "exited"), Bun.sleep(100).then(() => "waiting")]),
    ).toBe("waiting");
    await writeFile(release, "go");
    expect(
      await Promise.race([
        reader.exited,
        Bun.sleep(5000).then(() => {
          reader.kill();
          return -1;
        }),
      ]),
    ).toBe(0);
    expect(
      await Promise.race([
        gc.exited,
        Bun.sleep(5000).then(() => {
          gc.kill();
          return -1;
        }),
      ]),
    ).toBe(0);
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).exists()).toBe(
      true,
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    await api.removeMember(
      { cwd: root, userConfigPath: global },
      {
        level: "project",
        collection: "c",
        name: "s",
      },
    );
    await api.uninstallSkills(
      { cwd: root, userConfigPath: global },
      {
        source: "remote",
        paths: ["skill"],
      },
    );
    await api.gc();
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).exists()).toBe(
      false,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
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
  const root = await mkdtemp(join(tmpdir(), "skill-cli-trash-crash-"));
  const state = join(root, "state");
  const source = join(root, "source");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    process.env.SKILL_CLI_STATE_DIR = state;
    const digest = await new StateCoordinator(state).snapshotDigest(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    delete process.env.SKILL_CLI_STATE_DIR;
    const entry = join(import.meta.dir, "../../src/index.ts");
    const script = `import { gc } from ${JSON.stringify(entry)}; await gc();`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: { ...process.env, SKILL_CLI_STATE_DIR: state, SKILL_CLI_TEST_CRASH_AT: "trash-moved" },
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
    process.env.SKILL_CLI_STATE_DIR = state;
    await api.gc();
    expect((await readdir(join(state, "trash")).catch(() => [])).length).toBe(0);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("GC-001..003 retains malformed uses conservatively and collects only after ownership is knowable", async () => {
  const value = await fixture();
  const deadSource = join(value.root, "dead");
  try {
    await mkdir(deadSource);
    await writeFile(join(deadSource, "SKILL.md"), "---\nname: dead\ndescription: Dead\n---\n");
    const dead = await value.state.snapshotDigest(deadSource);
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
