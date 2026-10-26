import type { CoreOptions, Diagnostic } from "../../shared";
import { SkctlError } from "../../shared";
import type { SourceBindingView, SourceNetwork } from "../types";
import { withRepository } from "./remote/cache";
import type { RemoteRequest, Revision } from "./remote/types";
import { sourceCheckBudgetMs, sourceContentBudgetMs } from "./remote/network";
import { candidateMarkers, skillTree, sourceTree, validateSkillPaths, listFiles } from "./skills";
import { discoverLocal, inspectLocal } from "./local";
import { skillMetadata } from "./skills";
import { prepareRemote, type PreparedSkill } from "./prepare";
import { previewFiles } from "./preview";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeStrictText } from "../../content/text";
import { localBoundary } from "./local";
import * as v from "valibot";
import { gitTreeIdentitySchema } from "../schema";
import { assertPath } from "../../storage/files";

export interface SourceContext extends SourceNetwork {
  readonly binding: SourceBindingView;
  readonly transport?: CoreOptions["sourceTransport"];
  readonly githubApiBaseUrl?: string;
  readonly signal?: AbortSignal;
}
export const installedEvidenceSchema = v.object({
  path: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  tree: v.optional(gitTreeIdentitySchema),
  revision: v.optional(v.string()),
});
export type InstalledEvidence = Readonly<v.InferOutput<typeof installedEvidenceSchema>>;
type Target =
  | { readonly commit: string }
  | { readonly current: true }
  | { readonly retained: true };

function remote(context: SourceContext, budgetMs = sourceContentBudgetMs): RemoteRequest {
  const { binding, ...options } = context;
  if (binding.kind === "local" || !binding.ref)
    throw new SkctlError("INVALID_ARGUMENT", "Expected remote binding");
  return { ...options, origin: binding.origin, ref: binding.ref, kind: binding.kind, budgetMs };
}
const cancelled = (context: SourceContext) => {
  if (context.signal?.aborted) throw new SkctlError("CANCELLED", "Source task cancelled");
};
function uniqueNames(candidates: readonly { name: string }[]) {
  const names = new Set<string>();
  for (const item of candidates) {
    if (names.has(item.name))
      throw new SkctlError("DUPLICATE_SKILL_NAME", `Duplicate Skill name: ${item.name}`);
    names.add(item.name);
  }
}

export async function discoverSource(context: SourceContext) {
  cancelled(context);
  if (context.binding.kind === "local") {
    const result = await discoverLocal(context.binding);
    uniqueNames(result.candidates);
    return { ...result, version: undefined };
  }
  return withRepository(remote(context), async (repository) => {
    const version = (await repository.revision({ current: true }))!;
    const boundary = await sourceTree(version, context.binding.root);
    const markers = await candidateMarkers(version, boundary);
    const bytes = await version.blobs(markers.map((marker) => marker.oid));
    const candidates: { path: string; name: string; description: string }[] = [],
      diagnostics: Diagnostic[] = [];
    for (const marker of markers) {
      try {
        candidates.push({ path: marker.path, ...skillMetadata(bytes.get(marker.oid)!) });
      } catch (error) {
        if (!(error instanceof SkctlError)) throw error;
        diagnostics.push({
          code: "SKILL_FRONTMATTER_INVALID",
          severity: "warning",
          message: error.message,
          location: { file: [marker.path, "SKILL.md"].filter(Boolean).join("/") },
        });
      }
    }
    uniqueNames(candidates);
    return { candidates, diagnostics, version: version.version };
  });
}

export async function compareSource(
  context: SourceContext,
  installed: readonly InstalledEvidence[],
  target: Target = { current: true },
) {
  cancelled(context);
  const changed: string[] = [],
    removed: string[] = [],
    unchanged: string[] = [];
  const metadata = new Map<string, { readonly name: string; readonly description: string }>();
  if (!installed.length)
    return { changed, removed, unchanged, metadata, version: undefined as Revision | undefined };
  if (context.binding.kind === "local") {
    for (const item of installed) {
      const current = await inspectLocal(context.binding, item.path);
      if (current.status !== "present") removed.push(item.path);
      else {
        metadata.set(item.path, { name: current.name, description: current.description });
        (current.name === item.name && current.description === item.description
          ? unchanged
          : changed
        ).push(item.path);
      }
    }
    return { changed, removed, unchanged, metadata, version: undefined as Revision | undefined };
  }
  return withRepository(remote(context, sourceCheckBudgetMs), async (repository) => {
    const version = await repository.revision(target);
    if (!version) return undefined;
    const boundary = await sourceTree(version, context.binding.root);
    for (const item of installed) {
      const current = await skillTree(version, boundary, item.path);
      if (!current) {
        removed.push(item.path);
        continue;
      }
      let previous = item.tree?.objectId;
      if (!previous) {
        if (!item.revision)
          throw new SkctlError(
            "PINNED_COMMIT_UNAVAILABLE",
            "Installed Skill lacks exact comparison evidence",
          );
        const old = await repository.revision({
          commit: item.revision,
          offline: "retained" in target,
        });
        if (!old) return undefined;
        previous = await skillTree(old, await sourceTree(old, context.binding.root), item.path);
        if (!previous)
          throw new SkctlError(
            "PROVIDER_INTEGRITY_FAILED",
            "Installed comparison Root is unavailable",
          );
      }
      (previous === current ? unchanged : changed).push(item.path);
    }
    return { changed, removed, unchanged, metadata, version: version.version };
  });
}

export async function withPreparedSkills<T>(
  context: SourceContext,
  paths: readonly string[],
  revision: string | undefined,
  operation: (skills: readonly PreparedSkill[]) => Promise<T>,
) {
  cancelled(context);
  validateSkillPaths(paths);
  if (!paths.length) throw new SkctlError("INVALID_ARGUMENT", "Select at least one Skill");
  if (context.binding.kind === "local") {
    if (revision) throw new SkctlError("INVALID_ARGUMENT", "Local Source has no revision");
    const prepared: PreparedSkill[] = [];
    for (const path of paths) {
      const found = await inspectLocal(context.binding, path);
      if (found.status !== "present")
        throw new SkctlError("SKILL_NOT_FOUND", "Local Skill is unavailable");
      prepared.push({
        kind: "local",
        path,
        directory: found.root,
        name: found.name,
        description: found.description,
      });
    }
    return operation(prepared);
  }
  if (!revision)
    throw new SkctlError("INVALID_ARGUMENT", "Remote Source requires an exact revision");
  const stage = await mkdtemp(join(tmpdir(), "skctl-prepare-"));
  try {
    const prepared = await withRepository(remote(context), async (repository) => {
      const version = (await repository.revision({ commit: revision }))!;
      const boundary = await sourceTree(version, context.binding.root);
      return prepareRemote(version, boundary, paths, stage);
    });
    return await operation(prepared);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Removal eligibility reads only the selected new Roots, never old comparison evidence. */
export async function assertRemovedSkills(
  context: SourceContext,
  paths: readonly string[],
  revision?: string,
) {
  cancelled(context);
  validateSkillPaths(paths);
  if (!paths.length) return;
  if (context.binding.kind === "local") {
    for (const path of paths)
      if ((await inspectLocal(context.binding, path)).status === "present")
        throw new SkctlError("CONFIG_CONFLICT", "Selected removal is still a valid Skill Root");
    return;
  }
  if (!revision)
    throw new SkctlError("INVALID_ARGUMENT", "Remote removal requires an exact revision");
  await withRepository(remote(context), async (repository) => {
    const version = (await repository.revision({ commit: revision }))!;
    const boundary = await sourceTree(version, context.binding.root);
    for (const path of paths)
      if (await skillTree(version, boundary, path))
        throw new SkctlError("CONFIG_CONFLICT", "Selected removal is still a valid Skill Root");
  });
}

export async function previewSource(
  context: SourceContext,
  path: string,
  revision: string,
  installedRoot: string,
  installedRevision: string,
) {
  cancelled(context);
  validateSkillPaths([path]);
  return withRepository(remote(context, sourceCheckBudgetMs), async (repository) => {
    const version = (await repository.revision({ commit: revision }))!;
    const boundary = await sourceTree(version, context.binding.root);
    const old = (await repository.revision({ commit: installedRevision }))!;
    const oldTree = await skillTree(old, await sourceTree(old, context.binding.root), path);
    if (!oldTree)
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Installed version Root is unavailable");
    const before = new Map<string, { oid: string; executable: boolean; bytes: number }>();
    for (const entry of await listFiles(old, oldTree)) {
      if (context.signal?.aborted) throw new SkctlError("CANCELLED", "Preview cancelled");
      if (!["100644", "100755"].includes(entry.mode))
        throw new SkctlError(
          "PROVIDER_INTEGRITY_FAILED",
          "Installed version contains an unsafe entry",
        );
      const file = join(installedRoot, entry.path);
      await assertPath(file, "file");
      before.set(entry.path, {
        oid: entry.oid,
        executable: entry.mode === "100755",
        bytes: Number((await lstat(file)).size),
      });
    }
    return previewFiles(version, boundary, path, installedRoot, before, context.signal);
  });
}

/** Config bytes use the same origin objects as Skills, but never Skill discovery rules. */
export async function readSourceConfig(context: SourceContext, revision?: string) {
  cancelled(context);
  if (context.binding.kind === "local") {
    if (revision) throw new SkctlError("INVALID_ARGUMENT", "Local Config Source has no revision");
    const boundary = await localBoundary(context.binding);
    if (!boundary) throw new SkctlError("SOURCE_NOT_FOUND", "Local Config Source is unavailable");
    const path = join(boundary, "config.jsonc"),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Config is not an ordinary file");
    const bytes = await readFile(path);
    decodeStrictText(bytes);
    return { bytes, version: undefined };
  }
  return withRepository(remote(context), async (repository) => {
    const version = (await repository.revision(
      revision ? { commit: revision } : { current: true },
    ))!;
    if (version.version.refreshError)
      throw new SkctlError("PROVIDER_UNAVAILABLE", version.version.refreshError);
    const boundary = await sourceTree(version, context.binding.root);
    const marker =
      boundary && (await version.readTree(boundary)).find((entry) => entry.path === "config.jsonc");
    if (!marker || !["100644", "100755"].includes(marker.mode))
      throw new SkctlError("RESOURCE_NOT_FOUND", "Config Source has no ordinary config.jsonc");
    const bytes = (await version.blobs([marker.oid], 1_048_576)).get(marker.oid)!;
    decodeStrictText(bytes);
    return { bytes, version: version.version };
  });
}

export { validateSkillPaths } from "./skills";
export type { PreparedSkill } from "./prepare";
