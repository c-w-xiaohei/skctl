import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import type { SkillProvenance } from "../api";
import { SkillCliError } from "../api";
import { assertSourceContentLimit, parseResourcePath, SourceContentLimitError } from "./domain";
import { openGitSource, runProviderChild, inspectTreeRoots } from "./source-git";
import type { RemoteSnapshot, SourceEntry, SourceEntryContent } from "./sources";
import {
  createSourceOperation,
  sourceChildEnv,
  sourceFetch,
  sourceNetworkError,
  type SourceOperation,
} from "./source-network";

type GitHubRepository = { readonly owner: string; readonly repo: string };
type GitHubFailure = "fallback" | "auth" | "not-found" | "integrity" | "error";
export type GitHubApi = {
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeout?: number;
  readonly rawBaseUrl?: string;
};

/** Classifies only sanitized GitHub API outcomes; callers decide whether to restart via Git. */
export function classifyGitHubFailure(status: number, message: string): GitHubFailure {
  if (status === 401 || (status === 403 && !/rate.limit/i.test(message))) return "auth";
  if (status === 404) return "not-found";
  if (status === 429 || status >= 500 || (status === 403 && /rate.limit/i.test(message)))
    return "fallback";
  if (/integrity/i.test(message)) return "integrity";
  return "error";
}

export function parseGitHubRepository(
  url: string,
  allowEnterprise = false,
): GitHubRepository | undefined {
  const match = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/u.exec(url);
  if (!match || (match[1] !== "github.com" && !allowEnterprise)) return undefined;
  return { owner: match[2]!, repo: match[3]! };
}

function providerCode(status: number, message: string): SkillCliError["code"] {
  if ((status >= 200 && status < 300) || /json|unexpected|parse/i.test(message))
    return "PROVIDER_INTEGRITY_FAILED";
  switch (classifyGitHubFailure(status, message)) {
    case "auth":
      return "PROVIDER_AUTH_FAILED";
    case "not-found":
      return "SOURCE_NOT_FOUND";
    case "integrity":
      return "PROVIDER_INTEGRITY_FAILED";
    case "fallback":
    case "error":
      return "PROVIDER_UNAVAILABLE";
  }
}

function normalizeEntry(
  item: { path?: unknown; mode?: unknown; type?: unknown; sha?: unknown; size?: unknown },
  path: string,
): SourceEntry {
  if (
    typeof item.sha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(item.sha) ||
    typeof item.mode !== "string"
  )
    throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree entry is malformed");
  if (item.mode === "160000" && item.type === "commit")
    return { kind: "gitlink", path, commit: item.sha };
  if (item.type === "tree" && item.mode === "040000") return { kind: "directory", path };
  if (
    item.type !== "blob" ||
    !["100644", "100755", "120000"].includes(item.mode) ||
    typeof item.size !== "number" ||
    !Number.isSafeInteger(item.size) ||
    item.size < 0
  )
    throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree entry is malformed");
  return item.mode === "120000"
    ? { kind: "symlink", path, size: item.size, objectId: item.sha }
    : {
        kind: "file",
        path,
        size: item.size,
        executable: item.mode === "100755",
        objectId: item.sha,
      };
}

function tokenFor(): string | undefined {
  const tokens = [process.env.GITHUB_TOKEN, process.env.GH_TOKEN];
  return tokens.find((token) => token?.trim());
}

async function ghToken(
  host: string,
  operation: SourceOperation,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const result = await runProviderChild(
      {
        cmd: ["gh", "auth", "token", "--hostname", host],
        env: sourceChildEnv(operation),
        stdout: "pipe",
        stderr: "pipe",
      },
      signal ? AbortSignal.any([operation.signal, signal]) : operation.signal,
    );
    const token = new TextDecoder().decode(result.stdout).trim();
    if (result.status > 1)
      throw sourceNetworkError(
        operation,
        "GitHub credentials execution",
        `exit ${result.status}: ${new TextDecoder().decode(result.stderr)}`,
      );
    return result.status || !token ? undefined : token;
  } catch (error) {
    if (error instanceof Error && /cleanup failed|pipe drain failed/u.test(error.message))
      throw sourceNetworkError(operation, "GitHub credentials cleanup", error);
    operation.throwIfAborted("GitHub credentials");
    if (signal?.aborted)
      throw sourceNetworkError(operation, "GitHub credentials", "Operation cancelled", "CANCELLED");
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw sourceNetworkError(operation, "GitHub credentials startup/execution", error);
  }
}

export async function resolveGitHubApi(
  url: string,
  signal?: AbortSignal,
  testBaseUrl?: string,
  operation?: SourceOperation,
): Promise<GitHubApi | undefined> {
  const owned = operation === undefined;
  operation ??= createSourceOperation({ source: url, signal });
  try {
    operation.throwIfAborted("GitHub credentials/meta");
    const parsed = new URL(url);
    const host = parsed.host;
    if (testBaseUrl && parseGitHubRepository(url, true)) return { baseUrl: testBaseUrl };
    if (host === "github.com") {
      const token = tokenFor();
      return {
        baseUrl: "https://api.github.com",
        token: token ?? (await ghToken(host, operation, signal)),
      };
    }
    if (!parseGitHubRepository(url, true)) return undefined;
    const token = await ghToken(host, operation, signal);
    if (!token) return undefined;
    try {
      const response = await sourceFetch(operation)(`https://${host}/api/v3/meta`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      });
      // A missing meta route is capability evidence, not a missing repository.
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      const body = await response.text();
      operation.throwIfAborted("GitHub meta");
      if (!response.ok) {
        const classification = classifyGitHubFailure(response.status, body);
        if (classification === "fallback") return undefined;
        throw sourceNetworkError(
          operation,
          "GitHub meta",
          `HTTP ${response.status}`,
          providerCode(response.status, ""),
          [token],
        );
      }
      let meta: unknown;
      try {
        meta = JSON.parse(body);
      } catch (error) {
        throw sourceNetworkError(
          operation,
          "GitHub meta body",
          error,
          "PROVIDER_INTEGRITY_FAILED",
          [token],
        );
      }
      if (
        !meta ||
        typeof meta !== "object" ||
        !("installed_version" in meta) ||
        typeof meta.installed_version !== "string"
      )
        throw sourceNetworkError(
          operation,
          "GitHub meta",
          "Missing enterprise capability evidence",
          "PROVIDER_INTEGRITY_FAILED",
          [token],
        );
      return { baseUrl: `https://${host}/api/v3`, token };
    } catch (error) {
      operation.throwIfAborted("GitHub meta");
      if (signal?.aborted)
        throw sourceNetworkError(operation, "GitHub meta", "Operation cancelled", "CANCELLED");
      throw sourceNetworkError(
        operation,
        "GitHub meta",
        error,
        error instanceof SkillCliError ? error.code : "PROVIDER_UNAVAILABLE",
        [token],
      );
    }
  } finally {
    if (owned) operation.dispose();
  }
}

export async function openGitHubSource(
  sourceName: string,
  url: string,
  commit: string,
  repositoryRoot: string,
  provenance: SkillProvenance,
  signal?: AbortSignal,
  api: GitHubApi = { baseUrl: "https://api.github.com" },
  fallbackUrl = url,
  operation?: SourceOperation,
  batchTrees = false,
): Promise<RemoteSnapshot> {
  const repository = parseGitHubRepository(url, api.baseUrl !== "https://api.github.com");
  if (!repository) throw new SkillCliError("INVALID_ARGUMENT", "Invalid GitHub repository URL");
  const { owner, repo } = repository;
  if (!/^[0-9a-f]{40}$/u.test(commit))
    throw new SkillCliError("INVALID_ARGUMENT", "Expected exact SHA-1 commit");
  if (repositoryRoot) parseResourcePath(repositoryRoot);
  const owned = operation === undefined;
  operation ??= createSourceOperation({ source: sourceName, signal, budgetMs: api.timeout });
  const active = operation;
  const eligibleFallback = new WeakSet<Error>();
  const isEligibleFallback = (error: unknown) =>
    error instanceof Error && eligibleFallback.has(error);
  const requestSignal = signal ? AbortSignal.any([signal, active.signal]) : active.signal;
  let methodSignal: AbortSignal | undefined;
  let closing = false,
    closePromise: Promise<void> | undefined;
  let queue = Promise.resolve();
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const httpFetch = sourceFetch(active);
  function checkAbort(phase: string) {
    active.throwIfAborted(phase);
    if (signal?.aborted || methodSignal?.aborted)
      throw sourceNetworkError(active, phase, "Operation cancelled", "CANCELLED");
  }
  const currentSignal = () =>
    methodSignal ? AbortSignal.any([requestSignal, methodSignal]) : requestSignal;
  const exclusive = <T>(run: () => Promise<T>, phase: string, readSignal?: AbortSignal) => {
    if (closing)
      return Promise.reject(sourceNetworkError(active, phase, "GitHub snapshot is closed"));
    const pending = queue.then(async () => {
      methodSignal = readSignal;
      try {
        checkAbort(phase);
        const result = await run();
        checkAbort(phase);
        return result;
      } catch (error) {
        if (!(error instanceof Error && /cleanup failed|pipe drain failed/u.test(error.message)))
          checkAbort(phase);
        if (error instanceof SourceContentLimitError) throw error;
        throw sourceNetworkError(
          active,
          phase,
          error,
          error instanceof SkillCliError ? error.code : "PROVIDER_UNAVAILABLE",
          api.token ? [api.token] : [],
        );
      } finally {
        methodSignal = undefined;
      }
    });
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const client = new Octokit({
    auth: api.token,
    baseUrl: api.baseUrl,
    request: {
      signal: requestSignal,
      log: quiet,
      fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const response = await httpFetch(input, {
          ...init,
          signal: currentSignal(),
        });
        // Octokit swallows body read exceptions; consume at the existing fetch boundary first.
        try {
          const body = await response.arrayBuffer();
          checkAbort("GitHub API body");
          return new Response(response.status === 204 || response.status === 304 ? null : body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (error) {
          checkAbort("GitHub API body");
          throw sourceNetworkError(
            active,
            "GitHub API body",
            error,
            "PROVIDER_UNAVAILABLE",
            api.token ? [api.token] : [],
          );
        }
      },
    },
    log: quiet,
  });
  const rawBaseUrl = api.rawBaseUrl ?? "https://raw.githubusercontent.com";
  const commitNotFound = new WeakSet<Error>();
  async function request<T>(run: () => Promise<{ data: T }>, phase = "GitHub API"): Promise<T> {
    try {
      checkAbort(phase);
      const data = (await run()).data;
      checkAbort(phase);
      return data;
    } catch (error) {
      checkAbort(phase);
      if (error instanceof SkillCliError) throw error;
      const status =
        typeof error === "object" && error && "status" in error && typeof error.status === "number"
          ? error.status
          : 0;
      const message =
        typeof error === "object" &&
        error &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "request failed";
      // Octokit maps transport errors to status 500; only a real HTTP response can authorize fallback.
      const hasResponse =
        typeof error === "object" && error !== null && "response" in error && !!error.response;
      const failure = sourceNetworkError(
        active,
        phase,
        status === 401 || status === 404 ? `HTTP ${status}` : error,
        hasResponse ? providerCode(status, message) : "PROVIDER_UNAVAILABLE",
        api.token ? [api.token] : [],
      );
      if (
        hasResponse &&
        status === 404 &&
        phase === "GitHub commit" &&
        failure.code === "SOURCE_NOT_FOUND"
      )
        commitNotFound.add(failure);
      if (hasResponse && classifyGitHubFailure(status, message) === "fallback")
        eligibleFallback.add(failure);
      throw failure;
    }
  }
  type TreeItem = { readonly entry: SourceEntry; readonly objectId: string };
  const revisions = new Map<string, Promise<string>>(),
    trees = new Map<string, Promise<TreeItem[]>>();
  const listed = new Map<string, Promise<SourceEntry[]>>();
  const contents = new Map<string, SourceEntryContent>();
  const completeFacts = new Map<string, TreeItem[]>();
  const recursiveTrees = new Map<string, Promise<void>>();
  function completeTree(id: string) {
    let pending = recursiveTrees.get(id);
    if (!pending) {
      pending = (async () => {
        const response = await request(
          () => client.rest.git.getTree({ owner, repo, tree_sha: id, recursive: "1" }),
          "GitHub tree",
        );
        if (response.sha !== id || !Array.isArray(response.tree))
          throw new SkillCliError(
            "PROVIDER_INTEGRITY_FAILED",
            "GitHub recursive tree identity mismatch",
          );
        if (response.truncated) {
          const error = sourceNetworkError(
            active,
            "GitHub tree",
            "GitHub recursive tree is incomplete",
          );
          eligibleFallback.add(error);
          throw error;
        }
        const directoryIds = new Map<string, string>([["", id]]);
        const items: TreeItem[] = [];
        const names = new Set<string>();
        for (const entry of response.tree) {
          if (
            typeof entry.path !== "string" ||
            !entry.path ||
            entry.path.includes("\0") ||
            entry.path.startsWith("/") ||
            entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
            names.has(entry.path)
          )
            throw new SkillCliError(
              "PROVIDER_INTEGRITY_FAILED",
              "GitHub recursive tree path is malformed",
            );
          names.add(entry.path);
          const item = { entry: normalizeEntry(entry, entry.path), objectId: entry.sha! };
          items.push(item);
          if (item.entry.kind === "directory") directoryIds.set(entry.path, item.objectId);
        }
        const children = new Map<string, TreeItem[]>();
        for (const item of items) {
          const split = item.entry.path.lastIndexOf("/");
          const parent = split < 0 ? "" : item.entry.path.slice(0, split);
          if (!directoryIds.has(parent))
            throw new SkillCliError(
              "PROVIDER_INTEGRITY_FAILED",
              "GitHub recursive tree has missing parents",
            );
          const entries = children.get(parent) ?? [];
          entries.push({
            ...item,
            entry: { ...item.entry, path: item.entry.path.slice(split + 1) },
          });
          children.set(parent, entries);
        }
        for (const [path, treeId] of directoryIds) {
          const entries = children.get(path) ?? [];
          trees.set(treeId, Promise.resolve(entries));
          completeFacts.set(treeId, entries);
        }
      })().catch((error) => {
        recursiveTrees.delete(id);
        throw error;
      });
      recursiveTrees.set(id, pending);
    }
    return pending;
  }
  async function commitTree(revision: string) {
    const resolved = await request(
      () => client.rest.repos.getCommit({ owner, repo, ref: revision }),
      "GitHub commit",
    );
    if (resolved.sha !== revision || !/^[0-9a-f]{40}$/u.test(resolved.commit?.tree?.sha ?? ""))
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub commit identity mismatch");
    return resolved.commit.tree.sha;
  }
  function revisionRoot(revision: string) {
    checkAbort("GitHub commit");
    if (!/^[0-9a-f]{40}$/u.test(revision))
      throw new SkillCliError("INVALID_ARGUMENT", "Expected exact SHA-1 commit");
    let pending = revisions.get(revision);
    if (!pending) {
      pending = (async () => {
        try {
          return await commitTree(revision);
        } catch (error) {
          if (revision === commit || !(error instanceof Error) || !commitNotFound.has(error))
            throw error;
          // Fresh exact-C success distinguishes unavailable old evidence from lost repository access.
          // Do not reuse the cached C promise or change the snapshot's pinned revision.
          const currentTree = await commitTree(commit);
          const knownCurrent = revisions.get(commit);
          if (knownCurrent && (await knownCurrent) !== currentTree)
            throw new SkillCliError(
              "PROVIDER_INTEGRITY_FAILED",
              "GitHub current commit tree identity mismatch",
            );
          throw sourceNetworkError(
            active,
            "GitHub old commit",
            `Exact old commit ${revision}: HTTP 404; exact target ${commit} remains accessible`,
            "PINNED_COMMIT_UNAVAILABLE",
            api.token ? [api.token] : [],
          );
        }
      })().catch((error) => {
        revisions.delete(revision);
        throw error;
      });
      revisions.set(revision, pending);
    }
    return pending;
  }
  function tree(id: string) {
    checkAbort("GitHub tree");
    let pending = trees.get(id);
    if (!pending) {
      pending = (async () => {
        const response = await request(
          () => client.rest.git.getTree({ owner, repo, tree_sha: id }),
          "GitHub tree",
        );
        if (response.sha !== id || !Array.isArray(response.tree))
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree identity mismatch");
        if (response.truncated) {
          const error = sourceNetworkError(active, "GitHub tree", "GitHub tree is incomplete");
          eligibleFallback.add(error);
          throw error;
        }
        const names = new Set<string>();
        return response.tree.map((item) => {
          if (
            typeof item.path !== "string" ||
            !item.path ||
            item.path.includes("/") ||
            item.path.includes("\0") ||
            [".", ".."].includes(item.path) ||
            names.has(item.path)
          )
            throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree path is malformed");
          names.add(item.path);
          return { entry: normalizeEntry(item, item.path), objectId: item.sha! };
        });
      })().catch((error) => {
        trees.delete(id);
        throw error;
      });
      trees.set(id, pending);
    }
    return pending;
  }
  async function directoryAt(revision: string, path: string) {
    let id = await revisionRoot(revision);
    if (batchTrees) await completeTree(id);
    for (const segment of path.split("/").filter(Boolean)) {
      const child = (await tree(id)).find((item) => item.entry.path === segment);
      if (!child || child.entry.kind !== "directory") return undefined;
      id = child.objectId;
    }
    return id;
  }
  function entries(prefix: string): Promise<SourceEntry[]> {
    checkAbort("GitHub tree");
    if (prefix) parseResourcePath(prefix);
    let pending = listed.get(prefix);
    if (!pending) {
      pending = (async () => {
        const id = await directoryAt(commit, [repositoryRoot, prefix].filter(Boolean).join("/"));
        const result: SourceEntry[] = [];
        async function walk(id: string, path: string) {
          for (const child of await tree(id)) {
            const full = [path, child.entry.path].filter(Boolean).join("/");
            parseResourcePath(full);
            result.push({ ...child.entry, path: full });
            if (child.entry.kind === "directory") await walk(child.objectId, full);
          }
        }
        if (id) await walk(id, prefix);
        return result.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
      })().catch((error) => {
        listed.delete(prefix);
        throw error;
      });
      listed.set(prefix, pending);
    }
    return pending;
  }
  async function entryAt(path: string) {
    const parts = path.split("/"),
      name = parts.pop()!;
    const parent = await directoryAt(
      commit,
      [repositoryRoot, parts.join("/")].filter(Boolean).join("/"),
    );
    const item = parent && (await tree(parent)).find((item) => item.entry.path === name);
    if (!item || (item.entry.kind !== "file" && item.entry.kind !== "symlink"))
      throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`);
    return { ...item.entry, path };
  }
  let fallbackSnapshot: Promise<RemoteSnapshot> | undefined;
  async function openFallback() {
    const acquisition = new AbortController();
    const caller = methodSignal;
    const abort = () => acquisition.abort();
    caller?.addEventListener("abort", abort, { once: true });
    if (caller?.aborted) abort();
    try {
      return await openGitSource(
        sourceName,
        fallbackUrl,
        commit,
        repositoryRoot,
        provenance,
        AbortSignal.any([requestSignal, acquisition.signal]),
        active,
      );
    } finally {
      caller?.removeEventListener("abort", abort);
    }
  }
  async function fallback<T>(
    primary: unknown,
    operation: (snapshot: RemoteSnapshot) => Promise<T>,
  ): Promise<T> {
    checkAbort("GitHub Git fallback");
    if (closing)
      throw sourceNetworkError(
        active,
        "GitHub Git fallback",
        `Snapshot closing; primary: ${String(primary)}`,
      );
    try {
      fallbackSnapshot ??= openFallback().catch((error) => {
        fallbackSnapshot = undefined;
        throw error;
      });
      return await operation(await fallbackSnapshot);
    } catch (error) {
      if (!(error instanceof Error && /cleanup failed|pipe drain failed/u.test(error.message)))
        checkAbort("GitHub Git fallback");
      const primaryFact = sourceNetworkError(
        active,
        "primary",
        primary,
        "PROVIDER_UNAVAILABLE",
        api.token ? [api.token] : [],
      ).message;
      throw sourceNetworkError(
        active,
        "GitHub Git fallback",
        `Primary: ${primaryFact.slice(0, 200)} ${primaryFact.slice(-100)}; fallback: ${String(error)}`,
        error instanceof SkillCliError ? error.code : "PROVIDER_UNAVAILABLE",
        api.token ? [api.token] : [],
      );
    }
  }
  async function readRaw(
    path: string,
    entry: Extract<SourceEntry, { readonly kind: "file" | "symlink" }>,
  ) {
    if (api.baseUrl !== "https://api.github.com" && !api.rawBaseUrl) {
      const error = sourceNetworkError(active, "GitHub raw", "Raw capability is unavailable");
      eligibleFallback.add(error);
      throw error;
    }
    const objectId = entry.objectId;
    if (!objectId)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub entry has no object id");
    const location = [repositoryRoot, path]
      .filter(Boolean)
      .flatMap((segment) => segment.split("/").map((part) => encodeURIComponent(part)))
      .join("/");
    let response: Response;
    try {
      response = await sourceFetch(active)(`${rawBaseUrl}/${owner}/${repo}/${commit}/${location}`, {
        signal: currentSignal(),
      });
    } catch (error) {
      checkAbort("GitHub raw");
      throw sourceNetworkError(
        active,
        "GitHub raw",
        error,
        "PROVIDER_UNAVAILABLE",
        api.token ? [api.token] : [],
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = sourceNetworkError(
        active,
        "GitHub raw",
        `HTTP ${response.status}`,
        providerCode(response.status, ""),
      );
      if (classifyGitHubFailure(response.status, "") === "fallback") eligibleFallback.add(error);
      throw error;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
      checkAbort("GitHub raw body");
    } catch (error) {
      checkAbort("GitHub raw body");
      throw sourceNetworkError(active, "GitHub raw body", error);
    }
    return validatedBlob(entry, bytes);
  }
  // API/base64 and raw are two encodings of the same exact Git blob fact.
  function validatedBlob(
    entry: Extract<SourceEntry, { kind: "file" | "symlink" }>,
    bytes: Uint8Array,
  ) {
    if (bytes.byteLength !== entry.size)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob size mismatch");
    if (
      createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex") !==
      entry.objectId
    )
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob identity mismatch");
    return { entry, bytes };
  }
  const snapshot: RemoteSnapshot = {
    kind: "remote",
    sourceName,
    commit,
    repositoryRoot,
    provenance,
    async inspectRevisions(requests, inspectSignal) {
      const results = [];
      for (const request of requests)
        results.push({
          revision: request.revision,
          roots: await snapshot.inspectRoots(request.paths, inspectSignal, request.revision),
        });
      return results;
    },
    inspectRoots(paths, inspectSignal, revision = commit) {
      for (const path of paths) if (path) parseResourcePath(path);
      return exclusive(
        async () => {
          try {
            const source = await directoryAt(revision, repositoryRoot);
            if (batchTrees) return inspectTreeRoots(source, paths, completeFacts);
            const result: Awaited<ReturnType<RemoteSnapshot["inspectRoots"]>>[number][] = [];
            const inspect = async (path: string) => {
              if (!source) return { path, status: "missing" as const };
              let id = source;
              for (const segment of path.split("/").filter(Boolean)) {
                const items = await tree(id);
                if (
                  items.some((item) => item.entry.path === "SKILL.md" && item.entry.kind === "file")
                )
                  return { path, status: "not-skill-root" as const };
                const child = items.find((item) => item.entry.path === segment);
                if (!child) return { path, status: "missing" as const };
                if (child.entry.kind !== "directory")
                  return { path, status: "not-skill-root" as const };
                id = child.objectId;
              }
              if (
                !(await tree(id)).some(
                  (item) => item.entry.path === "SKILL.md" && item.entry.kind === "file",
                )
              )
                return { path, status: "not-skill-root" as const };
              return {
                path,
                status: "present" as const,
                tree: { objectFormat: "sha1" as const, objectId: id },
              };
            };
            for (const path of paths) result.push(await inspect(path));
            return result;
          } catch (error) {
            if (!isEligibleFallback(error)) throw error;
            return fallback(error, (snapshot) =>
              snapshot.inspectRoots(paths, inspectSignal, revision),
            );
          }
        },
        "GitHub tree",
        inspectSignal,
      );
    },
    async *list(prefix, listSignal) {
      const result = await exclusive(
        async () => {
          try {
            return await entries(prefix);
          } catch (error) {
            if (!isEligibleFallback(error)) throw error;
            return fallback(error, (snapshot) =>
              Array.fromAsync(snapshot.list(prefix, listSignal)),
            );
          }
        },
        "GitHub tree",
        listSignal,
      );
      for (const entry of result) {
        active.throwIfAborted("GitHub tree");
        if (signal?.aborted || listSignal?.aborted)
          throw sourceNetworkError(active, "GitHub tree", "Operation cancelled", "CANCELLED");
        yield entry;
      }
    },
    read(path, readSignal, maxBytes) {
      parseResourcePath(path);
      return exclusive(
        async () => {
          if (contents.has(path)) {
            const content = contents.get(path)!;
            assertSourceContentLimit(content.bytes.byteLength, maxBytes);
            return content;
          }
          const content = await readContent(path, readSignal, true, maxBytes);
          assertSourceContentLimit(content.bytes.byteLength, maxBytes);
          contents.set(path, content);
          return content;
        },
        "GitHub blob",
        readSignal,
      );
    },
    readMany(paths, readSignal) {
      const unique = [...new Set(paths)];
      unique.forEach(parseResourcePath);
      return exclusive(
        async () => {
          try {
            // A Git fallback owns one batch, not one fetch per path.
            if (fallbackSnapshot) return (await fallbackSnapshot).readMany(unique, readSignal);
            const objects = new Map<string, SourceEntryContent>();
            const result: SourceEntryContent[] = [];
            for (const path of unique) {
              const entry = await entryAt(path);
              let content = contents.get(path);
              const shared = entry.objectId ? objects.get(entry.objectId) : undefined;
              if (!content)
                content = shared
                  ? { entry: { ...entry, size: shared.bytes.length }, bytes: shared.bytes }
                  : await readContent(path, readSignal, false);
              contents.set(path, content);
              if (entry.objectId) objects.set(entry.objectId, content);
              result.push(content);
            }
            return result;
          } catch (error) {
            if (!isEligibleFallback(error)) throw error;
            return fallback(error, (snapshot) => snapshot.readMany(unique, readSignal));
          }
        },
        "GitHub blobs",
        readSignal,
      );
    },
    close() {
      closing = true;
      closePromise ??= (async () => {
        try {
          await queue;
          if (fallbackSnapshot) await (await fallbackSnapshot.catch(() => undefined))?.close();
        } finally {
          if (owned) active.dispose();
        }
      })();
      return closePromise;
    },
  };
  return snapshot;
  async function readContent(
    path: string,
    readSignal?: AbortSignal,
    allowGitFallback = true,
    maxBytes?: number,
  ) {
    try {
      const entry = await entryAt(path);
      if (entry.kind === "file" || entry.kind === "symlink")
        assertSourceContentLimit(entry.size, maxBytes);
      const objectId = entry.objectId;
      if (!objectId)
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub entry has no object id");
      const blob = await request(() =>
        client.rest.git.getBlob({ owner, repo, file_sha: objectId }),
      );
      if (
        blob.sha !== entry.objectId ||
        blob.encoding !== "base64" ||
        typeof blob.content !== "string"
      )
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob identity mismatch");
      const content = blob.content.replace(/\n/gu, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(content))
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob encoding is malformed");
      const bytes = new Uint8Array(Buffer.from(content, "base64"));
      return validatedBlob(entry, bytes);
    } catch (error) {
      if (!isEligibleFallback(error)) throw error;
      let entry;
      try {
        entry = await entryAt(path);
      } catch (entryError) {
        if (!isEligibleFallback(entryError)) throw entryError;
        if (!allowGitFallback) throw entryError;
        return fallback(entryError, (snapshot) => snapshot.read(path, readSignal, maxBytes));
      }
      try {
        if (entry.kind === "file" || entry.kind === "symlink")
          assertSourceContentLimit(entry.size, maxBytes);
        return await readRaw(path, entry);
      } catch (rawError) {
        if (!isEligibleFallback(rawError)) throw rawError;
        if (!allowGitFallback) throw rawError;
        return fallback(`${String(error)}; raw: ${String(rawError)}`, (snapshot) =>
          snapshot.read(path, readSignal, maxBytes),
        );
      }
    }
  }
}
