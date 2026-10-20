import { SkctlError } from "../../shared";
import { decodeStrictText, parseSkillMetadata } from "../../content/text";
import { parseResourcePath } from "../../content/path";
import type { RepositoryReader } from "./remote/types";
import type { TreeEntry } from "isomorphic-git";

export const joinSourcePath = (...parts: readonly string[]) => parts.filter(Boolean).join("/");
export function validateSkillPaths(paths: readonly string[]) {
  if (new Set(paths).size !== paths.length)
    throw new SkctlError("INVALID_ARGUMENT", "Skill paths must be unique");
  for (const path of paths) {
    try {
      if (path) parseResourcePath(path);
    } catch {
      throw new SkctlError("INVALID_ARGUMENT", "Invalid Skill path");
    }
  }
}
export function skillMetadata(bytes: Uint8Array) {
  return parseSkillMetadata(decodeStrictText(bytes));
}

export interface FileEntry extends TreeEntry {
  readonly size?: number;
}
export async function sourceTree(reader: RepositoryReader, root: string) {
  if (root) parseResourcePath(root);
  let tree = reader.version.tree;
  for (const part of root.split("/").filter(Boolean)) {
    const entry = (await reader.readTree(tree)).find((item) => item.path === part);
    if (!entry || entry.type !== "tree") return undefined;
    tree = entry.oid;
  }
  return tree;
}

/** Only an ordinary SKILL.md at the exact unshadowed Root yields a tree. */
export async function skillTree(
  reader: RepositoryReader,
  boundary: string | undefined,
  path: string,
): Promise<string | undefined> {
  if (path) parseResourcePath(path);
  if (!boundary) return undefined;
  let tree = boundary;
  for (const part of path.split("/").filter(Boolean)) {
    const entries = await reader.readTree(tree);
    if (
      entries.some((item) => item.path === "SKILL.md" && ["100644", "100755"].includes(item.mode))
    )
      return undefined;
    const next = entries.find((item) => item.path === part);
    if (!next || next.type !== "tree") return undefined;
    tree = next.oid;
  }
  return (await reader.readTree(tree)).some(
    (item) => item.path === "SKILL.md" && ["100644", "100755"].includes(item.mode),
  )
    ? tree
    : undefined;
}

export async function listFiles(
  reader: RepositoryReader,
  tree: string,
  prefix = "",
): Promise<readonly FileEntry[]> {
  const files: FileEntry[] = [];
  const walk = async (id: string, path: string, depth: number) => {
    if (depth > 32) throw new SkctlError("TEXT_TOO_LARGE", "Source directory depth exceeded");
    for (const entry of await reader.readTree(id)) {
      const full = joinSourcePath(path, entry.path);
      parseResourcePath(full);
      if (entry.type === "tree") await walk(entry.oid, full, depth + 1);
      else {
        if (files.length >= 10_000)
          throw new SkctlError("TEXT_TOO_LARGE", "Source file count exceeded");
        files.push({ ...entry, path: full, size: reader.blobSize(entry.oid) });
      }
    }
  };
  await walk(tree, prefix, 0);
  return files;
}

export async function candidateMarkers(reader: RepositoryReader, boundary: string | undefined) {
  const markers: { path: string; oid: string }[] = [];
  const walk = async (tree: string, path: string, depth: number): Promise<void> => {
    if (depth > 32 || markers.length > 10_000)
      throw new SkctlError("TEXT_TOO_LARGE", "Discovery limit exceeded");
    const entries = await reader.readTree(tree);
    const marker = entries.find(
      (entry) => entry.path === "SKILL.md" && ["100644", "100755"].includes(entry.mode),
    );
    if (marker) {
      markers.push({ path, oid: marker.oid });
      return;
    }
    for (const entry of entries)
      if (entry.type === "tree") await walk(entry.oid, joinSourcePath(path, entry.path), depth + 1);
  };
  if (boundary) await walk(boundary, "", 0);
  return markers;
}
