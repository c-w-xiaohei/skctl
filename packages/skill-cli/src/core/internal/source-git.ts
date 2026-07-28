import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillProvenance } from "../api";
import { SkillCliError } from "../api";
import { parseResourcePath } from "./domain";
import type { RemoteSnapshot, SourceEntry } from "./sources";

const cancelled = () => new SkillCliError("CANCELLED", "Operation cancelled");
type ProviderChildOptions = {
  readonly cmd: string[];
  readonly cwd?: string;
  readonly stdout: "pipe";
  readonly stderr: "pipe";
};

/** Runs one provider child to completion, including both pipe drains after cancellation. */
export async function runProviderChild(
  options: ProviderChildOptions,
  signal?: AbortSignal,
): Promise<{ readonly status: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array }> {
  if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  // Pass PATH explicitly: Bun otherwise resolves against its startup environment.
  const child = Bun.spawn({ ...options, env: process.env, detached: process.platform !== "win32" });
  const stream = (value: ReadableStream<Uint8Array> | number | undefined, name: string) => {
    if (!value || typeof value === "number") throw new Error(`${name} was not piped`);
    return new Response(value).arrayBuffer();
  };
  // Begin both drains before waiting so either full pipe cannot block child exit.
  const stdout = stream(child.stdout, "stdout");
  const stderr = stream(child.stderr, "stderr");
  let abort = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const terminate = (signal: "SIGTERM" | "SIGKILL") => {
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {}
    }
    child.kill(signal);
  };
  try {
    const exited = child.exited.then((status) => {
      settled = true;
      return status;
    });
    const abortRequested = new Promise<void>((resolve) => {
      onAbort = () => {
        if (settled) return;
        abort = true;
        terminate("SIGTERM");
        timer = setTimeout(() => {
          if (!settled) terminate("SIGKILL");
        }, 250);
        resolve();
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
    const result = await Promise.race([
      exited.then((status) => ({ kind: "exit" as const, status })),
      abortRequested.then(() => ({ kind: "abort" as const })),
    ]);
    const [output, error] = await Promise.all([stdout, stderr]);
    if (result.kind === "abort") {
      await exited;
      throw cancelled();
    }
    return { status: result.status, stdout: new Uint8Array(output), stderr: new Uint8Array(error) };
  } catch (error) {
    if (abort && !settled) await child.exited;
    if (abort) throw cancelled();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    await Promise.allSettled([child.exited, stdout, stderr]);
  }
}

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<Uint8Array> {
  try {
    const result = await runProviderChild(
      { cmd: ["git", "-c", "core.askPass=true", ...args], cwd, stdout: "pipe", stderr: "pipe" },
      signal,
    );
    if (result.status !== 0) throw new Error("git failed");
    return result.stdout;
  } catch (error) {
    if (error instanceof SkillCliError && error.code === "CANCELLED") throw error;
    if (signal?.aborted) throw cancelled();
    throw new SkillCliError("PINNED_COMMIT_UNAVAILABLE", "Pinned Git commit is unavailable");
  }
}
function treePath(root: string, path = "") {
  return [root, path].filter(Boolean).join("/");
}
function listTreeArgs(commit: string, path: string): string[] {
  return path
    ? ["ls-tree", "-rz", "-r", "-t", commit, path]
    : ["ls-tree", "-rz", "-r", "-t", commit];
}
function parseTree(bytes: Uint8Array): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const part of new TextDecoder().decode(bytes).split("\0")) {
    if (!part) continue;
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/u.exec(part);
    if (!match) continue;
    const [, mode, type, objectId, path] = match;
    if (mode === "160000") entries.push({ kind: "gitlink", path, commit: objectId });
    else if (type === "tree") entries.push({ kind: "directory", path });
    else if (mode === "120000") entries.push({ kind: "symlink", path, size: 0, objectId });
    else entries.push({ kind: "file", path, size: 0, executable: mode === "100755", objectId });
  }
  return entries.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
}
export async function openGitSource(
  sourceName: string,
  url: string,
  commit: string,
  repositoryRoot: string,
  provenance: SkillProvenance,
  signal?: AbortSignal,
): Promise<RemoteSnapshot> {
  const directory = await mkdtemp(join(tmpdir(), "skill-cli-git-"));
  try {
    await git(directory, ["init", "--bare"], signal);
    try {
      await git(directory, ["fetch", "--no-tags", url, commit], signal);
    } catch {
      await git(
        directory,
        [
          "fetch",
          "--no-tags",
          url,
          "+refs/heads/*:refs/skill-cli/heads/*",
          "+refs/tags/*:refs/skill-cli/tags/*",
        ],
        signal,
      );
    }
    await git(directory, ["cat-file", "-e", `${commit}^{commit}`], signal);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error instanceof SkillCliError) throw error;
    throw new SkillCliError("PINNED_COMMIT_UNAVAILABLE", "Pinned Git commit is unavailable");
  }
  return {
    kind: "remote",
    sourceName,
    commit,
    repositoryRoot,
    provenance,
    async *list(prefix) {
      const base = treePath(repositoryRoot, prefix);
      const result = await git(directory, listTreeArgs(commit, base), signal);
      for (const entry of parseTree(result)) {
        if (entry.path === base) continue;
        if (base && !entry.path.startsWith(`${base}/`)) continue;
        const path =
          repositoryRoot && entry.path.startsWith(`${repositoryRoot}/`)
            ? entry.path.slice(repositoryRoot.length + 1)
            : entry.path;
        if (entry.kind === "file" || entry.kind === "symlink") {
          if (!entry.objectId)
            throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git entry has no object id");
          const size = Number(
            new TextDecoder().decode(
              await git(directory, ["cat-file", "-s", entry.objectId], signal),
            ),
          );
          if (!Number.isSafeInteger(size) || size < 0)
            throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git entry has invalid size");
          yield { ...entry, path, size };
        } else yield { ...entry, path };
      }
    },
    async read(path, readSignal) {
      parseResourcePath(path);
      const base = repositoryRoot;
      const listed = parseTree(await git(directory, listTreeArgs(commit, base), readSignal));
      const entry = listed.find((item) => item.path === `${base}/${path}` || item.path === path);
      if (!entry || entry.kind === "directory" || entry.kind === "gitlink")
        throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`);
      const object = (entry as { objectId?: string }).objectId;
      if (!object)
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Git entry has no object id");
      const bytes = await git(directory, ["cat-file", "blob", object], readSignal);
      const content = { ...entry, path, size: bytes.byteLength };
      return { entry: content, bytes };
    },
    async close() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export async function resolveGitRef(
  locator: string,
  ref: string,
  signal?: AbortSignal,
  transport?: (url: string) => string | undefined,
): Promise<string> {
  const legacy = /^git:(.+)#(?:[0-9a-f]{40}|[0-9a-f]{64})(?:(:.*))?$/u.exec(locator);
  if (!locator || typeof ref !== "string" || !ref)
    throw new SkillCliError("INVALID_ARGUMENT", "Invalid Git ref update");
  const directory = await mkdtemp(join(tmpdir(), "skill-cli-ref-"));
  const source = legacy?.[1] ?? locator;
  const url = transport?.(source) ?? source;
  const refs = ref.startsWith("refs/") ? [ref] : [ref, `refs/heads/${ref}`, `refs/tags/${ref}`];
  try {
    await git(directory, ["init", "--bare"], signal);
    const advertised =
      new TextDecoder()
        .decode(await git(directory, ["ls-remote", url, ...refs], signal))
        .trim()
        .split(/\s+/u)[0] ?? "";
    if (!/^[0-9a-f]{40,64}$/u.test(advertised)) throw new Error("bad ref");
    try {
      await git(directory, ["fetch", "--no-tags", url, advertised], signal);
    } catch {
      await git(
        directory,
        [
          "fetch",
          "--no-tags",
          url,
          "+refs/heads/*:refs/skill-cli/heads/*",
          "+refs/tags/*:refs/skill-cli/tags/*",
        ],
        signal,
      );
    }
    await git(directory, ["cat-file", "-e", `${advertised}^{commit}`], signal);
    return legacy ? `git:${source}#${advertised}${legacy[2] ?? ""}` : advertised;
  } catch (error) {
    if (error instanceof SkillCliError && error.code === "CANCELLED") throw error;
    if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    throw new SkillCliError("PINNED_COMMIT_UNAVAILABLE", "Git ref is unavailable");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
