import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../../src/runtime/process";
import { withRepository, reclaimSources } from "../../src/source/service/remote/cache";
import { discoverSource, withPreparedSkills } from "../../src/source/service";
import { withFileLock } from "../../src/storage/file-lock";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skctl-source-cache-"));
  const work = join(root, "work"),
    bare = join(root, "remote.git"),
    cache = join(root, "cache"),
    trace = join(root, "trace");
  await mkdir(join(work, "skills", "guide"), { recursive: true });
  await writeFile(
    join(work, "skills", "guide", "SKILL.md"),
    "---\nname: guide\ndescription: A guide\n---\n",
  );
  await writeFile(join(work, "skills", "guide", "resource.txt"), "resource\n");
  await writeFile(join(work, "unselected.txt"), "do not acquire\n");
  const git = async (...args: string[]) => {
    const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd: work });
    if (result.status) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.test");
  await git("add", ".");
  await git("commit", "-m", "initial");
  await git("clone", "--bare", work, bare);
  await git("--git-dir", bare, "config", "uploadpack.allowFilter", "true");
  await git("--git-dir", bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const commit = await git("rev-parse", "HEAD");
  const marker = await git("rev-parse", "HEAD:skills/guide/SKILL.md");
  const resource = await git("rev-parse", "HEAD:skills/guide/resource.txt");
  const origin = "https://example.test/cache.git";
  return {
    root,
    work,
    bare,
    cache,
    trace,
    commit,
    marker,
    resource,
    origin,
    git,
    request: { origin, kind: "git" as const, ref: "main", transport: () => `file://${bare}` },
  };
}

test("expired ref failures retain exact old observations and idle collection only removes remote cache", async () => {
  const value = await fixture();
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = value.cache;
  try {
    await withRepository(value.request, async (reader) => {
      await reader.revision({ current: true });
    });
    const key = new Bun.CryptoHasher("sha256").update(value.origin).digest("hex");
    const path = join(value.cache, "origins", key, "cache.json");
    const index = JSON.parse(await readFile(path, "utf8"));
    index.refs.main.observedAt = Date.now() - 31_000;
    await writeFile(path, JSON.stringify(index));
    await withRepository(
      { ...value.request, transport: () => "file:///unavailable" },
      async (reader) => {
        const result = await reader.revision({ current: true });
        expect(result?.version.commit).toBe(value.commit);
        expect(result?.version.observedAt).toBe(index.refs.main.observedAt);
        expect(result?.version.refreshError).toBeDefined();
      },
    );
    const current = JSON.parse(await readFile(path, "utf8"));
    expect(current.refs.main.observedAt).toBe(index.refs.main.observedAt);
    current.lastUsedAt = Date.now() - 25 * 60 * 60 * 1_000;
    await writeFile(path, JSON.stringify(current));
    await reclaimSources();
    await expect(readFile(path)).rejects.toHaveProperty("code", "ENOENT");
    expect(await value.git("rev-parse", "HEAD")).toBe(value.commit);
  } finally {
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
  }
});

test("origin reclamation skips active readers and valid cache defaults never repair malformed persisted facts", async () => {
  const value = await fixture(),
    saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = value.cache;
  const key = new Bun.CryptoHasher("sha256").update(value.origin).digest("hex");
  const path = join(value.cache, "origins", key, "cache.json");
  try {
    await withRepository(value.request, async (reader) => {
      await reader.revision({ current: true });
    });
    const index = JSON.parse(await readFile(path, "utf8"));
    index.lastUsedAt = Date.now() - 25 * 60 * 60 * 1_000;
    await writeFile(path, JSON.stringify(index));
    const source = resolve("packages/skill-core/src/source/service/remote/cache.ts");
    await withFileLock(join(value.cache, "locks", key), async () => {
      const child = await runProcess({
        cmd: [
          process.execPath,
          "-e",
          `import {reclaimSources} from ${JSON.stringify(source)};await reclaimSources()`,
        ],
      });
      expect(child.status).toBe(0);
      expect(await Bun.file(path).exists()).toBe(true);
    });
    await withRepository({ ...value.request, transport: () => "/unavailable" }, async (reader) => {
      expect((await reader.revision({ commit: value.commit }))?.version.commit).toBe(value.commit);
    });
    await reclaimSources();
    expect(await Bun.file(path).exists()).toBe(true);
    for (const invalid of [
      { ...index, refs: undefined },
      { ...index, revisions: undefined },
      { ...index, canonicalOrigin: "https://other.test/repo" },
      { ...index, extra: true },
      { ...index, lastUsedAt: -1 },
    ]) {
      const bytes = JSON.stringify(invalid);
      await writeFile(path, bytes);
      await expect(withRepository(value.request, async () => {})).rejects.toHaveProperty(
        "code",
        "PROVIDER_INTEGRITY_FAILED",
      );
      expect(await readFile(path, "utf8")).toBe(bytes);
    }
  } finally {
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("GitHub metadata and Git transfers share trees and blobs without synthesizing commit objects", async () => {
  const value = await fixture();
  const tree = await value.git("rev-parse", "HEAD^{tree}");
  const entries = JSON.parse(
    await value
      .git(
        "ls-tree",
        "-r",
        "-t",
        '--format={"path":"%(path)","mode":"%(objectmode)","type":"%(objecttype)","sha":"%(objectname)"},',
        "HEAD",
      )
      .then((text) => `[${text.replace(/,\s*$/, "")}]`),
  );
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path.endsWith("/git/ref/heads/main"))
        return Response.json({ object: { sha: value.commit, type: "commit" } });
      if (path.includes("/git/ref/")) return new Response("missing", { status: 404 });
      if (path.endsWith(`/commits/${value.commit}`))
        return Response.json({ sha: value.commit, commit: { tree: { sha: tree } } });
      if (path.endsWith(`/git/trees/${tree}`))
        return Response.json({ sha: tree, truncated: false, tree: entries });
      const id = path.split("/git/blobs/")[1];
      if (id) {
        const result = await runProcess({
          cmd: ["/usr/bin/git", "cat-file", "blob", id],
          cwd: value.work,
        });
        return Response.json({
          sha: id,
          encoding: "base64",
          content: result.stdout.toString("base64"),
          size: result.stdout.length,
        });
      }
      return new Response("unexpected", { status: 500 });
    },
  });
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = value.cache;
  const origin = "https://github.com/fixture/shared";
  const context = {
    binding: {
      id: "api",
      kind: "github" as const,
      origin,
      root: "skills",
      ref: "main",
      selectors: [],
      provenance: { level: "project" as const },
    },
    githubApiBaseUrl: server.url.toString(),
    transport: () => `file://${value.bare}`,
  };
  try {
    const discovery = await discoverSource(context);
    expect(discovery.candidates).toHaveLength(1);
    const before = requests.length;
    const key = new Bun.CryptoHasher("sha256").update(origin).digest("hex"),
      odb = join(value.cache, "origins", key, "objects.git");
    expect(
      await value.git(
        `--git-dir=${odb}`,
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objecttype)",
      ),
    ).not.toContain("commit");
    await withPreparedSkills(
      { ...context, binding: { ...context.binding, id: "git", kind: "git" } },
      ["guide"],
      value.commit,
      async (prepared) => {
        expect(await readFile(join(prepared[0]!.directory, "resource.txt"), "utf8")).toBe(
          "resource\n",
        );
      },
    );
    expect(requests).toHaveLength(before);
    // Moving back to API uses the Git-acquired resource, not another HTTP request.
    await withPreparedSkills(context, ["guide"], value.commit, async () => {});
    expect(requests).toHaveLength(before);
  } finally {
    await server.stop(true);
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
  }
});

test("simultaneous independent readers recheck the locked cache instead of duplicating acquisition", async () => {
  const value = await fixture();
  const source = resolve("packages/skill-core/src/source/service/remote/cache.ts");
  const script = `import {withRepository} from ${JSON.stringify(source)};await withRepository({origin:${JSON.stringify(value.origin)},kind:'git',ref:'main',transport:()=>${JSON.stringify(`file://${value.bare}`)}},async r=>{const v=await r.revision({current:true});await v.blobs([${JSON.stringify(value.marker)}])});`;
  const result = await Promise.all(
    [1, 2].map(() =>
      runProcess({
        cmd: [process.execPath, "-e", script],
        env: { ...process.env, SKCTL_SOURCE_CACHE_DIR: value.cache, GIT_TRACE: value.trace },
      }),
    ),
  );
  expect(result.map((item) => item.status)).toEqual([0, 0]);
  const trace = await readFile(value.trace, "utf8");
  expect(
    trace.split("\n").filter((line) => line.includes("built-in: git ls-remote ")),
  ).toHaveLength(1);
  expect(trace.split("\n").filter((line) => line.includes("built-in: git fetch "))).toHaveLength(2);
});

test("missing cached root repairs its indexed exact revision; unavailable origin fails instead of substituting another commit", async () => {
  const value = await fixture();
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = value.cache;
  try {
    await withRepository(value.request, async (reader) => {
      await reader.revision({ current: true });
    });
    const key = new Bun.CryptoHasher("sha256").update(value.origin).digest("hex");
    const packs = join(value.cache, "origins", key, "objects.git", "objects", "pack");
    for (const name of await readdir(packs)) await rm(join(packs, name));
    await withRepository(value.request, async (reader) => {
      const revision = await reader.revision({ commit: value.commit });
      expect(
        (await revision!.readTree(revision!.version.tree)).some((entry) => entry.path === "skills"),
      ).toBe(true);
    });
    for (const name of await readdir(packs)) await rm(join(packs, name));
    await expect(
      withRepository(
        { ...value.request, transport: () => "file:///unavailable" },
        async (reader) => {
          await reader.revision({ commit: value.commit });
        },
      ),
    ).rejects.toHaveProperty("code", "PROVIDER_UNAVAILABLE");
  } finally {
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
  }
});

test("GitHub fallback is explicit and authentication or malformed responses do not switch providers", async () => {
  const value = await fixture();
  const tree = await value.git("rev-parse", "HEAD^{tree}");
  let mode = "truncated";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (mode === "auth") return new Response("unauthorized", { status: 401 });
      if (mode === "malformed") return Response.json({ sha: value.commit, commit: {} });
      if (new URL(request.url).pathname.includes("/commits/"))
        return Response.json({ sha: value.commit, commit: { tree: { sha: tree } } });
      return Response.json({ sha: tree, tree: [], truncated: true });
    },
  });
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  try {
    const request = {
      ...value.request,
      origin: "https://github.com/fixture/fallback",
      kind: "github" as const,
      githubApiBaseUrl: server.url.toString(),
    };
    process.env.SKCTL_SOURCE_CACHE_DIR = join(value.root, "truncated-cache");
    await withRepository(request, async (reader) => {
      expect((await reader.revision({ commit: value.commit }))?.version.tree).toBe(tree);
    });
    for (const failure of ["auth", "malformed"]) {
      mode = failure;
      process.env.SKCTL_SOURCE_CACHE_DIR = join(value.root, `${failure}-cache`);
      await expect(
        withRepository(request, async (reader) => reader.revision({ commit: value.commit })),
      ).rejects.toHaveProperty(
        "code",
        failure === "auth" ? "PROVIDER_AUTH_FAILED" : "PROVIDER_INTEGRITY_FAILED",
      );
    }
  } finally {
    await server.stop(true);
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
  }
});

test("an origin lock wait uses the same deadline without reporting caller cancellation or starting acquisition", async () => {
  const value = await fixture(),
    saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = value.cache;
  const key = new Bun.CryptoHasher("sha256").update(value.origin).digest("hex");
  const source = resolve("packages/skill-core/src/source/service/remote/cache.ts");
  try {
    await withFileLock(join(value.cache, "locks", key), async () => {
      const child = await runProcess({
        cmd: [
          process.execPath,
          "-e",
          `
import { withRepository } from ${JSON.stringify(source)};
try {
  await withRepository({ origin: ${JSON.stringify(value.origin)}, kind: 'git', ref: 'main', budgetMs: 30 }, async () => { throw Error('acquisition started'); });
  process.exitCode = 1;
} catch (error) { if (error.code !== 'PROVIDER_TIMEOUT') throw error; }
`,
        ],
      });
      expect(child.status).toBe(0);
      expect(await Bun.file(join(value.cache, "origins", key, "cache.json")).exists()).toBe(false);
    });
  } finally {
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
    await rm(value.root, { recursive: true, force: true });
  }
});
