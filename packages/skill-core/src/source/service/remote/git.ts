import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess } from "../../../runtime/process";
import { SkctlError } from "../../../shared";
import { GitObjects, isOid } from "./objects";
import {
  sourceChildEnv,
  sourceNetworkError,
  sourceProxyConfigArgs,
  type SourceOperation,
} from "./network";

export class GitTransfer {
  private readonly url: string;
  private proxyArgs?: Promise<string[]>;
  constructor(
    url: string,
    private readonly objects: GitObjects,
    private readonly operation: SourceOperation,
  ) {
    this.url = isAbsolute(url) ? pathToFileURL(url).href : url;
  }

  private async proxyConfiguration() {
    if (this.operation.proxy === undefined || !/^https?:/i.test(this.url)) return [];
    const result = await runProcess({
      cmd: [
        "git",
        "config",
        "--null",
        "--name-only",
        "--get-regexp",
        "^(http(\\..*)?|remote\\..*)\\.proxy$",
      ],
      cwd: tmpdir(),
      env: sourceChildEnv(this.operation),
      signal: this.operation.signal,
    });
    if (result.status > 1) throw sourceNetworkError(this.operation, "Git proxy configuration");
    return sourceProxyConfigArgs(
      this.operation,
      this.url,
      result.stdout.toString().split("\0").filter(Boolean),
    );
  }

  private async command(args: readonly string[], input?: Uint8Array, local = true) {
    this.operation.throwIfAborted(`Git ${args[0]}`);
    const env = {
      ...sourceChildEnv(this.operation),
      GIT_NO_LAZY_FETCH: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    let result: Awaited<ReturnType<typeof runProcess>>;
    this.proxyArgs ??= this.proxyConfiguration();
    try {
      result = await runProcess({
        cmd: [
          "git",
          "-c",
          "core.askPass=true",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          `remote.skctl.url=${this.url}`,
          "-c",
          "remote.skctl.promisor=true",
          "-c",
          "remote.skctl.partialclonefilter=blob:none",
          ...(await this.proxyArgs),
          ...(local ? [`--git-dir=${this.objects.directory}`] : []),
          ...args,
        ],
        cwd: tmpdir(),
        env,
        input,
        signal: this.operation.signal,
      });
    } catch (error) {
      if (error instanceof SkctlError && error.code === "CLEANUP_FAILED")
        throw sourceNetworkError(this.operation, "Git pipe drain failed", error.code);
      this.operation.throwIfAborted(`Git ${args[0]}`);
      throw sourceNetworkError(this.operation, `Git ${args[0]}`);
    }
    this.operation.throwIfAborted(`Git ${args[0]}`);
    if (result.status) {
      const reason = result.stderr.toString();
      const code = /authentication|could not read username|HTTP.*(?:401|403)/i.test(reason)
        ? "PROVIDER_AUTH_FAILED"
        : /not our ref|unadvertised|couldn't find remote ref|bad object/i.test(reason)
          ? "PINNED_COMMIT_UNAVAILABLE"
          : "PROVIDER_UNAVAILABLE";
      throw sourceNetworkError(this.operation, `Git ${args[0]}`, code);
    }
    return result.stdout;
  }

  async resolve(ref: string) {
    if (!ref || ref.includes("\0") || /[\r\n]/.test(ref) || ref.startsWith("-"))
      throw new SkctlError("INVALID_ARGUMENT", "Invalid Git ref");
    const names =
      ref === "HEAD" || ref.startsWith("refs/") ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`];
    const output = await this.command(
      ["ls-remote", this.url, ...names.flatMap((name) => [name, `${name}^{}`])],
      undefined,
      false,
    );
    const advertised = new Map(
      output
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, name] = line.split(/\s+/);
          return [name!, id!] as const;
        }),
    );
    const matched = names.filter((name) => advertised.has(name));
    if (matched.length !== 1)
      throw sourceNetworkError(this.operation, "Git ref", "PINNED_COMMIT_UNAVAILABLE");
    const name = matched[0]!,
      commit = advertised.get(`${name}^{}`) ?? advertised.get(name)!;
    if (!isOid(commit))
      throw new SkctlError("PROVIDER_INTEGRITY_FAILED", "Invalid advertised commit");
    return commit;
  }

  async metadata(commit: string) {
    if (!isOid(commit)) throw new SkctlError("INVALID_ARGUMENT", "Expected exact commit");
    // An indexed commit can survive a missing tree; force a filtered repair rather
    // than letting negotiation treat that commit as proof of a complete closure.
    await this.objects.fetch([], async () => {
      const header = await this.objects.inventory();
      await this.command([
        "fetch",
        ...(header.has(commit) ? ["--refetch"] : []),
        "--no-tags",
        "--depth=1",
        "--filter=blob:none",
        "--no-recurse-submodules",
        "--no-auto-maintenance",
        "--no-write-commit-graph",
        "skctl",
        commit,
      ]);
    });
    return this.objects.commitTree(commit);
  }

  async blobs(ids: readonly string[]) {
    if (!ids.length) return;
    if (ids.some((id) => !isOid(id)))
      throw new SkctlError("INVALID_ARGUMENT", "Invalid blob identity");
    await this.objects.fetch(ids, () =>
      this.command(
        [
          "-c",
          "fetch.negotiationAlgorithm=noop",
          "fetch",
          "--no-tags",
          "--no-write-fetch-head",
          "--filter=blob:none",
          "--no-recurse-submodules",
          "--no-auto-maintenance",
          "--stdin",
          "skctl",
        ],
        Buffer.from([...new Set(ids)].join("\n") + "\n"),
      ),
    );
  }
}
