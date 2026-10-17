import { cp, lstat, open, readFile, readlink, readdir, rename, unlink } from "node:fs/promises";
import { constants } from "node:os";
import { join, relative, resolve } from "node:path";
import type {
  ContentCapability,
  CoreFactoryOptions,
  OperationOptions,
  OperationResult,
  ResourceDescriptor,
} from "./api";
import { SkillCliError } from "./api";
import {
  decodeStrictText,
  parseNameSegment,
  parseResourcePath,
  parseSkillFrontmatter,
  parseSkillMetadata,
  textLimit,
} from "./internal/domain";
import { StateCoordinator } from "./internal/state";
import { readWorkspace, resolveInstalledSelector } from "./internal/config";

let contentHook: ((name: string) => void | Promise<void>) | undefined;
/** Test-only deterministic Reader I/O seam; it is intentionally not part of the public API. */
export function setContentHookForTest(next?: (name: string) => void | Promise<void>) {
  contentHook = next;
}
const contentSignal = async (name: string) => contentHook?.(name);

const resourceLimit = 10_000;
const resourceDepthLimit = 32;
const resourceWorkLimit = textLimit;

async function target(factory: CoreFactoryOptions, selector: string) {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const { item } = await resolveInstalledSelector(factory, selector, coordinator);
    const root = item.kind === "remote" ? await coordinator.verifySnapshot(item.digest) : item.root;
    const stat = await lstat(root).catch(() => undefined);
    if (
      !stat?.isDirectory() ||
      stat.isSymbolicLink() ||
      !(await Bun.file(join(root, "SKILL.md")).exists())
    )
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Installed snapshot is unavailable");
    const workspace = await readWorkspace(factory);
    const source =
      workspace.value.effective.status === "complete"
        ? workspace.value.effective.sources.find((candidate) => candidate.id === item.source)
        : undefined;
    return {
      item,
      root,
      coordinator,
      provenance: {
        source: item.source,
        origin: item.kind === "remote" ? ("git" as const) : ("local" as const),
        ...(source ? { declaration: source.provenance } : {}),
        stability: item.kind === "remote" ? ("immutable" as const) : ("mutable-local" as const),
      },
    };
  });
}
function cancelled(options?: OperationOptions) {
  if (options?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
}
async function safeFile(root: string, path: string) {
  const { candidate, stat } = await safeEntry(root, path);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new SkillCliError("RESOURCE_NOT_FOUND", "Resource not found");
  return candidate;
}

async function safeEntry(root: string, path: string) {
  parseResourcePath(path);
  const candidate = resolve(root, path);
  if (relative(root, candidate).startsWith(".."))
    throw new SkillCliError("INVALID_RESOURCE_PATH", "Resource escapes Skill root");
  let current = root;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat) throw new SkillCliError("RESOURCE_NOT_FOUND", "Resource not found");
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new SkillCliError("UNSUPPORTED_ENTRY", "Resource has an unsafe path");
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
    throw new SkillCliError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(rawText);
  if (rawText.startsWith("---") && !frontmatter)
    throw new SkillCliError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
  if (!frontmatter) return { ...fallback, rawText, markdownText: rawText };
  const values = parseSkillFrontmatter(frontmatter[1]!);
  const field = (name: "name" | "description", fallbackValue: string) => {
    const value = values[name];
    if (value === undefined) return fallbackValue;
    if (typeof value !== "string" || !value.trim())
      throw new SkillCliError("CONFIG_INVALID", "SKILL.md frontmatter is invalid");
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
      throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains a gitlink");
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      const resolved =
        target && !target.includes("\0") && !target.startsWith("/")
          ? resolve(join(path, ".."), target)
          : "";
      const targetStat =
        resolved && !relative(root, resolved).startsWith("..")
          ? await lstat(resolved).catch(() => undefined)
          : undefined;
      if (
        !targetStat ||
        targetStat.isSymbolicLink() ||
        (!targetStat.isFile() && !targetStat.isDirectory())
      )
        throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains an unsafe link");
      continue;
    }
    if (!stat.isFile() && !stat.isDirectory())
      throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains an unsafe entry");
    if (stat.isDirectory()) await safeTree(path);
  }
}
async function withContentUse<T>(
  found: Awaited<ReturnType<typeof target>>,
  operation: () => Promise<T>,
): Promise<T> {
  return found.item.kind === "remote"
    ? found.coordinator.withRemoteUse(found.item.digest, operation)
    : operation();
}
export function createContent(_factory: CoreFactoryOptions): ContentCapability {
  return {
    async loadInstalled(request, options) {
      cancelled(options);
      const coordinator = new StateCoordinator();
      return coordinator.withInstalledRoot(request.address, async (found) => {
        cancelled(options);
        const file = await safeFile(found.root, "SKILL.md");
        cancelled(options);
        const metadata = await lstat(file);
        if (metadata.size > textLimit)
          throw new SkillCliError("TEXT_TOO_LARGE", "Text exceeds limit");
        await contentSignal("reader-before-read");
        cancelled(options);
        const rawText = decodeStrictText(await readFile(file));
        cancelled(options);
        return {
          value: {
            address: request.address,
            ...installedSkillText(rawText, found.item),
          },
          diagnostics: [],
        };
      });
    },
    async listInstalledResources(request, options) {
      cancelled(options);
      const coordinator = new StateCoordinator();
      const output: ResourceDescriptor[] = [];
      let work = 0;
      const visit = async (root: string, prefix = "", depth = 0): Promise<void> => {
        cancelled(options);
        if (depth > resourceDepthLimit)
          throw new SkillCliError("TEXT_TOO_LARGE", "Resource traversal exceeds depth limit");
        const entries = await readdir(root, { withFileTypes: true });
        cancelled(options);
        for (const entry of entries.sort((left, right) =>
          Buffer.from(left.name).compare(Buffer.from(right.name)),
        )) {
          cancelled(options);
          work += Buffer.byteLength(entry.name) + 64;
          if (work > resourceWorkLimit)
            throw new SkillCliError("TEXT_TOO_LARGE", "Resource traversal exceeds work limit");
          if (output.length >= resourceLimit)
            throw new SkillCliError("TEXT_TOO_LARGE", "Resource list exceeds limit");
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (path === "SKILL.md") continue;
          const stat = await lstat(join(root, entry.name));
          cancelled(options);
          work += 128;
          if (work > resourceWorkLimit)
            throw new SkillCliError("TEXT_TOO_LARGE", "Resource traversal exceeds work limit");
          if (entry.name === ".git")
            throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains a gitlink");
          if (stat.isSymbolicLink())
            throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains a symlink");
          if (stat.isDirectory()) {
            output.push({ path, kind: "directory" });
            await visit(join(root, entry.name), path, depth + 1);
          } else if (stat.isFile()) output.push(descriptor(path, stat));
          else throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains an unsafe entry");
        }
      };
      return coordinator.withInstalledRoot(request.address, async (found) => {
        cancelled(options);
        await visit(found.root);
        cancelled(options);
        return { value: output.sort((a, b) => a.path.localeCompare(b.path)), diagnostics: [] };
      });
    },
    async readInstalled(request, options) {
      cancelled(options);
      const coordinator = new StateCoordinator();
      return coordinator.withInstalledRoot(request.address, async (found) => {
        cancelled(options);
        const { candidate: file, stat: metadata } = await safeEntry(found.root, request.path);
        cancelled(options);
        if (!metadata) throw new SkillCliError("RESOURCE_NOT_FOUND", "Resource not found");
        const notText = (
          reason: "unsupported" | "too-large" | "binary",
          metadata: ResourceDescriptor,
        ) => ({
          value: { kind: "not-text" as const, path: request.path, reason, metadata },
          diagnostics: [],
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
            value: {
              kind: "text" as const,
              path: request.path,
              text: decodeStrictText(bytes),
              format: request.path.endsWith(".md") ? ("markdown" as const) : ("text" as const),
            },
            diagnostics: [],
          };
        } catch (error) {
          if (error instanceof SkillCliError && error.code === "INVALID_UTF8")
            return notText("binary", resource);
          throw error;
        }
      });
    },
    async load(request): Promise<OperationResult<import("./api").LoadedSkill>> {
      const found = await target(_factory, request.selector);
      const text = await withContentUse(found, async () =>
        decodeStrictText(await readFile(await safeFile(found.root, "SKILL.md"))),
      );
      return {
        value: {
          selector: request.selector,
          ...parseSkillMetadata(text),
          path: "SKILL.md",
          text,
          provenance: found.provenance,
        },
        diagnostics: [],
      };
    },
    async listResources(request) {
      const found = await target(_factory, request.selector);
      const output: ResourceDescriptor[] = [];
      const visit = async (root: string, prefix = ""): Promise<void> => {
        for (const entry of await readdir(root, { withFileTypes: true })) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (path === "SKILL.md") continue;
          const stat = await lstat(join(root, entry.name));
          if (stat.isSymbolicLink())
            throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains a symlink");
          if (stat.isDirectory()) {
            output.push({ path, kind: "directory" });
            await visit(join(root, entry.name), path);
          } else if (stat.isFile())
            output.push({ path, kind: "file", size: stat.size, executable: !!(stat.mode & 0o111) });
          else throw new SkillCliError("UNSUPPORTED_ENTRY", "Skill contains an unsafe entry");
        }
      };
      await withContentUse(found, () => visit(found.root));
      return { value: output.sort((a, b) => a.path.localeCompare(b.path)), diagnostics: [] };
    },
    async read(request) {
      const found = await target(_factory, request.selector);
      const text = await withContentUse(found, async () =>
        decodeStrictText(await readFile(await safeFile(found.root, request.path))),
      );
      return {
        value: {
          selector: request.selector,
          path: request.path,
          text,
          provenance: found.provenance,
        },
        diagnostics: [],
      };
    },
    async download(request) {
      const found = await target(_factory, request.selector);
      const bytes = await withContentUse(found, async () =>
        readFile(await safeFile(found.root, request.path)),
      );
      const output = resolve(request.output);
      const parent = resolve(output, "..");
      const parentStat = await lstat(parent).catch(() => undefined);
      if (!parentStat?.isDirectory() || parentStat.isSymbolicLink())
        throw new SkillCliError("WRITE_FAILED", "Output parent is unsafe");
      if (!relative(found.root, output).startsWith(".."))
        throw new SkillCliError("WRITE_FAILED", "Output cannot replace installed content");
      const existing = await lstat(output).catch(() => undefined);
      if (existing && (!request.force || !existing.isFile() || existing.isSymbolicLink()))
        throw new SkillCliError("DESTINATION_EXISTS", "Output already exists");
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
        value: {
          selector: request.selector,
          path: request.path,
          output: request.output,
          bytesWritten: bytes.byteLength,
          provenance: found.provenance,
        },
        diagnostics: [],
      };
    },
    async run(request, options?: OperationOptions) {
      if (options?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const found = await target(_factory, request.selector);
      return found.coordinator.withRunRoot(async (runRoot) => {
        const copy = async () => {
          await cp(found.root, runRoot, {
            recursive: true,
            dereference: false,
            errorOnExist: true,
          });
          await safeTree(runRoot);
          await safeFile(runRoot, "SKILL.md");
        };
        if (found.item.kind === "remote")
          await found.coordinator.withRemoteUse(found.item.digest, copy);
        else await copy();
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
          throw new SkillCliError("SPAWN_FAILED", "Unable to spawn skill command");
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
                    throw new SkillCliError(
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
              ? (Object.entries(constants.signals).find(
                  ([, number]) => number === signalCode,
                )?.[0] ?? String(signalCode))
              : (signalCode ?? (wasCancelled ? "SIGTERM" : null));
          return {
            value: {
              selector: request.selector,
              exitCode: result,
              signal,
              cancelled: wasCancelled,
            },
            diagnostics: [],
          };
        } finally {
          if (abort) options!.signal!.removeEventListener("abort", abort);
        }
      });
    },
  };
}
