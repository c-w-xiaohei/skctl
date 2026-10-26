import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readResource } from "../../src/content/operations";
import { StateCoordinator } from "../../src/storage/state";
import { bindingDigest } from "../../src/source/identity";

afterEach(() => mock.restore());

test("GC retains literal old use records and refuses ambiguous ownership after v4 migration", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "snapshot-old-use-"));
  const coordinator = new StateCoordinator(root);
  const id = "a".repeat(64),
    directory = join(root, "snapshots", id);
  try {
    await fs.mkdir(join(directory, "root"), { recursive: true });
    await fs.mkdir(join(root, "uses"));
    await fs.writeFile(join(directory, "root/SKILL.md"), "installed bytes");
    const use = join(root, "uses/old.json");
    await fs.writeFile(use, JSON.stringify({ digest: id, pid: process.pid, nonce: "legacy" }));
    await coordinator.gc();
    expect(await fs.readFile(join(directory, "root/SKILL.md"), "utf8")).toBe("installed bytes");
    await fs.writeFile(
      use,
      JSON.stringify({
        digest: id,
        snapshotId: crypto.randomUUID(),
        pid: process.pid,
        nonce: "ambiguous",
      }),
    );
    await coordinator.gc();
    expect(await fs.readFile(join(directory, "root/SKILL.md"), "utf8")).toBe("installed bytes");
    await fs.rm(use);
    await coordinator.gc();
    await expect(fs.lstat(directory)).rejects.toHaveProperty("code", "ENOENT");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("v1-v3 snapshot IDs migrate without reading content, rewriting state, or changing shared paths", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "snapshot-legacy-"));
  const digest = "a".repeat(64);
  const item = {
    source: "remote",
    path: "guide",
    name: "guide",
    description: "Guide",
    digest,
    bindingDigest: "b".repeat(64),
    kind: "remote",
    adoptedRevision: "c".repeat(40),
  };
  const identityEvidence = {
    status: "known",
    canonicalOrigin: "https://example.test/repo",
    originRelativeSkillRoot: "guide",
  };
  try {
    for (const version of [1, 2, 3]) {
      const legacy = {
        version,
        generation: 8,
        installed: [item, { ...item, source: "alias" }].map((entry) =>
          version === 1 ? entry : { ...entry, identityEvidence },
        ),
        configs: {},
      };
      const bytes = JSON.stringify(legacy);
      await fs.writeFile(join(root, "state.json"), bytes);
      const coordinator = new StateCoordinator(root);
      const current = await coordinator.withLock(() => coordinator.read());
      expect(current.version).toBe(4);
      expect(
        current.installed.every(
          (entry) => entry.kind === "remote" && entry.snapshotId === digest && !("digest" in entry),
        ),
      ).toBe(true);
      expect(await fs.readFile(join(root, "state.json"), "utf8")).toBe(bytes);
      await coordinator.write(current, current.generation);
      const saved = JSON.parse(await fs.readFile(join(root, "state.json"), "utf8"));
      expect(saved).toMatchObject({ version: 4, generation: 9 });
      expect(saved.installed.map((entry: { snapshotId: string }) => entry.snapshotId)).toEqual([
        digest,
        digest,
      ]);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reading one resource captures state once and never enumerates or reads unrelated snapshot entries", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "snapshot-read-work-"));
  const previous = process.env.SKCTL_STATE_DIR;
  const coordinator = new StateCoordinator(join(root, "state"));
  process.env.SKCTL_STATE_DIR = coordinator.root;
  const snapshotId = crypto.randomUUID();
  const snapshot = join(coordinator.root, "snapshots", snapshotId, "root");
  const origin = "https://example.test/repo";
  try {
    await fs.mkdir(join(snapshot, "references"), { recursive: true });
    await fs.writeFile(join(snapshot, "SKILL.md"), "---\nname: guide\ndescription: Guide\n---\n");
    await fs.writeFile(join(snapshot, "references/one.md"), "one resource");
    await fs.writeFile(
      join(root, "skctl.jsonc"),
      JSON.stringify({
        sources: { remote: { kind: "git", origin, root: "", ref: "main" } },
        collections: { c: { members: { guide: { source: "remote", path: "guide" } } } },
        use: ["c"],
        agents: { opencode: "managed" },
      }),
    );
    await coordinator.write(
      {
        configs: {},
        installed: [
          {
            source: "remote",
            path: "guide",
            name: "guide",
            description: "Guide",
            kind: "remote",
            snapshotId,
            bindingDigest: bindingDigest({ kind: "git", origin, root: "", ref: "main" }),
            adoptedRevision: "a".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: origin,
              originRelativeSkillRoot: "guide",
            },
          },
        ],
      },
      0,
    );
    const read = spyOn(fs, "readFile"),
      scan = spyOn(fs, "readdir"),
      state = spyOn(StateCoordinator.prototype, "read");
    const before = await fs.readFile(join(coordinator.root, "state.json"));
    expect(
      (
        await readResource(
          { cwd: root, project: root, userConfigPath: join(root, "missing.jsonc") },
          { selector: "c:guide", path: "references/one.md" },
        )
      ).text,
    ).toBe("one resource");
    expect(state).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls.filter(([path]) => String(path).startsWith(snapshot))).toHaveLength(0);
    expect(
      read.mock.calls
        .filter(([path]) => String(path).startsWith(snapshot))
        .map(([path]) => String(path)),
    ).toEqual([join(snapshot, "references/one.md")]);
    expect(await fs.readFile(join(coordinator.root, "state.json"))).toEqual(before);
    expect(await fs.readdir(join(coordinator.root, "uses"))).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
