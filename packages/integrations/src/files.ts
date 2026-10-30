import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  checkCancellation,
  diagnostic,
  IntegrationError,
  type IntegrationDiagnostic,
} from "./schema";

export interface FileSnapshot {
  readonly file: string;
  readonly text: string;
  readonly exists: boolean;
  readonly revision: string;
  readonly mode: number;
  readonly uid?: number;
  readonly gid?: number;
}

export const digest = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");

export async function capture(file: string): Promise<FileSnapshot> {
  let stat;
  try {
    stat = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { file, text: "", exists: false, revision: "missing", mode: 0o666 & ~process.umask() };
    throw new IntegrationError("FILE_UNREADABLE", "Cannot inspect the entry file", file);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
    throw new IntegrationError(
      "UNSUPPORTED_FILE",
      "Entry must be a regular file with a single link",
      file,
    );
  if (stat.size > 2_097_152)
    throw new IntegrationError("FILE_TOO_LARGE", "Entry file exceeds 2 MiB", file);
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino)
      throw new IntegrationError("REVISION_CONFLICT", "Entry changed while being opened", file);
    const bytes = await handle.readFile();
    if (bytes.length > 2_097_152)
      throw new IntegrationError("FILE_TOO_LARGE", "Entry file exceeds 2 MiB", file);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new IntegrationError("INVALID_ENCODING", "Entry must be UTF-8", file);
    }
    return {
      file,
      text,
      exists: true,
      mode: stat.mode & 0o777,
      uid: stat.uid,
      gid: stat.gid,
      revision: digest(
        `${stat.dev}:${stat.ino}:${stat.mode}:${stat.uid}:${stat.gid}:${digest(bytes)}`,
      ),
    };
  } finally {
    await handle.close();
  }
}

export async function verify(snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const before of snapshots) {
    if ((await capture(before.file)).revision !== before.revision)
      throw new IntegrationError(
        "REVISION_CONFLICT",
        "Entry or loading configuration changed; inspect again",
        before.file,
      );
  }
}

export async function withDirectoryLock<T extends { diagnostics: IntegrationDiagnostic[] }>(
  directory: string,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  checkCancellation(signal);
  await mkdir(directory, { recursive: true });
  const actual = await realpath(directory);
  const lock = join(actual, ".skctl-integration.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new IntegrationError(
        "INTEGRATION_BUSY",
        `Entry directory is locked. If its owning process has ended, remove ${lock} and retry.`,
        lock,
      );
    throw error;
  }
  let result: T | undefined;
  try {
    const owner = await open(join(lock, "owner.json"), "wx", 0o600);
    try {
      await owner.writeFile(
        JSON.stringify({ pid: process.pid, created: new Date().toISOString() }),
      );
    } finally {
      await owner.close();
    }
    checkCancellation(signal);
    if ((await realpath(directory)) !== actual)
      throw new IntegrationError("REVISION_CONFLICT", "Target directory changed", directory);
    result = await run();
    return result;
  } finally {
    try {
      await rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (result)
        result.diagnostics.push({
          code: "LOCK_CLEANUP_FAILED",
          message: `Operation finished, but the lock could not be removed: ${diagnostic(error).message}`,
          file: lock,
        });
      // Preserve the original operation error when no receipt was produced.
    }
  }
}

export interface CommitResult {
  readonly outcome: "applied" | "indeterminate";
  readonly backup?: string;
  readonly durability: "synced" | "unconfirmed";
  readonly diagnostics: IntegrationDiagnostic[];
}

export async function commit(
  before: FileSnapshot,
  text: string,
  evidence: readonly FileSnapshot[],
  signal?: AbortSignal,
): Promise<CommitResult> {
  const parent = dirname(before.file);
  const actual = await realpath(parent);
  const id = randomUUID();
  const stage = join(parent, `.${basename(before.file)}.skctl-${id}.tmp`);
  const backup = before.exists
    ? join(parent, `.${basename(before.file)}.skctl-${id}.bak`)
    : undefined;
  let committed = false;
  let uncertain = false;
  const diagnostics: IntegrationDiagnostic[] = [];
  try {
    if (backup) {
      const handle = await open(backup, "wx", 0o600);
      try {
        await handle.writeFile(before.text);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const handle = await open(stage, "wx", before.mode);
    try {
      await handle.writeFile(text);
      await handle.chmod(before.mode);
      if (before.uid !== undefined && before.gid !== undefined) {
        const stat = await handle.stat();
        if (stat.uid !== before.uid || stat.gid !== before.gid)
          await handle.chown(before.uid, before.gid);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verify(evidence);
    if ((await realpath(parent)) !== actual)
      throw new IntegrationError("REVISION_CONFLICT", "Target directory changed", parent);
    checkCancellation(signal);
    try {
      await rename(stage, before.file);
      committed = true;
    } catch (error) {
      const current = await capture(before.file).catch(() => undefined);
      if (current?.text === text) committed = true;
      else if (!current || current.revision !== before.revision) uncertain = true;
      if (!committed && !uncertain) throw error;
      diagnostics.push(diagnostic(error));
    }
    let durability: CommitResult["durability"] = "unconfirmed";
    if (committed) {
      try {
        const dir = await open(parent, "r");
        try {
          await dir.sync();
          durability = "synced";
        } finally {
          await dir.close();
        }
      } catch (error) {
        diagnostics.push(diagnostic(error));
      }
    }
    return { outcome: uncertain ? "indeterminate" : "applied", backup, durability, diagnostics };
  } finally {
    await rm(stage, { force: true }).catch(() => {});
    if (backup && !committed && !uncertain) await rm(backup, { force: true }).catch(() => {});
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
