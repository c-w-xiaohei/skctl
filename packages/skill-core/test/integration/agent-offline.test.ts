import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/create-core";
import { bindingDigest, canonicalRemoteOrigin } from "../../src/internal/domain";
import { StateCoordinator } from "../../src/internal/state";
import { setAcquisitionTrapForTest } from "../../src/internal/sources";

const isolatedCore = (root: string) =>
  createSkillCliCore({ cwd: root, userConfigPath: join(root, "global.jsonc") });

function remoteBindingDigest(origin: string, root = "") {
  return bindingDigest({ kind: "git", origin: canonicalRemoteOrigin(origin), root, ref: "main" });
}

test("AGT-001/AGT-002/CNT-001 uses only exposed installed Local content across all operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-"));
  const state = join(root, "state");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(join(skill, "nested"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nbody\n");
    await writeFile(join(skill, "nested", "note.txt"), "note");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { engineering: { members: { review: { source: "source", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    await new StateCoordinator(state).installLocal("source", "review", skill);
    const previous = process.env.SKILL_CLI_STATE_DIR;
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    const selector = "engineering:review";
    expect((await core.content.load({ selector })).value.text).toContain("body");
    expect((await core.content.listResources({ selector })).value).toContainEqual(
      expect.objectContaining({ path: "nested/note.txt", size: 4 }),
    );
    expect((await core.content.read({ selector, path: "nested/note.txt" })).value.text).toBe(
      "note",
    );
    const output = join(root, "output.txt");
    await core.content.download({ selector, path: "nested/note.txt", output, force: false });
    expect(await Bun.file(output).text()).toBe("note");
    await expect(core.content.load({ selector: "source:review" })).rejects.toMatchObject({
      code: "SKILL_NOT_FOUND",
    });
    process.env.SKILL_CLI_STATE_DIR = previous;
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-033 browse refresh and Agent projection remain offline for Local and Remote materializations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-trap-"));
  const state = join(root, "state");
  const local = join(root, "skills", "local");
  const remote = join(root, "acquired");
  const fetch = globalThis.fetch;
  try {
    await mkdir(local, { recursive: true });
    await mkdir(remote, { recursive: true });
    await writeFile(join(local, "SKILL.md"), "---\nname: local\ndescription: Local\n---\n");
    await writeFile(join(local, "note.txt"), "local");
    await writeFile(join(remote, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    await writeFile(join(remote, "note.txt"), "remote");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          local: { kind: "local", path: "./skills", root: "" },
          remote: { kind: "git", origin: "https://example.test/repo", root: "", ref: "main" },
        },
        collections: {
          c: {
            members: {
              local: { source: "local", path: "local" },
              remote: { source: "remote", path: "remote" },
            },
          },
        },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    await new StateCoordinator(state).installLocal("local", "local", local);
    const digest = await new StateCoordinator(state).snapshotDigest(remote);
    await new StateCoordinator(state).publishSnapshot(digest, remote);
    await new StateCoordinator(state).installRemoteForTest({
      source: "remote",
      path: "remote",
      name: "remote",
      description: "Remote",
      kind: "remote",
      digest,
      bindingDigest: remoteBindingDigest("https://example.test/repo"),
      adoptedRevision: "a".repeat(40),
    });
    setAcquisitionTrapForTest(() => {
      throw new Error("provider/network acquisition occurred");
    });
    globalThis.fetch = (() => {
      throw new Error("network acquisition occurred");
    }) as unknown as typeof fetch;
    for (const selector of ["c:local", "c:remote"]) {
      await core.catalog.browse({ collection: "c" });
      await core.catalog.search({ query: selector });
      await core.content.load({ selector });
      await core.content.listResources({ selector });
      await core.content.read({ selector, path: "note.txt" });
      await core.content.download({
        selector,
        path: "note.txt",
        output: join(root, `${selector.replace(":", "-")}.txt`),
        force: false,
      });
      await core.content.run({ selector, argv: [process.execPath, "--eval", ""] });
    }
  } finally {
    setAcquisitionTrapForTest();
    globalThis.fetch = fetch;
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("CNT-001 rejects invalid and oversized installed text without side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-text-"));
  const state = join(root, "state");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nok\n");
    await writeFile(join(skill, "bad.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { engineering: { members: { review: { source: "source", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    await new StateCoordinator(state).installLocal("source", "review", skill);
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(join(skill, "large.txt"), Buffer.alloc(1_048_577, "x"));
    const core = isolatedCore(root);
    await expect(
      core.content.read({ selector: "engineering:review", path: "bad.txt" }),
    ).rejects.toMatchObject({ code: "INVALID_UTF8" });
    await expect(
      core.content.read({ selector: "engineering:review", path: "large.txt" }),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("AGT-001/002 USE-002 exposes all catalog and content operations from a Remote Snapshot only", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-remote-"));
  const state = join(root, "state");
  const source = join(root, "acquired");
  const output = join(root, "download.txt");
  const argv = join(root, "argv.json");
  try {
    await mkdir(join(source, "nested"), { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: remote\ndescription: Remote review\n---\nbody\n",
    );
    await writeFile(join(source, "nested", "note.txt"), "note");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/skills", root: "", ref: "main" },
        },
        collections: { engineering: { members: { review: { source: "remote", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    const digest = await new StateCoordinator(state).snapshotDigest(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).installRemoteForTest({
      source: "remote",
      path: "review",
      name: "remote",
      description: "Remote review",
      kind: "remote",
      digest,
      bindingDigest: remoteBindingDigest("https://example.test/skills"),
      adoptedRevision: "a".repeat(40),
    });
    const browsed = (await core.catalog.browse({ collection: "engineering" })).value;
    expect(browsed).toMatchObject({ status: "available" });
    if (browsed.status === "available") expect(browsed.items).toHaveLength(1);
    expect((await core.catalog.search({ query: "remote" })).value.results).toHaveLength(1);
    expect((await core.content.load({ selector: "engineering:review" })).value.name).toBe("remote");
    expect(
      (await core.content.listResources({ selector: "engineering:review" })).value,
    ).toContainEqual(expect.objectContaining({ path: "nested/note.txt" }));
    expect(
      (await core.content.read({ selector: "engineering:review", path: "nested/note.txt" })).value
        .text,
    ).toBe("note");
    await core.content.download({
      selector: "engineering:review",
      path: "nested/note.txt",
      output,
      force: false,
    });
    expect(await Bun.file(output).text()).toBe("note");
    const run = await core.content.run({
      selector: "engineering:review",
      argv: [
        process.execPath,
        "--eval",
        `import { readdir } from "node:fs/promises"; await Bun.write(${JSON.stringify(argv)}, JSON.stringify({ argv: process.argv.slice(-2), uses: await readdir(${JSON.stringify(join(state, "uses"))}).catch(() => []) }))`,
        "one two",
        "$(not-a-shell)",
      ],
    });
    expect(run.value.exitCode).toBe(0);
    expect(JSON.parse(await Bun.file(argv).text())).toEqual({
      argv: ["one two", "$(not-a-shell)"],
      uses: [],
    });
    expect(await Bun.file(join(state, "uses")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("AGT-002 does not repair a missing or corrupt Remote Snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-remote-missing-"));
  const state = join(root, "state");
  const source = join(root, "acquired");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/skills", root: "", ref: "main" },
        },
        collections: { engineering: { members: { review: { source: "remote", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    const digest = await new StateCoordinator(state).snapshotDigest(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).installRemoteForTest({
      source: "remote",
      path: "review",
      name: "remote",
      description: "Remote",
      kind: "remote",
      digest,
      bindingDigest: remoteBindingDigest("https://example.test/skills"),
      adoptedRevision: "a".repeat(40),
    });
    await rm(join(state, "snapshots", digest), { recursive: true, force: true });
    await expect(core.content.load({ selector: "engineering:review" })).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    expect(await Bun.file(join(state, "snapshots", digest)).exists()).toBe(false);
    await writeFile(join(source, "different.txt"), "different");
    const corrupt = await new StateCoordinator(state).snapshotDigest(source);
    await new StateCoordinator(state).publishSnapshot(corrupt, source);
    await new StateCoordinator(state).installRemoteForTest({
      source: "remote",
      path: "review",
      name: "remote",
      description: "Remote",
      kind: "remote",
      digest: corrupt,
      bindingDigest: remoteBindingDigest("https://example.test/skills"),
      adoptedRevision: "b".repeat(40),
    });
    await symlink("SKILL.md", join(state, "snapshots", corrupt, "root", "corrupt-link"));
    await expect(
      core.content.listResources({ selector: "engineering:review" }),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    expect(await Bun.file(join(state, "snapshots", corrupt, "root", "corrupt-link")).exists()).toBe(
      true,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("USE-001 rejects a live Remote Snapshot digest change before creating a use record", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-remote-tamper-"));
  const state = join(root, "state");
  const source = join(root, "acquired");
  const release = join(root, "release");
  try {
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: remote\ndescription: Remote\n---\noriginal\n",
    );
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/repo", root: "", ref: "main" },
        },
        collections: { c: { members: { remote: { source: "remote", path: "remote" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    const digest = await new StateCoordinator(state).snapshotDigest(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).installRemoteForTest({
      source: "remote",
      path: "remote",
      name: "remote",
      description: "Remote",
      kind: "remote",
      digest,
      bindingDigest: remoteBindingDigest("https://example.test/repo"),
      adoptedRevision: "a".repeat(40),
    });
    const snapshot = join(state, "snapshots", digest, "root", "SKILL.md");
    const stateBefore = await Bun.file(join(state, "state.json")).text();
    const cacheBefore = await Bun.file(join(state, "configs")).exists();
    const entry = join(import.meta.dir, "../../src/create-core.ts");
    const script = `import { createSkillCliCore } from ${JSON.stringify(entry)}; await createSkillCliCore({cwd:${JSON.stringify(root)},userConfigPath:${JSON.stringify(join(root, "global.jsonc"))}}).content.load({selector:"c:remote"});`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: {
        ...process.env,
        SKILL_CLI_STATE_DIR: state,
        SKILL_CLI_TEST_BARRIER_AT: "use-verify-before",
        SKILL_CLI_TEST_BARRIER_RELEASE: release,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (
      let index = 0;
      index < 500 && !(await Bun.file(join(state, "mutation.lock")).exists());
      index += 1
    )
      await Bun.sleep(10);
    await writeFile(snapshot, "---\nname: remote\ndescription: Remote\n---\ntampered\n");
    await writeFile(release, "go");
    expect(
      await Promise.race([
        child.exited,
        Bun.sleep(5_000).then(() => {
          child.kill();
          return -1;
        }),
      ]),
    ).not.toBe(0);
    expect(await Bun.file(join(state, "uses")).exists()).toBe(false);
    expect(await Bun.file(join(state, "state.json")).text()).toBe(stateBefore);
    expect(await Bun.file(join(state, "configs")).exists()).toBe(cacheBefore);
    await expect(
      core.content.read({ selector: "c:remote", path: "SKILL.md" }),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    await expect(
      core.content.run({ selector: "c:remote", argv: [process.execPath, "--eval", ""] }),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    expect(await Bun.file(join(state, "uses")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("CNT-001 rejects traversal, unsafe entries, output collisions, spawn failure, and cleans run roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-safety-"));
  const state = join(root, "state");
  const skill = join(root, "skills", "review");
  try {
    await mkdir(join(skill, "nested"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nok\n");
    await writeFile(join(skill, "nested", "note.txt"), "note");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { engineering: { members: { review: { source: "source", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    await new StateCoordinator(state).installLocal("source", "review", skill);
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    await expect(
      core.content.read({ selector: "engineering:review", path: "../SKILL.md" }),
    ).rejects.toMatchObject({ code: "INVALID_RESOURCE_PATH" });
    await expect(
      core.content.read({ selector: "engineering:review", path: "/etc/passwd" }),
    ).rejects.toMatchObject({ code: "INVALID_RESOURCE_PATH" });
    await symlink("nested/note.txt", join(skill, "unsafe-link"));
    await expect(
      core.content.listResources({ selector: "engineering:review" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
    await rm(join(skill, "unsafe-link"));
    const output = join(root, "output.txt");
    await writeFile(output, "old");
    await expect(
      core.content.download({
        selector: "engineering:review",
        path: "nested/note.txt",
        output,
        force: false,
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    await core.content.download({
      selector: "engineering:review",
      path: "nested/note.txt",
      output,
      force: true,
    });
    expect(await Bun.file(output).text()).toBe("note");
    await expect(
      core.content.download({
        selector: "engineering:review",
        path: "nested/note.txt",
        output: join(skill, "nested", "note.txt"),
        force: true,
      }),
    ).rejects.toMatchObject({ code: "WRITE_FAILED" });
    await expect(
      core.content.run({
        selector: "engineering:review",
        argv: ["/definitely/missing-executable"],
      }),
    ).rejects.toMatchObject({ code: "SPAWN_FAILED" });
    expect(await Bun.file(join(state, "runs")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("CNT-001 cancellation escalates a resistant child and removes its run root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-run-cancel-"));
  const state = join(root, "state");
  const skill = join(root, "skills", "review");
  try {
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { c: { members: { review: { source: "source", path: "review" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    await new StateCoordinator(state).installLocal("source", "review", skill);
    const controller = new AbortController();
    const run = isolatedCore(root).content.run(
      {
        selector: "c:review",
        argv: [
          process.execPath,
          "--eval",
          'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
        ],
      },
      { signal: controller.signal },
    );
    await Bun.sleep(50);
    controller.abort();
    expect((await run).value).toMatchObject({ cancelled: true, signal: "SIGTERM" });
    expect(await Bun.file(join(state, "runs")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("CNT-001 coordinator rejects a symlinked runs tree for Local and Remote runs without mutating content", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-run-tree-"));
  const state = join(root, "state");
  const local = join(root, "skills", "local");
  const remote = join(root, "acquired");
  const outside = join(root, "outside");
  try {
    await mkdir(local, { recursive: true });
    await mkdir(remote, { recursive: true });
    await mkdir(outside);
    for (const skill of [local, remote])
      await writeFile(
        join(skill, "SKILL.md"),
        `---\nname: ${skill === local ? "local" : "remote"}\ndescription: Test\n---\n`,
      );
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          local: { kind: "local", path: "./skills", root: "" },
          remote: { kind: "git", origin: "https://example.test/repo", root: "", ref: "main" },
        },
        collections: {
          c: {
            members: {
              local: { source: "local", path: "local" },
              remote: { source: "remote", path: "remote" },
            },
          },
        },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    const coordinator = new StateCoordinator(state);
    await coordinator.installLocal("local", "local", local);
    const digest = await coordinator.snapshotDigest(remote);
    await coordinator.publishSnapshot(digest, remote);
    await coordinator.installRemoteForTest({
      source: "remote",
      path: "remote",
      name: "remote",
      description: "Remote",
      kind: "remote",
      digest,
      bindingDigest: remoteBindingDigest("https://example.test/repo"),
      adoptedRevision: "a".repeat(40),
    });
    const before = await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text();
    await symlink(outside, join(state, "runs"));
    for (const selector of ["c:local", "c:remote"])
      await expect(
        core.content.run({ selector, argv: [process.execPath, "--eval", ""] }),
      ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
    expect(await Bun.file(join(outside, "root", "SKILL.md")).exists()).toBe(false);
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text()).toBe(
      before,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("CNT-001 rejects gitlinks before Snapshot publication and Local run copying without state mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-gitlink-"));
  const state = join(root, "state");
  const skill = join(root, "skills", "review");
  try {
    await mkdir(join(skill, ".git"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(join(skill, ".git", "config"), "gitdir");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { local: { kind: "local", path: "./skills", root: "" } },
        collections: { c: { members: { review: { source: "local", path: "review" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = isolatedCore(root);
    const coordinator = new StateCoordinator(state);
    await coordinator.installLocal("local", "review", skill);
    const before = await Bun.file(join(state, "state.json")).text();
    await expect(coordinator.publishSnapshot("a".repeat(64), skill)).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    await expect(
      core.content.run({ selector: "c:review", argv: [process.execPath, "--eval", ""] }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
    expect(
      await Bun.file(join(state, "snapshots", "a".repeat(64), "root", "SKILL.md")).exists(),
    ).toBe(false);
    expect(await Bun.file(join(state, "state.json")).text()).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
