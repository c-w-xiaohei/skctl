import { runProcess } from "../../../runtime/process";
import * as v from "valibot";
import { gitObjectIdSchema as oid } from "../../schema";
import { SkctlError } from "../../../shared";
import { GitObjects } from "./objects";
import { sourceFetch, sourceNetworkError, sourceChildEnv, type SourceOperation } from "./network";
import type { TreeEntry } from "isomorphic-git";
import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

/** Only explicit provider availability failures authorize a Git fallback. */
export class GitHubUnavailable extends SkctlError {
  constructor(message: string) {
    super("PROVIDER_UNAVAILABLE", message);
  }
}

const object = v.object({ sha: oid, type: v.string() });
const commitResponse = v.object({ sha: oid, commit: v.object({ tree: v.object({ sha: oid }) }) });
const treeResponse = v.object({
  sha: oid,
  truncated: v.boolean(),
  tree: v.array(
    v.object({
      path: v.string(),
      mode: v.picklist(["040000", "100644", "100755", "120000", "160000"]),
      type: v.string(),
      sha: oid,
      size: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    }),
  ),
});
const blobResponse = v.object({
  sha: oid,
  encoding: v.literal("base64"),
  content: v.string(),
  size: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
const refResponse = v.object({ object });
const metaResponse = v.object({ installed_version: v.string() });

export class GitHubTransfer {
  private readonly client: Octokit;
  private constructor(
    base: string,
    private readonly repository: string,
    private readonly objects: GitObjects,
    private readonly operation: SourceOperation,
    token?: string,
  ) {
    const fetch = sourceFetch(operation);
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    this.client = new Octokit({
      baseUrl: base,
      auth: token,
      log,
      request: {
        log,
        signal: operation.signal,
        redirect: "error",
        fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const response = await fetch(input, init);
          // Octokit suppresses body-read exceptions. Consume before its parser so
          // a broken body remains a transport failure rather than malformed data.
          const bytes = await response.arrayBuffer();
          return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
            status: response.status,
            headers: response.headers,
          });
        },
      },
    });
  }

  static async create(
    origin: string,
    objects: GitObjects,
    operation: SourceOperation,
    override?: string,
  ) {
    const url = new URL(origin);
    const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.pathname);
    if (!match) return undefined;
    const enterprise = url.hostname !== "github.com" && !override;
    let token =
      override || enterprise
        ? undefined
        : [process.env.GITHUB_TOKEN, process.env.GH_TOKEN].find((value) => value?.trim());
    if (!token && !override) {
      try {
        const result = await runProcess({
          cmd: ["gh", "auth", "token", "--hostname", url.hostname],
          env: sourceChildEnv(operation),
          signal: operation.signal,
        });
        if (result.status === 0) token = result.stdout.toString().trim();
        else if (result.status > 1) throw sourceNetworkError(operation, "GitHub credentials");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          if (error instanceof SkctlError && error.code === "CLEANUP_FAILED")
            throw sourceNetworkError(operation, "GitHub credential pipe drain failed", error.code);
          operation.throwIfAborted("GitHub credentials");
          throw sourceNetworkError(operation, "GitHub credentials startup/execution");
        }
      }
    }
    if (enterprise && !token) return undefined;
    const transfer = new GitHubTransfer(
      override?.replace(/\/$/, "") ??
        (enterprise ? `https://${url.host}/api/v3` : "https://api.github.com"),
      `${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}`,
      objects,
      operation,
      token,
    );
    if (enterprise) {
      try {
        await transfer.request("/meta", metaResponse);
      } catch (error) {
        if (
          error instanceof GitHubUnavailable ||
          (error instanceof SkctlError && error.code === "SOURCE_NOT_FOUND")
        )
          return undefined;
        throw error;
      }
    }
    return transfer;
  }

  private async request<S extends v.GenericSchema>(
    path: string,
    schema: S,
  ): Promise<v.InferOutput<S>> {
    this.operation.throwIfAborted("GitHub request");
    let value: unknown;
    try {
      value = (
        await this.client.request(
          `GET ${path === "/meta" ? path : `/repos/${this.repository}${path}`}`,
        )
      ).data;
    } catch (error) {
      this.operation.throwIfAborted("GitHub request");
      // A transport exception can also carry status 500. Only real HTTP
      // responses authorize fallback; never expose Octokit's request/error object.
      const status = error instanceof RequestError && error.response ? error.status : 0;
      if (
        status === 429 ||
        status >= 500 ||
        (status === 403 && error instanceof RequestError && /rate.limit/i.test(error.message))
      )
        throw new GitHubUnavailable(`GitHub HTTP ${status}`);
      throw sourceNetworkError(
        this.operation,
        `GitHub response${status ? ` HTTP ${status}` : " body/transport"}`,
        [401, 403].includes(status)
          ? "PROVIDER_AUTH_FAILED"
          : status === 404
            ? "SOURCE_NOT_FOUND"
            : "PROVIDER_UNAVAILABLE",
      );
    }
    this.operation.throwIfAborted("GitHub response");
    const result = v.safeParse(schema, value);
    if (!result.success)
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "GitHub response is malformed");
    return result.output;
  }

  async resolve(ref: string) {
    if (!ref || ref.includes("\0") || /[\r\n]/.test(ref) || ref.startsWith("-"))
      throw new SkctlError("INVALID_ARGUMENT", "Invalid Git ref");
    if (ref === "HEAD") return (await this.request("/commits/HEAD", commitResponse)).sha;
    const names = ref.startsWith("refs/") ? [ref.slice(5)] : [`heads/${ref}`, `tags/${ref}`];
    const found = [];
    for (const name of names) {
      try {
        found.push(
          (
            await this.request(
              `/git/ref/${name.split("/").map(encodeURIComponent).join("/")}`,
              refResponse,
            )
          ).object,
        );
      } catch (error) {
        if (!(error instanceof SkctlError) || error.code !== "SOURCE_NOT_FOUND") throw error;
      }
    }
    if (found.length !== 1)
      throw new SkctlError(
        "PINNED_COMMIT_UNAVAILABLE",
        found.length ? "Ambiguous branch/tag" : "Ref unavailable",
      );
    let target = found[0]!;
    for (let depth = 0; target.type === "tag" && depth < 16; depth++)
      target = (await this.request(`/git/tags/${target.sha}`, refResponse)).object;
    if (target.type !== "commit")
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Ref does not resolve to a commit");
    return target.sha;
  }

  async metadata(commit: string) {
    const info = await this.request(`/commits/${commit}`, commitResponse);
    const tree = info.commit.tree.sha;
    if (info.sha !== commit)
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "GitHub commit identity mismatch");
    try {
      await this.objects.verifyTree(tree);
      return tree;
    } catch (error) {
      if (!(error instanceof SkctlError) || error.code !== "PROVIDER_INTEGRITY_FAILED") throw error;
    }
    const response = await this.request(`/git/trees/${tree}?recursive=1`, treeResponse);
    if (response.sha !== tree)
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "GitHub tree identity mismatch");
    if (response.truncated) throw new GitHubUnavailable("GitHub recursive tree was truncated");
    const groups = new Map<string, TreeEntry[]>([["", []]]);
    const ids = new Map<string, string>([["", tree]]);
    const paths = new Set<string>();
    for (const item of response.tree) {
      if (
        !item.path ||
        item.path.split("/").some((part) => !part || part === "." || part === "..") ||
        item.path.includes("\0") ||
        paths.has(item.path)
      )
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Malformed GitHub tree entry");
      paths.add(item.path);
      if (item.type === "blob" && item.size !== undefined)
        this.objects.noteBlobSize(item.sha, item.size);
      const split = item.path.lastIndexOf("/"),
        parent = split < 0 ? "" : item.path.slice(0, split);
      const mode = item.mode;
      const expectedType = mode === "040000" ? "tree" : mode === "160000" ? "commit" : "blob";
      if (item.type !== expectedType)
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Unsupported GitHub tree mode");
      const list = groups.get(parent) ?? [];
      list.push({ path: item.path.slice(split + 1), oid: item.sha, mode, type: expectedType });
      groups.set(parent, list);
      if (mode === "040000") {
        ids.set(item.path, item.sha);
        if (!groups.has(item.path)) groups.set(item.path, []);
      }
    }
    for (const [path, entries] of groups) {
      const id = ids.get(path);
      if (!id) throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "GitHub tree has missing parents");
      await this.objects.writeTree(entries, id);
    }
    return tree;
  }

  async blobs(ids: readonly string[]) {
    for (const id of ids) {
      const result = await this.request(`/git/blobs/${id}`, blobResponse);
      if (result.sha !== id)
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Malformed GitHub blob");
      const text = result.content.replace(/\n/g, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Invalid GitHub blob encoding");
      const bytes = Buffer.from(text, "base64");
      if (bytes.length !== result.size)
        throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "GitHub blob size mismatch");
      await this.objects.writeBlob(bytes, id);
    }
  }
}
