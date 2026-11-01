import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseTree, type Node } from "jsonc-parser";
import { decodeConfig, parseDocument } from "./document";
import type { WorkspaceView } from "../workspace/types";
import type { PrivateState } from "../storage/schema";
import { SkctlError } from "../shared";
import { canonicalLocalOrigin } from "../source/identity";
import { contentHash, parseState } from "../storage/transaction";
import { assertPath, readOptional } from "../storage/files";

export const identityLimitation =
  "Only the captured workspace is inspected; other projects and external consumers are not rewritten.";

/** Captured under the global lock; byte evidence makes even comment-only review drift visible. */
function rejectDuplicates(text: string, file: string) {
  const visit = (node: Node) => {
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as string;
        if (keys.has(key)) throw new SkctlError("CONFIG_INVALID", `Duplicate JSONC key in ${file}`);
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (root) visit(root);
}

export async function identityDocuments(
  workspace: WorkspaceView,
  state: PrivateState,
  stateRoot: string,
) {
  const documents = await Promise.all(
    workspace.configs.map(async ({ level, file }) => {
      const stat = await lstat(file.file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (stat && (!stat.isFile() || stat.isSymbolicLink()))
        throw new SkctlError(
          "CONFIG_SYMLINK",
          `Configuration file is not an ordinary file: ${file.file}`,
        );
      const bytes = stat ? await readFile(file.file) : undefined;
      const text = bytes ? decodeConfig(bytes, file.file) : "{}\n";
      rejectDuplicates(text, file.file);
      return {
        level,
        file: file.file,
        text,
        exists: !!stat,
        hash: bytes ? contentHash(bytes) : null,
        value: parseDocument(text, file.file, level),
      };
    }),
  );
  const contributions = new Map<string, string | null>();
  for (const doc of documents)
    for (const binding of Object.values(doc.value.configSources ?? {})) {
      if (binding.kind !== "local") continue;
      const file = join(
        canonicalLocalOrigin(binding.path, dirname(doc.file)),
        binding.root,
        "config.jsonc",
      );
      await assertPath(file, "file", true);
      const bytes = await readOptional(file);
      const text = bytes ? decodeConfig(bytes, file) : "{}\n";
      rejectDuplicates(text, file);
      parseDocument(text, file, "reusable");
      contributions.set(file, bytes ? contentHash(bytes) : null);
    }
  const stateFile = join(stateRoot, "state.json");
  await assertPath(stateFile, "file", true);
  const stateBytes = await readOptional(stateFile);
  if (!sameReview(parseState(stateBytes), state))
    throw new SkctlError("CONFIG_CONFLICT", "State changed during capture");
  const readSet = [
    ...documents.map((doc) => ({
      path: doc.file,
      hash: doc.hash,
    })),
    ...[...contributions].map(([path, hash]) => ({ path, hash })),
    { path: stateFile, hash: stateBytes ? contentHash(stateBytes) : null },
  ];
  const baseline = new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify({
        project: workspace.project,
        documents,
        contributions: [...contributions],
        effective: workspace.effective,
        state,
      }),
    )
    .digest("hex");
  return { documents, baseline, readSet };
}

export function sameReview(left: unknown, right: unknown) {
  // Key order is not semantically relevant when evidence travels through a review file.
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
