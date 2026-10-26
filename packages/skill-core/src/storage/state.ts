import { cp, lstat, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { decodeStrictText } from "../content/text";
import { processIdentity, processStatus } from "../runtime/process";
import { SkctlError } from "../shared";
import type { SkillAddress } from "../source/schema";
import { isFileLockHeld, withFileLock } from "./file-lock";
import {
  assertPath,
  ensureDirectory,
  readOptional,
  syncDirectory,
  writeAtomic,
  writeSynced,
} from "./files";
import { contentHash, parseState, Transactions } from "./transaction";
import {
  materializationSchema,
  snapshotUseSchema,
  snapshotIdSchema,
  tombstoneOwnerSchema,
  type InstalledMaterialization,
  type PrivateState,
  type StateContents,
  type SnapshotUse,
} from "./schema";
import * as v from "valibot";

const digestPattern = /^[a-f0-9]{64}$/;
const entries = async (path: string) => {
  await assertPath(path, "directory", true);
  return readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
};

async function syncContent(path: string) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const stat = await lstat(child);
    if (entry.name === ".git" || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new SkctlError(
        "PROVIDER_INTEGRITY_FAILED",
        "Prepared content contains an unsafe entry",
      );
    if (stat.isDirectory()) await syncContent(child);
    else {
      const file = await open(child, "r");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    }
  }
  await syncDirectory(path);
}

export function resolveStateRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
) {
  if (env.SKCTL_STATE_DIR !== undefined) {
    if (!isAbsolute(env.SKCTL_STATE_DIR))
      throw new SkctlError("INVALID_ARGUMENT", "SKCTL_STATE_DIR must be absolute");
    return resolve(env.SKCTL_STATE_DIR);
  }
  const home = env.HOME ?? homedir();
  if (platform === "win32") return join(env.LOCALAPPDATA ?? home, "skctl");
  if (platform === "darwin") return join(home, "Library", "Application Support", "skctl");
  return join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "skctl");
}

/** Local publication authority. No provider, ref observation or acquisition lives here. */
export class StateCoordinator {
  readonly root: string;
  private readonly lock: string;
  private readonly transactions: Transactions;
  constructor(root = resolveStateRoot()) {
    this.root = resolve(root);
    this.lock = join(this.root, "mutation.lock");
    this.transactions = new Transactions(this.root);
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (isFileLockHeld(this.lock)) return operation();
    return withFileLock(this.lock, async () => {
      await this.transactions.recover();
      return operation();
    });
  }

  async read(): Promise<PrivateState> {
    const path = join(this.root, "state.json");
    await assertPath(path, "file", true);
    return parseState(await readOptional(path));
  }

  async publish(
    targets: readonly { readonly target: string; readonly bytes: string | Uint8Array }[],
    expectedState?: number,
  ) {
    return this.withLock(() => this.transactions.publish(targets, expectedState));
  }

  async write(next: StateContents, expected: number): Promise<PrivateState> {
    return this.withLock(async () => {
      const current = await this.read();
      if (current.generation !== expected)
        throw new SkctlError("TRANSACTION_CONFLICT", "State generation changed");
      const value = {
        version: 4 as const,
        generation: expected + 1,
        installed: [...next.installed],
        configs: next.configs,
      };
      if (!value.installed.every((item) => v.is(materializationSchema, item)))
        throw new SkctlError("CONFIG_INVALID", "Installed Skill identity is invalid");
      const bytes = `${JSON.stringify(value)}\n`;
      const validated = parseState(Buffer.from(bytes));
      await this.transactions.publish([{ target: join(this.root, "state.json"), bytes }], expected);
      return validated;
    });
  }

  private contentPath(kind: "snapshots" | "configs", id: string) {
    if (!(kind === "snapshots" ? v.is(snapshotIdSchema, id) : digestPattern.test(id)))
      throw new SkctlError("INVALID_ARGUMENT", "Invalid content identity");
    return join(this.root, kind, id, kind === "snapshots" ? "root" : "config.jsonc");
  }

  async snapshotRoot(snapshotId: string) {
    const path = this.contentPath("snapshots", snapshotId);
    await assertPath(path, "directory", true);
    if (
      !(await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }))
    )
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Installed content is missing");
    const marker = await lstat(join(path, "SKILL.md")).catch(() => undefined);
    if (!marker?.isFile() || marker.isSymbolicLink())
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Installed Skill marker is unavailable");
    return path;
  }

  async publishSnapshot(snapshotId: string, source: string) {
    return this.withLock(async () => {
      const destination = this.contentPath("snapshots", snapshotId);
      await assertPath(destination, "directory", true);
      if (await lstat(destination).catch(() => undefined))
        throw new SkctlError("DESTINATION_EXISTS", "Snapshot already exists");
      await assertPath(source, "directory");
      await ensureDirectory(join(this.root, "staging"));
      const stage = await mkdtemp(join(this.root, "staging", "content-"));
      try {
        const copy = join(stage, "root");
        await cp(source, copy, {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
          errorOnExist: true,
        });
        const marker = await lstat(join(copy, "SKILL.md"));
        if (!marker.isFile() || marker.isSymbolicLink())
          throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Prepared Skill marker is unsafe");
        await syncContent(copy);
        await ensureDirectory(join(this.root, "snapshots", snapshotId));
        await rename(copy, destination);
        await syncDirectory(join(this.root, "snapshots", snapshotId));
        await syncDirectory(join(this.root, "snapshots"));
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    });
  }

  /** Publishes immutable bytes only; Config operations own validation and the state transaction. */
  async publishConfig(bytes: Uint8Array) {
    decodeStrictText(bytes);
    const digest = contentHash(bytes),
      path = this.contentPath("configs", digest);
    await this.withLock(async () => {
      await assertPath(path, "file", true);
      const existing = await readOptional(path);
      if (existing && contentHash(existing) !== digest)
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Installed Config digest mismatch");
      if (!existing) await writeAtomic(path, bytes);
    });
    return digest;
  }

  private async createUse(snapshotId: string) {
    const path = join(this.root, "uses", `${crypto.randomUUID()}.json`);
    await ensureDirectory(join(this.root, "uses"));
    await writeSynced(
      path,
      JSON.stringify({ ...(await processIdentity()), snapshotId, nonce: crypto.randomUUID() }),
      true,
    );
    await syncDirectory(join(this.root, "uses"));
    return path;
  }

  private async finishUse(path: string | undefined) {
    if (path) await this.withLock(() => rm(path, { force: true }));
  }

  async withInstalledRoot<T>(
    address: SkillAddress | (() => Promise<InstalledMaterialization>),
    operation: (found: {
      readonly item: InstalledMaterialization;
      readonly root: string;
    }) => Promise<T>,
  ): Promise<T> {
    let use: string | undefined;
    const found = await this.withLock(async () => {
      const item =
        typeof address === "function"
          ? await address()
          : (await this.read()).installed.find(
              (item) => item.source === address.source && item.path === address.path,
            );
      if (!item) throw new SkctlError("SKILL_NOT_FOUND", "Installed Skill not found");
      const root = item.kind === "remote" ? await this.snapshotRoot(item.snapshotId) : item.root;
      await assertPath(root, "directory");
      if (item.kind === "remote") use = await this.createUse(item.snapshotId);
      return { item, root };
    });
    try {
      return await operation(found);
    } finally {
      await this.finishUse(use);
    }
  }

  async withRunRoot<T>(operation: (root: string) => Promise<T>): Promise<T> {
    await ensureDirectory(join(this.root, "runs"));
    const directory = await mkdtemp(join(this.root, "runs", "operation-")),
      root = join(directory, "root");
    await ensureDirectory(root);
    try {
      return await operation(root);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async gc() {
    const garbage: string[] = [];
    await this.withLock(async () => {
      const state = await this.read();
      const snapshots = new Set(
        state.installed.filter((item) => item.kind === "remote").map((item) => item.snapshotId),
      );
      const configs = new Set(Object.values(state.configs).map((item) => item.digest));
      const uses: (SnapshotUse & { path: string })[] = [];
      for (const name of await entries(join(this.root, "uses"))) {
        const path = join(this.root, "uses", name);
        await assertPath(path, "file");
        try {
          const record: unknown = JSON.parse((await readOptional(path))!.toString());
          const parsed = v.safeParse(snapshotUseSchema, record);
          if (!parsed.success) return;
          uses.push({ ...parsed.output, path });
        } catch {
          return;
        }
      }
      for (const use of uses) {
        if ((await processStatus(use)) !== "dead") snapshots.add(use.snapshotId);
        else await rm(use.path);
      }
      const trash = join(this.root, "trash");
      await ensureDirectory(trash);
      for (const name of await entries(trash)) {
        const path = join(trash, name);
        try {
          await assertPath(path, "directory");
          await assertPath(join(path, "owner.json"), "file");
          const owner: unknown = JSON.parse(
            (await readOptional(join(path, "owner.json")))!.toString(),
          );
          if (v.is(tombstoneOwnerSchema, owner) && (await processStatus(owner)) === "dead")
            garbage.push(path);
        } catch {
          /* Unprovable ownership never authorizes collection. */
        }
      }
      for (const [kind, retained] of [
        ["snapshots", snapshots],
        ["configs", configs],
      ] as const) {
        for (const digest of await entries(join(this.root, kind))) {
          if (
            retained.has(digest) ||
            !(kind === "snapshots" ? v.is(snapshotIdSchema, digest) : digestPattern.test(digest))
          )
            continue;
          const path = join(this.root, kind, digest);
          try {
            await assertPath(path, "directory");
            if (kind === "configs") {
              const file = this.contentPath(kind, digest);
              await assertPath(file, "file");
              const bytes = await readOptional(file);
              if (!bytes || contentHash(bytes) !== digest) continue;
              decodeStrictText(bytes);
            }
          } catch {
            continue;
          }
          const tombstone = join(trash, crypto.randomUUID());
          await ensureDirectory(tombstone);
          await writeSynced(
            join(tombstone, "owner.json"),
            JSON.stringify({ ...(await processIdentity()), nonce: crypto.randomUUID() }),
            true,
          );
          await rename(path, join(tombstone, "content"));
          garbage.push(tombstone);
        }
      }
    });
    for (const path of garbage) await rm(path, { recursive: true, force: true });
  }
}
