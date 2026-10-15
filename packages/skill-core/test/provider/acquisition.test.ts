import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGitSource, resolveGitRef, runProviderChild } from "../../src/internal/source-git";
import { createSourceOperation } from "../../src/internal/source-network";
import { openGitHubSource } from "../../src/internal/source-github";
import { createExecutableFixture } from "../executable-fixture";

const provenance = {
  source: "target",
  origin: "git" as const,
  declaration: { level: "project" as const },
  stability: "immutable" as const,
};
async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["/usr/bin/git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status) throw new Error(err);
  return out.trim();
}

test("exact tree inspection is literal, scoped, memoized and old revision cannot repin content", async () => {
  const root = await mkdtemp(join(tmpdir(), "acquisition-"));
  const shim = await createExecutableFixture();
  const previous = process.env.PATH;
  let snapshot: Awaited<ReturnType<typeof openGitSource>> | undefined;
  try {
    const work = join(root, "work"),
      bare = join(root, "remote.git"),
      log = join(root, "commands");
    await mkdir(join(work, "source", "literal [*]: root"), { recursive: true });
    await mkdir(join(work, "source", "shadow", "child"), { recursive: true });
    await mkdir(join(work, "unrelated"), { recursive: true });
    await git(work, "init");
    await git(work, "config", "user.name", "Test");
    await git(work, "config", "user.email", "test@example.test");
    await writeFile(join(work, "SKILL.md"), "outside boundary");
    await writeFile(join(work, "source", "literal [*]: root", "SKILL.md"), "old");
    await writeFile(join(work, "source", "shadow", "SKILL.md"), "malformed ancestor");
    await writeFile(join(work, "source", "shadow", "child", "SKILL.md"), "child");
    await writeFile(join(work, "unrelated", "unsafe"), "not requested");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "old");
    const old = await git(work, "rev-parse", "HEAD");
    const oldTree = await git(work, "rev-parse", "HEAD:source/literal [*]: root");
    await writeFile(join(work, "source", "literal [*]: root", "SKILL.md"), "new");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "new");
    const current = await git(work, "rev-parse", "HEAD");
    const tree = await git(work, "rev-parse", "HEAD:source/literal [*]: root");
    await git(root, "init", "--bare", bare);
    await git(root, `--git-dir=${bare}`, "config", "uploadpack.allowFilter", "true");
    await git(work, "push", bare, "HEAD:main");
    await mkdir(join(shim, "bin"));
    await writeFile(
      join(shim, "bin", "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec /usr/bin/git "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${shim}/bin:${previous}`;
    snapshot = await openGitSource("target", bare, current, "source", provenance);
    expect(
      await snapshot.inspectRoots(["literal [*]: root", "shadow/child", "missing", ""]),
    ).toEqual([
      {
        path: "literal [*]: root",
        status: "present",
        tree: { objectFormat: "sha1", objectId: tree },
      },
      { path: "shadow/child", status: "not-skill-root" },
      { path: "missing", status: "missing" },
      { path: "", status: "not-skill-root" },
    ]);
    expect(await snapshot.inspectRoots(["literal [*]: root"], undefined, old)).toEqual([
      {
        path: "literal [*]: root",
        status: "present",
        tree: { objectFormat: "sha1", objectId: oldTree },
      },
    ]);
    const before = await readFile(log, "utf8");
    await snapshot.inspectRoots(["literal [*]: root"], undefined, old);
    expect(await readFile(log, "utf8")).toBe(before);
    const inspectionCommands = await readFile(log, "utf8");
    expect(
      new TextDecoder().decode((await snapshot.read("literal [*]: root/SKILL.md")).bytes),
    ).toBe("new");
    expect((await Array.fromAsync(snapshot.list("literal [*]: root"))).map((e) => e.path)).toEqual([
      "literal [*]: root/SKILL.md",
    ]);
    expect(inspectionCommands).not.toMatch(/fetch[^\n]*refs\/heads\//);
    expect(inspectionCommands).not.toMatch(/cat-file[^\n]*--batch(?:\s|$)/);
    expect(inspectionCommands.match(/ls-tree/g)).toHaveLength(2);
  } finally {
    await snapshot?.close();
    process.env.PATH = previous;
    await rm(shim, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("ref advertisement is one request with no content acquisition and peeled tags win", async () => {
  const shim = await createExecutableFixture(),
    previous = process.env.PATH;
  const log = join(shim, "commands"),
    commit = "b".repeat(40);
  try {
    await mkdir(join(shim, "bin"));
    await writeFile(
      join(shim, "bin", "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase " $* " in\n*' ls-remote '*) printf '%s\\trefs/tags/release\\n%s\\trefs/tags/release^{}\\n' '${"a".repeat(40)}' '${commit}';;\n*' fetch '*) echo forbidden-fetch >&2; exit 1;;\n*) exec /usr/bin/git "$@";;\nesac\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${shim}/bin:${previous}`;
    expect(await resolveGitRef("https://example.test/repo", "release")).toBe(commit);
    const commands = await readFile(log, "utf8");
    expect(commands.match(/ls-remote/g)).toHaveLength(1);
    expect(commands).not.toContain(" fetch ");
  } finally {
    process.env.PATH = previous;
    await rm(shim, { recursive: true, force: true });
  }
});

test("GitHub explicit operation proxy reaches actual Octokit and timeout never falls back", async () => {
  const commit = "a".repeat(40),
    seen: string[] = [];
  const proxy = Bun.serve({
    port: 0,
    fetch(request) {
      seen.push(request.url);
      const path = new URL(request.url).pathname;
      if (path.includes("/commits/"))
        return Response.json({ sha: commit, commit: { tree: { sha: "b".repeat(40) } } });
      return Response.json({ sha: "b".repeat(40), truncated: false, tree: [] });
    },
  });
  const operation = createSourceOperation({
    source: "target",
    proxy: proxy.url.toString(),
    budgetMs: 1000,
  });
  const snapshot = await openGitHubSource(
    "target",
    "https://github.com/acme/skills",
    commit,
    "",
    provenance,
    undefined,
    { baseUrl: "http://unresolvable.invalid" },
    undefined,
    operation,
  );
  try {
    expect(await Array.fromAsync(snapshot.list(""))).toEqual([]);
    expect(seen).toHaveLength(2);
  } finally {
    await snapshot.close();
    operation.dispose();
    proxy.stop(true);
  }
  const hanging = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  const deadline = createSourceOperation({ source: "target", budgetMs: 30 });
  const blocked = await openGitHubSource(
    "target",
    "https://github.com/acme/skills",
    commit,
    "",
    provenance,
    undefined,
    { baseUrl: hanging.url.toString() },
    "/nonexistent-fallback",
    deadline,
  );
  try {
    await expect(Array.fromAsync(blocked.list(""))).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
  } finally {
    await blocked.close();
    deadline.dispose();
    hanging.stop(true);
  }
});

test("owned process group escalation continues after leader exit while descendant holds pipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "acquisition-descendant-"));
  const controller = new AbortController();
  const pidFile = join(root, "pid"),
    ready = join(root, "ready");
  const pending = runProviderChild(
    {
      cmd: [
        "/bin/sh",
        "-c",
        `trap 'exit 0' TERM; /bin/sh -c 'trap "" TERM; echo $$ > "${pidFile}"; : > "${ready}"; while :; do sleep 1; done' & wait`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    },
    controller.signal,
  );
  try {
    for (let i = 0; i < 100 && !(await Bun.file(ready).exists()); i++) await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    const started = performance.now();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(performance.now() - started).toBeLessThan(1500);
    const pid = Number(await readFile(pidFile, "utf8"));
    // PID 1 may briefly retain a dead descendant as zombie; it must not be running.
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
    expect(!stat || /^\d+ \(.*\) Z /u.test(stat)).toBe(true);
  } finally {
    controller.abort();
    await pending.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub tree inspection shares ancestor and revision trees without sibling blob requests", async () => {
  const current = "a".repeat(40),
    old = "1".repeat(40),
    repo = "b".repeat(40),
    source = "c".repeat(40),
    skill = "d".repeat(40);
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith(`/commits/${current}`) || url.pathname.endsWith(`/commits/${old}`))
        return Response.json({
          sha: url.pathname.split("/").at(-1),
          commit: { tree: { sha: repo } },
        });
      const id = url.pathname.split("/").at(-1);
      const tree =
        id === repo
          ? [
              { path: "SKILL.md", mode: "100644", type: "blob", sha: "e".repeat(40), size: 1 },
              { path: "source", mode: "040000", type: "tree", sha: source },
            ]
          : id === source
            ? [
                { path: "literal [*]: root", mode: "040000", type: "tree", sha: skill },
                { path: "unrelated", mode: "040000", type: "tree", sha: "f".repeat(40) },
              ]
            : id === skill
              ? [{ path: "SKILL.md", mode: "100644", type: "blob", sha: "e".repeat(40), size: 1 }]
              : [];
      return Response.json({ sha: id, truncated: false, tree });
    },
  });
  const snapshot = await openGitHubSource(
    "target",
    "https://github.com/acme/skills",
    current,
    "source",
    provenance,
    undefined,
    { baseUrl: server.url.toString() },
  );
  try {
    expect(await snapshot.inspectRoots(["literal [*]: root", "missing"])).toEqual([
      {
        path: "literal [*]: root",
        status: "present",
        tree: { objectFormat: "sha1", objectId: skill },
      },
      { path: "missing", status: "missing" },
    ]);
    await snapshot.inspectRoots(["literal [*]: root"], undefined, old);
    const before = requests.slice();
    await snapshot.inspectRoots(["literal [*]: root"], undefined, old);
    expect(requests).toEqual(before);
    expect(
      (await Array.fromAsync(snapshot.list("literal [*]: root"))).map((entry) => entry.path),
    ).toEqual(["literal [*]: root/SKILL.md"]);
    expect(requests).toHaveLength(5);
    expect(requests.some((path) => /recursive|blobs|ffff/u.test(path))).toBe(false);
    expect(snapshot.commit).toBe(current);
  } finally {
    await snapshot.close();
    server.stop(true);
  }
});
