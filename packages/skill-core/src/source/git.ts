import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SkillCliError } from "../shared";
import { type SkillProvenance } from "./types";
import { assertSourceContentLimit, SourceContentLimitError } from "../content/text";
import { parseResourcePath } from "../content/path";
import {
  createSourceOperation,
  sourceChildEnv,
  sourceNetworkError,
  sourceProxyConfigArgs,
  type SourceOperation,
} from "./network";
import type {
  RemoteSnapshot,
  RootInspection,
  SourceEntry,
  SourceEntryContent,
  TreeItem,
} from "./snapshot";

export type ProviderChildOptions = {
  readonly cmd: string[];
  readonly cwd?: string;
  readonly stdin?: Uint8Array;
  readonly env?: Record<string, string | undefined>;
  readonly stdout: "pipe";
  readonly stderr: "pipe";
};
export type RunGit = typeof runProviderChild;

/** Group ownership includes pipe drains, even after its leader exits. */
export async function runProviderChild(
  options: ProviderChildOptions,
  signal?: AbortSignal,
): Promise<{ readonly status: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array }> {
  if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  const child = Bun.spawn(options.cmd, {
    ...options,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
  });
  async function drain(
    value: ReadableStream<Uint8Array> | number | undefined,
    limit = 64 * 1024 * 1024,
    rejectOverflow = true,
  ) {
    if (!value || typeof value === "number") throw new Error("Child stream was not piped");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of value) {
      if (rejectOverflow && chunk.length > limit - size)
        throw new SkillCliError(
          "PROVIDER_INTEGRITY_FAILED",
          "Git response exceeds the output limit",
        );
      const keep = chunk.subarray(0, Math.max(0, limit - size));
      if (keep.length) {
        chunks.push(keep);
        size += keep.length;
      }
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  let aborted = false;
  let cleanup: Promise<void> | undefined;
  let cleanupError: unknown;
  const kill = (signal: "SIGTERM" | "SIGKILL") => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const stop = () => {
    if (cleanup) return;
    cleanup = (async () => {
      if (process.platform === "win32") {
        const killer = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const results = await Promise.allSettled([
          killer.exited,
          drain(killer.stdout),
          drain(killer.stderr, 64 * 1024, false),
        ]);
        if (
          results.some((result) => result.status === "rejected") ||
          (results[0].status === "fulfilled" && results[0].value !== 0)
        )
          throw new SkillCliError("PROVIDER_UNAVAILABLE", "Owned child tree cleanup failed");
      } else {
        kill("SIGTERM");
        // Pipes/leader may settle first; the owned group still gets its escalation.
        await Bun.sleep(250);
        kill("SIGKILL");
        // Linux PID1 can retain zombies; only live members of our group block cleanup.
        const deadline = Date.now() + 1000;
        for (;;) {
          let live = false;
          if (process.platform === "linux") {
            for (const name of await readdir("/proc")) {
              if (!/^\d+$/u.test(name)) continue;
              const stat = await readFile(`/proc/${name}/stat`, "utf8").catch((error) => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
                throw error;
              });
              const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
              if (Number(fields[2]) === child.pid && !["Z", "X"].includes(fields[0])) live = true;
            }
          } else {
            try {
              process.kill(-child.pid, 0);
              live = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
          }
          if (!live) break;
          if (Date.now() >= deadline)
            throw new Error("Owned process group still has live descendants");
          await Bun.sleep(10);
        }
      }
    })().catch((error) => {
      cleanupError = error;
    });
  };
  const onAbort = () => {
    aborted = true;
    stop();
  };
  const stdout = drain(child.stdout).catch((error) => {
    stop();
    throw error;
  });
  const stderr = drain(child.stderr, 64 * 1024, false).catch((error) => {
    stop();
    throw error;
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const results = await Promise.allSettled([
      child.exited.catch((error) => {
        stop();
        throw error;
      }),
      stdout,
      stderr,
    ]);
    await cleanup;
    if (cleanupError)
      throw new SkillCliError(
        "PROVIDER_UNAVAILABLE",
        `Owned child cleanup failed: ${String(cleanupError)}`,
      );
    for (const result of results)
      if (result.status === "rejected")
        throw new SkillCliError(
          "PROVIDER_UNAVAILABLE",
          `Owned pipe drain failed: ${String(result.reason)}`,
        );
    if (aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    const [status, output, error] = results;
    if (
      status.status !== "fulfilled" ||
      output.status !== "fulfilled" ||
      error.status !== "fulfilled"
    )
      throw new Error("Child completion was not settled");
    return { status: status.value, stdout: output.value, stderr: error.value };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

const oid = (value: string) => /^[0-9a-f]{40}$/u.test(value);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const gitUrl = (url: string) => (url.startsWith("/") ? `file://${url}` : url);
const pathParts = (path: string) => {
  if (path) parseResourcePath(path);
  return path.split("/").filter(Boolean);
};

async function gitCommands(
  operation: SourceOperation,
  target: string,
  sourceSignal?: AbortSignal,
  run: RunGit = runProviderChild,
) {
  const env = sourceChildEnv(operation);
  // Explicit exact-object fetch owns network activity; local parsing must fail closed.
  env.GIT_NO_LAZY_FETCH = "1";
  let config: string[] = [];
  if (operation.proxy !== undefined && /^https?:/iu.test(target)) {
    operation.throwIfAborted("Git proxy configuration");
    try {
      const result = await run(
        {
          cmd: [
            "git",
            "config",
            "--null",
            "--name-only",
            "--get-regexp",
            "^(http(\\..*)?|remote\\..*)\\.proxy$",
          ],
          cwd: tmpdir(),
          env,
          stdout: "pipe",
          stderr: "pipe",
        },
        sourceSignal ? AbortSignal.any([operation.signal, sourceSignal]) : operation.signal,
      );
      if (result.status > 1) throw new Error(text(result.stderr));
      config = sourceProxyConfigArgs(
        operation,
        target,
        text(result.stdout).split("\0").filter(Boolean),
      );
    } catch (error) {
      operation.throwIfAborted("Git proxy configuration");
      throw sourceNetworkError(
        operation,
        "Git proxy configuration",
        error,
        sourceSignal?.aborted ? "CANCELLED" : "PROVIDER_UNAVAILABLE",
      );
    }
  }
  return async (
    directory: string | undefined,
    args: string[],
    signal?: AbortSignal,
    stdin?: Uint8Array,
  ) => {
    const phase = `Git ${args[0]}`;
    operation.throwIfAborted(phase);
    const combined = AbortSignal.any([
      operation.signal,
      ...(sourceSignal ? [sourceSignal] : []),
      ...(signal ? [signal] : []),
    ]);
    if (combined.aborted)
      throw sourceNetworkError(operation, phase, "Operation cancelled", "CANCELLED");
    try {
      const command = ["git", "-c", "core.askPass=true", ...config];
      if (args[0] === "fetch" && args.includes("--stdin"))
        command.push("-c", "fetch.negotiationAlgorithm=noop");
      if (directory && args[0] !== "init") command.push(`--git-dir=${directory}`);
      command.push(...args);
      if (directory && args[0] === "init") command.push(directory);
      const result = await run(
        { cmd: command, cwd: tmpdir(), env, stdin, stdout: "pipe", stderr: "pipe" },
        combined,
      );
      operation.throwIfAborted(phase);
      if (result.status) {
        const reason = text(result.stderr) || `exit ${result.status}`;
        const code =
          /authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|HTTP.*(?:401|403)/iu.test(
            reason,
          )
            ? "PROVIDER_AUTH_FAILED"
            : /not our ref|unadvertised object|couldn't find remote ref|bad object|not a valid object/iu.test(
                  reason,
                )
              ? "PINNED_COMMIT_UNAVAILABLE"
              : "PROVIDER_UNAVAILABLE";
        throw sourceNetworkError(operation, phase, reason, code);
      }
      return result.stdout;
    } catch (error) {
      if (error instanceof Error && /cleanup failed|pipe drain failed/u.test(error.message))
        throw sourceNetworkError(operation, phase, error);
      operation.throwIfAborted(phase);
      if (combined.aborted)
        throw sourceNetworkError(operation, phase, "Operation cancelled", "CANCELLED");
      if (error instanceof SkillCliError) throw error;
      throw sourceNetworkError(operation, `${phase} startup/execution`, error);
    }
  };
}

/** Pure structural rule shared by native Git and complete GitHub tree acquisitions. */
export function inspectTreeRoots(
  source: string | undefined,
  paths: readonly string[],
  trees: ReadonlyMap<string, readonly TreeItem[]>,
): RootInspection[] {
  const indexed = new Map<string, ReadonlyMap<string, TreeItem>>();
  function children(id: string) {
    let entries = indexed.get(id);
    if (!entries) {
      const facts = trees.get(id);
      if (!facts)
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Root directory facts are incomplete");
      entries = new Map(facts.map((item) => [item.entry.path, item]));
      indexed.set(id, entries);
    }
    return entries;
  }
  return paths.map((path) => {
    if (!source) return { path, status: "missing" };
    let id = source;
    for (const segment of pathParts(path)) {
      const entries = children(id);
      if (entries.get("SKILL.md")?.entry.kind === "file") return { path, status: "not-skill-root" };
      const child = entries.get(segment);
      if (!child) return { path, status: "missing" };
      if (child.entry.kind !== "directory") return { path, status: "not-skill-root" };
      id = child.objectId;
    }
    if (children(id).get("SKILL.md")?.entry.kind !== "file")
      return { path, status: "not-skill-root" };
    return { path, status: "present", tree: { objectFormat: "sha1", objectId: id } };
  });
}
function parseTree(bytes: Uint8Array): TreeItem[] {
  return text(bytes)
    .split("\0")
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/u.exec(part);
      if (!match)
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git tree response is malformed");
      const mode = match[1]!,
        type = match[2]!,
        objectId = match[3]!,
        path = match[4]!;
      let entry: SourceEntry;
      if (mode === "160000" && type === "commit")
        entry = { kind: "gitlink", path, commit: objectId };
      else if (mode === "040000" && type === "tree") entry = { kind: "directory", path };
      else if (mode === "120000" && type === "blob")
        entry = { kind: "symlink", path, size: 0, objectId };
      else if (["100644", "100755"].includes(mode) && type === "blob")
        entry = { kind: "file", path, size: 0, executable: mode === "100755", objectId };
      else throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Unsupported Git tree mode");
      return { entry, objectId };
    });
}

export async function openGitSource(
  sourceName: string,
  url: string,
  commit: string,
  repositoryRoot: string,
  provenance: SkillProvenance,
  signal?: AbortSignal,
  operation?: SourceOperation,
  run?: RunGit,
): Promise<RemoteSnapshot> {
  if (!oid(commit)) throw new SkillCliError("INVALID_ARGUMENT", "Expected exact SHA-1 commit");
  return openGitSnapshot(
    sourceName,
    url,
    { commit },
    repositoryRoot,
    provenance,
    signal,
    operation,
    run,
  );
}

/** Fetch and pin one explicit ref in the same acquisition; short refs retain advertisement disambiguation. */
export async function openGitRef(
  sourceName: string,
  url: string,
  ref: string,
  repositoryRoot: string,
  provenance: SkillProvenance,
  operation: SourceOperation,
  run?: RunGit,
): Promise<RemoteSnapshot> {
  const target =
    ref.startsWith("refs/") || ref === "HEAD"
      ? { ref }
      : { commit: await resolveGitRef(url, ref, operation.signal, undefined, operation, run) };
  return openGitSnapshot(
    sourceName,
    url,
    target,
    repositoryRoot,
    provenance,
    operation.signal,
    operation,
    run,
  );
}

async function openGitSnapshot(
  sourceName: string,
  url: string,
  target: { commit: string } | { ref: string },
  repositoryRoot: string,
  provenance: SkillProvenance,
  signal?: AbortSignal,
  operation?: SourceOperation,
  run?: RunGit,
): Promise<RemoteSnapshot> {
  pathParts(repositoryRoot);
  const owned = operation === undefined;
  operation ??= createSourceOperation({ source: sourceName, signal });
  const active = operation;
  const directory = await mkdtemp(join(tmpdir(), "skill-cli-git-"));
  try {
    const git = await gitCommands(active, gitUrl(url), signal, run);
    await git(directory, ["init", "--bare", "--object-format=sha1"]);
    const acquired = new Set<string>();
    async function checkFiltering(readSignal?: AbortSignal) {
      // Inspect only locally present object headers; never recurse through candidate paths/blobs.
      const headers = text(
        await git(
          directory,
          ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"],
          readSignal,
        ),
      );
      if (
        headers
          .split("\n")
          .some((line) => line.endsWith(" blob") && !acquired.has(line.split(" ")[0]!))
      )
        throw sourceNetworkError(
          active,
          "Git filtering",
          "Git remote did not preserve blob filtering",
        );
    }
    const fetched = new Set<string>();
    const revisions = new Map<string, Promise<string>>();
    const trees = new Map<string, TreeItem[]>();
    const fetchArgs = [
      "fetch",
      "--no-tags",
      "--depth=1",
      "--filter=blob:none",
      "--no-recurse-submodules",
      "--no-auto-maintenance",
      "--no-write-commit-graph",
    ];
    await git(directory, [
      ...fetchArgs,
      gitUrl(url),
      "commit" in target ? target.commit : target.ref,
    ]);
    const initial = text(
      await git(directory, ["rev-parse", "FETCH_HEAD^{commit}", "FETCH_HEAD^{tree}"]),
    )
      .trim()
      .split("\n");
    const pinned = initial[0]!;
    if (!oid(pinned) || ("commit" in target && pinned !== target.commit))
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Fetched commit identity mismatch");
    const commit = pinned;
    fetched.add(commit);
    function revisionRoot(revision: string, readSignal?: AbortSignal) {
      checkAbort("Git commit", readSignal);
      if (!oid(revision))
        throw new SkillCliError("INVALID_ARGUMENT", "Expected exact SHA-1 commit");
      let promise = revisions.get(revision);
      if (!promise) {
        promise = (async () => {
          if (!fetched.has(revision)) {
            await git(directory, [...fetchArgs, gitUrl(url), revision], readSignal);
            fetched.add(revision);
          }
          const resolved =
            revision === commit
              ? initial
              : text(
                  await git(
                    directory,
                    ["rev-parse", `${revision}^{commit}`, `${revision}^{tree}`],
                    readSignal,
                  ),
                )
                  .trim()
                  .split("\n");
          const root = resolved[1];
          if (resolved[0] !== revision || !root || !oid(root))
            throw new SkillCliError(
              "PROVIDER_INTEGRITY_FAILED",
              "Pinned commit/tree identity mismatch",
            );
          const listing = parseTree(
            await git(
              directory,
              ["ls-tree", "-r", "-t", "-z", "--full-tree", revision],
              readSignal,
            ),
          );
          // One listing per revision, not one child process per directory/path.
          const directoryIds = new Map<string, string>([["", root]]);
          const names = new Set<string>();
          for (const item of listing) {
            if (
              item.entry.path.startsWith("/") ||
              item.entry.path.split("/").some((part) => !part || part === "." || part === "..")
            )
              throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git listing path is malformed");
            if (names.has(item.entry.path))
              throw new SkillCliError(
                "PROVIDER_INTEGRITY_FAILED",
                "Git listing has duplicate paths",
              );
            names.add(item.entry.path);
            if (item.entry.kind === "directory") directoryIds.set(item.entry.path, item.objectId);
          }
          const children = new Map<string, TreeItem[]>();
          for (const item of listing) {
            const split = item.entry.path.lastIndexOf("/");
            const parent = split < 0 ? "" : item.entry.path.slice(0, split);
            const name = item.entry.path.slice(split + 1);
            const id = directoryIds.get(parent);
            if (!id)
              throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git listing is incomplete");
            const items = children.get(parent) ?? [];
            items.push({ ...item, entry: { ...item.entry, path: name } });
            children.set(parent, items);
          }
          for (const [path, id] of directoryIds) trees.set(id, children.get(path) ?? []);
          await checkFiltering(readSignal);
          return root;
        })().catch((error) => {
          revisions.delete(revision);
          throw error;
        });
        revisions.set(revision, promise);
      }
      return promise;
    }
    function tree(id: string, readSignal?: AbortSignal) {
      checkAbort("Git tree", readSignal);
      const items = trees.get(id);
      if (!items)
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git directory facts are missing");
      return items;
    }
    async function directoryAt(revision: string, path: string, readSignal?: AbortSignal) {
      let id = await revisionRoot(revision, readSignal);
      for (const segment of pathParts(path)) {
        const item = (await tree(id, readSignal)).find((item) => item.entry.path === segment);
        if (!item || item.entry.kind !== "directory") return undefined;
        id = item.objectId;
      }
      return id;
    }
    await revisionRoot(commit);
    let queue = Promise.resolve(),
      closing = false;
    let closePromise: Promise<void> | undefined;
    function checkAbort(phase: string, methodSignal?: AbortSignal) {
      active.throwIfAborted(phase);
      if (signal?.aborted || methodSignal?.aborted)
        throw sourceNetworkError(active, phase, "Operation cancelled", "CANCELLED");
    }
    const exclusive = <T>(run: () => Promise<T>, phase: string, methodSignal?: AbortSignal) => {
      if (closing)
        return Promise.reject(new SkillCliError("PROVIDER_UNAVAILABLE", "Git snapshot is closed"));
      const pending = queue.then(async () => {
        try {
          checkAbort(phase, methodSignal);
          const result = await run();
          checkAbort(phase, methodSignal);
          return result;
        } catch (error) {
          if (!(error instanceof Error && /cleanup failed|pipe drain failed/u.test(error.message)))
            checkAbort(phase, methodSignal);
          if (error instanceof SourceContentLimitError) throw error;
          throw sourceNetworkError(
            active,
            phase,
            error,
            error instanceof SkillCliError ? error.code : "PROVIDER_UNAVAILABLE",
          );
        }
      });
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    };
    const contents = new Map<string, SourceEntryContent>();
    async function entryAt(path: string, readSignal?: AbortSignal) {
      const parts = pathParts(path),
        name = parts.pop()!;
      const parent = await directoryAt(
        commit,
        [repositoryRoot, parts.join("/")].filter(Boolean).join("/"),
        readSignal,
      );
      const item =
        parent && (await tree(parent, readSignal)).find((item) => item.entry.path === name);
      if (!item || (item.entry.kind !== "file" && item.entry.kind !== "symlink"))
        throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`);
      return { ...item.entry, path };
    }
    async function readMany(paths: readonly string[], readSignal?: AbortSignal, maxBytes?: number) {
      const unique = [...new Set(paths)];
      unique.forEach(parseResourcePath);
      checkAbort("Git blob", readSignal);
      if (!unique.length) return [];
      return exclusive(
        async () => {
          const needed: Extract<SourceEntry, { kind: "file" | "symlink" }>[] = [];
          for (const path of unique)
            if (!contents.has(path)) needed.push(await entryAt(path, readSignal));
          if (needed.length) {
            const objectIds = needed.map((entry) => entry.objectId);
            if (objectIds.some((id) => !id || !oid(id)))
              throw new SkillCliError(
                "PROVIDER_INTEGRITY_FAILED",
                "Git blob identity is malformed",
              );
            const encodeIds = (ids: readonly (string | undefined)[]) =>
              new TextEncoder().encode(ids.join("\n") + "\n");
            const wants = encodeIds([...new Set(objectIds)]);
            // Batch lookup retains path order/modes even when paths share one transfer OID.
            const uniqueIds = [...new Set(objectIds)];
            const input = encodeIds(uniqueIds);
            await git(
              directory,
              [
                "fetch",
                "--no-tags",
                "--no-write-fetch-head",
                "--recurse-submodules=no",
                "--filter=blob:none",
                "--no-auto-maintenance",
                "--no-write-commit-graph",
                "--no-prune",
                "--no-prune-tags",
                "--stdin",
                gitUrl(url),
              ],
              readSignal,
              wants,
            );
            if (maxBytes !== undefined) {
              // These explicitly requested blobs are transferred even if their
              // reported size prevents reading them into a preview buffer.
              for (const objectId of uniqueIds) acquired.add(objectId!);
              await checkFiltering(readSignal);
              const sizes = text(
                await git(directory, ["cat-file", "--batch-check"], readSignal, input),
              )
                .trimEnd()
                .split("\n");
              if (sizes.length !== uniqueIds.length)
                throw new SkillCliError(
                  "PROVIDER_INTEGRITY_FAILED",
                  "Git blob size response is incomplete",
                );
              for (const [index, line] of sizes.entries()) {
                const fields = line.split(" "),
                  size = Number(fields[2]);
                if (
                  fields.length !== 3 ||
                  fields[0] !== uniqueIds[index] ||
                  fields[1] !== "blob" ||
                  !/^(0|[1-9][0-9]*)$/u.test(fields[2] ?? "") ||
                  !Number.isSafeInteger(size)
                )
                  throw new SkillCliError(
                    "PROVIDER_INTEGRITY_FAILED",
                    "Git blob size response is malformed",
                  );
                assertSourceContentLimit(size, maxBytes);
              }
            }
            const objects = await git(directory, ["cat-file", "--batch"], readSignal, input);
            let offset = 0;
            const blobs = new Map<string, Uint8Array>();
            for (const objectId of uniqueIds) {
              const end = objects.indexOf(10, offset),
                header = text(objects.slice(offset, end)).split(" ");
              const size = Number(header[2]);
              if (
                end < 0 ||
                header.length !== 3 ||
                header[0] !== objectId ||
                header[1] !== "blob" ||
                !/^(0|[1-9][0-9]*)$/u.test(header[2] ?? "") ||
                !Number.isSafeInteger(size)
              )
                throw new SkillCliError(
                  "PROVIDER_INTEGRITY_FAILED",
                  "Git blob response is malformed",
                );
              offset = end + 1;
              const bytes = objects.slice(offset, offset + size);
              offset += size;
              if (bytes.length !== size || objects[offset++] !== 10)
                throw new SkillCliError(
                  "PROVIDER_INTEGRITY_FAILED",
                  "Git blob response is malformed or truncated",
                );
              if (
                createHash("sha1").update(`blob ${size}\0`).update(bytes).digest("hex") !== objectId
              )
                throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git blob identity mismatch");
              blobs.set(objectId!, bytes);
            }
            if (offset !== objects.length)
              throw new SkillCliError(
                "PROVIDER_INTEGRITY_FAILED",
                "Git blob response has trailing data",
              );
            for (const entry of needed) {
              const bytes = blobs.get(entry.objectId!)!;
              acquired.add(entry.objectId!);
              contents.set(entry.path, { entry: { ...entry, size: bytes.length }, bytes });
            }
            await checkFiltering(readSignal);
          }
          return unique.map((path) => {
            const content = contents.get(path)!;
            assertSourceContentLimit(content.bytes.byteLength, maxBytes);
            return content;
          });
        },
        "Git blob",
        readSignal,
      );
    }
    return {
      kind: "remote",
      sourceName,
      commit,
      repositoryRoot,
      provenance,
      inspectRevisions(requests, inspectSignal) {
        return exclusive(
          async () => {
            const missing = [...new Set(requests.map((request) => request.revision))].filter(
              (revision) => !fetched.has(revision),
            );
            if (missing.some((revision) => !oid(revision)))
              throw new SkillCliError("INVALID_ARGUMENT", "Expected exact SHA-1 commit");
            if (missing.length) {
              for (let index = 0; index < missing.length; index += 128)
                await git(
                  directory,
                  [
                    ...fetchArgs,
                    "--no-write-fetch-head",
                    gitUrl(url),
                    ...missing.slice(index, index + 128),
                  ],
                  inspectSignal,
                );
              for (const revision of missing) fetched.add(revision);
            }
            // Do not enter the snapshot queue recursively.
            const results = [];
            for (const request of requests)
              results.push({
                revision: request.revision,
                roots: await inspect(request.paths, request.revision, inspectSignal),
              });
            return results;
          },
          "Git legacy tree",
          inspectSignal,
        );
      },
      inspectRoots(paths, inspectSignal, revision = commit) {
        paths.forEach(pathParts);
        return exclusive(() => inspect(paths, revision, inspectSignal), "Git tree", inspectSignal);
      },
      async *list(prefix, listSignal) {
        pathParts(prefix);
        const entries = await exclusive(
          async () => {
            const root = await directoryAt(
              commit,
              [repositoryRoot, prefix].filter(Boolean).join("/"),
              listSignal,
            );
            const result: SourceEntry[] = [];
            function walk(id: string, path: string) {
              for (const item of tree(id, listSignal)) {
                const child = [path, item.entry.path].filter(Boolean).join("/");
                result.push({ ...item.entry, path: child });
                if (item.entry.kind === "directory") walk(item.objectId, child);
              }
            }
            if (root) walk(root, prefix);
            return result.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
          },
          "Git tree",
          listSignal,
        );
        for (const entry of entries) {
          checkAbort("Git tree", listSignal);
          yield entry;
        }
      },
      async read(path, readSignal, maxBytes) {
        return (await readMany([path], readSignal, maxBytes))[0]!;
      },
      readMany,
      close() {
        closing = true;
        closePromise ??= (async () => {
          try {
            await queue;
            await rm(directory, { recursive: true, force: true });
          } finally {
            if (owned) active.dispose();
          }
        })();
        return closePromise;
      },
    };
    async function inspect(
      paths: readonly string[],
      revision: string,
      inspectSignal?: AbortSignal,
    ) {
      paths.forEach(pathParts);
      const source = await directoryAt(revision, repositoryRoot, inspectSignal);
      checkAbort("Git tree", inspectSignal);
      return inspectTreeRoots(source, paths, trees);
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (owned) active.dispose();
    if (!(error instanceof Error && /cleanup failed|pipe drain failed/u.test(error.message)))
      active.throwIfAborted("Git acquisition");
    throw sourceNetworkError(
      active,
      "Git acquisition",
      error,
      error instanceof SkillCliError ? error.code : "PROVIDER_UNAVAILABLE",
    );
  }
}

/** Resolve advertisement only. Exact acquisition subsequently validates the commit object. */
export async function resolveGitRef(
  locator: string,
  ref: string,
  signal?: AbortSignal,
  transport?: (url: string) => string | undefined,
  operation?: SourceOperation,
  run?: RunGit,
): Promise<string> {
  const legacy = /^git:(.+)#[0-9a-f]{40}(:.*)?$/u.exec(locator);
  if (!locator || typeof ref !== "string" || !ref)
    throw new SkillCliError("INVALID_ARGUMENT", "Invalid Git ref update");
  const source = legacy?.[1] ?? locator,
    url = gitUrl(transport?.(source) ?? source);
  const owned = operation === undefined;
  operation ??= createSourceOperation({ source, signal });
  try {
    const git = await gitCommands(operation, url, signal, run);
    const names =
      ref.startsWith("refs/") || ref === "HEAD" ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`];
    const output = text(
      await git(undefined, ["ls-remote", url, ...names.flatMap((name) => [name, `${name}^{}`])]),
    );
    const advertised = new Map(
      output
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/\s+/u) as [string, string])
        .map(([id, name]) => [name, id]),
    );
    const matches = names.filter((name) => advertised.has(name));
    if (matches.length !== 1)
      throw sourceNetworkError(
        operation,
        "Git ref",
        matches.length ? "Ambiguous branch/tag ref" : `Ref not found: ${ref}`,
        "PINNED_COMMIT_UNAVAILABLE",
      );
    const name = matches[0]!,
      id = advertised.get(`${name}^{}`) ?? advertised.get(name)!;
    if (!oid(id))
      throw sourceNetworkError(
        operation,
        "Git ref",
        "Unsupported or malformed advertised object identity",
        "PROVIDER_INTEGRITY_FAILED",
      );
    return legacy ? `git:${source}#${id}${legacy[2] ?? ""}` : id;
  } finally {
    if (owned) operation.dispose();
  }
}
