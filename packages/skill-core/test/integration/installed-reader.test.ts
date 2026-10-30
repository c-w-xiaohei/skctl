import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
import { snapshotId } from "../snapshot-fixture";
import { setContentHookForTest } from "../../src/content/operations";
test("READ-001/005/006 reads undisclosed installed content structurally and classifies non-text", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-reader-"));
  const skill = join(root, "skills", "review");
  const state = join(root, "state");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(skill, { recursive: true });
    await writeFile(join(root, "skctl.jsonc"), "{}");
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\nbody\n");
    await writeFile(join(skill, "data.bin"), Buffer.from([0, 1, 2]));
    const core = { cwd: root };
    await api.registerSource(core, {
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await api.installSkills(core, { source: "local", paths: ["review"] });
    expect(
      (await api.loadInstalledSkill(core, { address: { source: "local", path: "review" } }))
        .markdownText,
    ).toBe("body\n");
    expect(
      await api.readInstalledResource(core, {
        address: { source: "local", path: "review" },
        path: "data.bin",
      }),
    ).toMatchObject({
      kind: "not-text",
      reason: "binary",
      metadata: { path: "data.bin", kind: "file", size: 3 },
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("READ-001/003 structural load preserves malformed frontmatter while enforcing text limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-reader-load-"));
  const state = join(root, "state");
  const skill = join(root, "skill");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(skill);
    await writeFile(join(root, "skctl.jsonc"), "{}");
    await writeFile(join(skill, "SKILL.md"), "---\nname: live\ndescription: Live\n---\nbody\n");
    const core = { cwd: root };
    await api.registerSource(core, {
      level: "project",
      id: "missing",
      binding: { kind: "local", path: root, root: "" },
    });
    await api.installSkills(core, { source: "missing", paths: ["skill"] });
    await writeFile(join(root, "skctl.jsonc"), "{}");
    expect(
      await api.loadInstalledSkill(core, { address: { source: "missing", path: "skill" } }),
    ).toMatchObject({ name: "live", markdownText: "body\n" });
    expect((await api.getWorkspace(core)).value.installedSkills[0]).toMatchObject({
      owner: { health: "missing" },
      problems: [{ code: "CONFIG_INVALID" }],
    });
    for (const text of [
      "---\nname: [broken\n---\nbody\n",
      "---\nname: unfinished\n",
      "---\nname: 42\ndescription: invalid\n---\nbody",
      "---\nname: invalid/name\ndescription: invalid\n---\nbody",
      "---\nname: &alias live\ndescription: Live\n---\nbody",
      "---\nname: live\nname: duplicate\n---\nbody",
      "# Plain Skill text",
    ]) {
      await writeFile(join(skill, "SKILL.md"), text);
      expect(
        await api.loadInstalledSkill(core, { address: { source: "missing", path: "skill" } }),
      ).toMatchObject({ name: "live", description: "Live", rawText: text, markdownText: text });
    }
    await writeFile(join(skill, "SKILL.md"), Buffer.alloc(1048577, "x"));
    await expect(
      api.loadInstalledSkill(core, { address: { source: "missing", path: "skill" } }),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("READ-002/003/009 Remote structural reads use only an intact Snapshot despite owner drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-reader-remote-"));
  const state = join(root, "state");
  const source = join(root, "source");
  const fetch = globalThis.fetch;
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(source);
    await writeFile(join(root, "skctl.jsonc"), "{}");
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: remote\ndescription: Remote\n---\nbody\n",
    );
    const coordinator = new StateCoordinator(state);
    const digest = snapshotId();
    await coordinator.publishSnapshot(digest, source);
    await coordinator.write(
      {
        configs: {},
        installed: [
          {
            source: "drifted",
            path: "skill",
            name: "old",
            description: "Old",
            kind: "remote",
            snapshotId: digest,
            bindingDigest: "a".repeat(64),
            adoptedRevision: "a".repeat(40),
            identityEvidence: { status: "unavailable" },
          },
        ],
      },
      0,
    );
    globalThis.fetch = (() => {
      throw new Error("network called");
    }) as unknown as typeof fetch;
    const core = {
      cwd: root,
      sourceTransport: () => {
        throw new Error("provider called");
      },
    };
    expect(
      (await api.loadInstalledSkill(core, { address: { source: "drifted", path: "skill" } })).name,
    ).toBe("remote");
    expect(await readdir(join(state, "uses"))).toEqual([]);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("READ-004/005/006/011 structural resources are live, deterministic, bounded and safe", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-reader-tree-"));
  const state = join(root, "state");
  const skill = join(root, "tree");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(join(skill, "nested"), { recursive: true });
    await writeFile(join(root, "skctl.jsonc"), "{}");
    await writeFile(join(skill, "SKILL.md"), "---\nname: tree\ndescription: Tree\n---\n");
    await writeFile(join(skill, "nested", "z.md"), "# z");
    await writeFile(join(skill, "a.txt"), "a");
    const core = { cwd: root };
    await api.registerSource(core, {
      level: "project",
      id: "local",
      binding: { kind: "local", path: root, root: "" },
    });
    await api.installSkills(core, { source: "local", paths: ["tree"] });
    expect(
      (await api.listInstalledResources(core, { address: { source: "local", path: "tree" } })).map(
        (item) => item.path,
      ),
    ).toEqual(["a.txt", "nested", "nested/z.md"]);
    expect(
      await api.readInstalledResource(core, {
        address: { source: "local", path: "tree" },
        path: "nested/z.md",
      }),
    ).toMatchObject({ kind: "text", format: "markdown", text: "# z" });
    await writeFile(join(skill, "later.txt"), "later");
    expect(
      (await api.listInstalledResources(core, { address: { source: "local", path: "tree" } })).map(
        (item) => item.path,
      ),
    ).toContain("later.txt");
    await writeFile(join(skill, "large.txt"), Buffer.alloc(1048577));
    expect(
      await api.readInstalledResource(core, {
        address: { source: "local", path: "tree" },
        path: "large.txt",
      }),
    ).toMatchObject({ kind: "not-text", reason: "too-large", metadata: { size: 1048577 } });
    await writeFile(join(skill, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    expect(
      await api.readInstalledResource(core, {
        address: { source: "local", path: "tree" },
        path: "invalid.txt",
      }),
    ).toMatchObject({ kind: "not-text", reason: "binary" });
    setContentHookForTest(async () => {
      await writeFile(join(skill, "a.txt"), Buffer.alloc(1048577, "x"));
    });
    await expect(
      api.readInstalledResource(core, {
        address: { source: "local", path: "tree" },
        path: "a.txt",
      }),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
    setContentHookForTest();
    for (const path of ["../SKILL.md", "/etc/passwd", "nested\\z.md", "bad\0name"])
      await expect(
        api.readInstalledResource(core, { address: { source: "local", path: "tree" }, path }),
      ).rejects.toMatchObject({ code: "INVALID_RESOURCE_PATH" });
    await symlink("a.txt", join(skill, "link"));
    await expect(
      api.listInstalledResources(core, { address: { source: "local", path: "tree" } }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
    await expect(
      api.readInstalledResource(core, { address: { source: "local", path: "tree" }, path: "link" }),
    ).resolves.toMatchObject({
      kind: "not-text",
      reason: "unsupported",
      metadata: { path: "link", kind: "symlink" },
    });
    await rm(join(skill, "link"));
    let deep = skill;
    for (let index = 0; index < 33; index += 1) {
      deep = join(deep, `d${index}`);
      await mkdir(deep);
    }
    await expect(
      api.listInstalledResources(core, { address: { source: "local", path: "tree" } }),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
  } finally {
    setContentHookForTest();
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("READ-008/010 cancels protected Remote traversal and releases it for later GC", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-reader-cancel-"));
  const state = join(root, "state");
  const source = join(root, "source");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(source);
    await writeFile(join(root, "skctl.jsonc"), "{}");
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    await writeFile(join(source, "note.txt"), "note");
    const coordinator = new StateCoordinator(state);
    const digest = snapshotId();
    await coordinator.publishSnapshot(digest, source);
    await coordinator.write(
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
            bindingDigest: "a".repeat(64),
            adoptedRevision: "a".repeat(40),
            identityEvidence: { status: "unavailable" },
          },
        ],
      },
      0,
    );
    const controller = new AbortController();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    setContentHookForTest(async (name) => {
      if (name === "reader-before-read") {
        entered();
        await new Promise<void>((resolve) =>
          controller.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
    });
    const core = { cwd: root };
    const read = api.readInstalledResource(
      core,
      { address: { source: "remote", path: "skill" }, path: "note.txt" },
      { signal: controller.signal },
    );
    await waiting;
    expect((await readdir(join(state, "uses"))).length).toBe(1);
    controller.abort();
    await expect(read).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(join(state, "uses"))).toEqual([]);
    await api.uninstallSkills(core, { source: "remote", paths: ["skill"] });
    await coordinator.gc();
    expect(await Bun.file(join(state, "snapshots", digest)).exists()).toBe(false);
  } finally {
    setContentHookForTest();
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("READ-007 structural Remote reads reject a missing or corrupt Snapshot without repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-reader-corrupt-"));
  const state = join(root, "state");
  const source = join(root, "source");
  try {
    process.env.SKCTL_STATE_DIR = state;
    await mkdir(source);
    await writeFile(join(root, "skctl.jsonc"), "{}");
    await writeFile(join(source, "SKILL.md"), "---\nname: remote\ndescription: Remote\n---\n");
    const coordinator = new StateCoordinator(state);
    const digest = snapshotId();
    await coordinator.publishSnapshot(digest, source);
    await coordinator.write(
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
            bindingDigest: "a".repeat(64),
            adoptedRevision: "a".repeat(40),
            identityEvidence: { status: "unavailable" },
          },
        ],
      },
      0,
    );
    await rm(join(state, "snapshots", digest), { recursive: true, force: true });
    await expect(
      api.loadInstalledSkill(
        { cwd: root },
        {
          address: { source: "remote", path: "skill" },
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_INTEGRITY_FAILED" });
    expect(await Bun.file(join(state, "snapshots", digest)).exists()).toBe(false);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
