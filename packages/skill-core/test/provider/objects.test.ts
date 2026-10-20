import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { GitObjects } from "../../src/source/service/remote/objects";
import { repositoryFixture } from "./repository-fixture";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skctl-objects-"));
});
afterEach(async () => {
  mock.restore();
  await rm(root, { recursive: true, force: true });
});

test.each([false, true])(
  "complete metadata closure uses bounded parallel reads and drains on corrupt child=%s",
  async (corrupt) => {
    const value = await repositoryFixture(
      Object.fromEntries(
        Array.from({ length: 32 }, (_, index) => [`group-${index}/file`, `distinct ${index}`]),
      ),
    );
    try {
      const objects = new GitObjects(join(value.work, ".git"));
      await objects.initialize();
      if (corrupt) {
        const oid = value.entries.find((entry) => entry.path === "group-0")!.sha;
        const file = join(value.work, ".git/objects", oid.slice(0, 2), oid.slice(2));
        await rm(file);
        await writeFile(file, "corrupt");
      }
      const original = objects.tree.bind(objects);
      let active = 0,
        peak = 0;
      const read = spyOn(objects, "tree").mockImplementation(async (oid) => {
        active++;
        peak = Math.max(peak, active);
        try {
          return await original(oid);
        } finally {
          active--;
        }
      });
      if (corrupt)
        await expect(objects.verifyTree(value.tree)).rejects.toHaveProperty(
          "code",
          "PROVIDER_INTEGRITY_FAILED",
        );
      else {
        await objects.verifyTree(value.tree);
        expect(new Set(read.mock.calls.map(([oid]) => oid)).size).toBe(33);
      }
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
      expect(active).toBe(0);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  },
);

test("library-written blobs and trees are native Git objects with exact bytes and modes", async () => {
  const value = await repositoryFixture();
  try {
    const objects = new GitObjects(join(root, "objects.git"));
    await objects.initialize();
    const bytes = Buffer.from([0, 255, 10, 128, 65]);
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    await objects.writeBlob(bytes, oid);
    const expected = createHash("sha1")
      .update("tree 31\0")
      .update(Buffer.concat([Buffer.from("100755 run\0"), Buffer.from(oid, "hex")]))
      .digest("hex");
    await objects.writeTree([{ path: "run", mode: "100755", type: "blob", oid }], expected);
    expect(await value.git(`--git-dir=${objects.directory}`, "ls-tree", expected)).toBe(
      `100755 blob ${oid}\trun`,
    );
    expect((await objects.blobs([oid])).get(oid)).toEqual(bytes);
    expect(await readdir(join(objects.directory, "objects", oid.slice(0, 2)))).toEqual([
      oid.slice(2),
    ]);
    expect(
      (await stat(join(objects.directory, "objects", oid.slice(0, 2), oid.slice(2)))).mode & 0o777,
    ).toBe(0o600);
    expect(await objects.tree(expected)).toEqual([
      { path: "run", mode: "100755", type: "blob", oid },
    ]);
    await expect(objects.writeBlob(bytes, "f".repeat(40))).rejects.toHaveProperty(
      "code",
      "PROVIDER_INTEGRITY_FAILED",
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("native packed objects are read without cat-file content or network acquisition", async () => {
  const value = await repositoryFixture({ "SKILL.md": "marker", run: "binary\0bytes" });
  try {
    await value.git("repack", "-ad");
    const objects = new GitObjects(join(value.work, ".git"));
    await objects.initialize();
    const previous = process.env.GIT_TRACE,
      trace = join(root, "trace");
    process.env.GIT_TRACE = trace;
    try {
      const tree = await objects.commitTree(value.commit);
      expect(tree).toBe(value.tree);
      const before = (
        await readdir(join(value.work, ".git", "objects"), { recursive: true })
      ).sort();
      const entries = await objects.tree(tree);
      const blob = entries.find((entry) => entry.path === "run")!.oid;
      expect(Buffer.from((await objects.blobs([blob])).get(blob)!)).toEqual(
        Buffer.from("binary\0bytes"),
      );
      expect(
        (await readdir(join(value.work, ".git", "objects"), { recursive: true })).sort(),
      ).toEqual(before);
      await writeFile(join(value.work, "new"), "new content");
      await value.git("add", ".");
      await value.git("commit", "-m", "next pack");
      await value.git("repack", "-ad");
      objects.invalidate();
      const next = await objects.commitTree(await value.git("rev-parse", "HEAD"));
      expect((await objects.tree(next)).some((entry) => entry.path === "new")).toBe(true);
      const commands = await Bun.file(trace).text();
      expect(commands).not.toMatch(/cat-file (?:blob|tree|commit|--batch(?:\s|$))/);
    } finally {
      if (previous === undefined) delete process.env.GIT_TRACE;
      else process.env.GIT_TRACE = previous;
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("native object additions refresh storage inventory without discarding verified decoded trees", async () => {
  const value = await repositoryFixture();
  try {
    const objects = new GitObjects(join(value.work, ".git"));
    await objects.initialize();
    const before = await objects.tree(value.tree);
    const oldInventory = await objects.inventory();
    const id = createHash("sha1").update("blob 9\0new bytes").digest("hex");
    await objects.fetch([id], async () => {
      await writeFile(join(value.work, "new"), "new bytes");
      await value.git("add", ".");
      await value.git("commit", "-m", "add objects");
    });
    expect(await objects.tree(value.tree)).toBe(before);
    expect((await objects.inventory()).size).toBeGreaterThan(oldInventory.size);
    const next = await objects.commitTree(await value.git("rev-parse", "HEAD"));
    expect((await objects.tree(next)).some((entry) => entry.path === "new")).toBe(true);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("an oversized pack uses bounded native content reading instead of a whole-pack JS allocation", async () => {
  const value = await repositoryFixture({ "SKILL.md": "marker", resource: "selected content" });
  try {
    await writeFile(join(value.work, "unselected.bin"), randomBytes(65 * 1024 * 1024));
    await value.git("add", ".");
    await value.git("commit", "-m", "large pack");
    const commit = await value.git("rev-parse", "HEAD"),
      expectedTree = await value.git("rev-parse", "HEAD^{tree}");
    await value.git("repack", "-ad");
    const packs = join(value.work, ".git", "objects", "pack");
    const pack = (await readdir(packs)).find((name) => name.endsWith(".pack"))!;
    expect((await stat(join(packs, pack))).size).toBeGreaterThan(64 * 1024 * 1024);
    const objects = new GitObjects(join(value.work, ".git"));
    await objects.initialize();
    const tree = await objects.commitTree(commit);
    expect(tree).toBe(expectedTree);
    const oid = (await objects.tree(tree)).find((entry) => entry.path === "resource")!.oid;
    expect(Buffer.from((await objects.blobs([oid])).get(oid)!)).toEqual(
      Buffer.from("selected content"),
    );
    await expect(objects.blobs([oid], 1)).rejects.toHaveProperty("code", "TEXT_TOO_LARGE");
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
}, 30_000);

test("corrupt loose bytes, duplicate tree entries and invalid UTF-8 never become trusted content", async () => {
  const objects = new GitObjects(join(root, "objects.git"));
  await objects.initialize();
  const entry = Buffer.concat([Buffer.from("100644 SKILL.md\0"), Buffer.alloc(20, 1)]);
  for (const bytes of [
    Buffer.concat([entry, entry]),
    Buffer.concat([Buffer.from("100644 ../escape\0"), Buffer.alloc(20, 1)]),
    Buffer.concat([
      Buffer.from("100644 "),
      Buffer.from([255]),
      Buffer.from([0]),
      Buffer.alloc(20, 1),
    ]),
  ]) {
    const oid = createHash("sha1").update(`tree ${bytes.length}\0`).update(bytes).digest("hex");
    await mkdir(join(objects.directory, "objects", oid.slice(0, 2)), { recursive: true });
    await writeFile(
      join(objects.directory, "objects", oid.slice(0, 2), oid.slice(2)),
      deflateSync(Buffer.concat([Buffer.from(`tree ${bytes.length}\0`), bytes])),
    );
    await expect(objects.tree(oid)).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
  }
  const bytes = Buffer.from("trusted"),
    oid = createHash("sha1").update("blob 7\0").update(bytes).digest("hex");
  await objects.writeBlob(bytes, oid);
  await expect(
    objects.writeTree([{ path: "SKILL.md", mode: "100644", type: "blob", oid }], "f".repeat(40)),
  ).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
  await writeFile(
    join(objects.directory, "objects", oid.slice(0, 2), oid.slice(2)),
    deflateSync(Buffer.from("blob 7\0corrupt")),
  );
  objects.invalidate();
  await expect(objects.blobs([oid])).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
});

test("object writes stay atomic and reject symlinked object paths", async () => {
  const objects = new GitObjects(join(root, "objects.git"));
  await objects.initialize();
  const bytes = Buffer.from("private"),
    oid = createHash("sha1").update("blob 7\0").update(bytes).digest("hex");
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(objects.directory, "objects", oid.slice(0, 2)));
  await expect(objects.writeBlob(bytes, oid)).rejects.toHaveProperty("code", "CONFIG_SYMLINK");
  expect(await readdir(outside)).toEqual([]);
});

test("an existing symlinked loose object cannot turn publication into a successful no-op", async () => {
  const objects = new GitObjects(join(root, "objects.git"));
  await objects.initialize();
  const bytes = Buffer.from("private"),
    oid = createHash("sha1").update("blob 7\0").update(bytes).digest("hex");
  const path = join(objects.directory, "objects", oid.slice(0, 2), oid.slice(2));
  await objects.writeBlob(bytes, oid);
  const outside = join(root, "outside");
  await writeFile(outside, await readFile(path));
  await rm(path);
  await symlink(outside, path);
  await expect(objects.writeBlob(bytes, oid)).rejects.toHaveProperty("code", "CONFIG_SYMLINK");
});

test("tree encoding preserves native directory order and Unicode names without local sorting", async () => {
  const value = await repositoryFixture({
    "a/file": "nested",
    "a.txt": "file before directory",
    "脚本.sh": "unicode",
    "\u{10000}.txt": "supplementary",
    "\ue000.txt": "private use",
    "tab\tnewline\n.txt": "literal separators",
  });
  try {
    const objects = new GitObjects(join(value.work, ".git"));
    await objects.initialize();
    const tree = await objects.tree(value.tree);
    const target = new GitObjects(join(root, "objects.git"));
    await target.initialize();
    await target.writeTree(tree, value.tree);
    expect(await value.git(`--git-dir=${target.directory}`, "ls-tree", value.tree)).toBe(
      await value.git("ls-tree", value.tree),
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
