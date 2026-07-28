import { SkillCliError, type SkillProvenance } from "../api";
import { openGitSource } from "./source-git";
import { openGitHubSource, resolveGitHubApi } from "./source-github";
import { openLocalSource } from "./source-local";
import { decodeStrictText, parseNameSegment } from "./domain";

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
interface SnapshotBase {
  readonly sourceName: string;
  readonly provenance: SkillProvenance;
  /** Entries always retain Source Root-relative paths; prefix only filters descendants. */
  list(prefix: string, signal?: AbortSignal): AsyncIterable<SourceEntry>;
  read(path: string, signal?: AbortSignal): Promise<SourceEntryContent>;
  close(): Promise<void>;
}
export interface LocalSnapshot extends SnapshotBase {
  readonly kind: "local";
  readonly sourceRoot: string;
}
export interface RemoteSnapshot extends SnapshotBase {
  readonly kind: "remote";
  readonly commit: string;
  readonly repositoryRoot: string;
}
export type SourceSnapshot = LocalSnapshot | RemoteSnapshot;

export async function openSource(
  sourceName: string,
  locator:
    | { readonly origin: "local"; readonly path: string; readonly text?: string }
    | {
        readonly origin: "git";
        readonly url: string;
        readonly commit: string;
        readonly path: string;
        readonly text?: string;
      },
  provenance: SkillProvenance,
  signal?: AbortSignal,
  transport?: (url: string) => string | undefined,
  githubApiBaseUrl?: string,
): Promise<SourceSnapshot> {
  acquisitionTrap?.();
  if (signal?.aborted)
    throw new (await import("../api")).SkillCliError("CANCELLED", "Operation cancelled");
  switch (locator.origin) {
    case "local":
      return openLocalSource(sourceName, locator.path, provenance);
    case "git": {
      const api = await resolveGitHubApi(locator.url, signal, githubApiBaseUrl);
      return api
        ? openGitHubSource(
            sourceName,
            locator.url,
            locator.commit,
            locator.path,
            provenance,
            signal,
            api,
            transport?.(locator.url) ?? locator.url,
          )
        : openGitSource(
            sourceName,
            transport?.(locator.url) ?? locator.url,
            locator.commit,
            locator.path,
            provenance,
            signal,
          );
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
  readonly diagnostics: readonly import("../api").Diagnostic[];
}> {
  const diagnostics: import("../api").Diagnostic[] = [];
  const skills: { root: string; name: string; description: string }[] = [];
  const stopped = new Set<string>();
  for (const entry of (await Array.fromAsync(snapshot.list("", signal))).sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  )) {
    if (entry.kind !== "file" || !entry.path.endsWith("SKILL.md")) continue;
    const root = entry.path.slice(0, -"SKILL.md".length).replace(/\/$/u, "");
    if ([...stopped].some((ancestor) => ancestor === "" || root.startsWith(`${ancestor}/`)))
      continue;
    stopped.add(root);
    try {
      const text = decodeStrictText((await snapshot.read(entry.path, signal)).bytes);
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)?.[1];
      const nameText = frontmatter && /^name:\s*(.+)$/mu.exec(frontmatter)?.[1];
      const description = frontmatter && /^description:\s*(.+)$/mu.exec(frontmatter)?.[1];
      if (!nameText || !description) throw new Error("frontmatter");
      const name = parseNameSegment(nameText);
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
