import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSource } from "../../src/source/service";
import { withRepository } from "../../src/source/service/remote/cache";
import { networkFixture } from "./network-fixture";
import { repositoryFixture, serveRepository } from "./repository-fixture";

let root: string, saved: string | undefined;
let roots: string[];
beforeEach(async () => {
  saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  root = await mkdtemp(join(tmpdir(), "skctl-update-acquisition-"));
  roots = [root];
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
});
afterEach(async () => {
  if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
  else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
  for (const path of roots) await rm(path, { recursive: true, force: true });
});
const binding = {
  id: "remote",
  kind: "git" as const,
  origin: "https://example.test/repo.git",
  root: "",
  ref: "refs/heads/main",
  selectors: [],
  provenance: { level: "project" as const },
};

test.each(["git", "github"] as const)(
  "%s compares 120 Roots from one complete metadata acquisition without blobs",
  async (kind) => {
    const paths = Array.from({ length: 120 }, (_, index) => `skill-${index}`);
    const value = await repositoryFixture(
      Object.fromEntries(paths.map((path) => [`${path}/SKILL.md`, `distinct marker: ${path}`])),
    );
    roots.push(value.root);
    const api = serveRepository(value),
      trace = join(root, "git-trace"),
      savedTrace = process.env.GIT_TRACE;
    process.env.GIT_TRACE = trace;
    try {
      expect(
        new Set(paths.map((path) => value.entries.find((entry) => entry.path === path)!.sha)).size,
      ).toBe(120);
      const result = await compareSource(
        {
          binding: {
            ...binding,
            kind,
            origin: kind === "github" ? "https://github.com/acme/skills" : binding.origin,
          },
          githubApiBaseUrl: api.server.url.toString(),
          transport: () => value.bare,
        },
        paths.map((path) => ({
          path,
          digest: "a".repeat(64),
          tree: {
            objectFormat: "sha1",
            objectId: value.entries.find((entry) => entry.path === path)!.sha,
          },
        })),
        { commit: value.commit },
      );
      expect(result).toMatchObject({ changed: [], removed: [], unchanged: paths });
      if (kind === "github") {
        expect(api.requests.filter((path) => path.includes("/trees/"))).toHaveLength(1);
        expect(api.requests.some((path) => path.includes("/blobs/"))).toBe(false);
      } else {
        const commands = await readFile(trace, "utf8");
        expect(
          commands.split("\n").filter((line) => line.includes("built-in: git fetch ")),
        ).toHaveLength(1);
        expect(
          commands
            .split("\n")
            .filter((line) => line.includes("built-in: git fetch "))
            .some((line) => line.includes("--stdin")),
        ).toBe(false);
      }
    } finally {
      if (savedTrace === undefined) delete process.env.GIT_TRACE;
      else process.env.GIT_TRACE = savedTrace;
      await api.server.stop(true);
    }
  },
);

test("metadata transport failure rejects rather than inventing removed paths", async () => {
  await expect(
    compareSource(
      { binding, transport: () => "/unavailable" },
      [
        {
          path: "review",
          digest: "a".repeat(64),
          tree: { objectFormat: "sha1", objectId: "b".repeat(40) },
        },
      ],
      { commit: "a".repeat(40) },
    ),
  ).rejects.toHaveProperty("code", "PROVIDER_UNAVAILABLE");
});

test("short Git refs reject branch/tag ambiguity before fetch; explicit annotated tags resolve to commits", async () => {
  const value = await repositoryFixture();
  roots.push(value.root);
  await value.git("branch", "release");
  await value.git("tag", "-a", "release", "-m", "annotated");
  await value.git("push", value.bare, "refs/heads/release", "refs/tags/release");
  const request = { ...binding, transport: () => value.bare };
  await expect(
    withRepository({ ...request, ref: "release" }, async (reader) =>
      reader.revision({ current: true }),
    ),
  ).rejects.toHaveProperty("code", "PINNED_COMMIT_UNAVAILABLE");
  const key = new Bun.CryptoHasher("sha256").update(binding.origin).digest("hex");
  const packs = join(root, "cache", "origins", key, "objects.git", "objects", "pack");
  expect(await readdir(packs)).toEqual([]);
  await withRepository({ ...request, ref: "refs/tags/release" }, async (reader) => {
    expect((await reader.revision({ current: true }))?.version.commit).toBe(value.commit);
  });
});

test.each([
  [200, true, "PROVIDER_UNAVAILABLE"],
  [401, false, "PROVIDER_AUTH_FAILED"],
] as const)(
  "recursive GitHub failure %i cannot observe an empty Root set",
  async (status, truncated, code) => {
    const value = await repositoryFixture();
    roots.push(value.root);
    const api = serveRepository(value, (request) =>
      new URL(request.url).pathname.includes("/trees/")
        ? status === 200
          ? Response.json({ sha: value.tree, truncated, tree: [] })
          : new Response("bad credentials", { status })
        : undefined,
    );
    try {
      await expect(
        compareSource(
          {
            binding: { ...binding, kind: "github", origin: "https://github.com/acme/skills" },
            githubApiBaseUrl: api.server.url.toString(),
            transport: () => "/unavailable",
          },
          [
            {
              path: "",
              digest: "a".repeat(64),
              tree: { objectFormat: "sha1", objectId: value.tree },
            },
          ],
          { commit: value.commit },
        ),
      ).rejects.toHaveProperty("code", code);
    } finally {
      await api.server.stop(true);
    }
  },
);

test("GitHub failure falls back to a deduplicated Git blob batch with actual pack evidence", async () => {
  const value = await networkFixture();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("unavailable", { status: 503 }),
  });
  try {
    await withRepository(
      {
        origin: "https://github.com/acme/skills",
        kind: "github",
        ref: "main",
        githubApiBaseUrl: server.url.toString(),
        transport: () => value.targetUrl,
      },
      async (reader) => {
        const version = (await reader.revision({ commit: value.commit }))!;
        expect((await version.blobs([value.selectedBlob, value.selectedBlob])).size).toBe(1);
      },
    );
    expect(value.transfers.map((transfer) => transfer.wants)).toEqual([
      [value.commit],
      [value.selectedBlob],
    ]);
    expect(value.transfers[1]!.objects).toEqual([`${value.selectedBlob} blob`]);
    expect(value.transfers[0]!.objects.every((object) => !object.endsWith(" blob"))).toBe(true);
  } finally {
    await server.stop(true);
    await value.close();
  }
});
