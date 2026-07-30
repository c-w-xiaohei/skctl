import { expect, test as bunTest } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSource } from "../../src/core/internal/sources";
import { openGitHubSource, resolveGitHubApi } from "../../src/core/internal/source-github";

const test = bunTest.serial;
const commit = "a".repeat(40);
const runBytes = new TextEncoder().encode("#!/bin/sh");
const runObject = createHash("sha1")
  .update(`blob ${runBytes.byteLength}\0`)
  .update(runBytes)
  .digest("hex");
const provenance = {
  source: "github",
  origin: "git" as const,
  declaration: { level: "project" as const },
  stability: "immutable" as const,
  revision: commit,
};

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

async function bareFixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-github-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  await mkdir(work);
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "SKILL.md"), "---\nname: fallback\ndescription: Fallback\n---\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const pinned = await git(work, "rev-parse", "HEAD");
  await git(root, "init", "--bare", bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  return { bare, pinned };
}

test("GitHub reads pinned tree metadata and requested blob bytes through its API", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === `/repos/acme/skills/commits/${commit}`)
        return Response.json({ sha: commit, commit: { tree: { sha: "b".repeat(40) } } });
      if (path === `/repos/acme/skills/git/trees/${"b".repeat(40)}`)
        return Response.json({
          sha: "b".repeat(40),
          truncated: false,
          tree: [
            { path: "nested", mode: "040000", type: "tree", sha: "c".repeat(40) },
            {
              path: "nested/SKILL.md",
              mode: "100644",
              type: "blob",
              sha: "d".repeat(40),
              size: 35,
            },
            { path: "nested/run", mode: "100755", type: "blob", sha: runObject, size: 9 },
            { path: "nested/link", mode: "120000", type: "blob", sha: "f".repeat(40), size: 6 },
            { path: "nested/module", mode: "160000", type: "commit", sha: "1".repeat(40) },
            {
              path: "nested/pointer",
              mode: "100644",
              type: "blob",
              sha: "2".repeat(40),
              size: 73,
            },
          ],
        });
      if (path === `/repos/acme/skills/git/blobs/${runObject}`)
        return Response.json({
          sha: runObject,
          encoding: "base64",
          content: Buffer.from("#!/bin/sh").toString("base64"),
        });
      return Response.json({ message: "not found" }, { status: 404 });
    },
  });
  try {
    const snapshot = await openSource(
      "github",
      {
        origin: "git",
        url: "https://github.com/acme/skills.git",
        commit,
        path: "",
        text: "",
      },
      provenance,
      undefined,
      undefined,
      server.url.toString(),
    );
    expect(await Array.fromAsync(snapshot.list("nested"))).toEqual([
      { kind: "directory", path: "nested" },
      {
        kind: "file",
        path: "nested/SKILL.md",
        size: 35,
        executable: false,
        objectId: "d".repeat(40),
      },
      { kind: "symlink", path: "nested/link", size: 6, objectId: "f".repeat(40) },
      { kind: "gitlink", path: "nested/module", commit: "1".repeat(40) },
      {
        kind: "file",
        path: "nested/pointer",
        size: 73,
        executable: false,
        objectId: "2".repeat(40),
      },
      { kind: "file", path: "nested/run", size: 9, executable: true, objectId: runObject },
    ]);
    expect(await snapshot.read("nested/run")).toEqual({
      entry: { kind: "file", path: "nested/run", size: 9, executable: true, objectId: runObject },
      bytes: runBytes,
    });
    expect(requests).toEqual([
      `/repos/acme/skills/commits/${commit}`,
      `/repos/acme/skills/git/trees/${"b".repeat(40)}`,
      `/repos/acme/skills/commits/${commit}`,
      `/repos/acme/skills/git/trees/${"b".repeat(40)}`,
      `/repos/acme/skills/git/blobs/${runObject}`,
    ]);
    await snapshot.close();
  } finally {
    server.stop(true);
  }
});

test("GitHub fallback is eligible only for incomplete or unavailable API operations", async () => {
  const { classifyGitHubFailure } = await import("../../src/core/internal/source-github");
  expect(classifyGitHubFailure(403, "rate limit")).toBe("fallback");
  expect(classifyGitHubFailure(503, "unavailable")).toBe("fallback");
  expect(classifyGitHubFailure(401, "bad credentials")).toBe("auth");
  expect(classifyGitHubFailure(404, "not found")).toBe("not-found");
  expect(classifyGitHubFailure(200, "integrity mismatch")).toBe("integrity");
});

test("GitHub.com auth token child is cancelled and drained", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-gh-abort-"));
  const bin = join(root, "bin");
  const ready = join(root, "ready");
  const pid = join(root, "pid");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
: > "${ready}"
printf '%s' "$$" > "${pid}"
trap '' TERM
i=0; while [ "$i" -lt 8192 ]; do printf 'blocked stderr %s\\n' "$i" >&2; i=$((i + 1)); done
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  const previousGhToken = process.env.GH_TOKEN;
  process.env.PATH = `${bin}:${previousPath}`;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    const controller = new AbortController();
    const pending = resolveGitHubApi("https://github.com/acme/skills", controller.signal);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        await readFile(ready)
          .then(() => true)
          .catch(() => false)
      )
        break;
      await Bun.sleep(10);
    }
    expect(
      await readFile(ready)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    const blockedPid = Number(await readFile(pid, "utf8"));
    expect(() => process.kill(blockedPid, 0)).toThrow();
  } finally {
    process.env.PATH = previousPath;
    if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGitHubToken;
    if (previousGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGhToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub.com resolves API tokens without exposing test APIs to gh", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-gh-token-"));
  const bin = join(root, "bin");
  const invocation = join(root, "invocation");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${invocation}"
printf '%s\\n' gh-token
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  const previousGhToken = process.env.GH_TOKEN;
  process.env.PATH = `${bin}:${previousPath}`;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    await expect(resolveGitHubApi("https://github.com/acme/skills")).resolves.toEqual({
      baseUrl: "https://api.github.com",
      token: "gh-token",
    });
    expect(await readFile(invocation, "utf8")).toBe("auth token --hostname github.com\n");

    await rm(invocation, { force: true });
    process.env.GITHUB_TOKEN = "github-token";
    process.env.GH_TOKEN = "gh-env-token";
    await expect(resolveGitHubApi("https://github.com/acme/skills")).resolves.toEqual({
      baseUrl: "https://api.github.com",
      token: "github-token",
    });
    expect(
      await readFile(invocation)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "gh-env-token";
    await expect(resolveGitHubApi("https://github.com/acme/skills")).resolves.toEqual({
      baseUrl: "https://api.github.com",
      token: "gh-env-token",
    });
    expect(
      await readFile(invocation)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "gh-env-token";
    await expect(resolveGitHubApi("https://github.com/acme/skills")).resolves.toEqual({
      baseUrl: "https://api.github.com",
      token: "gh-env-token",
    });
    expect(
      await readFile(invocation)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    process.env.GH_TOKEN = "";
    await expect(resolveGitHubApi("https://github.com/acme/skills")).resolves.toEqual({
      baseUrl: "https://api.github.com",
      token: "gh-token",
    });
    expect(await readFile(invocation, "utf8")).toBe("auth token --hostname github.com\n");

    await writeFile(join(bin, "gh"), `#!/bin/sh\n: > "${invocation}"\nexit 1\n`, {
      mode: 0o755,
    });
    await rm(invocation, { force: true });
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    await expect(resolveGitHubApi("https://github.com/acme/skills")).resolves.toEqual({
      baseUrl: "https://api.github.com",
      token: undefined,
    });
    await rm(invocation, { force: true });

    await expect(
      resolveGitHubApi("https://github.com/acme/skills", undefined, "http://127.0.0.1:9876"),
    ).resolves.toEqual({ baseUrl: "http://127.0.0.1:9876", token: undefined });
    expect(
      await readFile(invocation)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  } finally {
    process.env.PATH = previousPath;
    if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGitHubToken;
    if (previousGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGhToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub test APIs never receive environment tokens", async () => {
  const authorization: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      authorization.push(request.headers.get("authorization") ?? "");
      const path = new URL(request.url).pathname;
      if (path === `/repos/acme/skills/commits/${commit}`)
        return Response.json({ sha: commit, commit: { tree: { sha: "b".repeat(40) } } });
      if (path === `/repos/acme/skills/git/trees/${"b".repeat(40)}`)
        return Response.json({ sha: "b".repeat(40), truncated: false, tree: [] });
      return Response.json({ message: "not found" }, { status: 404 });
    },
  });
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  const previousGhToken = process.env.GH_TOKEN;
  process.env.GITHUB_TOKEN = "github-sentinel";
  process.env.GH_TOKEN = "gh-sentinel";
  try {
    const api = await resolveGitHubApi(
      "https://github.com/acme/skills",
      undefined,
      server.url.toString(),
    );
    expect(api).toEqual({ baseUrl: server.url.toString(), token: undefined });
    const snapshot = await openGitHubSource(
      "github",
      "https://github.com/acme/skills.git",
      commit,
      "",
      provenance,
      undefined,
      api,
    );
    expect(await Array.fromAsync(snapshot.list(""))).toEqual([]);
    await snapshot.close();
    expect(authorization).toEqual(["", ""]);
  } finally {
    if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGitHubToken;
    if (previousGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGhToken;
    server.stop(true);
  }
});

test("GitHub restarts incomplete or unavailable API operations through Generic Git", async () => {
  for (const [_name, status, truncated] of [
    ["truncated tree", 200, true],
    ["server error", 503, false],
    ["rate exhaustion", 429, false],
  ] as const) {
    const fixture = await bareFixture();
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === `/repos/acme/skills/commits/${fixture.pinned}`)
          return Response.json({
            sha: fixture.pinned,
            commit: { tree: { sha: "b".repeat(40) } },
          });
        if (path === `/repos/acme/skills/git/trees/${"b".repeat(40)}`)
          return status === 200
            ? Response.json({ sha: "b".repeat(40), truncated, tree: [] })
            : Response.json({ message: "rate limit" }, { status });
        return Response.json({ message: "not found" }, { status: 404 });
      },
    });
    try {
      const snapshot = await openSource(
        "github",
        {
          origin: "git",
          url: "https://github.com/acme/skills.git",
          commit: fixture.pinned,
          path: "",
          text: "",
        },
        { ...provenance, revision: fixture.pinned },
        undefined,
        () => fixture.bare,
        server.url.toString(),
      );
      expect((await Array.fromAsync(snapshot.list(""))).map((entry) => entry.path)).toEqual([
        "SKILL.md",
      ]);
      await snapshot.close();
    } finally {
      server.stop(true);
    }
  }
});

test("GitHub never falls back on authentication or verified not-found failures", async () => {
  for (const [status, code] of [
    [401, "PROVIDER_AUTH_FAILED"],
    [404, "SOURCE_NOT_FOUND"],
  ] as const) {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ message: "secret-token" }, { status }),
    });
    try {
      const snapshot = await openSource(
        "github",
        { origin: "git", url: "https://github.com/acme/skills.git", commit, path: "", text: "" },
        provenance,
        undefined,
        () => "https://invalid.test/no.git",
        server.url.toString(),
      );
      await expect(Array.fromAsync(snapshot.list(""))).rejects.toMatchObject({
        code,
        message: expect.not.stringContaining("secret-token"),
      });
    } finally {
      server.stop(true);
    }
  }
});

test("GitHub rejects a mismatched commit object without a Git fallback", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ sha: "b".repeat(40), commit: { tree: { sha: "c".repeat(40) } } }),
  });
  try {
    const snapshot = await openSource(
      "github",
      { origin: "git", url: "https://github.com/acme/skills.git", commit, path: "", text: "" },
      provenance,
      undefined,
      () => "https://invalid.test/no.git",
      server.url.toString(),
    );
    await expect(Array.fromAsync(snapshot.list(""))).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
  } finally {
    server.stop(true);
  }
});

test("GitHub rejects a mismatched tree object without a Git fallback", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === `/repos/acme/skills/commits/${commit}`)
        return Response.json({ sha: commit, commit: { tree: { sha: "b".repeat(40) } } });
      return Response.json({ sha: "c".repeat(40), truncated: false, tree: [] });
    },
  });
  try {
    const snapshot = await openSource(
      "github",
      { origin: "git", url: "https://github.com/acme/skills.git", commit, path: "", text: "" },
      provenance,
      undefined,
      () => "https://invalid.test/no.git",
      server.url.toString(),
    );
    await expect(Array.fromAsync(snapshot.list(""))).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
  } finally {
    server.stop(true);
  }
});

test("GitHub treats malformed JSON as integrity failure without fallback", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("not-json", { headers: { "content-type": "application/json" } }),
  });
  try {
    const snapshot = await openSource(
      "github",
      { origin: "git", url: "https://github.com/acme/skills.git", commit, path: "", text: "" },
      provenance,
      undefined,
      () => "https://invalid.test/no.git",
      server.url.toString(),
    );
    await expect(Array.fromAsync(snapshot.list(""))).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
  } finally {
    server.stop(true);
  }
});

test("GitHub fallback closes its temporary Generic Git snapshot after a successful operation", async () => {
  const fixture = await bareFixture();
  const before = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith("skill-cli-git-")),
  );
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === `/repos/acme/skills/commits/${fixture.pinned}`)
        return Response.json({ sha: fixture.pinned, commit: { tree: { sha: "b".repeat(40) } } });
      return Response.json({ message: "unavailable" }, { status: 503 });
    },
  });
  try {
    const snapshot = await openSource(
      "github",
      {
        origin: "git",
        url: "https://github.com/acme/skills.git",
        commit: fixture.pinned,
        path: "",
        text: "",
      },
      { ...provenance, revision: fixture.pinned },
      undefined,
      () => fixture.bare,
      server.url.toString(),
    );
    await Array.fromAsync(snapshot.list(""));
    await snapshot.close();
    expect(
      (await readdir(tmpdir())).filter(
        (name) => name.startsWith("skill-cli-git-") && !before.has(name),
      ),
    ).toEqual([]);
  } finally {
    server.stop(true);
  }
});

test("GitHub request timeout falls back without exposing transport details", async () => {
  const fixture = await bareFixture();
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  try {
    const snapshot = await openGitHubSource(
      "github",
      "https://github.com/acme/skills.git",
      fixture.pinned,
      "",
      { ...provenance, revision: fixture.pinned },
      undefined,
      { baseUrl: server.url.toString(), timeout: 25 },
      fixture.bare,
    );
    expect((await Array.fromAsync(snapshot.list(""))).map((entry) => entry.path)).toEqual([
      "SKILL.md",
    ]);
    await snapshot.close();
  } finally {
    server.stop(true);
  }
});

test("GitHub fallback closes its temporary Generic Git snapshot after a failed operation", async () => {
  const fixture = await bareFixture();
  const before = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith("skill-cli-git-")),
  );
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === `/repos/acme/skills/commits/${fixture.pinned}`)
        return Response.json({ sha: fixture.pinned, commit: { tree: { sha: "b".repeat(40) } } });
      if (path === `/repos/acme/skills/git/trees/${"b".repeat(40)}`)
        return Response.json({
          sha: "b".repeat(40),
          truncated: false,
          tree: [{ path: "missing", mode: "100644", type: "blob", sha: "d".repeat(40), size: 1 }],
        });
      return Response.json({ message: "unavailable" }, { status: 503 });
    },
  });
  try {
    const snapshot = await openSource(
      "github",
      {
        origin: "git",
        url: "https://github.com/acme/skills.git",
        commit: fixture.pinned,
        path: "",
        text: "",
      },
      { ...provenance, revision: fixture.pinned },
      undefined,
      () => fixture.bare,
      server.url.toString(),
    );
    await expect(snapshot.read("missing")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await snapshot.close();
    expect(
      (await readdir(tmpdir())).filter(
        (name) => name.startsWith("skill-cli-git-") && !before.has(name),
      ),
    ).toEqual([]);
  } finally {
    server.stop(true);
  }
});
