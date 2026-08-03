import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGitSource, resolveGitRef } from "../../src/core/internal/source-git";
import { discoverSnapshotSkills } from "../../src/core/internal/sources";

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

test("Generic Git reads an exact pinned commit with spaces and executable modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  await mkdir(work);
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await mkdir(join(work, "skill space"));
  await writeFile(
    join(work, "skill space", "SKILL.md"),
    "---\nname: remote\ndescription: Remote\n---\n",
  );
  await writeFile(join(work, "skill space", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const commit = await git(work, "rev-parse", "HEAD");
  await git(root, "init", "--bare", bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  const snapshot = await openGitSource("remote", bare, commit, "skill space", {
    source: "remote",
    origin: "git",
    declaration: { level: "project" },
    stability: "immutable",
    revision: commit,
  });
  expect(await Array.fromAsync(snapshot.list(""))).toMatchObject([
    { path: "SKILL.md", size: 41 },
    { path: "run.sh", size: 10, executable: true },
  ]);
  expect((await snapshot.read("run.sh")).entry).toMatchObject({ executable: true });
  expect(await resolveGitRef(`git:${bare}#${commit}:skill space`, "main")).toBe(
    `git:${bare}#${commit}:skill space`,
  );
  await snapshot.close();
});

test("Generic Git falls back to advertised refs when direct pinned fetch is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-fallback-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const bin = join(root, "bin");
  await mkdir(work);
  await mkdir(bin);
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "SKILL.md"), "---\nname: fallback\ndescription: Fallback\n---\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const commit = await git(work, "rev-parse", "HEAD");
  await git(root, "init", "--bare", bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  await writeFile(
    join(bin, "git"),
    `#!/bin/bash
if [ "$1" = "-c" ] && [ "$3" = "fetch" ] && printf '%s' "$6" | grep -Eq '^[0-9a-f]{40}$'; then
  exit 1
fi
exec /usr/bin/git "$@"
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    const snapshot = await openGitSource("fallback", bare, commit, "", {
      source: "fallback",
      origin: "git",
      declaration: { level: "project" },
      stability: "immutable",
      revision: commit,
    });
    expect((await Array.fromAsync(snapshot.list(""))).map((entry) => entry.path)).toEqual([
      "SKILL.md",
    ]);
    await snapshot.close();
    expect(await resolveGitRef(`git:${bare}#${commit}`, "main")).toBe(`git:${bare}#${commit}`);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("Generic Git fetches remote Snapshots without eagerly downloading blobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-filter-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const bin = join(root, "bin");
  const log = join(root, "git.log");
  await mkdir(work);
  await mkdir(bin);
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "SKILL.md"), "---\nname: filtered\ndescription: Filtered\n---\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const commit = await git(work, "rev-parse", "HEAD");
  await git(root, "init", "--bare", bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
exec /usr/bin/git "$@"
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    const snapshot = await openGitSource("filtered", bare, commit, "", {
      source: "filtered",
      origin: "git",
      declaration: { level: "project" },
      stability: "immutable",
      revision: commit,
    });
    await snapshot.close();
    expect(await readFile(log, "utf8")).toContain("fetch --no-tags --depth=1 --filter=blob:none");
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git never substitutes a missing pinned commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-missing-"));
  try {
    const bare = join(root, "remote.git");
    await git(root, "init", "--bare", bare);
    await expect(
      openGitSource("missing", bare, "a".repeat(40), "", {
        source: "missing",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: "a".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "PINNED_COMMIT_UNAVAILABLE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git aborts, escalates, and drains a blocked child", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-abort-"));
  const bin = join(root, "bin");
  const ready = join(root, "ready");
  const pid = join(root, "pid");
  await mkdir(bin);
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
if [ "$3" = "init" ]; then
  : > "${ready}"
  printf '%s' "$$" > "${pid}"
  trap '' TERM
  i=0; while [ "$i" -lt 8192 ]; do printf 'blocked stderr %s\\n' "$i" >&2; i=$((i + 1)); done
  while :; do sleep 1; done
fi
exec /usr/bin/git "$@"
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    const controller = new AbortController();
    const pending = openGitSource(
      "blocked",
      "https://invalid.test/blocked.git",
      "a".repeat(40),
      "",
      {
        source: "blocked",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: "a".repeat(40),
      },
      controller.signal,
    );
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
    const started = performance.now();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(performance.now() - started).toBeLessThan(1_500);
    const blockedPid = Number(await readFile(pid, "utf8"));
    expect(() => process.kill(blockedPid, 0)).toThrow();
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git keeps Source-Root-relative paths when filtering a nested Skill Root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-nested-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  await mkdir(join(work, "alpha"), { recursive: true });
  await mkdir(join(work, "nested"), { recursive: true });
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha\n---\n");
  await writeFile(
    join(work, "nested", "SKILL.md"),
    "---\nname: nested\ndescription: Nested\n---\n",
  );
  await writeFile(join(work, "nested", "helper.sh"), "#!/bin/sh\n", { mode: 0o755 });
  await git(work, "add", ".");
  await git(work, "commit", "-m", "nested");
  const commit = await git(work, "rev-parse", "HEAD");
  await git(root, "init", "--bare", bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  const snapshot = await openGitSource("remote", bare, commit, "", {
    source: "remote",
    origin: "git",
    declaration: { level: "project" },
    stability: "immutable",
    revision: commit,
  });
  expect((await Array.fromAsync(snapshot.list("nested"))).map((entry) => entry.path)).toEqual([
    "nested/SKILL.md",
    "nested/helper.sh",
  ]);
  expect((await snapshot.read("nested/helper.sh")).entry).toMatchObject({ executable: true });
  await snapshot.close();
});

test("provider discovery stops below valid and malformed Skill Roots", async () => {
  const entries = [
    { kind: "file" as const, path: "a/SKILL.md", size: 34, executable: false },
    { kind: "file" as const, path: "a/child/SKILL.md", size: 38, executable: false },
    { kind: "file" as const, path: "bad/SKILL.md", size: 3, executable: false },
    { kind: "file" as const, path: "bad/child/SKILL.md", size: 42, executable: false },
    { kind: "file" as const, path: "z/SKILL.md", size: 34, executable: false },
  ];
  const bytes: Record<string, string> = {
    "a/SKILL.md": "---\nname: a\ndescription: A\n---\n",
    "a/child/SKILL.md": "---\nname: hidden\ndescription: Hidden\n---\n",
    "bad/SKILL.md": "bad",
    "bad/child/SKILL.md": "---\nname: hidden2\ndescription: Hidden\n---\n",
    "z/SKILL.md": "---\nname: z\ndescription: Z\n---\n",
  };
  const snapshot = {
    kind: "remote" as const,
    sourceName: "remote",
    commit: "a".repeat(40),
    repositoryRoot: "",
    provenance: {
      source: "remote",
      origin: "git" as const,
      declaration: { level: "project" as const },
      stability: "immutable" as const,
    },
    async *list() {
      yield* entries;
    },
    async read(path: string) {
      const entry = entries.find((item) => item.path === path)!;
      return { entry, bytes: new TextEncoder().encode(bytes[path]!) };
    },
    async close() {},
  };
  const discovered = await discoverSnapshotSkills(snapshot);
  expect(discovered.skills.map((skill) => skill.name)).toEqual(["a", "z"]);
  expect(discovered.diagnostics).toHaveLength(1);
  const rootSnapshot = {
    ...snapshot,
    async *list() {
      yield { kind: "file" as const, path: "SKILL.md", size: 40, executable: false };
      yield { kind: "file" as const, path: "child/SKILL.md", size: 42, executable: false };
    },
    async read(path: string) {
      const text =
        path === "SKILL.md"
          ? "---\nname: root\ndescription: Root\n---\n"
          : "---\nname: child\ndescription: Child\n---\n";
      return {
        entry: { kind: "file" as const, path, size: text.length, executable: false },
        bytes: new TextEncoder().encode(text),
      };
    },
  };
  expect((await discoverSnapshotSkills(rootSnapshot)).skills.map((skill) => skill.name)).toEqual([
    "root",
  ]);
});
