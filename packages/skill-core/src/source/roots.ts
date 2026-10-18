import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CoreOptions } from "../shared";

import type { SourceBindingView, DiscoveredSkillCandidate } from "./types";
import { SkillCliError } from "../shared";
import { decodeStrictText, parseSkillMetadata } from "../content/text";
import { parseResourcePath } from "../content/path";
import { type GitTreeIdentity } from "./schema";
import { readWorkspace, capturedWorkspace } from "../workspace/capture";
import { StateCoordinator } from "../storage/state";

export interface Candidate extends DiscoveredSkillCandidate {
  readonly root: string;
  readonly revision?: string;
  readonly tree?: GitTreeIdentity;
}

export async function sourceFor(options: CoreOptions, source: string, signal?: AbortSignal) {
  const workspace = await readWorkspace({ ...options, signal });
  if (workspace.value.effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  const binding = capturedWorkspace(workspace.value)?.sources.get(source);
  if (!binding) {
    const coordinator = new StateCoordinator();
    const state = await coordinator.withLock(() => coordinator.read());
    if (state.installed.some((item) => item.source === source))
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skill owner has disappeared from declarations",
      );
    throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${source}`);
  }
  return { binding, network: capturedWorkspace(workspace.value)?.network ?? {} };
}

export function validPaths(paths: readonly string[]) {
  if (new Set(paths).size !== paths.length)
    throw new SkillCliError("INVALID_ARGUMENT", "Selected Skill Roots must be unique");
  for (const path of paths) {
    try {
      if (path !== "") parseResourcePath(path);
    } catch {
      throw new SkillCliError("INVALID_ARGUMENT", "Invalid selected Skill Root path");
    }
  }
}

export function metadata(bytes: Uint8Array) {
  try {
    return parseSkillMetadata(decodeStrictText(bytes));
  } catch (error) {
    if (
      error instanceof SkillCliError &&
      ["CONFIG_INVALID", "INVALID_ARGUMENT", "INVALID_UTF8", "TEXT_TOO_LARGE"].includes(error.code)
    )
      return undefined;
    throw error;
  }
}

async function statOrMissing(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function localRoot(
  binding: SourceBindingView,
  path: string,
  coordinator: StateCoordinator,
) {
  let boundary = binding.origin;
  for (const component of ["", ...binding.root.split("/").filter(Boolean)]) {
    if (component) boundary = join(boundary, component);
    const stat = await statOrMissing(boundary);
    if (!stat) return { status: "missing" as const };
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new SkillCliError(
        "PROVIDER_INTEGRITY_FAILED",
        "Local Source prefix is not a safe directory",
      );
  }
  const parts = path ? path.split("/") : [];
  let root = boundary;
  for (let depth = 0; depth <= parts.length; depth++) {
    const stat = await statOrMissing(root);
    if (!stat) return { status: "missing" as const };
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { status: "not-skill-root" as const };
    const marker = await statOrMissing(join(root, "SKILL.md"));
    if (depth < parts.length) {
      if (marker?.isFile() && !marker.isSymbolicLink())
        return {
          status: "not-skill-root" as const,
          markerDigest: new Bun.CryptoHasher("sha256")
            .update(await readFile(join(root, "SKILL.md")))
            .digest("hex"),
        };
      root = join(root, parts[depth]!);
      continue;
    }
    if (!marker?.isFile() || marker.isSymbolicLink()) return { status: "not-skill-root" as const };
    const bytes = await readFile(join(root, "SKILL.md"));
    const parsed = metadata(bytes);
    if (!parsed)
      return {
        status: "malformed" as const,
        markerDigest: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      };
    const digest = await coordinator.snapshotDigest(root);
    if (!bytes.equals(await readFile(join(root, "SKILL.md"))))
      throw new SkillCliError(
        "TRANSACTION_CONFLICT",
        "Local marker changed during content capture",
      );
    return { status: "present" as const, candidate: { path, root, ...parsed }, digest };
  }
  throw new SkillCliError("INTERNAL", "Local Root inspection failed");
}
