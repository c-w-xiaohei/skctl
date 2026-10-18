import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { SkillCliError } from "../shared";
import { type SkillProvenance, type SourceBindingView } from "./types";
import { type CoreOptions } from "../shared";
import { openGitSource, openGitRef, resolveGitRef, type RunGit } from "./git";
import { openGitHubSource, resolveGitHubApi } from "./github";
import { openLocalSource } from "./local";
import { decodeStrictText, parseSkillMetadata, type SkillMetadata } from "../content/text";
import { parseResourcePath } from "../content/path";
import { type GitTreeIdentity } from "./schema";
import { createSourceOperation, type SourceOperation } from "./network";

let acquisitionTrap: (() => void) | undefined;
/** Test-only trap proving installed-content operations never open a provider. */
export function setAcquisitionTrapForTest(trap?: () => void) {
  acquisitionTrap = trap;
}

export type SourceEntry =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly size: number;
      readonly executable: boolean;
      readonly objectId?: string;
    }
  | {
      readonly kind: "symlink";
      readonly path: string;
      readonly size: number;
      readonly objectId?: string;
    }
  | { readonly kind: "gitlink"; readonly path: string; readonly commit: string }
  | { readonly kind: "directory"; readonly path: string };
export interface SourceEntryContent {
  readonly entry: Exclude<SourceEntry, { readonly kind: "directory" }>;
  readonly bytes: Uint8Array;
}
export interface TreeItem {
  readonly entry: SourceEntry;
  readonly objectId: string;
}
interface SnapshotBase {
  readonly sourceName: string;
  readonly provenance: SkillProvenance;
  /** Entries always retain Source Root-relative paths; prefix only filters descendants. */
  list(prefix: string, signal?: AbortSignal): AsyncIterable<SourceEntry>;
  read(path: string, signal?: AbortSignal): Promise<SourceEntryContent>;
  /** Acquires a bounded set of explicitly requested resources as one provider operation. */
  readMany?(paths: readonly string[], signal?: AbortSignal): Promise<readonly SourceEntryContent[]>;
  close(): Promise<void>;
}
export interface LocalSnapshot extends SnapshotBase {
  readonly kind: "local";
  readonly sourceRoot: string;
}
export interface RemoteSnapshot extends SnapshotBase {
  readonly kind: "remote";
  /** Optional byte bound applies before a blob buffer is returned; omitted keeps full reads. */
  read(path: string, signal?: AbortSignal, maxBytes?: number): Promise<SourceEntryContent>;
  readonly commit: string;
  readonly repositoryRoot: string;
  readMany(paths: readonly string[], signal?: AbortSignal): Promise<readonly SourceEntryContent[]>;
  inspectRevisions(
    requests: readonly { revision: string; paths: readonly string[] }[],
    signal?: AbortSignal,
  ): Promise<readonly { revision: string; roots: readonly RootInspection[] }[]>;
  inspectRoots(
    paths: readonly string[],
    signal?: AbortSignal,
    revision?: string,
  ): Promise<readonly RootInspection[]>;
}
export interface RootInspection {
  readonly path: string;
  readonly tree?: GitTreeIdentity;
  readonly status: "present" | "missing" | "not-skill-root";
}
export interface RootComparison extends Pick<RootInspection, "path" | "tree"> {
  readonly revision?: string;
}

export async function openUpdateSource(
  binding: SourceBindingView,
  options: CoreOptions,
  operation: SourceOperation,
  revision?: string,
  runGit?: RunGit,
): Promise<RemoteSnapshot> {
  const provenance: SkillProvenance = {
    source: binding.id,
    origin: "git",
    declaration: binding.provenance,
    stability: "immutable",
    ...(revision ? { revision } : {}),
  };
  if (binding.kind === "git") {
    acquisitionTrap?.();
    const url = options.sourceTransport?.(binding.origin) ?? binding.origin;
    return revision
      ? openGitSource(
          binding.id,
          url,
          revision,
          binding.root,
          provenance,
          operation.signal,
          operation,
          runGit,
        )
      : openGitRef(binding.id, url, binding.ref!, binding.root, provenance, operation, runGit);
  }
  const commit =
    revision ??
    (await resolveGitRef(
      binding.origin,
      binding.ref!,
      operation.signal,
      options.sourceTransport,
      operation,
      runGit,
    ));
  const snapshot = await openSource(
    binding.id,
    { origin: "git", kind: "github", url: binding.origin, commit, path: binding.root },
    { ...provenance, revision: commit },
    operation.signal,
    options.sourceTransport,
    options.githubApiBaseUrl,
    operation,
    true,
  );
  if (snapshot.kind !== "remote") {
    await snapshot.close();
    throw new SkillCliError("INTERNAL", "Expected remote source");
  }
  return snapshot;
}

/** Complete metadata task. No provider lifetime or per-file reads escape to the use case. */
export async function inspectRemoteRoots(
  binding: SourceBindingView,
  options: CoreOptions,
  comparisons: readonly RootComparison[],
  operation: SourceOperation,
  runGit?: RunGit,
) {
  const snapshot = await openUpdateSource(binding, options, operation, undefined, runGit);
  try {
    const roots = await snapshot.inspectRoots(
      comparisons.map((item) => item.path),
      operation.signal,
    );
    const present = new Map(
      roots.filter((root) => root.status === "present").map((root) => [root.path, root]),
    );
    const previous = new Map<string, GitTreeIdentity>();
    const legacy = new Map<string, string[]>();
    for (const item of comparisons) {
      if (!present.has(item.path)) continue;
      if (item.tree) previous.set(item.path, item.tree);
      else if (item.revision === snapshot.commit) {
        const root = present.get(item.path)!;
        if (root.tree) previous.set(item.path, root.tree);
      } else if (item.revision) {
        const paths = legacy.get(item.revision) ?? [];
        paths.push(item.path);
        legacy.set(item.revision, paths);
      } else
        throw new SkillCliError(
          "PINNED_COMMIT_UNAVAILABLE",
          "Installed Root has no exact comparison revision",
        );
    }
    const recovered = await snapshot.inspectRevisions(
      [...legacy].map(([revision, paths]) => ({ revision, paths })),
      operation.signal,
    );
    for (const result of recovered)
      for (const root of result.roots) {
        if (root.status !== "present" || !root.tree)
          throw new SkillCliError(
            "PROVIDER_INTEGRITY_FAILED",
            "Installed comparison Root is not present at its adopted commit",
          );
        previous.set(root.path, root.tree);
      }
    operation.throwIfAborted("check completion");
    return { commit: snapshot.commit, roots, previous };
  } finally {
    await snapshot.close();
  }
}

/** One exact-C task for every selected Root, including metadata-only removal observations. */
export async function materializeUpdateRoots(
  binding: SourceBindingView,
  options: CoreOptions,
  revision: string,
  paths: readonly string[],
  observe: readonly string[],
  stage: string,
  operation: SourceOperation,
  runGit?: RunGit,
) {
  const snapshot = await openUpdateSource(binding, options, operation, revision, runGit);
  try {
    const inspections = await snapshot.inspectRoots([...paths, ...observe], operation.signal);
    const files: { entry: Extract<SourceEntry, { kind: "file" }>; target: string }[] = [];
    const roots: { path: string; root: string; tree: GitTreeIdentity }[] = [];
    for (const [index, path] of paths.entries()) {
      const inspection = inspections.find((root) => root.path === path);
      if (inspection?.status !== "present" || !inspection.tree)
        throw new SkillCliError("INVALID_ARGUMENT", "Selected update is not a present Skill Root");
      const root = join(stage, String(index));
      await mkdir(root, { recursive: true });
      roots.push({ path, root, tree: inspection.tree });
      for await (const entry of snapshot.list(path, operation.signal)) {
        if (entry.kind === "directory") continue;
        if (entry.kind !== "file" || (path && !entry.path.startsWith(`${path}/`)))
          throw new SkillCliError(
            "PROVIDER_INTEGRITY_FAILED",
            "Selected Root contains an unsafe entry",
          );
        const relative = path ? entry.path.slice(path.length + 1) : entry.path;
        parseResourcePath(relative);
        files.push({ entry, target: join(root, ...relative.split("/")) });
      }
    }
    const contents = new Map(
      (
        await snapshot.readMany(
          files.map(({ entry }) => entry.path),
          operation.signal,
        )
      ).map((content) => [content.entry.path, content]),
    );
    for (const { entry, target } of files) {
      operation.throwIfAborted("materialization");
      const content = contents.get(entry.path);
      if (!content)
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Selected content is incomplete");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content.bytes, { mode: entry.executable ? 0o700 : 0o600 });
      if (entry.executable) await chmod(target, 0o700);
    }
    operation.throwIfAborted("update preparation");
    return { inspections, roots };
  } finally {
    await snapshot.close();
  }
}
export type SourceSnapshot = LocalSnapshot | RemoteSnapshot;

export async function openSource(
  sourceName: string,
  locator:
    | { readonly origin: "local"; readonly path: string; readonly text?: string }
    | {
        readonly origin: "git";
        readonly kind?: "git" | "github";
        readonly url: string;
        readonly commit: string;
        readonly path: string;
        readonly text?: string;
      },
  provenance: SkillProvenance,
  signal?: AbortSignal,
  transport?: (url: string) => string | undefined,
  githubApiBaseUrl?: string,
  operation?: SourceOperation,
  batchTrees = false,
): Promise<SourceSnapshot> {
  acquisitionTrap?.();
  if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  switch (locator.origin) {
    case "local":
      return openLocalSource(sourceName, locator.path, provenance);
    case "git": {
      const owned = operation === undefined;
      const active = operation ?? createSourceOperation({ source: sourceName, signal });
      const url = transport?.(locator.url) ?? locator.url;
      try {
        const api =
          locator.kind === "git"
            ? undefined
            : await resolveGitHubApi(locator.url, signal, githubApiBaseUrl, active);
        const snapshot = api
          ? await openGitHubSource(
              sourceName,
              locator.url,
              locator.commit,
              locator.path,
              provenance,
              signal,
              api,
              url,
              active,
              batchTrees,
            )
          : await openGitSource(
              sourceName,
              url,
              locator.commit,
              locator.path,
              provenance,
              signal,
              active,
            );
        if (!owned) return snapshot;
        return {
          ...snapshot,
          async close() {
            try {
              await snapshot.close();
            } finally {
              active.dispose();
            }
          },
        };
      } catch (error) {
        if (owned) active.dispose();
        throw error;
      }
    }
  }
}

export async function discoverSnapshotSkills(
  snapshot: SourceSnapshot,
  signal?: AbortSignal,
): Promise<{
  readonly skills: readonly {
    readonly root: string;
    readonly name: string;
    readonly description: string;
  }[];
  readonly diagnostics: readonly import("../shared").Diagnostic[];
}> {
  const diagnostics: import("../shared").Diagnostic[] = [];
  const skills: (SkillMetadata & { root: string })[] = [];
  const entries = (await Array.fromAsync(snapshot.list("", signal))).sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  const skillEntries = entries.filter(
    (entry) =>
      entry.kind === "file" && (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")),
  );
  const candidates = skillEntries.filter((entry) => {
    const root = entry.path.slice(0, -"SKILL.md".length).replace(/\/$/u, "");
    return !skillEntries.some(
      (ancestor) =>
        ancestor !== entry &&
        (ancestor.path === "SKILL.md" ||
          root.startsWith(ancestor.path.slice(0, -"SKILL.md".length))),
    );
  });
  const contents = snapshot.readMany
    ? new Map(
        (
          await snapshot.readMany(
            candidates.map((entry) => entry.path),
            signal,
          )
        ).map((item) => [item.entry.path, item]),
      )
    : undefined;
  for (const entry of candidates) {
    const root = entry.path.slice(0, -"SKILL.md".length).replace(/\/$/u, "");
    const content = contents?.get(entry.path) ?? (await snapshot.read(entry.path, signal));
    try {
      const text = decodeStrictText(content.bytes);
      const { name, description } = parseSkillMetadata(text);
      skills.push({
        root,
        name,
        description,
      });
    } catch {
      diagnostics.push({
        code: "SKILL_FRONTMATTER_INVALID",
        severity: "warning",
        message: "Malformed SKILL.md",
      });
    }
  }
  const duplicate = new Set<string>();
  const names = new Set<string>();
  for (const skill of skills) {
    if (names.has(skill.name)) duplicate.add(skill.name);
    names.add(skill.name);
  }
  if (duplicate.size)
    throw new SkillCliError(
      "DUPLICATE_SKILL_NAME",
      `Duplicate Skill name: ${[...duplicate].sort().join(", ")}`,
    );
  return { skills: skills.sort((a, b) => a.root.localeCompare(b.root)), diagnostics };
}
