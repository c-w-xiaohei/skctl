import { AsyncLocalStorage } from "node:async_hooks";
import { link, lstat, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { processIdentity, processStatus } from "../runtime/process";
import { SkctlError } from "../shared";
import { assertPath, ensureDirectory, readOptional, writeSynced } from "./files";
import { lockOwnerSchema, type LockOwner } from "./schema";
import * as v from "valibot";

type Owner = LockOwner;
interface LockOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
const held = new AsyncLocalStorage<ReadonlyMap<string, { active: boolean }>>();
export const isFileLockHeld = (path: string) =>
  held.getStore()?.get(resolve(path))?.active === true;
const sameInode = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) =>
  a.dev === b.dev && a.ino === b.ino;

async function readOwner(path: string): Promise<Owner | undefined> {
  await assertPath(path, "file", true);
  try {
    const bytes = await readOptional(path);
    if (!bytes) return undefined;
    const value = JSON.parse(bytes.toString());
    return v.is(lockOwnerSchema, value) ? value : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** The fence pins the exact owner inode; an unknown/live owner is never stolen. */
async function removeOwner(path: string, owner: Owner, ticket: string) {
  const election = `${path}.election`;
  let elected = false;
  try {
    try {
      await link(ticket, election);
      elected = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stale = await readOwner(election);
      if (stale && (await processStatus(stale)) === "dead") {
        const fence = `${ticket}.election-fence`;
        try {
          await link(election, fence);
          const pinned = await readOwner(fence);
          const current = await lstat(election).catch(() => undefined);
          if (pinned?.nonce === stale.nonce && current && sameInode(current, await lstat(fence)))
            await rm(election);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        } finally {
          await rm(fence, { force: true });
        }
      }
      return false;
    }
    const fence = `${ticket}.fence`;
    try {
      await link(path, fence);
      const pinned = await readOwner(fence);
      const current = await lstat(path).catch(() => undefined);
      if (
        pinned?.nonce !== owner.nonce ||
        pinned.pid !== owner.pid ||
        !current ||
        !sameInode(current, await lstat(fence))
      )
        return false;
      await rm(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    } finally {
      await rm(fence, { force: true });
    }
  } finally {
    if (elected) await rm(election, { force: true });
  }
}

async function releaseOwner(path: string, owner: Owner, ticket: string) {
  const deadline = Date.now() + 5_000;
  while (!(await removeOwner(path, owner, ticket))) {
    if (Date.now() >= deadline)
      throw new SkctlError("LOCK_LOST", `Could not release owned lock: ${path}`);
    await Bun.sleep(10);
  }
}

export async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  path = resolve(path);
  const inherited = held.getStore();
  if (inherited?.get(path)?.active) return operation();
  await ensureDirectory(dirname(path));
  const owner: Owner = { ...(await processIdentity()), nonce: crypto.randomUUID() };
  const ticket = `${path}.${owner.nonce}.owner`;
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  const check = () => {
    if (options.signal?.aborted) throw new SkctlError("CANCELLED", "Lock wait cancelled");
    if (Date.now() >= deadline) throw new SkctlError("LOCK_TIMEOUT", `Lock is held: ${path}`);
  };
  await writeSynced(ticket, JSON.stringify(owner), true);
  let acquired = false;
  try {
    for (;;) {
      check();
      try {
        await link(ticket, path);
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const observed = await readOwner(path);
      if (observed && (await processStatus(observed)) === "dead")
        await removeOwner(path, observed, ticket);
      await Bun.sleep(10);
    }
    const lifetime = { active: true };
    try {
      return await held.run(new Map([...(inherited ?? []), [path, lifetime]]), operation);
    } finally {
      lifetime.active = false;
    }
  } finally {
    try {
      if (acquired) await releaseOwner(path, owner, ticket);
    } finally {
      await rm(ticket, { force: true });
    }
  }
}
