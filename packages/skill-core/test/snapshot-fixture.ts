import { rename } from "node:fs/promises";
import { join } from "node:path";

/** Test snapshot identities are allocation IDs, never computed from fixture content. */
export const snapshotId = () => crypto.randomUUID();
/** Literal old formats use 64-hex directory names; no content hashing is needed. */
export async function legacySnapshots<T extends { kind: string; snapshotId?: string }>(
  root: string,
  installed: readonly T[],
) {
  const moved = new Map<string, string>();
  const result = [];
  for (const entry of installed) {
    const { snapshotId, ...item } = entry;
    if (item.kind !== "remote" || !snapshotId) {
      result.push({ ...item, digest: "0".repeat(64) });
      continue;
    }
    const digest = snapshotId.replaceAll("-", "").padEnd(64, "0");
    if (!moved.has(snapshotId) && digest !== snapshotId)
      await rename(join(root, "snapshots", snapshotId), join(root, "snapshots", digest));
    moved.set(snapshotId, digest);
    result.push({ ...item, digest });
  }
  return result;
}
