import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRepository } from "../../src/source/service/remote/cache";
import { GitTransfer } from "../../src/source/service/remote/git";
import { GitObjects } from "../../src/source/service/remote/objects";
import { createSourceOperation } from "../../src/source/service/remote/network";
import { skillTree, sourceTree } from "../../src/source/service/skills";
import { runProcess } from "../../src/runtime/process";
import { createExecutableFixture } from "../executable-fixture";
import { repositoryFixture, serveRepository } from "./repository-fixture";

let root: string, saved: string | undefined;
const roots: string[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skctl-acquisition-"));
  saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
});
afterEach(async () => {
  if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
  else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
  for (const path of [root, ...roots.splice(0)]) await rm(path, { recursive: true, force: true });
});
const request = {
  origin: "https://example.test/acquisition.git",
  kind: "git" as const,
  ref: "main",
};

test("exact tree inspection is literal, scoped and cached; inspecting an old revision cannot repin content", async () => {
  const value = await repositoryFixture({
    "SKILL.md": "outside boundary",
    "source/literal [*]: root/SKILL.md": "old",
    "source/shadow/SKILL.md": "malformed ancestor",
    "source/shadow/child/SKILL.md": "child",
    "unrelated/unsafe": "not requested",
  });
  roots.push(value.root);
  const oldTree = await value.git("rev-parse", "HEAD:source/literal [*]: root");
  await writeFile(join(value.work, "source", "literal [*]: root", "SKILL.md"), "new");
  await value.git("add", ".");
  await value.git("commit", "-m", "new");
  const current = await value.git("rev-parse", "HEAD"),
    tree = await value.git("rev-parse", "HEAD:source/literal [*]: root");
  const marker = await value.git("rev-parse", "HEAD:source/literal [*]: root/SKILL.md");
  await value.git("push", value.bare, "HEAD:main");
  await withRepository({ ...request, transport: () => value.bare }, async (reader) => {
    const version = await reader.revision({ commit: current });
    const boundary = await sourceTree(version!, "source");
    expect(
      await Promise.all(
        ["literal [*]: root", "shadow/child", "missing", ""].map((path) =>
          skillTree(version!, boundary, path),
        ),
      ),
    ).toEqual([tree, undefined, undefined, undefined]);
    const old = await reader.revision({ commit: value.commit });
    const oldBoundary = await sourceTree(old!, "source");
    expect(await skillTree(old!, oldBoundary, "literal [*]: root")).toBe(oldTree);
    expect(await skillTree(old!, oldBoundary, "literal [*]: root")).toBe(oldTree);
    expect(Buffer.from((await version!.blobs([marker])).get(marker)!).toString()).toBe("new");
    expect((await reader.revision({ commit: current }))?.version.commit).toBe(current);
  });
});

test("one ref advertisement acquires no content and peeled annotated tags win", async () => {
  const executable = await createExecutableFixture(),
    previous = process.env.PATH;
  roots.push(executable);
  const log = join(root, "commands"),
    commit = "b".repeat(40);
  await mkdir(join(executable, "bin"));
  await writeFile(
    join(executable, "bin", "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase " $* " in
*' ls-remote '*) printf '%s\\trefs/tags/release\\n%s\\trefs/tags/release^{}\\n' '${"a".repeat(40)}' '${commit}';;
*) exit 1;; esac\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${executable}/bin:${previous}`;
  const operation = createSourceOperation({ source: "ref" });
  try {
    const transfer = new GitTransfer(
      request.origin,
      new GitObjects(join(root, "objects.git")),
      operation,
    );
    expect(await transfer.resolve("release")).toBe(commit);
    const commands = await readFile(log, "utf8");
    expect(commands.match(/ls-remote/g)).toHaveLength(1);
    expect(commands).not.toContain(" fetch ");
  } finally {
    process.env.PATH = previous;
  }
});

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.3"))(
  "GitHub explicit proxy reaches the actual HTTP client",
  async () => {
    const value = await repositoryFixture();
    roots.push(value.root);
    const api = serveRepository(value);
    try {
      await withRepository(
        {
          origin: "https://github.com/acme/skills",
          kind: "github",
          ref: value.commit,
          githubApiBaseUrl: "http://unresolvable.invalid",
          proxy: api.server.url.toString(),
          budgetMs: 1000,
        },
        async (reader) => {
          expect((await reader.revision({ commit: value.commit }))?.version.tree).toBe(value.tree);
        },
      );
      expect(api.requests).toHaveLength(2);
    } finally {
      await api.server.stop(true);
    }
  },
);

test("GitHub timeout never falls back or renews the operation budget", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  try {
    await expect(
      withRepository(
        {
          origin: "https://github.com/acme/skills",
          kind: "github",
          ref: "main",
          githubApiBaseUrl: server.url.toString(),
          budgetMs: 30,
          transport: () => "/nonexistent-fallback",
        },
        async (reader) => reader.revision({ current: true }),
      ),
    ).rejects.toHaveProperty("code", "PROVIDER_TIMEOUT");
  } finally {
    await server.stop(true);
  }
});

test("owned process-group escalation continues after leader exit while its descendant holds pipes", async () => {
  const controller = new AbortController(),
    pidFile = join(root, "pid"),
    ready = join(root, "ready");
  const pending = runProcess({
    cmd: [
      "/bin/sh",
      "-c",
      `trap 'exit 0' TERM; /bin/sh -c 'trap "" TERM; echo $$ > "${pidFile}"; : > "${ready}"; while :; do sleep 1; done' & wait`,
    ],
    signal: controller.signal,
  });
  try {
    for (let attempt = 0; attempt < 100 && !(await Bun.file(ready).exists()); attempt++)
      await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    const started = performance.now();
    controller.abort();
    await expect(pending).rejects.toHaveProperty("code", "CANCELLED");
    expect(performance.now() - started).toBeLessThan(1500);
    const pid = Number(await readFile(pidFile, "utf8"));
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
    expect(!stat || /^\d+ \(.*\) Z /u.test(stat)).toBe(true);
  } finally {
    controller.abort();
    await pending.catch(() => {});
  }
});

test("GitHub tree inspection shares cached revision trees without sibling blob requests", async () => {
  const value = await repositoryFixture({
    "SKILL.md": "outside boundary",
    "source/literal [*]: root/SKILL.md": "marker",
    "source/unrelated/file": "unread",
  });
  roots.push(value.root);
  const old = "1".repeat(40);
  const api = serveRepository(value, (request) =>
    new URL(request.url).pathname.endsWith(`/commits/${old}`)
      ? Response.json({ sha: old, commit: { tree: { sha: value.tree } } })
      : undefined,
  );
  try {
    await withRepository(
      {
        origin: "https://github.com/acme/skills",
        kind: "github",
        ref: "main",
        githubApiBaseUrl: api.server.url.toString(),
      },
      async (reader) => {
        const current = await reader.revision({ commit: value.commit });
        const boundary = await sourceTree(current!, "source");
        expect(await skillTree(current!, boundary, "literal [*]: root")).toBe(
          await value.git("rev-parse", "HEAD:source/literal [*]: root"),
        );
        expect(await skillTree(current!, boundary, "missing")).toBeUndefined();
        const previous = await reader.revision({ commit: old });
        expect(previous!.version.tree).toBe(current!.version.tree);
        const before = api.requests.slice();
        await reader.revision({ commit: old });
        expect(api.requests).toEqual(before);
        expect(api.requests.filter((path) => path.includes("/git/trees/"))).toHaveLength(1);
        expect(api.requests.some((path) => path.includes("/git/blobs/"))).toBe(false);
      },
    );
  } finally {
    await api.server.stop(true);
  }
});
