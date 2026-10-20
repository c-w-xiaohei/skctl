import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { cp, readFile, rm, writeFile, utimes } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import * as git from "isomorphic-git";
import { compareSource } from "../../src/source/service";
import { withRepository } from "../../src/source/service/remote/cache";
import { GitObjects } from "../../src/source/service/remote/objects";
import { repositoryFixture } from "./repository-fixture";
import { GitTransfer } from "../../src/source/service/remote/git";
import * as files from "../../src/storage/files";

let value: Awaited<ReturnType<typeof fixture>>;
let savedCache: string | undefined;
let root: string | undefined;
beforeEach(async () => {
  root = undefined;
  savedCache = process.env.SKCTL_SOURCE_CACHE_DIR;
  value = await fixture();
});
afterEach(async () => {
  mock.restore();
  if (savedCache === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
  else process.env.SKCTL_SOURCE_CACHE_DIR = savedCache;
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const paths = Array.from({ length: 8 }, (_, index) => `skill-${index}`);
  const files = Object.fromEntries([
    ...paths.map((path) => [
      `skills/${path}/SKILL.md`,
      `---\nname: ${path}\ndescription: ${path}\n---\n`,
    ]),
    ...Array.from({ length: 128 }, (_, index) => [
      `unrelated/group-${index}/file`,
      `unique ${index}`,
    ]),
  ]);
  const value = await repositoryFixture(files);
  root = value.root;
  process.env.SKCTL_SOURCE_CACHE_DIR = join(value.root, "cache");
  const context = {
    binding: {
      id: "team",
      kind: "git" as const,
      origin: "https://example.test/work.git",
      ref: "main",
      root: "skills",
      provenance: { level: "project" as const },
      selectors: [],
    },
    transport: () => value.bare,
  };
  const evidence = paths.map((path) => ({ path, digest: "a".repeat(64), revision: value.commit }));
  await compareSource(context, evidence, { commit: value.commit });
  const request = {
    origin: context.binding.origin,
    kind: "git" as const,
    ref: "main",
    transport: () => value.bare,
  };
  const key = new Bun.CryptoHasher("sha256").update(request.origin).digest("hex");
  const directory = join(process.env.SKCTL_SOURCE_CACHE_DIR, "origins", key, "objects.git");
  return {
    ...value,
    paths,
    context,
    evidence,
    request,
    directory,
  };
}

test("warm comparisons read only selected distinct subtrees; legacy repeated commits do not repeat closure walks", async () => {
  const read = spyOn(git, "readTree");
  const closure = spyOn(GitObjects.prototype, "verifyTree");
  for (const evidence of [
    value.evidence,
    value.evidence.map((item) => ({
      ...item,
      tree: {
        objectFormat: "sha1" as const,
        objectId: value.entries.find((entry) => entry.path === `skills/${item.path}`)!.sha,
      },
    })),
  ]) {
    read.mockClear();
    closure.mockClear();
    const started = performance.now();
    const result = await compareSource(
      { ...value.context, transport: () => "/unavailable" },
      evidence,
      { commit: value.commit },
    );
    expect(result?.unchanged).toEqual(value.paths);
    expect(result?.removed).toEqual([]);
    expect(read.mock.calls.length).toBeLessThanOrEqual(value.paths.length + 2);
    expect(closure).not.toHaveBeenCalled();
    // Work-count assertions identify the cause; this generous end-to-end
    // ceiling also catches other accidental unbounded local processing.
    expect(performance.now() - started).toBeLessThan(2000);
  }
});

test.each(["missing", "corrupt"] as const)(
  "%s selected subtree never becomes upstream removal; only missing content can be repaired",
  async (failure) => {
    const child = value.entries.find((entry) => entry.path === "skills/skill-0")!.sha;
    // Use the fixture's real loose objects so one child can disappear while
    // the root and its indexed exact revision remain intact.
    await rm(value.directory, { recursive: true });
    await cp(join(value.work, ".git"), value.directory, { recursive: true });
    const target = join(value.directory, "objects", child.slice(0, 2), child.slice(2));
    await rm(target);
    if (failure === "corrupt") await writeFile(target, "corrupt object");
    const metadata = spyOn(GitTransfer.prototype, "metadata");
    await expect(
      withRepository(value.request, async (reader) => {
        const version = (await reader.revision({ commit: value.commit, offline: true }))!;
        await version.readTree(value.tree);
        await version.readTree(value.entries.find((entry) => entry.path === "skills")!.sha);
        await version.readTree(child);
      }),
    ).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
    expect(metadata).not.toHaveBeenCalled();
    if (failure === "missing") {
      await withRepository(value.request, async (reader) => {
        const version = (await reader.revision({ commit: value.commit }))!;
        const results = await Promise.all([version.readTree(child), version.readTree(child)]);
        expect(results[0]).toEqual(results[1]);
      });
    }
    const pending = compareSource(value.context, value.evidence, { commit: value.commit });
    if (failure === "missing") expect((await pending)?.unchanged).toEqual(value.paths);
    else await expect(pending).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
    expect(metadata).toHaveBeenCalledTimes(1);
  },
);

test("different current and legacy commits retain exact results without rewalking either closure per Skill", async () => {
  await writeFile(join(value.work, "skills/skill-0/SKILL.md"), "new marker");
  await value.git("add", ".");
  await value.git("commit", "-m", "one selected root changed");
  await value.git("push", value.bare, "HEAD:main");
  const current = await value.git("rev-parse", "HEAD");
  await compareSource(value.context, value.evidence, { commit: current });
  const read = spyOn(git, "readTree");
  const closure = spyOn(GitObjects.prototype, "verifyTree");
  const result = await compareSource(
    { ...value.context, transport: () => "/unavailable" },
    value.evidence,
    { commit: current },
  );
  expect(result?.changed).toEqual(["skill-0"]);
  expect(result?.unchanged).toEqual(value.paths.slice(1));
  expect(read.mock.calls.length).toBeLessThanOrEqual(value.paths.length + 5);
  expect(closure).not.toHaveBeenCalled();
});

test("unrelated cached subtree loss does not broaden a warm Source read or trigger acquisition", async () => {
  await rm(value.directory, { recursive: true });
  await cp(join(value.work, ".git"), value.directory, { recursive: true });
  const unrelated = value.entries.find((entry) => entry.path === "unrelated")!.sha;
  await rm(join(value.directory, "objects", unrelated.slice(0, 2), unrelated.slice(2)));
  const metadata = spyOn(GitTransfer.prototype, "metadata");
  const result = await compareSource(
    { ...value.context, transport: () => "/unavailable" },
    value.evidence,
    { commit: value.commit },
  );
  expect(result?.unchanged).toEqual(value.paths);
  expect(metadata).not.toHaveBeenCalled();
});

test("ref reuse partitions cover the TTL edge, future clock values and explicit retained reads", async () => {
  const path = join(value.directory, "../cache.json");
  const index = JSON.parse(await readFile(path, "utf8"));
  const now = Date.now();
  spyOn(Date, "now").mockReturnValue(now);
  const resolve = spyOn(GitTransfer.prototype, "resolve");
  const metadata = spyOn(GitTransfer.prototype, "metadata");
  for (const [age, queries] of [
    [29_999, 0],
    [30_000, 1],
    [-1, 1],
  ] as const) {
    index.refs.main = { commit: value.commit, observedAt: now - age };
    await writeFile(path, JSON.stringify(index));
    resolve.mockClear();
    metadata.mockClear();
    await withRepository(value.request, async (reader) => {
      const revision = await reader.revision({ current: true });
      expect(revision?.version.commit).toBe(value.commit);
      expect(revision?.version.observedAt).toBe(queries ? now : now - age);
    });
    expect(resolve).toHaveBeenCalledTimes(queries);
    expect(metadata).not.toHaveBeenCalled();
  }
  resolve.mockClear();
  index.refs.main = { commit: value.commit, observedAt: now - 100_000 };
  await writeFile(path, JSON.stringify(index));
  await withRepository(value.request, async (reader) => {
    expect((await reader.revision({ retained: true }))?.version.observedAt).toBe(now - 100_000);
  });
  expect(resolve).not.toHaveBeenCalled();
});

test.each(["deadline", "caller"] as const)(
  "warm object traversal observes %s cancellation before reading the remaining trees",
  async (kind) => {
    const controller = new AbortController();
    const original = GitObjects.prototype.tree;
    let entered = 0;
    spyOn(GitObjects.prototype, "tree").mockImplementation(async function (this: GitObjects, oid) {
      if (++entered === 1) {
        if (kind === "caller") controller.abort();
        else await Bun.sleep(1100);
      }
      return original.call(this, oid);
    });
    await expect(
      withRepository(
        {
          ...value.request,
          budgetMs: kind === "deadline" ? 1000 : 5000,
          signal: controller.signal,
        },
        async (reader) => {
          const version = await reader.revision({ commit: value.commit });
          await version!.readTree(version!.version.tree);
        },
      ),
    ).rejects.toHaveProperty("code", kind === "deadline" ? "PROVIDER_TIMEOUT" : "CANCELLED");
    expect(entered).toBe(1);
  },
);

test("online and offline revision views never share acquisition permission", async () => {
  const child = value.entries.find((entry) => entry.path === "skills/skill-0")!.sha;
  const blob = value.entries.find((entry) => entry.path === "skills/skill-0/SKILL.md")!.sha;
  await rm(value.directory, { recursive: true });
  await cp(join(value.work, ".git"), value.directory, { recursive: true });
  for (const oid of [child, blob])
    await rm(join(value.directory, "objects", oid.slice(0, 2), oid.slice(2)));
  const metadata = spyOn(GitTransfer.prototype, "metadata");
  const contents = spyOn(GitTransfer.prototype, "blobs");
  await withRepository(value.request, async (repository) => {
    const online = (await repository.revision({ commit: value.commit }))!;
    const offline = (await repository.revision({ commit: value.commit, offline: true }))!;
    await expect(offline.readTree(child)).rejects.toHaveProperty(
      "code",
      "PROVIDER_INTEGRITY_FAILED",
    );
    await expect(offline.blobs([blob])).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
    expect(metadata).not.toHaveBeenCalled();
    expect(contents).not.toHaveBeenCalled();
    expect((await online.readTree(child)).some((entry) => entry.path === "SKILL.md")).toBe(true);
    expect((await online.blobs([blob])).has(blob)).toBe(true);
    // The offline view can observe newly present bytes, but never fetch them itself.
    expect((await offline.blobs([blob])).has(blob)).toBe(true);
  });
  expect(metadata).toHaveBeenCalledTimes(1);
  expect(contents).toHaveBeenCalledTimes(1);
});

test("a missing historical tree repairs only its owning commit, not the current revision", async () => {
  const child = value.entries.find((entry) => entry.path === "skills/skill-0")!.sha;
  await writeFile(join(value.work, "skills/skill-0/SKILL.md"), "replacement marker");
  await value.git("add", ".");
  await value.git("commit", "-m", "changed target");
  await value.git("push", value.bare, "HEAD:main");
  const current = await value.git("rev-parse", "HEAD");
  await compareSource(value.context, value.evidence, { commit: current });
  await rm(value.directory, { recursive: true });
  await cp(join(value.work, ".git"), value.directory, { recursive: true });
  await rm(join(value.directory, "objects", child.slice(0, 2), child.slice(2)));
  const metadata = spyOn(GitTransfer.prototype, "metadata");
  await withRepository(value.request, async (repository) => {
    const latest = (await repository.revision({ commit: current }))!;
    const old = (await repository.revision({ commit: value.commit }))!;
    await old.readTree(child);
    expect(latest.version.commit).toBe(current);
    expect(old.version.commit).toBe(value.commit);
  });
  expect(metadata.mock.calls.map(([commit]) => commit)).toEqual([value.commit]);
});

test("concurrent overlapping content requests share one missing-object batch", async () => {
  const ids = value.entries
    .filter((entry) => entry.path.endsWith("SKILL.md"))
    .map((entry) => entry.sha);
  const transfer = spyOn(GitTransfer.prototype, "blobs");
  await withRepository(value.request, async (repository) => {
    const version = (await repository.revision({ commit: value.commit }))!;
    const results = await Promise.all([
      version.blobs(ids.slice(0, 4)),
      version.blobs(ids.slice(2, 6)),
    ]);
    expect(results.map((result) => result.size)).toEqual([4, 4]);
  });
  expect(transfer).toHaveBeenCalledTimes(1);
  expect(new Set(transfer.mock.calls[0]![0])).toEqual(new Set(ids.slice(0, 6)));
});

test("one transfer queue serializes revision acquisition with content batches", async () => {
  const original = GitTransfer.prototype.blobs;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writing = false;
  spyOn(GitTransfer.prototype, "blobs").mockImplementation(async function (this: GitTransfer, ids) {
    writing = true;
    entered();
    try {
      await blocked;
      return await original.call(this, ids);
    } finally {
      writing = false;
    }
  });
  const metadata = GitTransfer.prototype.metadata;
  spyOn(GitTransfer.prototype, "metadata").mockImplementation(function (this: GitTransfer, commit) {
    expect(writing).toBe(false);
    return metadata.call(this, commit);
  });
  await writeFile(join(value.work, "new.txt"), "second commit");
  await value.git("add", ".");
  await value.git("commit", "-m", "new revision");
  await value.git("push", value.bare, "HEAD:main");
  const commit = await value.git("rev-parse", "HEAD");
  await withRepository(value.request, async (repository) => {
    const view = (await repository.revision({ commit: value.commit }))!;
    const blob = value.entries.find((entry) => entry.path.endsWith("SKILL.md"))!.sha;
    const content = view.blobs([blob]);
    await started;
    const revision = repository.revision({ commit });
    release();
    const results = await Promise.allSettled([content, revision]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  });
});

test("warm reads neither rewrite the index nor rescan origins; due maintenance remains automatic", async () => {
  const path = join(value.directory, "../cache.json");
  const bytes = await readFile(path, "utf8");
  const scan = spyOn(fs, "readdir");
  const write = spyOn(files, "writeAtomic");
  await withRepository(value.request, async (repository) => {
    const version = (await repository.revision({ commit: value.commit }))!;
    await version.readTree(version.version.tree);
  });
  expect(await readFile(path, "utf8")).toBe(bytes);
  expect(write.mock.calls.filter(([path]) => path.endsWith("cache.json"))).toHaveLength(0);
  expect(scan.mock.calls.filter(([path]) => String(path).endsWith("/origins"))).toHaveLength(0);
  const stamp = join(process.env.SKCTL_SOURCE_CACHE_DIR!, "maintained");
  await utimes(stamp, 1, 1);
  await withRepository(value.request, async (repository) => {
    await repository.revision({ commit: value.commit });
  });
  expect(scan.mock.calls.filter(([path]) => String(path).endsWith("/origins"))).toHaveLength(1);
});

test("a failed index flush never masks the original operation failure, but new facts must persist before success", async () => {
  const original = files.writeAtomic;
  spyOn(files, "writeAtomic").mockImplementation((path, bytes) => {
    if (path.endsWith("cache.json")) throw new Error("index flush failed");
    return original(path, bytes);
  });
  const primary = new Error("original callback failure");
  await expect(
    withRepository(value.request, async (repository) => {
      await repository.revision({ current: true });
      throw primary;
    }),
  ).rejects.toBe(primary);
  await expect(
    withRepository(value.request, async (repository) => {
      await repository.revision({ current: true });
    }),
  ).rejects.toThrow("index flush failed");
});

test("timestamp maintenance failure does not turn a successful cached read into a content error", async () => {
  const path = join(value.directory, "../cache.json");
  const index = JSON.parse(await readFile(path, "utf8"));
  index.lastUsedAt -= 120_000;
  await writeFile(path, JSON.stringify(index));
  const original = files.writeAtomic;
  spyOn(files, "writeAtomic").mockImplementation((path, bytes) => {
    if (path.endsWith("cache.json")) throw new Error("touch failed");
    return original(path, bytes);
  });
  await withRepository(value.request, async (repository) => {
    const version = (await repository.revision({ commit: value.commit }))!;
    expect(version.version.commit).toBe(value.commit);
  });
  expect(JSON.parse(await readFile(path, "utf8")).lastUsedAt).toBe(index.lastUsedAt);
});

test("a callback failure drains every already-owned read before releasing its repository", async () => {
  const original = GitObjects.prototype.tree;
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let gate = false,
    active = 0,
    settled = false;
  spyOn(GitObjects.prototype, "tree").mockImplementation(async function (this: GitObjects, id) {
    if (gate) {
      gate = false;
      active++;
      entered();
      try {
        await held;
      } finally {
        active--;
      }
    }
    return original.call(this, id);
  });
  const failure = new Error("callback failed");
  const pending = withRepository(value.request, async (repository) => {
    const version = (await repository.revision({ commit: value.commit }))!;
    gate = true;
    void version.readTree(version.version.tree).catch(() => {});
    await started;
    throw failure;
  }).catch((error) => {
    settled = true;
    return error;
  });
  try {
    await started;
    await Bun.sleep(20);
    expect(active).toBe(1);
    expect(settled).toBe(false);
  } finally {
    release();
  }
  expect(await pending).toBe(failure);
  expect(active).toBe(0);
});
