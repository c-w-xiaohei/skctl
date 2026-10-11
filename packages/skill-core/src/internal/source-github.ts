import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import type { SkillProvenance } from "../api";
import { SkillCliError } from "../api";
import { parseResourcePath } from "./domain";
import { openGitSource, runProviderChild } from "./source-git";
import type { RemoteSnapshot, SourceEntry } from "./sources";

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
  if (
    status === 429 ||
    status >= 500 ||
    /rate.limit|truncat|unavailable|unsupported/i.test(message)
  )
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

function providerError(status: number, message: string): SkillCliError {
  if ((status >= 200 && status < 300) || /json|unexpected|parse/i.test(message))
    return new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub API response is malformed");
  switch (classifyGitHubFailure(status, message)) {
    case "auth":
      return new SkillCliError("PROVIDER_AUTH_FAILED", "GitHub authentication failed");
    case "not-found":
      return new SkillCliError("SOURCE_NOT_FOUND", "GitHub repository or object was not found");
    case "integrity":
      return new SkillCliError(
        "PROVIDER_INTEGRITY_FAILED",
        "GitHub object integrity validation failed",
      );
    case "fallback":
      return new SkillCliError("PROVIDER_UNAVAILABLE", "GitHub API is unavailable");
    case "error":
      return new SkillCliError("PROVIDER_UNAVAILABLE", "GitHub API request failed");
  }
}

function isEligibleFallback(error: unknown): boolean {
  return error instanceof SkillCliError && error.code === "PROVIDER_UNAVAILABLE";
}
function normalizeEntry(
  item: { path?: unknown; mode?: unknown; type?: unknown; sha?: unknown; size?: unknown },
  path: string,
): SourceEntry {
  if (
    typeof item.sha !== "string" ||
    !/^[0-9a-f]{40,64}$/iu.test(item.sha) ||
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

function tokenFor(host: string): string | undefined {
  const tokens =
    host === "github.com"
      ? [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]
      : [process.env.GH_TOKEN];
  return tokens.find((token) => token?.trim());
}

async function ghToken(host: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const result = await runProviderChild(
      { cmd: ["gh", "auth", "token", "--hostname", host], stdout: "pipe", stderr: "pipe" },
      signal,
    );
    const token = new TextDecoder().decode(result.stdout).trim();
    return result.status || !token ? undefined : token;
  } catch (error) {
    if (error instanceof SkillCliError) throw error;
    return undefined;
  }
}

export async function resolveGitHubApi(
  url: string,
  signal?: AbortSignal,
  testBaseUrl?: string,
): Promise<GitHubApi | undefined> {
  const parsed = new URL(url);
  const host = parsed.host;
  if (testBaseUrl && parseGitHubRepository(url, true)) return { baseUrl: testBaseUrl };
  if (host === "github.com") {
    const token = tokenFor(host);
    return { baseUrl: "https://api.github.com", token: token ?? (await ghToken(host, signal)) };
  }
  if (!parseGitHubRepository(url, true)) return undefined;
  const token = await ghToken(host, signal);
  if (!token) return undefined;
  try {
    const response = await fetch(`https://${host}/api/v3/meta`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    const meta: unknown = await response.json();
    return response.ok && meta && typeof meta === "object"
      ? { baseUrl: `https://${host}/api/v3`, token }
      : undefined;
  } catch {
    if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    return undefined;
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
): Promise<RemoteSnapshot> {
  const repository = parseGitHubRepository(url, api.baseUrl !== "https://api.github.com");
  if (!repository) throw new SkillCliError("INVALID_ARGUMENT", "Invalid GitHub repository URL");
  const { owner, repo } = repository;
  const timeout = AbortSignal.timeout(api.timeout ?? 10_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const client = new Octokit({
    auth: api.token,
    baseUrl: api.baseUrl,
    request: { signal: requestSignal },
  });
  const rawBaseUrl = api.rawBaseUrl ?? "https://raw.githubusercontent.com";
  async function request<T>(run: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await run()).data;
    } catch (error) {
      if (signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      if (timeout.aborted) throw new SkillCliError("PROVIDER_UNAVAILABLE", "GitHub API timed out");
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
      throw providerError(status, message);
    }
  }
  let entriesPromise: Promise<SourceEntry[]> | undefined;
  async function entries(): Promise<SourceEntry[]> {
    entriesPromise ??= readEntries();
    return entriesPromise;
  }
  async function readEntries(): Promise<SourceEntry[]> {
    const resolved = await request(() => client.rest.repos.getCommit({ owner, repo, ref: commit }));
    if (resolved.sha !== commit || !resolved.commit.tree.sha)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub commit identity mismatch");
    let root = resolved.commit.tree.sha;
    for (const segment of repositoryRoot.split("/").filter(Boolean)) {
      const tree = await request(() => client.rest.git.getTree({ owner, repo, tree_sha: root }));
      if (tree.sha !== root || !Array.isArray(tree.tree))
        throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree identity mismatch");
      const child = tree.tree.find(
        (item) => item.path === segment && item.type === "tree" && item.mode === "040000",
      );
      if (!child || typeof child.sha !== "string" || !/^[0-9a-f]{40,64}$/iu.test(child.sha))
        throw new SkillCliError("SOURCE_NOT_FOUND", "GitHub Source Root was not found");
      root = child.sha;
    }
    const tree = await request(() =>
      client.rest.git.getTree({ owner, repo, tree_sha: root, recursive: "1" }),
    );
    if (tree.sha !== root)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree identity mismatch");
    if (tree.truncated || !Array.isArray(tree.tree))
      throw new SkillCliError("PROVIDER_UNAVAILABLE", "GitHub tree is incomplete");
    return tree.tree
      .map((item) => {
        if (
          typeof item.path !== "string" ||
          !item.path ||
          item.path.includes("\\") ||
          item.path.split("/").some((part) => !part || part === "." || part === "..")
        )
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub tree path is malformed");
        return normalizeEntry(item, item.path);
      })
      .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  }
  async function fallback<T>(operation: (snapshot: RemoteSnapshot) => Promise<T>): Promise<T> {
    const git = await openGitSource(
      sourceName,
      fallbackUrl,
      commit,
      repositoryRoot,
      provenance,
      signal,
    );
    try {
      return await operation(git);
    } finally {
      await git.close();
    }
  }
  async function readRaw(
    path: string,
    entry: Extract<SourceEntry, { readonly kind: "file" | "symlink" }>,
  ) {
    if (api.baseUrl !== "https://api.github.com" && !api.rawBaseUrl)
      throw new SkillCliError("PROVIDER_UNAVAILABLE", "GitHub raw content is unavailable");
    const objectId = entry.objectId;
    if (!objectId)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub entry has no object id");
    const location = [repositoryRoot, path]
      .filter(Boolean)
      .flatMap((segment) => segment.split("/").map((part) => encodeURIComponent(part)))
      .join("/");
    let response: Response;
    try {
      response = await fetch(`${rawBaseUrl}/${owner}/${repo}/${commit}/${location}`, {
        signal: requestSignal,
      });
    } catch {
      throw new SkillCliError("PROVIDER_UNAVAILABLE", "GitHub raw content is unavailable");
    }
    if (!response.ok)
      throw new SkillCliError(
        response.status === 404 ? "SOURCE_NOT_FOUND" : "PROVIDER_UNAVAILABLE",
        response.status === 404 ? "Resource not found" : "GitHub raw content is unavailable",
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== entry.size)
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob size mismatch");
    if (
      objectId.length === 40 &&
      createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex") !==
        objectId
    )
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob identity mismatch");
    return { entry: { ...entry, path }, bytes };
  }
  return {
    kind: "remote",
    sourceName,
    commit,
    repositoryRoot,
    provenance,
    async *list(prefix, listSignal) {
      try {
        for (const entry of await entries()) {
          if (!prefix || entry.path === prefix || entry.path.startsWith(`${prefix}/`)) yield entry;
        }
      } catch (error) {
        if (!isEligibleFallback(error)) throw error;
        for await (const entry of (await fallback((snapshot) =>
          Array.fromAsync(snapshot.list(prefix, listSignal)),
        )) as SourceEntry[])
          yield entry;
      }
    },
    async read(path, readSignal) {
      parseResourcePath(path);
      try {
        const entry = (await entries()).find((item) => item.path === path);
        if (!entry || entry.kind === "directory" || entry.kind === "gitlink")
          throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`);
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
        if (bytes.byteLength !== entry.size)
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob size mismatch");
        if (
          objectId.length === 40 &&
          createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex") !==
            objectId
        )
          throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "GitHub blob identity mismatch");
        return { entry: { ...entry, path }, bytes };
      } catch (error) {
        if (!isEligibleFallback(error)) throw error;
        const entry = (await entries()).find((item) => item.path === path);
        if (!entry || entry.kind === "directory" || entry.kind === "gitlink")
          throw new SkillCliError("RESOURCE_NOT_FOUND", `Resource not found: ${path}`);
        try {
          return await readRaw(path, entry);
        } catch (rawError) {
          if (!isEligibleFallback(rawError)) throw rawError;
          return fallback((snapshot) => snapshot.read(path, readSignal));
        }
      }
    },
    async close() {},
  };
}
