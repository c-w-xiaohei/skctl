import * as fs from "node:fs/promises";
import { join } from "node:path";
import * as git from "isomorphic-git";
import { runProcess } from "../../../runtime/process";
import { SkctlError } from "../../../shared";
import { assertPath, ensureDirectory, writeAtomic } from "../../../storage/files";
import { assertSourceContentLimit } from "../../../content/text";

export const isOid = (value: string) => /^[a-f0-9]{40}$/.test(value);
const largePack = new Error("Read large packs through native Git instead of loading them into JS");
// Public write APIs also encode/hash objects. Suppress publication when verifying
// existing objects so a packed tree never gains a redundant loose copy.
const hashOnlyFs = { promises: { ...fs, writeFile: async () => {} } };
const invalid = (message: string): never => {
  throw new SkctlError("PROVIDER_INTEGRITY_FAILED", message);
};

/** Local objects only. Git owns transport; isomorphic-git owns object formats. */
export class GitObjects {
  private headers?: Promise<ReadonlyMap<string, { kind: string; size: number }>>;
  private cache = {};
  private readonly trees = new Map<string, git.TreeObject>();
  private readonly packs = new Map<string, number>();
  private readonly blobSizes = new Map<string, number>();
  private readonly client;
  constructor(
    readonly directory: string,
    private readonly signal?: AbortSignal,
  ) {
    this.client = {
      promises: {
        ...fs,
        readFile: async (path: string, options?: Parameters<typeof fs.readFile>[1]) => {
          this.check();
          await assertPath(path, "file", true);
          if (path.endsWith(".pack")) {
            const size = (await fs.stat(path)).size;
            if (
              !this.packs.has(path) &&
              size + [...this.packs.values()].reduce((sum, bytes) => sum + bytes, 0) >
                64 * 1024 * 1024
            )
              throw largePack;
            this.packs.set(path, size);
          }
          return fs.readFile(path, options);
        },
        writeFile: async (path: string, bytes: Uint8Array) => {
          this.check();
          await writeAtomic(path, bytes);
          this.refreshStorage();
        },
      },
    };
  }

  private check() {
    if (this.signal?.aborted) throw new SkctlError("CANCELLED", "Object read cancelled");
  }
  private async read<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.check();
    try {
      const result = await operation();
      this.check();
      return result;
    } catch (error) {
      this.check();
      if ((error === largePack || error instanceof git.Errors.UnsafeFilepathError) && fallback)
        return this.read(fallback);
      if (error instanceof SkctlError) throw error;
      return invalid("Missing, corrupt or malformed Git object");
    }
  }
  invalidate() {
    this.trees.clear();
    this.refreshStorage();
  }
  private refreshStorage() {
    this.headers = undefined;
    this.cache = {};
    this.packs.clear();
  }
  /** Native transfers may add only the requested blobs; metadata requests pass no IDs. */
  async fetch(ids: readonly string[], transfer: () => Promise<unknown>) {
    const allowed = new Set([...(await this.blobIds()), ...ids]);
    try {
      await transfer();
      this.refreshStorage();
      if ([...(await this.blobIds())].some((id) => !allowed.has(id)))
        invalid(
          ids.length
            ? "Remote returned unrequested blobs"
            : "Remote ignored metadata-only filtering",
        );
      const found = await this.inventory();
      if (ids.some((id) => found.get(id)?.kind !== "blob"))
        invalid("Requested blob transfer is incomplete");
    } finally {
      this.refreshStorage();
    }
  }
  noteBlobSize(id: string, size: number) {
    this.blobSizes.set(id, size);
  }
  blobSize(id: string) {
    return this.blobSizes.get(id);
  }

  private async command(args: readonly string[]) {
    const result = await runProcess({
      cmd: ["git", `--git-dir=${this.directory}`, ...args],
      signal: this.signal,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.status) invalid(`Local Git object operation failed: ${args[0]}`);
    return result.stdout;
  }
  async initialize() {
    await ensureDirectory(this.directory);
    if (await fs.lstat(join(this.directory, "HEAD")).catch(() => undefined)) {
      await assertPath(join(this.directory, "HEAD"), "file");
      await assertPath(join(this.directory, "config"), "file");
      await assertPath(join(this.directory, "objects"), "directory");
      if (
        await fs.lstat(join(this.directory, "objects", "info", "alternates")).catch(() => undefined)
      )
        invalid("Shared object cache must not use alternate object stores");
      return;
    }
    const result = await runProcess({
      cmd: ["git", "init", "--bare", "--object-format=sha1", this.directory],
      signal: this.signal,
    });
    if (result.status) invalid("Cannot initialize Git object cache");
    await this.command(["config", "gc.auto", "0"]);
    await this.command(["config", "maintenance.auto", "false"]);
  }

  async inventory(): Promise<ReadonlyMap<string, { kind: string; size: number }>> {
    this.check();
    return (this.headers ??= this.readInventory());
  }
  private async readInventory() {
    const generation = this.cache;
    // Headers only, never lazy-fetch missing promisor objects or inflate blobs.
    const output = await this.command([
      "cat-file",
      "--batch-all-objects",
      "--batch-check=%(objectname) %(objecttype) %(objectsize)",
    ]);
    const found = new Map<string, { kind: string; size: number }>();
    for (const line of output.toString().trimEnd().split("\n").filter(Boolean)) {
      const [id, kind, count] = line.split(" "),
        size = Number(count);
      if (
        !id ||
        !isOid(id) ||
        !kind ||
        !/^(0|[1-9]\d*)$/.test(count ?? "") ||
        !Number.isSafeInteger(size)
      )
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Invalid Git object header");
      found.set(id, { kind, size });
    }
    if (this.cache === generation)
      for (const [id, header] of found)
        if (header.kind === "blob") this.noteBlobSize(id, header.size);
    return found;
  }
  private async blobIds() {
    return new Set(
      [...(await this.inventory())]
        .filter(([, header]) => header.kind === "blob")
        .map(([id]) => id),
    );
  }
  async missingBlobs(ids: readonly string[], maxBytes?: number) {
    if (ids.some((id) => !isOid(id))) invalid("Invalid object identity");
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const headers = await this.inventory();
    return unique.filter((id) => {
      const header = headers.get(id);
      if (header && header.kind !== "blob") invalid("Expected cached blob");
      const size = header?.size ?? this.blobSize(id);
      if (size !== undefined) assertSourceContentLimit(size, maxBytes);
      return !header;
    });
  }
  async blobs(ids: readonly string[], maxBytes?: number) {
    this.check();
    const unique = [...new Set(ids)];
    if ((await this.missingBlobs(unique, maxBytes)).length) invalid("Missing blob object");
    const found = new Map<string, Uint8Array>();
    for (const oid of unique) {
      const bytes = await this.read(
        async () =>
          (await git.readBlob({ fs: this.client, gitdir: this.directory, oid, cache: this.cache }))
            .blob,
        () => this.command(["cat-file", "blob", oid]),
      );
      if ((await git.hashBlob({ object: bytes })).oid !== oid) invalid("Corrupt cached blob");
      found.set(oid, bytes);
    }
    return found;
  }
  async commitTree(oid: string) {
    if (!isOid(oid)) invalid("Invalid commit identity");
    return this.read(
      async () => {
        const result = await git.readCommit({
          fs: this.client,
          gitdir: this.directory,
          oid,
          cache: this.cache,
        });
        if (result.oid !== oid || !isOid(result.commit.tree)) invalid("Invalid commit identity");
        return result.commit.tree;
      },
      async () => {
        const object = await this.command(["cat-file", "commit", oid]);
        const actual = await git.writeObject({
          fs: hashOnlyFs,
          gitdir: this.directory,
          type: "commit",
          format: "content",
          object,
        });
        if (actual !== oid) invalid("Corrupt cached commit");
        return (await this.command(["rev-parse", "--verify", `${oid}^{tree}`])).toString().trim();
      },
    );
  }
  async writeBlob(blob: Uint8Array, expected: string) {
    this.check();
    if ((await git.hashBlob({ object: blob })).oid !== expected)
      invalid("Remote blob identity mismatch");
    // The library skips existing objects, so validate before that shortcut too.
    await assertPath(
      join(this.directory, "objects", expected.slice(0, 2), expected.slice(2)),
      "file",
      true,
    );
    await this.read(() => git.writeBlob({ fs: this.client, gitdir: this.directory, blob }));
  }
  async writeTree(tree: git.TreeObject, expected: string) {
    this.check();
    if (!isOid(expected)) invalid("Invalid tree identity");
    await assertPath(
      join(this.directory, "objects", expected.slice(0, 2), expected.slice(2)),
      "file",
      true,
    );
    const oid = await this.read(() =>
      git.writeTree({ fs: this.client, gitdir: this.directory, tree }),
    );
    if (oid !== expected) invalid("Remote tree identity mismatch");
  }
  async tree(oid: string): Promise<git.TreeObject> {
    this.check();
    if (!isOid(oid)) invalid("Invalid tree identity");
    const cached = this.trees.get(oid);
    if (cached) return cached;
    const tree = await this.read(
      async () =>
        (await git.readTree({ fs: this.client, gitdir: this.directory, oid, cache: this.cache }))
          .tree,
      async () => {
        const output = await this.command(["ls-tree", "-z", oid]);
        return new TextDecoder("utf-8", { fatal: true })
          .decode(output)
          .split("\0")
          .filter(Boolean)
          .map((record) => {
            const tab = record.indexOf("\t"),
              [mode, type, oid] = record.slice(0, tab).split(" ");
            if (tab < 0 || (type !== "blob" && type !== "tree" && type !== "commit"))
              throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Invalid tree entry");
            return { mode, type, oid, path: record.slice(tab + 1) };
          });
      },
    );
    const names = new Set<string>();
    for (const entry of tree) {
      if (
        !entry.path ||
        entry.path.includes("/") ||
        entry.path.includes("\0") ||
        [".", ".."].includes(entry.path) ||
        names.has(entry.path) ||
        !isOid(entry.oid)
      )
        invalid("Unsafe or duplicate tree entry");
      names.add(entry.path);
    }
    // The library decodes names permissively; round-trip identity rejects lossy UTF-8
    // and malformed encodings without maintaining another tree format parser.
    // writeTree is also the library's encoder/hash API. A write sink computes
    // the identity without materializing a second loose copy of packed trees.
    const rendered = await this.read(() =>
      git.writeTree({
        fs: hashOnlyFs,
        gitdir: this.directory,
        tree: tree.map((entry) => ({ ...entry })),
      }),
    );
    if (rendered !== oid) invalid("Malformed or corrupt cached tree");
    this.trees.set(oid, tree);
    return tree;
  }
  async verifyTree(root: string) {
    const seen = new Set<string>(),
      pending = [root];
    while (pending.length) {
      this.check();
      const batch: string[] = [];
      while (pending.length && batch.length < 8) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        batch.push(id);
      }
      // Drain every owned read before releasing the origin lock on failure.
      const results = await Promise.allSettled(batch.map((id) => this.tree(id)));
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        for (const entry of result.value) if (entry.type === "tree") pending.push(entry.oid);
      }
    }
  }
}
