import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SkillCliError } from "../shared";
import { type UpdateFileChange } from "./types";
import { decodeStrictText, SourceContentLimitError, textLimit } from "../content/text";
import { parseResourcePath } from "../content/path";
import type { RemoteSnapshot } from "../source/snapshot";

const fileLimit = 10_000;
const previewLimit = 4 * textLimit;
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new SkillCliError("CANCELLED", "Update preview cancelled");
};
type File = { readonly bytes: number; readonly executable: boolean; readonly objectId: string };

/** Installed remote snapshots are immutable and pinned by the caller for this entire read. */
async function installedFiles(root: string, signal?: AbortSignal) {
  const files = new Map<string, File>();
  let entries = 0;
  const visit = async (directory: string, prefix: string, depth: number) => {
    abort(signal);
    if (depth > 32)
      throw new SkillCliError("TEXT_TOO_LARGE", "Update preview directory limit exceeded");
    for (const name of await readdir(directory)) {
      abort(signal);
      if (++entries > fileLimit)
        throw new SkillCliError("TEXT_TOO_LARGE", "Update preview entry limit exceeded");
      const path = prefix ? `${prefix}/${name}` : name;
      parseResourcePath(path);
      const absolute = join(directory, name),
        stat = await lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new SkillCliError(
          "PROVIDER_INTEGRITY_FAILED",
          "Installed snapshot has an unsafe entry",
        );
      if (stat.isDirectory()) {
        await visit(absolute, path, depth + 1);
        continue;
      }
      if (files.size >= fileLimit)
        throw new SkillCliError("TEXT_TOO_LARGE", "Update preview file limit exceeded");
      const hash = createHash("sha1").update(`blob ${stat.size}\0`);
      for await (const chunk of createReadStream(absolute)) {
        abort(signal);
        hash.update(chunk);
      }
      files.set(path, {
        bytes: stat.size,
        executable: !!(stat.mode & 0o111),
        objectId: hash.digest("hex"),
      });
    }
  };
  await visit(root, "", 0);
  return files;
}

/** Compare all files, but bound text acquisition independently of the number of changes. */
export async function previewUpdateFiles(
  root: string,
  snapshot: RemoteSnapshot,
  path: string,
  removed: boolean,
  signal?: AbortSignal,
): Promise<readonly UpdateFileChange[]> {
  const before = await installedFiles(root, signal);
  const after = new Map<string, File & { readonly sourcePath: string }>();
  if (!removed)
    for await (const entry of snapshot.list(path, signal)) {
      abort(signal);
      if (entry.kind === "directory") continue;
      if (entry.kind !== "file" || !entry.objectId || (path && !entry.path.startsWith(`${path}/`)))
        throw new SkillCliError(
          "PROVIDER_INTEGRITY_FAILED",
          "Update target has an unsafe or incomplete entry",
        );
      const relative = path ? entry.path.slice(path.length + 1) : entry.path;
      parseResourcePath(relative);
      if (after.size >= fileLimit || after.has(relative))
        throw new SkillCliError("TEXT_TOO_LARGE", "Update preview file limit exceeded");
      after.set(relative, {
        bytes: entry.size,
        executable: entry.executable,
        objectId: entry.objectId,
        sourcePath: entry.path,
      });
    }
  const files: UpdateFileChange[] = [];
  let acquired = 0;
  for (const relative of [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
    a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b),
  )) {
    abort(signal);
    const old = before.get(relative),
      next = after.get(relative);
    if (old && next && old.objectId === next.objectId && old.executable === next.executable)
      continue;
    const bytes = (old?.bytes ?? 0) + (next?.bytes ?? 0);
    let afterSize = next?.bytes || undefined;
    let content: UpdateFileChange["content"];
    if ((old?.bytes ?? 0) > textLimit || (next?.bytes ?? 0) > textLimit)
      content = { kind: "unavailable", reason: "too-large" };
    else if (acquired + bytes > previewLimit)
      content = { kind: "unavailable", reason: "preview-limit" };
    else {
      const oldBytes = old ? await readFile(join(root, ...relative.split("/"))) : new Uint8Array();
      acquired += oldBytes.byteLength;
      try {
        const newBytes = next
          ? (
              await snapshot.read(
                next.sourcePath,
                signal,
                Math.min(textLimit, previewLimit - acquired),
              )
            ).bytes
          : new Uint8Array();
        if (next) afterSize = newBytes.byteLength;
        acquired += newBytes.byteLength;
        const beforeText = decodeStrictText(oldBytes),
          afterText = decodeStrictText(newBytes);
        content =
          beforeText.includes("\0") || afterText.includes("\0")
            ? { kind: "unavailable", reason: "binary" }
            : { kind: "text", before: beforeText, after: afterText };
      } catch (error) {
        if (error instanceof SourceContentLimitError) {
          afterSize = error.byteLength;
          content = {
            kind: "unavailable",
            reason: error.byteLength > textLimit ? "too-large" : "preview-limit",
          };
        } else {
          if (!(error instanceof SkillCliError) || error.code !== "INVALID_UTF8") throw error;
          content = { kind: "unavailable", reason: "binary" };
        }
      }
    }
    files.push({
      path: relative,
      status: !old ? "added" : !next ? "deleted" : "modified",
      ...(old ? { before: { bytes: old.bytes, executable: old.executable } } : {}),
      ...(next
        ? {
            after: {
              ...(afterSize !== undefined ? { bytes: afterSize } : {}),
              executable: next.executable,
            },
          }
        : {}),
      content,
    });
  }
  abort(signal);
  return files;
}
