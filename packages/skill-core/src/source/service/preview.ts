import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SkctlError } from "../../shared";
import { decodeStrictText, SourceContentLimitError, textLimit } from "../../content/text";
import type { SourceFileChange } from "../types";
import type { RepositoryReader } from "./remote/types";
import { skillTree, listFiles } from "./skills";

interface File {
  readonly oid: string;
  readonly executable: boolean;
  readonly bytes?: number;
}
type FileChange = { -readonly [K in keyof SourceFileChange]: SourceFileChange[K] };

const unavailable = (
  reason: "binary" | "too-large" | "preview-limit",
): SourceFileChange["content"] => ({ kind: "unavailable", reason });

/** Lists every change, but reads text only within the per-file and aggregate budgets. */
export async function previewFiles(
  reader: RepositoryReader,
  boundary: string | undefined,
  path: string,
  installedRoot: string,
  before: ReadonlyMap<string, File>,
  signal?: AbortSignal,
) {
  const tree = await skillTree(reader, boundary, path);
  const after = new Map<string, File>();
  if (tree) {
    for (const file of await listFiles(reader, tree)) {
      if (!["100644", "100755"].includes(file.mode))
        throw new SkctlError(
          "PROVIDER_INTEGRITY_FAILED",
          "Preview target contains an unsafe entry",
        );
      after.set(file.path, { oid: file.oid, executable: file.mode === "100755", bytes: file.size });
    }
  }
  const files: SourceFileChange[] = [];
  const changed = [...new Set([...before.keys(), ...after.keys()])].sort().filter((path) => {
    const old = before.get(path),
      next = after.get(path);
    return !old || !next || old.oid !== next.oid || old.executable !== next.executable;
  });
  let remaining = 4 * textLimit;
  async function readContent(path: string) {
    if (signal?.aborted) throw new SkctlError("CANCELLED", "Preview cancelled");
    const old = before.get(path),
      next = after.get(path);
    const change: FileChange = {
      path,
      status: !old ? "added" : !next ? "deleted" : "modified",
      before: old && { bytes: old.bytes!, executable: old.executable },
      after: next && { bytes: next.bytes, executable: next.executable },
      content: unavailable("preview-limit"),
    };
    if ((old?.bytes ?? 0) > textLimit || (next?.bytes ?? 0) > textLimit) {
      change.content = unavailable("too-large");
      return change;
    }
    if ((old?.bytes ?? 0) + (next?.bytes ?? 0) > remaining) return change;
    let newBytes: Uint8Array = new Uint8Array();
    if (next) {
      try {
        newBytes = (
          await reader.blobs([next.oid], Math.min(textLimit, remaining - (old?.bytes ?? 0)))
        ).get(next.oid)!;
      } catch (error) {
        if (!(error instanceof SourceContentLimitError)) throw error;
        change.after = { bytes: error.byteLength, executable: next.executable };
        if (error.byteLength > textLimit) change.content = unavailable("too-large");
        return change;
      }
      change.after = { bytes: newBytes.length, executable: next.executable };
    }
    const oldBytes = old ? await readFile(join(installedRoot, path)) : Buffer.alloc(0);
    if (oldBytes.length + newBytes.length > remaining) return change;
    remaining -= oldBytes.length + newBytes.length;
    if (oldBytes.includes(0) || newBytes.includes(0)) {
      change.content = unavailable("binary");
      return change;
    }
    try {
      change.content = {
        kind: "text",
        before: decodeStrictText(oldBytes),
        after: decodeStrictText(newBytes),
      };
    } catch (error) {
      if (!(error instanceof SkctlError) || error.code !== "INVALID_UTF8") throw error;
      change.content = unavailable("binary");
    }
    return change;
  }
  for (let index = 0; index < changed.length;) {
    const batch = [];
    let planned = remaining;
    do {
      const path = changed[index]!;
      const cost =
        (before.get(path)?.bytes ?? 0) +
        (after.get(path) ? (after.get(path)!.bytes ?? textLimit) : 0);
      if (cost > planned && batch.length) break;
      batch.push(readContent(path));
      planned -= Math.min(planned, cost);
      index++;
    } while (index < changed.length);
    // Requests share the repository's acquisition batch; every started read is drained.
    for (const result of await Promise.allSettled(batch)) {
      if (result.status === "rejected") throw result.reason;
      files.push(result.value);
    }
  }
  return { removed: !tree, files };
}
