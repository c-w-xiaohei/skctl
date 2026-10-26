import type { InstalledResourceResult } from "./types";
import type { LoadedInstalledSkill } from "./types";
import type { RunSkillResult } from "./types";
import type { RunSkillRequest } from "./types";
import type { DownloadResourceResult } from "./types";
import type { DownloadResourceRequest } from "./types";
import type { ReadResourceResult } from "./types";
import type { ReadResourceRequest } from "./types";
import type { LoadedSkill } from "./types";
import type { LoadSkillRequest } from "./types";
import { cp, lstat, open, readFile, readlink, readdir, rename, unlink } from "node:fs/promises";
import { constants } from "node:os";
import { join, relative, resolve } from "node:path";

import type { CoreOptions } from "../shared";
import type { OperationOptions } from "../shared";
import type { SkillAddress } from "../source/schema";
import type { ResourceDescriptor } from "./types";
import { SkctlError } from "../shared";
import { decodeStrictText, parseSkillFrontmatter, parseSkillMetadata, textLimit } from "./text";
import { parseNameSegment } from "../collection/names";
import { parseResourcePath } from "./path";
import { StateCoordinator } from "../storage/state";
import { resolveInstalledSelector } from "../collection/resolve";

let contentHook: ((name: string) => void | Promise<void>) | undefined;
/** Test-only deterministic Reader I/O seam; it is intentionally not part of the public API. */
export function setContentHookForTest(next?: (name: string) => void | Promise<void>) {
  contentHook = next;
}
const contentSignal = async (name: string) => contentHook?.(name);

const resourceLimit = 10_000;
const resourceDepthLimit = 32;
const resourceWorkLimit = textLimit;

async function withTarget<T>(
  factory: CoreOptions,
  selector: string,
  operation: (found: {
    readonly root: string;
    readonly provenance: ReadResourceResult["provenance"];
  }) => Promise<T>,
) {
  const coordinator = new StateCoordinator();
  let declaration: ReadResourceResult["provenance"]["declaration"];
  return coordinator.withInstalledRoot(
    async () => {
      const found = await resolveInstalledSelector(factory, selector, coordinator);
      declaration = found.declaration;
      return found.item;
    },
    async ({ item, root }) => {
      const marker = await lstat(join(root, "SKILL.md")).catch(() => undefined);
      if (!marker?.isFile() || marker.isSymbolicLink())
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Installed Skill marker is unavailable");
      return operation({
        root,
        provenance: {
          source: item.source,
          origin: item.kind === "remote" ? ("git" as const) : ("local" as const),
          declaration,
          stability: item.kind === "remote" ? ("immutable" as const) : ("mutable-local" as const),
        },
      });
    },
  );
}
function cancelled(options?: OperationOptions) {
  if (options?.signal?.aborted) throw new SkctlError("CANCELLED", "Operation cancelled");
}
async function safeFile(root: string, path: string) {
  const { candidate, stat } = await safeEntry(root, path);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new SkctlError("RESOURCE_NOT_FOUND", "Resource not found");
  return candidate;
}
async function readText(root: string, path: string) {
  const file = await safeFile(root, path);
  if ((await lstat(file)).size > textLimit)
    throw new SkctlError("TEXT_TOO_LARGE", "Text exceeds limit");
  return decodeStrictText(await readFile(file));
}

async function safeEntry(root: string, path: string) {
  parseResourcePath(path);
  const candidate = resolve(root, path);
  if (relative(root, candidate).startsWith(".."))
    throw new SkctlError("INVALID_RESOURCE_PATH", "Resource escapes Skill root");
  let current = root;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat) throw new SkctlError("RESOURCE_NOT_FOUND", "Resource not found");
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new SkctlError("UNSUPPORTED_ENTRY", "Resource has an unsafe path");
  }
  return { candidate, stat: await lstat(candidate).catch(() => undefined) };
}

function descriptor(path: string, stat: Awaited<ReturnType<typeof lstat>>): ResourceDescriptor {
  return {
    path,
    kind: "file",
    size: Number(stat.size),
    executable: !!(Number(stat.mode) & 0o111),
  };
}

function installedSkillText(
  rawText: string,
  fallback: { readonly name: string; readonly description: string },
) {
  if (rawText.startsWith("---") && !/^---\r?\n/u.test(rawText))
    throw new SkctlError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(rawText);
  if (rawText.startsWith("---") && !frontmatter)
    throw new SkctlError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  if (!frontmatter) return { ...fallback, rawText, markdownText: rawText };
  const values = parseSkillFrontmatter(frontmatter[1]!);
  const field = (name: "name" | "description", fallbackValue: string) => {
    const value = values[name];
    if (value === undefined) return fallbackValue;
    if (typeof value !== "string" || !value.trim())
      throw new SkctlError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
    return name === "name" ? parseNameSegment(value.trim()) : value.trim();
  };
  return {
    name: field("name", fallback.name),
    description: field("description", fallback.description),
    rawText,
    markdownText: rawText.slice(frontmatter[0].length),
  };
}
async function safeTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const stat = await lstat(path);
    if (entry.name === ".git")
      throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains a gitlink");
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      if (!target || target.includes("\0") || target.startsWith("/"))
        throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains an unsafe link");
      const resolved = resolve(join(path, ".."), target);
      if (relative(root, resolved).startsWith(".."))
        throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains an unsafe link");
      const targetStat = await lstat(resolved).catch(() => undefined);
      if (
        !targetStat ||
        targetStat.isSymbolicLink() ||
        (!targetStat.isFile() && !targetStat.isDirectory())
      )
        throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains an unsafe link");
      continue;
    }
    if (!stat.isFile() && !stat.isDirectory())
      throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains an unsafe entry");
    if (stat.isDirectory()) await safeTree(path);
  }
}
export async function loadInstalledSkill(
  environment: CoreOptions,
  request: { readonly address: SkillAddress },
  options?: OperationOptions,
): Promise<LoadedInstalledSkill> {
  cancelled(options);
  const coordinator = new StateCoordinator();
  return coordinator.withInstalledRoot(request.address, async (found) => {
    cancelled(options);
    const file = await safeFile(found.root, "SKILL.md");
    cancelled(options);
    const metadata = await lstat(file);
    if (metadata.size > textLimit) throw new SkctlError("TEXT_TOO_LARGE", "Text exceeds limit");
    await contentSignal("reader-before-read");
    cancelled(options);
    const rawText = decodeStrictText(await readFile(file));
    cancelled(options);
    return {
      address: request.address,
      ...installedSkillText(rawText, found.item),
    };
  });
}

export async function listInstalledResources(
  environment: CoreOptions,
  request: { readonly address: SkillAddress },
  options?: OperationOptions,
): Promise<readonly ResourceDescriptor[]> {
  cancelled(options);
  const coordinator = new StateCoordinator();
  const output: ResourceDescriptor[] = [];
  let work = 0;
  const visit = async (root: string, prefix = "", depth = 0): Promise<void> => {
    cancelled(options);
    if (depth > resourceDepthLimit)
      throw new SkctlError("TEXT_TOO_LARGE", "Resource traversal exceeds depth limit");
    const entries = await readdir(root, { withFileTypes: true });
    cancelled(options);
    for (const entry of entries.sort((left, right) =>
      Buffer.from(left.name).compare(Buffer.from(right.name)),
    )) {
      cancelled(options);
      work += Buffer.byteLength(entry.name) + 64;
      if (work > resourceWorkLimit)
        throw new SkctlError("TEXT_TOO_LARGE", "Resource traversal exceeds work limit");
      if (output.length >= resourceLimit)
        throw new SkctlError("TEXT_TOO_LARGE", "Resource list exceeds limit");
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (path === "SKILL.md") continue;
      const stat = await lstat(join(root, entry.name));
      cancelled(options);
      work += 128;
      if (work > resourceWorkLimit)
        throw new SkctlError("TEXT_TOO_LARGE", "Resource traversal exceeds work limit");
      if (entry.name === ".git")
        throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains a gitlink");
      if (stat.isSymbolicLink())
        throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains a symlink");
      if (stat.isDirectory()) {
        output.push({ path, kind: "directory" });
        await visit(join(root, entry.name), path, depth + 1);
      } else if (stat.isFile()) output.push(descriptor(path, stat));
      else throw new SkctlError("UNSUPPORTED_ENTRY", "Skill contains an unsafe entry");
    }
  };
  return coordinator.withInstalledRoot(request.address, async (found) => {
    cancelled(options);
    await visit(found.root);
    cancelled(options);
    return output.sort((a, b) => a.path.localeCompare(b.path));
  });
}

export async function readInstalledResource(
  environment: CoreOptions,
  request: { readonly address: SkillAddress; readonly path: string },
  options?: OperationOptions,
): Promise<InstalledResourceResult> {
  cancelled(options);
  const coordinator = new StateCoordinator();
  return coordinator.withInstalledRoot(request.address, async (found) => {
    cancelled(options);
    const { candidate: file, stat: metadata } = await safeEntry(found.root, request.path);
    cancelled(options);
    if (!metadata) throw new SkctlError("RESOURCE_NOT_FOUND", "Resource not found");
    const notText = (
      reason: "unsupported" | "too-large" | "binary",
      metadata: ResourceDescriptor,
    ) => ({
      kind: "not-text" as const,
      path: request.path,
      reason,
      metadata,
    });
    if (!metadata.isFile() || metadata.isSymbolicLink())
      return notText("unsupported", {
        path: request.path,
        kind: metadata.isSymbolicLink() ? "symlink" : "directory",
      });
    const resource = descriptor(request.path, metadata);
    if (metadata.size > 1_048_576) return notText("too-large", resource);
    await contentSignal("reader-before-read");
    cancelled(options);
    const bytes = await readFile(file);
    cancelled(options);
    if (bytes.includes(0)) return notText("binary", resource);
    try {
      return {
        kind: "text" as const,
        path: request.path,
        text: decodeStrictText(bytes),
        format: request.path.endsWith(".md") ? ("markdown" as const) : ("text" as const),
      };
    } catch (error) {
      if (error instanceof SkctlError && error.code === "INVALID_UTF8")
        return notText("binary", resource);
      throw error;
    }
  });
}
export async function loadSkill(
  factory: CoreOptions,
  request: LoadSkillRequest,
): Promise<LoadedSkill> {
  return withTarget(factory, request.selector, async (found) => {
    const text = await readText(found.root, "SKILL.md");
    return {
      selector: request.selector,
      ...parseSkillMetadata(text),
      path: "SKILL.md" as const,
      text,
      provenance: found.provenance,
    };
  });
}

export async function readResource(
  factory: CoreOptions,
  request: ReadResourceRequest,
): Promise<ReadResourceResult> {
  return withTarget(factory, request.selector, async (found) => {
    await contentSignal("reader-before-read");
    return {
      selector: request.selector,
      path: request.path,
      text: await readText(found.root, request.path),
      provenance: found.provenance,
    };
  });
}

export async function downloadResource(
  factory: CoreOptions,
  request: DownloadResourceRequest,
): Promise<DownloadResourceResult> {
  const found = await withTarget(factory, request.selector, async (found) => ({
    ...found,
    bytes: await readFile(await safeFile(found.root, request.path)),
  }));
  const bytes = found.bytes;
  const output = resolve(request.output);
  const parent = resolve(output, "..");
  const parentStat = await lstat(parent).catch(() => undefined);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink())
    throw new SkctlError("WRITE_FAILED", "Output parent is unsafe");
  if (!relative(found.root, output).startsWith(".."))
    throw new SkctlError("WRITE_FAILED", "Output cannot replace installed content");
  const existing = await lstat(output).catch(() => undefined);
  if (existing && (!request.force || !existing.isFile() || existing.isSymbolicLink()))
    throw new SkctlError("DESTINATION_EXISTS", "Output already exists");
  const temporary = join(parent, `.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, output);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {
    selector: request.selector,
    path: request.path,
    output: request.output,
    bytesWritten: bytes.byteLength,
    provenance: found.provenance,
  };
}

export async function runSkill(
  factory: CoreOptions,
  request: RunSkillRequest,
  options?: OperationOptions,
): Promise<RunSkillResult> {
  if (options?.signal?.aborted) throw new SkctlError("CANCELLED", "Operation cancelled");
  return new StateCoordinator().withRunRoot(async (runRoot) => {
    await withTarget(factory, request.selector, async (found) => {
      await cp(found.root, runRoot, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
      });
      await safeTree(runRoot);
      await safeFile(runRoot, "SKILL.md");
    });
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn({
        cmd: [...request.argv],
        cwd: runRoot,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
    } catch {
      throw new SkctlError("SPAWN_FAILED", "Unable to spawn skill command");
    }
    let abort: (() => void) | undefined;
    const waitForExit = async (milliseconds: number) =>
      Promise.race([child.exited, Bun.sleep(milliseconds).then(() => undefined)]);
    const cancelled =
      options?.signal &&
      new Promise<null>((resolve, reject) => {
        abort = () => {
          void (async () => {
            child.kill("SIGTERM");
            if ((await waitForExit(250)) === undefined) {
              child.kill("SIGKILL");
              if ((await waitForExit(250)) === undefined)
                throw new SkctlError(
                  "CLEANUP_FAILED",
                  "Skill process did not exit after cancellation",
                );
            }
            resolve(null);
          })().catch(reject);
        };
        options.signal!.addEventListener("abort", abort!, { once: true });
        if (options.signal!.aborted) abort();
      });
    try {
      const result = await (cancelled ? Promise.race([child.exited, cancelled]) : child.exited);
      const wasCancelled = options?.signal?.aborted === true;
      const signalCode = child.signalCode;
      const signal =
        typeof signalCode === "number"
          ? (Object.entries(constants.signals).find(([, number]) => number === signalCode)?.[0] ??
            String(signalCode))
          : (signalCode ?? (wasCancelled ? "SIGTERM" : null));
      return {
        selector: request.selector,
        exitCode: result,
        signal,
        cancelled: wasCancelled,
      };
    } finally {
      if (abort) options!.signal!.removeEventListener("abort", abort);
    }
  });
}
