import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SkctlError, type Diagnostic } from "../../shared";
import { assertPath } from "../../storage/files";
import { digestDirectory } from "../../content/directory";
import type { SourceBindingView } from "../types";
import { joinSourcePath, skillMetadata, validateSkillPaths } from "./skills";

async function stat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export async function localBoundary(binding: SourceBindingView) {
  let root = resolve(binding.origin);
  await assertPath(root, "directory", true);
  for (const part of ["", ...binding.root.split("/").filter(Boolean)]) {
    if (part) root = join(root, part);
    const value = await stat(root);
    if (!value) return undefined;
    if (!value.isDirectory() || value.isSymbolicLink())
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Local Source prefix is unsafe");
  }
  return root;
}

export async function inspectLocal(binding: SourceBindingView, path: string) {
  validateSkillPaths([path]);
  let root = await localBoundary(binding);
  if (!root) return { status: "missing" as const };
  const parts = path.split("/").filter(Boolean);
  for (let index = 0; index <= parts.length; index++) {
    const value = await stat(root);
    if (!value) return { status: "missing" as const };
    if (!value.isDirectory() || value.isSymbolicLink())
      return { status: "not-skill-root" as const };
    const marker = await stat(join(root, "SKILL.md"));
    if (index < parts.length) {
      if (marker?.isFile() && !marker.isSymbolicLink())
        return { status: "not-skill-root" as const };
      root = join(root, parts[index]!);
      continue;
    }
    if (!marker?.isFile() || marker.isSymbolicLink()) return { status: "not-skill-root" as const };
    const bytes = await readFile(join(root, "SKILL.md"));
    let metadata;
    try {
      metadata = skillMetadata(bytes);
    } catch (error) {
      if (!(error instanceof SkctlError)) throw error;
      return {
        status: "malformed" as const,
        marker: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      };
    }
    const digest = await digestDirectory(root);
    if (!bytes.equals(await readFile(join(root, "SKILL.md"))))
      throw new SkctlError("TRANSACTION_CONFLICT", "Local marker changed during inspection");
    return { status: "present" as const, path, root, digest, ...metadata };
  }
  throw new SkctlError("INTERNAL", "Unreachable Local inspection");
}

export async function discoverLocal(binding: SourceBindingView) {
  const boundary = await localBoundary(binding);
  if (!boundary) throw new SkctlError("SOURCE_NOT_FOUND", "Local Source is missing");
  const candidates: { path: string; name: string; description: string }[] = [];
  const diagnostics: Diagnostic[] = [];
  const walk = async (root: string, path: string, depth: number) => {
    if (depth > 32 || candidates.length > 10_000)
      throw new SkctlError("TEXT_TOO_LARGE", "Discovery limit exceeded");
    const marker = join(root, "SKILL.md"),
      value = await stat(marker);
    if (value?.isFile() && !value.isSymbolicLink()) {
      try {
        candidates.push({ path, ...skillMetadata(await readFile(marker)) });
      } catch (error) {
        if (!(error instanceof SkctlError)) throw error;
        diagnostics.push({
          code: "SKILL_FRONTMATTER_INVALID",
          severity: "warning",
          message: error.message,
          location: { file: marker },
        });
      }
      return;
    }
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      Buffer.from(a.name).compare(Buffer.from(b.name)),
    ))
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await walk(join(root, entry.name), joinSourcePath(path, entry.name), depth + 1);
  };
  await walk(boundary, "", 0);
  return { candidates, diagnostics };
}
