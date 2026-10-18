import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { SkillCliError } from "../shared";
import { type SkillProvenance } from "./types";
import { parseResourcePath } from "../content/path";
import type { LocalSnapshot, SourceEntry } from "./snapshot";

function relativePath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}
async function entries(root: string): Promise<SourceEntry[]> {
  const found: SourceEntry[] = [];
  async function walk(directory: string): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      Buffer.from(a.name).compare(Buffer.from(b.name)),
    )) {
      const path = join(directory, item.name);
      const relative = relativePath(root, path);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) found.push({ kind: "symlink", path: relative, size: stat.size });
      else if (stat.isDirectory()) {
        found.push({ kind: "directory", path: relative });
        await walk(path);
      } else if (stat.isFile())
        found.push({
          kind: "file",
          path: relative,
          size: stat.size,
          executable: Boolean(stat.mode & 0o111),
        });
    }
  }
  await walk(root);
  return found;
}
export async function openLocalSource(
  sourceName: string,
  sourceRoot: string,
  provenance: SkillProvenance,
): Promise<LocalSnapshot> {
  const root = await realpath(sourceRoot);
  const snapshot: LocalSnapshot = {
    kind: "local",
    sourceName,
    sourceRoot: root,
    provenance,
    async *list(prefix) {
      for (const entry of await entries(root))
        if (!prefix || entry.path.startsWith(`${prefix}/`)) yield entry;
    },
    async read(path) {
      parseResourcePath(path);
      const entry = (await entries(root)).find((item) => item.path === path);
      if (!entry || entry.kind === "directory")
        throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`);
      const target = join(root, ...path.split("/"));
      try {
        const bytes = await readFile(target);
        return { entry, bytes };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`, [], {
            cause: error,
          });
        throw error;
      }
    },
    async close() {},
  };
  return snapshot;
}
