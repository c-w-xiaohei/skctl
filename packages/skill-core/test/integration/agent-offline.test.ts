import * as api from "../../src/index";
import { expect, spyOn, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindingDigest, canonicalRemoteOrigin } from "../../src/source/identity";
import { StateCoordinator } from "../../src/storage/state";
import { digestDirectory } from "../../src/content/directory";
const isolatedCore = (root: string) => ({
  cwd: root,
  userConfigPath: join(root, "global.jsonc"),
  sourceTransport: () => {
    throw new Error("Agent must not acquire Sources");
  },
});
function remoteBindingDigest(origin: string, root = "") {
  return bindingDigest({ kind: "git", origin: canonicalRemoteOrigin(origin), root, ref: "main" });
}
test("AGT-001/AGT-002/CNT-001 uses only exposed installed Local content across all operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-"));
  const state = join(root, "state");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(join(skill, "nested"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nbody\n");
    await writeFile(join(skill, "nested", "note.txt"), "note");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { engineering: { members: { review: { source: "source", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    const previous = process.env.SKCTL_STATE_DIR;
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    await api.installSkills(core, { source: "source", paths: ["review"] });
    const selector = "engineering:review";
    expect((await api.loadSkill(core, { selector })).text).toContain("body");
    expect(
      await api.listInstalledResources(core, { address: { source: "source", path: "review" } }),
    ).toContainEqual(expect.objectContaining({ path: "nested/note.txt", size: 4 }));
    expect((await api.readResource(core, { selector, path: "nested/note.txt" })).text).toBe("note");
    const output = join(root, "output.txt");
    await api.downloadResource(core, { selector, path: "nested/note.txt", output, force: false });
    expect(await Bun.file(output).text()).toBe("note");
    await expect(api.loadSkill(core, { selector: "source:review" })).rejects.toMatchObject({
      code: "SKILL_NOT_FOUND",
    });
    process.env.SKCTL_STATE_DIR = previous;
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-033 browse refresh and Agent projection remain offline for Local and Remote materializations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-trap-"));
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
      join(root, "skctl.jsonc"),
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
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    await api.installSkills(core, { source: "local", paths: ["local"] });
    const digest = await digestDirectory(remote);
    await new StateCoordinator(state).publishSnapshot(digest, remote);
    const coordinator = new StateCoordinator(state),
      current = await coordinator.read();
    await coordinator.write(
      {
        configs: {},
        installed: [
          ...current.installed,
          {
            source: "remote",
            path: "remote",
            name: "remote",
            description: "Remote",
            kind: "remote",
            digest,
            bindingDigest: remoteBindingDigest("https://example.test/repo"),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/repo",
              originRelativeSkillRoot: "remote",
            },
          },
        ],
      },
      current.generation,
    );
    globalThis.fetch = (() => {
      throw new Error("network acquisition occurred");
    }) as unknown as typeof fetch;
    for (const selector of ["c:local", "c:remote"]) {
      await api.browseCatalog(core, { collection: "c" });
      await api.searchSkills(core, { query: selector });
      await api.loadSkill(core, { selector });
      await api.listInstalledResources(core, {
        address: { source: selector.slice(2), path: selector.slice(2) },
      });
      await api.readResource(core, { selector, path: "note.txt" });
      await api.downloadResource(core, {
        selector,
        path: "note.txt",
        output: join(root, `${selector.replace(":", "-")}.txt`),
        force: false,
      });
      await api.runSkill(core, { selector, argv: [process.execPath, "--eval", ""] });
    }
  } finally {
    globalThis.fetch = fetch;
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("CNT-001 rejects invalid and oversized installed text without side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-text-"));
  const state = join(root, "state");
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nok\n");
    await writeFile(join(skill, "bad.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { engineering: { members: { review: { source: "source", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    await api.installSkills(isolatedCore(root), { source: "source", paths: ["review"] });
    await writeFile(join(skill, "large.txt"), Buffer.alloc(1048577, "x"));
    const core = isolatedCore(root);
    await expect(
      api.readResource(core, { selector: "engineering:review", path: "bad.txt" }),
    ).rejects.toMatchObject({ code: "INVALID_UTF8" });
    await expect(
      api.readResource(core, { selector: "engineering:review", path: "large.txt" }),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("AGT-001/002 USE-002 exposes all catalog and content operations from a Remote Snapshot only", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-remote-"));
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
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/skills", root: "", ref: "main" },
        },
        collections: { engineering: { members: { review: { source: "remote", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    const digest = await digestDirectory(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).write(
      {
        configs: {},
        installed: [
          {
            source: "remote",
            path: "review",
            name: "remote",
            description: "Remote review",
            kind: "remote",
            digest,
            bindingDigest: remoteBindingDigest("https://example.test/skills"),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/skills",
              originRelativeSkillRoot: "review",
            },
          },
        ],
      },
      0,
    );
    const browsed = (await api.browseCatalog(core, { collection: "engineering" })).value;
    expect(browsed).toMatchObject({ status: "available" });
    if (browsed.status === "available") expect(browsed.items).toHaveLength(1);
    expect((await api.searchSkills(core, { query: "remote" })).value.results).toHaveLength(1);
    expect((await api.loadSkill(core, { selector: "engineering:review" })).name).toBe("remote");
    expect(
      await api.listInstalledResources(core, { address: { source: "remote", path: "review" } }),
    ).toContainEqual(expect.objectContaining({ path: "nested/note.txt" }));
    expect(
      (await api.readResource(core, { selector: "engineering:review", path: "nested/note.txt" }))
        .text,
    ).toBe("note");
    await api.downloadResource(core, {
      selector: "engineering:review",
      path: "nested/note.txt",
      output,
      force: false,
    });
    expect(await Bun.file(output).text()).toBe("note");
    const run = await api.runSkill(core, {
      selector: "engineering:review",
      argv: [
        process.execPath,
        "--eval",
        `import { readdir } from "node:fs/promises"; await Bun.write(${JSON.stringify(argv)}, JSON.stringify({ argv: process.argv.slice(-2), uses: await readdir(${JSON.stringify(join(state, "uses"))}).catch(() => []) }))`,
        "one two",
        "$(not-a-shell)",
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(await Bun.file(argv).text())).toEqual({
      argv: ["one two", "$(not-a-shell)"],
      uses: [],
    });
    expect(await readdir(join(state, "uses"))).toEqual([]);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("AGT-002 does not repair a missing or corrupt Remote Snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-remote-missing-"));
  const state = join(root, "state");
  const source = join(root, "acquired");
  try {
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/skills", root: "", ref: "main" },
        },
        collections: { engineering: { members: { review: { source: "remote", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    const digest = await digestDirectory(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).write(
      {
        configs: {},
        installed: [
          {
            source: "remote",
            path: "review",
            name: "remote",
            description: "Remote",
            kind: "remote",
            digest,
            bindingDigest: remoteBindingDigest("https://example.test/skills"),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/skills",
              originRelativeSkillRoot: "review",
            },
          },
        ],
      },
      0,
    );
    await rm(join(state, "snapshots", digest), { recursive: true, force: true });
    await expect(api.loadSkill(core, { selector: "engineering:review" })).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    expect(await Bun.file(join(state, "snapshots", digest)).exists()).toBe(false);
    await writeFile(join(source, "different.txt"), "different");
    const corrupt = await digestDirectory(source);
    await new StateCoordinator(state).publishSnapshot(corrupt, source);
    await new StateCoordinator(state).write(
      {
        configs: {},
        installed: [
          {
            source: "remote",
            path: "review",
            name: "remote",
            description: "Remote",
            kind: "remote",
            digest: corrupt,
            bindingDigest: remoteBindingDigest("https://example.test/skills"),
            adoptedRevision: "b".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/skills",
              originRelativeSkillRoot: "review",
            },
          },
        ],
      },
      1,
    );
    await symlink("SKILL.md", join(state, "snapshots", corrupt, "root", "corrupt-link"));
    await expect(
      api.listInstalledResources(core, { address: { source: "remote", path: "review" } }),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    expect(await Bun.file(join(state, "snapshots", corrupt, "root", "corrupt-link")).exists()).toBe(
      true,
    );
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("USE-001 rejects a live Remote Snapshot digest change before creating a use record", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-remote-tamper-"));
  const state = join(root, "state");
  const source = join(root, "acquired");
  try {
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: remote\ndescription: Remote\n---\noriginal\n",
    );
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: {
          remote: { kind: "git", origin: "https://example.test/repo", root: "", ref: "main" },
        },
        collections: { c: { members: { remote: { source: "remote", path: "remote" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    const digest = await digestDirectory(source);
    await new StateCoordinator(state).publishSnapshot(digest, source);
    await new StateCoordinator(state).write(
      {
        configs: {},
        installed: [
          {
            source: "remote",
            path: "remote",
            name: "remote",
            description: "Remote",
            kind: "remote",
            digest,
            bindingDigest: remoteBindingDigest("https://example.test/repo"),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/repo",
              originRelativeSkillRoot: "remote",
            },
          },
        ],
      },
      0,
    );
    const snapshot = join(state, "snapshots", digest, "root", "SKILL.md");
    const stateBefore = await Bun.file(join(state, "state.json")).text();
    const cacheBefore = await Bun.file(join(state, "configs")).exists();
    const verify = StateCoordinator.prototype.verifySnapshot;
    const mutation = spyOn(StateCoordinator.prototype, "verifySnapshot").mockImplementation(
      async function (this: StateCoordinator, digest) {
        await writeFile(snapshot, "---\nname: remote\ndescription: Remote\n---\ntampered\n");
        return verify.call(this, digest);
      },
    );
    try {
      await expect(api.loadSkill(core, { selector: "c:remote" })).rejects.toHaveProperty(
        "code",
        "PROVIDER_INTEGRITY_FAILED",
      );
    } finally {
      mutation.mockRestore();
    }
    expect(await Bun.file(join(state, "uses")).exists()).toBe(false);
    expect(await Bun.file(join(state, "state.json")).text()).toBe(stateBefore);
    expect(await Bun.file(join(state, "configs")).exists()).toBe(cacheBefore);
    await expect(
      api.readResource(core, { selector: "c:remote", path: "SKILL.md" }),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    await expect(
      api.runSkill(core, { selector: "c:remote", argv: [process.execPath, "--eval", ""] }),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    expect(await Bun.file(join(state, "uses")).exists()).toBe(false);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("CNT-001 rejects traversal, unsafe entries, output collisions, spawn failure, and cleans run roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-agent-safety-"));
  const state = join(root, "state");
  const skill = join(root, "skills", "review");
  try {
    await mkdir(join(skill, "nested"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nok\n");
    await writeFile(join(skill, "nested", "note.txt"), "note");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { engineering: { members: { review: { source: "source", path: "review" } } } },
        use: ["engineering"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    await api.installSkills(core, { source: "source", paths: ["review"] });
    await expect(
      api.readResource(core, { selector: "engineering:review", path: "../SKILL.md" }),
    ).rejects.toMatchObject({ code: "INVALID_RESOURCE_PATH" });
    await expect(
      api.readResource(core, { selector: "engineering:review", path: "/etc/passwd" }),
    ).rejects.toMatchObject({ code: "INVALID_RESOURCE_PATH" });
    await symlink("nested/note.txt", join(skill, "unsafe-link"));
    await expect(
      api.listInstalledResources(core, { address: { source: "source", path: "review" } }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
    await rm(join(skill, "unsafe-link"));
    const output = join(root, "output.txt");
    await writeFile(output, "old");
    await expect(
      api.downloadResource(core, {
        selector: "engineering:review",
        path: "nested/note.txt",
        output,
        force: false,
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    await api.downloadResource(core, {
      selector: "engineering:review",
      path: "nested/note.txt",
      output,
      force: true,
    });
    expect(await Bun.file(output).text()).toBe("note");
    await expect(
      api.downloadResource(core, {
        selector: "engineering:review",
        path: "nested/note.txt",
        output: join(skill, "nested", "note.txt"),
        force: true,
      }),
    ).rejects.toMatchObject({ code: "WRITE_FAILED" });
    await expect(
      api.runSkill(core, {
        selector: "engineering:review",
        argv: ["/definitely/missing-executable"],
      }),
    ).rejects.toMatchObject({ code: "SPAWN_FAILED" });
    expect(await readdir(join(state, "runs"))).toEqual([]);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("CNT-001 cancellation escalates a resistant child and removes its run root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-run-cancel-"));
  const state = join(root, "state");
  const skill = join(root, "skills", "review");
  const ready = join(root, "child-ready.json");
  const previous = process.env.SKCTL_STATE_DIR;
  const controller = new AbortController();
  const core = isolatedCore(root);
  let run: ReturnType<typeof api.runSkill> | undefined;
  try {
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { c: { members: { review: { source: "source", path: "review" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    await api.installSkills(core, { source: "source", paths: ["review"] });
    run = api.runSkill(
      core,
      {
        selector: "c:review",
        argv: [
          process.execPath,
          "--eval",
          `import { renameSync, writeFileSync } from "node:fs"; process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); writeFileSync(${JSON.stringify(`${ready}.tmp`)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() })); renameSync(${JSON.stringify(`${ready}.tmp`)}, ${JSON.stringify(ready)});`,
        ],
      },
      { signal: controller.signal },
    );
    // Keep an early run rejection observed while polling; finally still awaits it.
    void run.catch(() => undefined);
    // Observe the real child only after its TERM-resistant handler is installed.
    let child:
      | {
          pid: number;
          cwd: string;
        }
      | undefined;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        child = JSON.parse(await readFile(ready, "utf8"));
        break;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      await Bun.sleep(10);
    }
    if (!child) throw new Error("Resistant child did not report readiness within 10 seconds");
    expect(child.pid).toBeGreaterThan(0);
    const entries = await readdir(join(state, "runs"));
    expect(entries).toHaveLength(1);
    const directory = join(state, "runs", entries[0]!);
    expect(child.cwd).toBe(join(directory, "root"));
    expect((await lstat(child.cwd)).isDirectory()).toBe(true);
    controller.abort();
    const result = await Promise.race([
      run,
      Bun.sleep(2000).then(() => {
        throw new Error("Resistant child cancellation did not complete within 2 seconds");
      }),
    ]);
    expect(result).toMatchObject({ cancelled: true, signal: "SIGKILL", exitCode: 137 });
    await expect(lstat(child.cwd)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(state, "runs"))).toEqual([]);
  } finally {
    controller.abort();
    try {
      // Do not remove fixture bytes while this test's run is still pending.
      if (run) await run;
    } finally {
      if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  }
}, 15000);
test("CNT-001 coordinator rejects a symlinked runs tree for Local and Remote runs without mutating content", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-run-tree-"));
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
      join(root, "skctl.jsonc"),
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
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    const coordinator = new StateCoordinator(state);
    await api.installSkills(core, { source: "local", paths: ["local"] });
    const digest = await digestDirectory(remote);
    await coordinator.publishSnapshot(digest, remote);
    const current = await coordinator.read();
    await coordinator.write(
      {
        configs: {},
        installed: [
          ...current.installed,
          {
            source: "remote",
            path: "remote",
            name: "remote",
            description: "Remote",
            kind: "remote",
            digest,
            bindingDigest: remoteBindingDigest("https://example.test/repo"),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/repo",
              originRelativeSkillRoot: "remote",
            },
          },
        ],
      },
      current.generation,
    );
    const before = await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text();
    await symlink(outside, join(state, "runs"));
    for (const selector of ["c:local", "c:remote"])
      await expect(
        api.runSkill(core, { selector, argv: [process.execPath, "--eval", ""] }),
      ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
    expect(await Bun.file(join(outside, "root", "SKILL.md")).exists()).toBe(false);
    expect(await Bun.file(join(state, "snapshots", digest, "root", "SKILL.md")).text()).toBe(
      before,
    );
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("CNT-001 rejects gitlinks before Snapshot publication and Local run copying without state mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-gitlink-"));
  const state = join(root, "state");
  const skill = join(root, "skills", "review");
  try {
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { local: { kind: "local", path: "./skills", root: "" } },
        collections: { c: { members: { review: { source: "local", path: "review" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    process.env.SKCTL_STATE_DIR = state;
    const core = isolatedCore(root);
    const coordinator = new StateCoordinator(state);
    await api.installSkills(core, { source: "local", paths: ["review"] });
    await mkdir(join(skill, ".git"));
    await writeFile(join(skill, ".git", "config"), "gitdir");
    const before = await Bun.file(join(state, "state.json")).text();
    await expect(coordinator.publishSnapshot("a".repeat(64), skill)).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    await expect(
      api.runSkill(core, { selector: "c:review", argv: [process.execPath, "--eval", ""] }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
    expect(
      await Bun.file(join(state, "snapshots", "a".repeat(64), "root", "SKILL.md")).exists(),
    ).toBe(false);
    expect(await Bun.file(join(state, "state.json")).text()).toBe(before);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
