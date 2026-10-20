import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSource, withPreparedSkills } from "../../src/source/service";
import { withRepository } from "../../src/source/service/remote/cache";
import { GitHubTransfer } from "../../src/source/service/remote/github";
import { GitObjects } from "../../src/source/service/remote/objects";
import * as network from "../../src/source/service/remote/network";
import { sourceTree } from "../../src/source/service/skills";
import { createExecutableFixture } from "../executable-fixture";
import { repositoryFixture, serveRepository } from "./repository-fixture";

const origin = "https://github.com/acme/skills";
const binding = {
  id: "github",
  kind: "github" as const,
  origin,
  root: "",
  ref: "main",
  selectors: [],
  provenance: { level: "project" as const },
};
let root: string, saved: Record<string, string | undefined>;
let roots: string[];
beforeEach(async () => {
  saved = Object.fromEntries(
    ["PATH", "GITHUB_TOKEN", "GH_TOKEN", "SKCTL_SOURCE_CACHE_DIR"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  root = await mkdtemp(join(tmpdir(), "skctl-github-cache-"));
  roots = [root];
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
});
afterEach(async () => {
  mock.restore();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const path of roots) await rm(path, { recursive: true, force: true });
});
async function fixture(files?: Readonly<Record<string, string>>) {
  const value = await repositoryFixture(files);
  roots.push(value.root);
  return value;
}

test("GitHub verifies recursive tree metadata and requested blob bytes including executable, link and gitlink modes", async () => {
  const value = await fixture({
    "nested/SKILL.md": "---\nname: nested\ndescription: Nested\n---\n",
    "nested/run": "#!/bin/sh",
    "nested/link": "target",
    "nested/pointer": "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n",
  });
  const run = await value.git("rev-parse", "HEAD:nested/run"),
    link = await value.git("rev-parse", "HEAD:nested/link");
  await value.git("update-index", "--cacheinfo", "100755", run, "nested/run");
  await value.git("update-index", "--cacheinfo", "120000", link, "nested/link");
  await value.git("update-index", "--add", "--cacheinfo", "160000", value.commit, "nested/module");
  await value.git("commit", "-m", "modes");
  const commit = await value.git("rev-parse", "HEAD"),
    tree = await value.git("rev-parse", "HEAD^{tree}");
  const nested = await value.git("rev-parse", "HEAD:nested");
  const entries = [
    { path: "nested", mode: "040000", type: "tree", sha: nested },
    ...value.entries
      .filter((entry) => entry.type === "blob")
      .map((entry) => ({
        ...entry,
        mode:
          entry.path === "nested/run"
            ? "100755"
            : entry.path === "nested/link"
              ? "120000"
              : entry.mode,
      })),
    { path: "nested/module", mode: "160000", type: "commit", sha: value.commit },
  ];
  const api = serveRepository(value, (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/commits/${commit}`))
      return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
    if (path.endsWith(`/git/trees/${tree}`))
      return Response.json({ sha: tree, truncated: false, tree: entries });
  });
  try {
    await withRepository(
      { ...binding, githubApiBaseUrl: api.server.url.toString() },
      async (reader) => {
        const revision = await reader.revision({ commit });
        const boundary = await sourceTree(revision!, "nested");
        expect(
          (await revision!.readTree(boundary!)).map((entry) => [entry.path, entry.mode]),
        ).toEqual([
          ["SKILL.md", "100644"],
          ["link", "120000"],
          ["module", "160000"],
          ["pointer", "100644"],
          ["run", "100755"],
        ]);
        expect(Buffer.from((await revision!.blobs([run])).get(run)!).toString()).toBe("#!/bin/sh");
      },
    );
    expect(api.requests).toEqual([
      `/repos/acme/skills/commits/${commit}`,
      `/repos/acme/skills/git/trees/${tree}?recursive=1`,
      `/repos/acme/skills/git/blobs/${run}`,
    ]);
  } finally {
    await api.server.stop(true);
  }
});

test("GitHub discovery respects the Source boundary and never reads sibling marker bytes", async () => {
  const value = await fixture({
    "SKILL.md": "outside boundary",
    "skills/only/SKILL.md": "---\nname: only\ndescription: Only\n---\n",
    "other/resource.txt": "unselected",
  });
  const api = serveRepository(value);
  try {
    expect(
      (
        await discoverSource({
          binding: { ...binding, root: "skills", ref: value.commit },
          githubApiBaseUrl: api.server.url.toString(),
        })
      ).candidates,
    ).toEqual([{ path: "only", name: "only", description: "Only" }]);
    const blobs = api.requests.filter((path) => path.includes("/git/blobs/"));
    expect(blobs).toEqual([
      `/repos/acme/skills/git/blobs/${await value.git("rev-parse", "HEAD:skills/only/SKILL.md")}`,
    ]);
  } finally {
    await api.server.stop(true);
  }
});

test("GitHub.com credential child is cancelled, escalated and drained", async () => {
  const executable = await createExecutableFixture();
  roots.push(executable);
  await mkdir(join(executable, "bin"));
  const ready = join(root, "ready"),
    pid = join(root, "pid"),
    controller = new AbortController();
  await writeFile(
    join(executable, "bin", "gh"),
    `#!/bin/sh\n: > '${ready}'\nprintf '%s' "$$" > '${pid}'\ntrap '' TERM\ni=0; while [ "$i" -lt 8192 ]; do printf 'blocked stderr %s\\n' "$i" >&2; i=$((i + 1)); done\nwhile :; do sleep 1; done\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${executable}/bin:${saved.PATH}`;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  const operation = network.createSourceOperation({ source: "github", signal: controller.signal });
  const pending = GitHubTransfer.create(
    origin,
    new GitObjects(join(root, "objects.git")),
    operation,
  );
  try {
    for (let attempt = 0; attempt < 100 && !(await Bun.file(ready).exists()); attempt++)
      await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    controller.abort();
    await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
    const blockedPid = Number(await readFile(pid, "utf8"));
    expect(() => process.kill(blockedPid, 0)).toThrow();
  } finally {
    controller.abort();
    await pending.catch(() => {});
  }
});

test("GitHub.com uses GITHUB_TOKEN, GH_TOKEN then gh credentials; custom APIs never receive them", async () => {
  const executable = await createExecutableFixture();
  roots.push(executable);
  await mkdir(join(executable, "bin"));
  const invocation = join(root, "invocation");
  await writeFile(
    join(executable, "bin", "gh"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${invocation}'\nprintf '%s\\n' gh-token\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${executable}/bin:${saved.PATH}`;
  const headers: string[] = [];
  spyOn(network, "sourceFetch").mockReturnValue(async (_input, init) => {
    headers.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response("missing", { status: 404 });
  });
  const operation = network.createSourceOperation({ source: "credentials" });
  for (const [github, gh, expected] of [
    ["github-token", "gh-env-token", "token github-token"],
    ["", "gh-env-token", "token gh-env-token"],
    [undefined, "gh-env-token", "token gh-env-token"],
    [undefined, "", "token gh-token"],
  ] as const) {
    if (github === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = github;
    process.env.GH_TOKEN = gh;
    const transfer = await GitHubTransfer.create(
      origin,
      new GitObjects(join(root, "objects.git")),
      operation,
    );
    await expect(transfer!.metadata("a".repeat(40))).rejects.toHaveProperty(
      "code",
      "SOURCE_NOT_FOUND",
    );
    expect(headers.at(-1)).toBe(expected);
  }
  expect(await readFile(invocation, "utf8")).toBe("auth token --hostname github.com\n");
  await rm(invocation);
  process.env.GITHUB_TOKEN = "github-sentinel";
  process.env.GH_TOKEN = "gh-sentinel";
  const transfer = await GitHubTransfer.create(
    origin,
    new GitObjects(join(root, "objects.git")),
    operation,
    "http://127.0.0.1:9876",
  );
  await expect(transfer!.metadata("a".repeat(40))).rejects.toHaveProperty(
    "code",
    "SOURCE_NOT_FOUND",
  );
  expect(headers.at(-1)).toBe("");
  expect(await Bun.file(invocation).exists()).toBe(false);
  await writeFile(join(executable, "bin", "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  const anonymous = await GitHubTransfer.create(
    origin,
    new GitObjects(join(root, "objects.git")),
    operation,
  );
  await expect(anonymous!.metadata("a".repeat(40))).rejects.toHaveProperty(
    "code",
    "SOURCE_NOT_FOUND",
  );
  expect(headers.at(-1)).toBe("");
});

test("custom GitHub HTTP APIs never receive environment tokens", async () => {
  const value = await fixture(),
    api = serveRepository(value);
  process.env.GITHUB_TOKEN = "github-sentinel";
  process.env.GH_TOKEN = "gh-sentinel";
  try {
    await discoverSource({ binding, githubApiBaseUrl: api.server.url.toString() });
    expect(api.authorization.length).toBeGreaterThan(2);
    expect(api.authorization.every((value) => value === "")).toBe(true);
  } finally {
    await api.server.stop(true);
  }
});

test.each([
  ["truncated", 200],
  ["server error", 503],
  ["rate exhaustion", 429],
  ["rate-limit forbidden", 403],
])("GitHub falls back for %s without replacing the pinned revision", async (name, status) => {
  const value = await fixture();
  const api = serveRepository(value, (request) =>
    new URL(request.url).pathname.includes("/git/trees/")
      ? status === 200
        ? Response.json({ sha: value.tree, truncated: true, tree: [] })
        : Response.json(
            { message: name === "rate-limit forbidden" ? "rate limit exceeded" : "unavailable" },
            { status },
          )
      : undefined,
  );
  try {
    await withPreparedSkills(
      { binding, githubApiBaseUrl: api.server.url.toString(), transport: () => value.bare },
      [""],
      value.commit,
      async ([skill]) => {
        expect(skill).toMatchObject({ kind: "remote", revision: value.commit });
      },
    );
    // Fallback objects and exact-revision metadata survive; offline reuse needs no API.
    const count = api.requests.length;
    await withPreparedSkills(
      { binding, githubApiBaseUrl: "http://127.0.0.1:1", transport: () => "/missing" },
      [""],
      value.commit,
      async () => {},
    );
    expect(api.requests).toHaveLength(count);
  } finally {
    await api.server.stop(true);
  }
});

test.each([
  [401, "PROVIDER_AUTH_FAILED"],
  [403, "PROVIDER_AUTH_FAILED"],
  [404, "SOURCE_NOT_FOUND"],
] as const)("GitHub never falls back on HTTP %i", async (status, code) => {
  const value = await fixture(),
    api = serveRepository(value, () => Response.json({ message: "secret-token" }, { status }));
  try {
    const error = await discoverSource({
      binding: { ...binding, ref: value.commit },
      githubApiBaseUrl: api.server.url.toString(),
      transport: () => "/missing",
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("secret-token");
  } finally {
    await api.server.stop(true);
  }
});

test.each([
  "commit identity",
  "tree identity",
  "tree bytes",
  "blob identity",
  "blob bytes",
  "JSON",
])("GitHub rejects mismatched %s without fallback", async (failure) => {
  const value = await fixture();
  const api = serveRepository(value, (request) => {
    const path = new URL(request.url).pathname;
    if (failure === "JSON") return new Response("not-json");
    if (failure === "commit identity" && path.includes("/commits/"))
      return Response.json({ sha: "b".repeat(40), commit: { tree: { sha: value.tree } } });
    if (failure === "tree identity" && path.includes("/git/trees/"))
      return Response.json({ sha: "b".repeat(40), tree: [], truncated: false });
    if (failure === "tree bytes" && path.includes("/git/trees/"))
      return Response.json({ sha: value.tree, tree: [], truncated: false });
    if (failure.startsWith("blob") && path.includes("/git/blobs/"))
      return Response.json({
        sha: failure === "blob identity" ? "b".repeat(40) : path.split("/").at(-1),
        content: Buffer.from("wrong").toString("base64"),
        encoding: "base64",
        size: 5,
      });
  });
  try {
    await expect(
      discoverSource({
        binding,
        githubApiBaseUrl: api.server.url.toString(),
        transport: () => "/missing",
      }),
    ).rejects.toHaveProperty("code", "PROVIDER_INTEGRITY_FAILED");
  } finally {
    await api.server.stop(true);
  }
});

test("GitHub fallback releases origin locks and preparation directories on business failure", async () => {
  const value = await fixture(),
    api = serveRepository(value, () => new Response("unavailable", { status: 503 }));
  try {
    let stage = "";
    const context = {
      binding,
      githubApiBaseUrl: api.server.url.toString(),
      transport: () => value.bare,
    };
    await expect(
      withPreparedSkills(context, [""], value.commit, async ([skill]) => {
        stage = skill!.directory;
        throw new Error("business failure");
      }),
    ).rejects.toThrow("business failure");
    expect(await Bun.file(join(stage, "SKILL.md")).exists()).toBe(false);
    expect(await readdir(join(root, "cache", "locks"))).toEqual([]);
    await expect(
      withPreparedSkills(context, ["missing"], value.commit, async () => {}),
    ).rejects.toHaveProperty("code", "SKILL_NOT_FOUND");
    expect(await readdir(join(root, "cache", "locks"))).toEqual([]);
    await withPreparedSkills(context, [""], value.commit, async () => {});
  } finally {
    await api.server.stop(true);
  }
});

test("GitHub request timeout is authoritative and never falls back", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  try {
    await expect(
      withRepository(
        {
          origin,
          kind: "github",
          ref: "main",
          githubApiBaseUrl: server.url.toString(),
          budgetMs: 250,
          transport: () => "/missing",
        },
        async (reader) => reader.revision({ current: true }),
      ),
    ).rejects.toHaveProperty("code", "PROVIDER_TIMEOUT");
  } finally {
    await server.stop(true);
  }
});
