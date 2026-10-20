import { lstat, readdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import envPaths from "env-paths";
import * as v from "valibot";
import { SkctlError } from "../../../shared";
import { withFileLock } from "../../../storage/file-lock";
import { assertPath, ensureDirectory, writeAtomic } from "../../../storage/files";
import { canonicalRemoteOrigin } from "../../identity";
import { gitObjectIdSchema } from "../../schema";
import { GitTransfer } from "./git";
import { GitHubTransfer, GitHubUnavailable } from "./github";
import {
  createSourceOperation,
  sourceNetworkError,
  sourceContentBudgetMs,
  type SourceOperation,
} from "./network";
import { GitObjects, isOid } from "./objects";
import type { RemoteRequest, Repository, RepositoryReader, Revision } from "./types";

const REF_TTL = 30_000,
  IDLE_TTL = 24 * 60 * 60 * 1_000,
  TOUCH_INTERVAL = 60_000;
const time = v.pipe(v.number(), v.finite(), v.minValue(0));
const indexSchema = v.strictObject({
  version: v.literal(1),
  canonicalOrigin: v.string(),
  lastUsedAt: time,
  refs: v.record(v.string(), v.strictObject({ commit: gitObjectIdSchema, observedAt: time })),
  revisions: v.record(gitObjectIdSchema, gitObjectIdSchema),
});
type CacheIndex = v.InferOutput<typeof indexSchema>;

export function sourceCacheRoot() {
  const override = process.env.SKCTL_SOURCE_CACHE_DIR;
  if (override !== undefined && !isAbsolute(override))
    throw new SkctlError("INVALID_ARGUMENT", "SKCTL_SOURCE_CACHE_DIR must be absolute");
  if (override) return override;
  return join(envPaths("skctl", { suffix: "" }).cache, "sources-v1");
}
const originKey = (origin: string) => new Bun.CryptoHasher("sha256").update(origin).digest("hex");
async function readIndex(path: string, origin: string): Promise<CacheIndex> {
  await assertPath(path, "file", true);
  const file = Bun.file(path);
  if (!(await file.exists()))
    return { version: 1, canonicalOrigin: origin, lastUsedAt: Date.now(), refs: {}, revisions: {} };
  try {
    const index: unknown = await file.json();
    if (!v.is(indexSchema, index) || index.canonicalOrigin !== origin)
      throw new Error("Invalid index");
    return index;
  } catch {
    throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Invalid remote cache index");
  }
}

/** Runs under one origin lock; only validated object and revision facts are published. */
async function readRepository<T>(
  request: RemoteRequest,
  path: string,
  network: SourceOperation,
  operation: (repository: Repository) => Promise<T>,
) {
  const index = await readIndex(path, request.origin);
  const original = JSON.stringify(index);
  const objects = new GitObjects(join(dirname(path), "objects.git"), network.signal);
  await objects.initialize();
  const git = new GitTransfer(
    request.transport?.(request.origin) ?? request.origin,
    objects,
    network,
  );
  let provider: GitTransfer | GitHubTransfer | undefined;
  let transfers = Promise.resolve();
  const repairs = new Map<string, Promise<Revision>>();
  let active = true;
  const check = () => {
    if (!active) throw new SkctlError("INTERNAL", "Repository reader escaped its lifetime");
    if (request.signal?.aborted) throw new SkctlError("CANCELLED", "Source read cancelled");
    network.throwIfAborted("Source read");
  };
  const reads = new Set<Promise<unknown>>();
  async function own<R>(operation: () => Promise<R>): Promise<R> {
    check();
    const pending = operation();
    reads.add(pending);
    try {
      return await pending;
    } finally {
      reads.delete(pending);
    }
  }
  function acquire<R>(
    transfer: (provider: GitTransfer | GitHubTransfer) => Promise<R>,
  ): Promise<R> {
    const task = transfers.then(async () => {
      check();
      provider ??=
        request.kind === "github"
          ? ((await GitHubTransfer.create(
              request.origin,
              objects,
              network,
              request.githubApiBaseUrl,
            )) ?? git)
          : git;
      try {
        return await transfer(provider);
      } catch (error) {
        if (!(error instanceof GitHubUnavailable)) throw error;
        check();
        provider = git;
        try {
          return await transfer(git);
        } catch (fallback) {
          throw sourceNetworkError(
            network,
            `${error.message}; GitHub fallback`,
            fallback instanceof SkctlError ? fallback.code : "PROVIDER_UNAVAILABLE",
          );
        }
      }
    });
    transfers = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async function exact(commit: string, offline = false): Promise<Revision | undefined> {
    if (!isOid(commit)) throw new SkctlError("INVALID_ARGUMENT", "Expected exact remote commit");
    const tree = index.revisions[commit];
    if (tree) {
      try {
        // Acquisition verifies the full closure before indexing. Warm reads
        // verify only objects they actually consume; child loss is repaired
        // on access, never interpreted as an absent upstream path.
        await objects.tree(tree);
        return { commit, tree };
      } catch (error) {
        if (!(error instanceof SkctlError) || error.code !== "PROVIDER_INTEGRITY_FAILED")
          throw error;
      }
    }
    if (offline) return undefined;
    return repair(commit);
  }
  function repair(commit: string) {
    let pending = repairs.get(commit);
    if (!pending) {
      pending = acquire((provider) => provider.metadata(commit)).then(async (tree) => {
        const expected = index.revisions[commit];
        if (expected && tree !== expected)
          throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Cached revision tree changed");
        await objects.verifyTree(tree);
        index.revisions[commit] = tree;
        return { commit, tree };
      });
      repairs.set(commit, pending);
    }
    return pending;
  }
  async function retained(previous: CacheIndex["refs"][string] | undefined) {
    if (!previous) return undefined;
    const version = await exact(previous.commit, true);
    return version && { ...version, observedAt: previous.observedAt };
  }
  let pendingBlobs: { ids: Set<string>; task: Promise<void> } | undefined;
  function acquireBlobs(ids: readonly string[]) {
    if (!pendingBlobs) {
      const batch = new Set<string>();
      const task = acquire(async (provider) => {
        if (pendingBlobs?.ids === batch) pendingBlobs = undefined;
        return provider.blobs(await objects.missingBlobs([...batch]));
      });
      pendingBlobs = { ids: batch, task };
    }
    for (const id of ids) pendingBlobs.ids.add(id);
    return pendingBlobs.task;
  }
  function view(version: Revision, offline: boolean): RepositoryReader {
    Object.freeze(version);
    return {
      version,
      readTree(id) {
        return own(async () => {
          try {
            return await objects.tree(id);
          } catch (error) {
            if (
              offline ||
              !(error instanceof SkctlError) ||
              error.code !== "PROVIDER_INTEGRITY_FAILED"
            )
              throw error;
            await repair(version.commit);
            return objects.tree(id);
          }
        });
      },
      blobSize(id) {
        check();
        return objects.blobSize(id);
      },
      blobs(ids, maxBytes) {
        return own(async () => {
          const absent = await objects.missingBlobs(ids, maxBytes);
          if (!offline && absent.length) await acquireBlobs(absent);
          return objects.blobs(ids, maxBytes);
        });
      },
    };
  }
  const repository: Repository = {
    revision(target) {
      return own(async () => {
        const version = await resolve(target);
        const offline =
          "retained" in target || ("commit" in target && target.offline) || !!version?.refreshError;
        return version && view(version, !!offline);
      });
    },
  };
  async function resolve(target: Parameters<Repository["revision"]>[0]) {
    if ("commit" in target) {
      return exact(target.commit, target.offline);
    }
    const previous = Object.hasOwn(index.refs, request.ref) ? index.refs[request.ref] : undefined;
    if ("retained" in target) {
      return retained(previous);
    }
    const now = Date.now();
    if (previous && previous.observedAt <= now && now - previous.observedAt < REF_TTL)
      return { ...(await exact(previous.commit))!, observedAt: previous.observedAt };
    try {
      const commit = isOid(request.ref)
        ? request.ref
        : await acquire((provider) => provider.resolve(request.ref));
      const observedAt = Date.now(),
        version = (await exact(commit))!;
      index.refs = { ...index.refs, [request.ref]: { commit, observedAt } };
      return { ...version, observedAt };
    } catch (error) {
      if (
        request.signal?.aborted ||
        (error instanceof SkctlError && error.code === "CLEANUP_FAILED")
      )
        throw error;
      const previousVersion = await retained(previous);
      if (!previousVersion) throw error;
      return {
        ...previousVersion,
        refreshError: error instanceof Error ? error.message : "Remote refresh failed",
      };
    }
  }
  const [outcome] = await Promise.allSettled([Promise.resolve().then(() => operation(repository))]);
  active = false;
  await Promise.allSettled(reads);
  const factsChanged = JSON.stringify(index) !== original;
  if (Date.now() - index.lastUsedAt >= TOUCH_INTERVAL || index.lastUsedAt > Date.now())
    index.lastUsedAt = Date.now();
  const bytes = JSON.stringify(index);
  try {
    if (bytes !== original) await writeAtomic(path, bytes);
  } catch (error) {
    if (outcome.status === "fulfilled" && factsChanged) throw error;
  }
  if (outcome.status === "rejected") throw outcome.reason;
  return outcome.value;
}

export async function withRepository<T>(
  request: RemoteRequest,
  operation: (repository: Repository) => Promise<T>,
): Promise<T> {
  const origin = canonicalRemoteOrigin(request.origin),
    root = sourceCacheRoot(),
    key = originKey(origin);
  using network = createSourceOperation({ ...request, source: origin });
  const result = await withFileLock(
    join(root, "locks", key),
    async () => {
      const directory = join(root, "origins", key);
      await ensureDirectory(directory);
      return readRepository(
        { ...request, origin },
        join(directory, "cache.json"),
        network,
        operation,
      );
    },
    { signal: network.signal, timeoutMs: request.budgetMs ?? sourceContentBudgetMs },
  ).catch((error: unknown) => {
    if (error instanceof SkctlError && ["CLEANUP_FAILED", "PROVIDER_TIMEOUT"].includes(error.code))
      throw error;
    network.throwIfAborted("Source read");
    throw error;
  });
  await maintainSources(root).catch(() => {});
  return result;
}

/** Cross-process maintenance admission, not a scan/write after every read. */
async function maintainSources(root: string) {
  const stamp = join(root, "maintained");
  const due = async () => {
    await assertPath(stamp, "file", true);
    const stat = await lstat(stamp).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    return !stat || stat.mtimeMs > Date.now() || Date.now() - stat.mtimeMs >= 60 * 60 * 1_000;
  };
  if (!(await due())) return;
  await withFileLock(
    join(root, "locks", "maintenance"),
    async () => {
      if (!(await due())) return;
      await reclaimSources(root);
      await writeAtomic(stamp, "");
    },
    { timeoutMs: 50 },
  );
}

const entries = (path: string) =>
  readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
/** Reclamation takes the same origin lock, then removes only an irreversible tombstone. */
export async function reclaimSources(root = sourceCacheRoot()) {
  const origins = join(root, "origins"),
    trash = join(root, "trash");
  await assertPath(origins, "directory", true);
  for (const key of await entries(origins)) {
    if (!/^[a-f0-9]{64}$/.test(key)) continue;
    try {
      await withFileLock(
        join(root, "locks", key),
        async () => {
          const directory = join(origins, key);
          if (!(await lstat(directory).catch(() => undefined))) return;
          await assertPath(directory, "directory");
          const file = Bun.file(join(directory, "cache.json"));
          if (!(await file.exists())) return;
          let index: unknown;
          try {
            index = await file.json();
          } catch {
            return;
          }
          if (!v.is(indexSchema, index) || originKey(index.canonicalOrigin) !== key) return;
          if (Date.now() - index.lastUsedAt < IDLE_TTL) return;
          await ensureDirectory(trash);
          await rename(directory, join(trash, crypto.randomUUID()));
        },
        { timeoutMs: 50 },
      );
    } catch (error) {
      if (!(error instanceof SkctlError) || error.code !== "LOCK_TIMEOUT") throw error;
    }
  }
  await assertPath(trash, "directory", true);
  for (const name of await entries(trash)) {
    if (!/^[a-f0-9-]{36}$/.test(name)) continue;
    const path = join(trash, name);
    await assertPath(path, "directory", true);
    await rm(path, { recursive: true, force: true });
  }
}
