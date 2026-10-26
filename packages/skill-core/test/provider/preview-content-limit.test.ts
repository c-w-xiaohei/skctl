import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRepository } from "../../src/source/service/remote/cache";
import { previewFiles } from "../../src/source/service/preview";
import { textLimit } from "../../src/content/text";
import { repositoryFixture, serveRepository } from "./repository-fixture";

test("bounded GitHub reads reject oversized metadata before requesting a blob and constrain cached bytes", async () => {
  const value = await repositoryFixture({
    "huge.txt": "x".repeat(2_000_000),
    "small.txt": "small\n",
  });
  const cache = await mkdtemp(join(tmpdir(), "skctl-preview-cache-")),
    saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = cache;
  const api = serveRepository(value);
  try {
    await withRepository(
      {
        origin: "https://github.com/acme/skills",
        kind: "github",
        ref: value.commit,
        githubApiBaseUrl: api.server.url.toString(),
      },
      async (reader) => {
        const revision = await reader.revision({ current: true });
        const entries = await revision!.readTree(revision!.version.tree);
        const huge = entries.find((entry) => entry.path === "huge.txt")!,
          small = entries.find((entry) => entry.path === "small.txt")!;
        await expect(revision!.blobs([huge.oid], 1_048_576)).rejects.toMatchObject({
          code: "TEXT_TOO_LARGE",
          byteLength: 2_000_000,
        });
        expect(api.requests.some((path) => path.includes("/blobs/"))).toBe(false);
        expect(
          Buffer.from((await revision!.blobs([small.oid], 100)).get(small.oid)!).toString(),
        ).toBe("small\n");
        const count = api.requests.length;
        await expect(revision!.blobs([small.oid], 0)).rejects.toMatchObject({
          code: "TEXT_TOO_LARGE",
          byteLength: 6,
        });
        expect(api.requests).toHaveLength(count);
        await expect(revision!.blobs([huge.oid, small.oid], 100)).rejects.toHaveProperty(
          "code",
          "TEXT_TOO_LARGE",
        );
        expect(api.requests).toHaveLength(count);
      },
    );
  } finally {
    await api.server.stop(true);
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
    await rm(value.root, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test("preview batches eligible content, refills after oversized files, and never fetches beyond its aggregate budget", async () => {
  const value = await repositoryFixture(
    Object.fromEntries([
      ["SKILL.md", "---\nname: preview\ndescription: Preview\n---\n"],
      ["a-huge.txt", "h".repeat(textLimit + 1)],
      ...Array.from({ length: 6 }, (_, index) => [
        `text-${index}.txt`,
        String(index).repeat(textLimit),
      ]),
    ]),
  );
  const installed = await mkdtemp(join(tmpdir(), "preview-empty-"));
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = join(value.root, "cache");
  const api = serveRepository(value);
  try {
    const result = await withRepository(
      {
        origin: "https://github.com/acme/skills",
        kind: "github",
        ref: "main",
        githubApiBaseUrl: api.server.url.toString(),
      },
      async (repository) => {
        const reader = (await repository.revision({ commit: value.commit }))!;
        return previewFiles(reader, reader.version.tree, "", installed, new Map());
      },
    );
    expect(result.files.find((file) => file.path === "a-huge.txt")!.content).toEqual({
      kind: "unavailable",
      reason: "too-large",
    });
    expect(
      result.files.filter((file) => file.content.kind === "text").map((file) => file.path),
    ).toEqual(["SKILL.md", "text-0.txt", "text-1.txt", "text-2.txt"]);
    const requested = api.requests
      .filter((path) => path.includes("/blobs/"))
      .map((path) => path.split("/blobs/")[1]);
    const allowed = value.entries
      .filter((entry) =>
        ["SKILL.md", "text-0.txt", "text-1.txt", "text-2.txt"].includes(entry.path),
      )
      .map((entry) => entry.sha);
    expect(new Set(requested)).toEqual(new Set(allowed));
    expect(requested).toHaveLength(allowed.length);
  } finally {
    await api.server.stop(true);
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
    await rm(value.root, { recursive: true, force: true });
    await rm(installed, { recursive: true, force: true });
  }
});
