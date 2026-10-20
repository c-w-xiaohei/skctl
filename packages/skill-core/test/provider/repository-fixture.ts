import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runProcess } from "../../src/runtime/process";

/** Real object identities for Git transport and GitHub response fixtures. */
export async function repositoryFixture(
  files: Readonly<Record<string, string>> = {
    "SKILL.md": "---\nname: fixture\ndescription: Fixture\n---\n",
  },
) {
  const root = await mkdtemp(join(tmpdir(), "skctl-repository-"));
  const work = join(root, "work"),
    bare = join(root, "remote.git");
  await mkdir(work);
  const git = async (...args: string[]) => {
    const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd: work });
    if (result.status) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.test");
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), bytes);
  }
  await git("add", ".");
  await git("commit", "-m", "initial");
  await git("clone", "--bare", work, bare);
  await git("--git-dir", bare, "config", "uploadpack.allowFilter", "true");
  await git("--git-dir", bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const commit = await git("rev-parse", "HEAD");
  const tree = await git("rev-parse", "HEAD^{tree}");
  const records = await runProcess({
    cmd: ["/usr/bin/git", "ls-tree", "-r", "-t", "-z", "HEAD"],
    cwd: work,
  });
  if (records.status) throw new Error(records.stderr.toString());
  const entries = [];
  for (const record of records.stdout.toString().split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, type, sha] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    const size = type === "blob" ? (await readFile(join(work, path))).length : undefined;
    entries.push({
      path,
      mode: mode!,
      type: type!,
      sha: sha!,
      ...(size === undefined ? {} : { size }),
    });
  }
  return { root, work, bare, git, commit, tree, entries };
}

export function serveRepository(
  fixture: Awaited<ReturnType<typeof repositoryFixture>>,
  respond?: (request: Request) => Response | undefined,
) {
  const requests: string[] = [],
    authorization: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url),
        path = url.pathname;
      requests.push(path + url.search);
      authorization.push(request.headers.get("authorization") ?? "");
      const override = respond?.(request);
      if (override) return override;
      if (path.endsWith("/git/ref/heads/main"))
        return Response.json({ object: { sha: fixture.commit, type: "commit" } });
      if (path.endsWith(`/commits/${fixture.commit}`))
        return Response.json({ sha: fixture.commit, commit: { tree: { sha: fixture.tree } } });
      if (path.endsWith(`/git/trees/${fixture.tree}`))
        return Response.json({ sha: fixture.tree, truncated: false, tree: fixture.entries });
      const blob = path.split("/git/blobs/")[1];
      const entry =
        blob && fixture.entries.find((entry) => entry.sha === blob && entry.type === "blob");
      if (entry) {
        const bytes = await readFile(join(fixture.work, entry.path));
        return Response.json({
          sha: blob,
          encoding: "base64",
          size: bytes.length,
          content: bytes.toString("base64"),
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, requests, authorization };
}
