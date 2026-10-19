import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGitSource, resolveGitRef } from "../../src/source/git";
import { discoverSnapshotSkills, openSource, type RemoteSnapshot } from "../../src/source/snapshot";
import { createExecutableFixture } from "../executable-fixture";

// Recognize invocation-level config without weakening the shim's intended failure.
const identifyGitCommand = `identify() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -c) shift 2 ;;
      --git-dir=*) shift ;;
      *) command="$1"; option="\${2:-}"; return ;;
    esac
  done
}
identify "$@"`;

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

async function initBare(cwd: string, path: string) {
  await git(cwd, "init", "--bare", path);
  await git(cwd, `--git-dir=${path}`, "config", "uploadpack.allowFilter", "true");
  await git(cwd, `--git-dir=${path}`, "config", "uploadpack.allowReachableSHA1InWant", "true");
}

test("Generic Git reads an exact pinned commit with spaces and executable modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-"));
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
  await initBare(root, bare);
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
    { path: "SKILL.md", size: 0 },
    { path: "run.sh", size: 0, executable: true },
  ]);
  expect((await snapshot.read("run.sh")).entry).toMatchObject({ executable: true });
  expect(await resolveGitRef(`git:${bare}#${commit}:skill space`, "main")).toBe(
    `git:${bare}#${commit}:skill space`,
  );
  await snapshot.close();
});

test("Generic Git never broadens a rejected exact fetch to all advertised refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-fallback-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  await mkdir(work);
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "SKILL.md"), "---\nname: fallback\ndescription: Fallback\n---\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const commit = await git(work, "rev-parse", "HEAD");
  await initBare(root, bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  const previousPath = process.env.PATH;
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/bash
${identifyGitCommand}
printf '%s\\n' "$*" >> "${root}/commands"
if [ "$command" = "fetch" ]; then
  exit 1
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${previousPath}`;
    await expect(
      openGitSource("fallback", bare, commit, "", {
        source: "fallback",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const commands = await readFile(join(root, "commands"), "utf8");
    expect(commands.match(/ fetch /gu)).toHaveLength(1);
    expect(commands).not.toContain("refs/heads/*");
    expect(await resolveGitRef(`git:${bare}#${commit}`, "main")).toBe(`git:${bare}#${commit}`);
  } finally {
    process.env.PATH = previousPath;
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git fetches remote Snapshots without eagerly downloading blobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-filter-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const log = join(root, "git.log");
  await mkdir(work);
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(join(work, "SKILL.md"), "---\nname: filtered\ndescription: Filtered\n---\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const commit = await git(work, "rev-parse", "HEAD");
  await initBare(root, bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  const previousPath = process.env.PATH;
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${previousPath}`;
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
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicit git Source binding uses Git transport for a GitHub-shaped origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-kind-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  try {
    await mkdir(work);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "SKILL.md"), "---\nname: generic\ndescription: Generic\n---\n");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const snapshot = await openSource(
      "generic",
      {
        origin: "git",
        kind: "git",
        url: "https://github.com/acme/skills",
        commit,
        path: "",
      },
      {
        source: "generic",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      },
      undefined,
      () => bare,
      "http://127.0.0.1:1",
    );
    expect((await discoverSnapshotSkills(snapshot)).skills.map((skill) => skill.name)).toEqual([
      "generic",
    ]);
    await snapshot.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git batches candidate SKILL.md acquisition without fetching unselected resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-batch-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const log = join(root, "git.log");
  const wants = join(root, "wants.log");
  await mkdir(join(work, "chosen"), { recursive: true });
  await mkdir(join(work, "other"), { recursive: true });
  await git(work, "init");
  await git(work, "config", "user.email", "test@example.test");
  await git(work, "config", "user.name", "Test");
  await writeFile(
    join(work, "chosen", "SKILL.md"),
    "---\nname: chosen\ndescription: Chosen\n---\n",
  );
  await writeFile(join(work, "chosen", "helper.txt"), "chosen helper\n");
  await writeFile(join(work, "other", "SKILL.md"), "---\nname: other\ndescription: Other\n---\n");
  await writeFile(join(work, "other", "unselected.txt"), "must not be fetched\n");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "initial");
  const commit = await git(work, "rev-parse", "HEAD");
  const chosen = await git(work, "rev-parse", "HEAD:chosen/SKILL.md");
  const unselected = await git(work, "rev-parse", "HEAD:other/unselected.txt");
  await initBare(root, bare);
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "HEAD:main");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  const previousPath = process.env.PATH;
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
${identifyGitCommand}
if [ "$command" = "fetch" ] && printf '%s\\n' "$@" | grep -qx -- '--stdin'; then
  input=$(cat)
  printf '%s' "$input" > "${wants}"
  printf '%s\\n' "$input" | /usr/bin/git "$@"
  exit $?
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${previousPath}`;
    const snapshot = await openGitSource("batched", bare, commit, "", {
      source: "batched",
      origin: "git",
      declaration: { level: "project" },
      stability: "immutable",
      revision: commit,
    });
    expect((await discoverSnapshotSkills(snapshot)).skills.map((skill) => skill.name)).toEqual([
      "chosen",
      "other",
    ]);
    expect((await Array.fromAsync(snapshot.list("chosen"))).map((entry) => entry.path)).toEqual([
      "chosen/SKILL.md",
      "chosen/helper.txt",
    ]);
    await snapshot.close();
    const commands = await readFile(log, "utf8");
    expect(commands).not.toContain("cat-file -s");
    expect(
      commands.split("\n").filter((line) => line.includes(" fetch ") && line.includes(" --stdin ")),
    ).toHaveLength(1);
    expect(commands).not.toContain("fetch-pack");
    expect(commands).not.toContain("unselected.txt");
    const requested = await readFile(wants, "utf8");
    expect(requested).toContain(chosen);
    expect(requested).not.toContain(unselected);
  } finally {
    process.env.PATH = previousPath;
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git rejects a remote that ignores blob filtering", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-no-filter-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  try {
    await mkdir(work);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "SKILL.md"), "---\nname: ignored\ndescription: Ignored\n---\n");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await git(root, "init", "--bare", bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await expect(
      openGitSource("ignored", bare, commit, "", {
        source: "ignored",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git serializes concurrent reads and lets close wait for them", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-concurrent-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  try {
    await mkdir(work);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await writeFile(join(work, "two.txt"), "two");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const snapshot = await openGitSource("concurrent", bare, commit, "", {
      source: "concurrent",
      origin: "git",
      declaration: { level: "project" },
      stability: "immutable",
      revision: commit,
    });
    const [one, two] = await Promise.all([
      snapshot.read("one.txt"),
      snapshot.read("two.txt"),
      snapshot.close(),
    ]);
    expect(new TextDecoder().decode(one.bytes)).toBe("one");
    expect(new TextDecoder().decode(two.bytes)).toBe("two");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git sanitizes post-open provider failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-sanitize-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  try {
    await mkdir(work);
    await mkdir(bin);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "cat-file" ] && [ "$option" = "--batch" ]; then
  printf 'token=private-secret' >&2
  exit 1
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const snapshot = await openGitSource("sanitize", bare, commit, "", {
        source: "sanitize",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      });
      const error = await snapshot.read("one.txt").catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(String(error)).not.toContain("private-secret");
      await snapshot.close();
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git reports an unreachable pinned source as unavailable without stderr", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-transport-"));
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "fetch" ]; then
  printf 'token=transport-secret' >&2
  exit 1
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const error = await openGitSource(
        "transport",
        "https://invalid.test/skills.git",
        "a".repeat(40),
        "",
        {
          source: "transport",
          origin: "git",
          declaration: { level: "project" },
          stability: "immutable",
          revision: "a".repeat(40),
        },
      ).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(String(error)).not.toContain("transport-secret");
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git reports authentication failures without exposing stderr", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-auth-"));
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  const invocation = join(root, "auth-invocation");
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  try {
    await mkdir(bin);
    await mkdir(work);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "fetch" ]; then
  : > "${invocation}"
  printf 'authentication failed: token=auth-secret' >&2
  exit 1
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const error = await openGitSource("auth", bare, commit, "", {
        source: "auth",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      }).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "PROVIDER_AUTH_FAILED" });
      expect(await Bun.file(invocation).exists()).toBe(true);
      expect(String(error)).not.toContain("auth-secret");
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git reads symlink blob bytes without treating it as an installable file", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-symlink-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  try {
    await mkdir(work);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "target.txt"), "target");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "target");
    await git(work, "checkout", "-b", "main");
    await git(work, "symbolic-ref", "HEAD", "refs/heads/main");
    await Bun.write(join(work, "link"), "target.txt");
    await git(
      work,
      "update-index",
      "--add",
      "--cacheinfo",
      "120000",
      await git(work, "hash-object", "-w", "link"),
      "link",
    );
    await git(work, "commit", "-m", "link");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const snapshot = await openGitSource("symlink", bare, commit, "", {
      source: "symlink",
      origin: "git",
      declaration: { level: "project" },
      stability: "immutable",
      revision: commit,
    });
    const content = await snapshot.read("link");
    expect(content.entry.kind).toBe("symlink");
    expect(new TextDecoder().decode(content.bytes)).toBe("target.txt");
    await snapshot.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git rejects malformed cat-file batch separators", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-batch-malformed-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  try {
    await mkdir(work);
    await mkdir(bin);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "cat-file" ] && [ "$option" = "--batch" ]; then
  oid=$(cat)
  printf '%s blob 3\\noneX' "$oid"
  exit 0
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const snapshot = await openGitSource("malformed", bare, commit, "", {
        source: "malformed",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      });
      await expect(snapshot.read("one.txt")).rejects.toMatchObject({
        code: "PROVIDER_INTEGRITY_FAILED",
      });
      await snapshot.close();
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git rejects cat-file batch headers with extra fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-batch-header-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  try {
    await mkdir(work);
    await mkdir(bin);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "cat-file" ] && [ "$option" = "--batch" ]; then
  oid=$(cat)
  printf '%s blob 3 extra\\none\\n' "$oid"
  exit 0
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const snapshot = await openGitSource("header", bare, commit, "", {
        source: "header",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      });
      await expect(snapshot.read("one.txt")).rejects.toMatchObject({
        code: "PROVIDER_INTEGRITY_FAILED",
      });
      await snapshot.close();
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git rejects non-decimal cat-file batch sizes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-batch-size-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  try {
    await mkdir(work);
    await mkdir(bin);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "cat-file" ] && [ "$option" = "--batch" ]; then
  oid=$(cat)
  printf '%s blob 0x3\\none\\n' "$oid"
  exit 0
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const snapshot = await openGitSource("size", bare, commit, "", {
        source: "size",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      });
      await expect(snapshot.read("one.txt")).rejects.toMatchObject({
        code: "PROVIDER_INTEGRITY_FAILED",
      });
      await snapshot.close();
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git rejects trailing cat-file batch bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-batch-trailing-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  try {
    await mkdir(work);
    await mkdir(bin);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "one.txt"), "one");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "cat-file" ] && [ "$option" = "--batch" ]; then
  oid=$(cat)
  printf '%s blob 3\\none\\ntrailing' "$oid"
  exit 0
fi
exec /usr/bin/git "$@"
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const snapshot = await openGitSource("trailing", bare, commit, "", {
        source: "trailing",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      });
      await expect(snapshot.read("one.txt")).rejects.toMatchObject({
        code: "PROVIDER_INTEGRITY_FAILED",
      });
      await snapshot.close();
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git leaves an empty batch entirely idle", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-empty-batch-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  const log = join(root, "git.log");
  try {
    await mkdir(work);
    await mkdir(bin);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "SKILL.md"), "---\nname: empty\ndescription: Empty\n---\n");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const commit = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
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
      const snapshot = await openGitSource("empty", bare, commit, "", {
        source: "empty",
        origin: "git",
        declaration: { level: "project" },
        stability: "immutable",
        revision: commit,
      });
      const before = await readFile(log, "utf8");
      expect(await snapshot.readMany?.([])).toEqual([]);
      expect(await readFile(log, "utf8")).toBe(before);
      await snapshot.close();
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git never substitutes a missing pinned commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-missing-"));
  const work = join(root, "work");
  try {
    const bare = join(root, "remote.git");
    await mkdir(work);
    await git(work, "init");
    await git(work, "config", "user.email", "test@example.test");
    await git(work, "config", "user.name", "Test");
    await writeFile(join(work, "present.txt"), "present");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "present");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
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
  const root = await mkdtemp(join(tmpdir(), "skctl-git-abort-"));
  const shimRoot = await createExecutableFixture();
  const bin = join(shimRoot, "bin");
  const ready = join(root, "ready");
  const pid = join(root, "pid");
  const previousPath = process.env.PATH;
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh
${identifyGitCommand}
if [ "$command" = "init" ]; then
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
    process.env.PATH = `${bin}:${previousPath}`;
    pending = openGitSource(
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
    controller.abort();
    await pending?.catch(() => {});
    await rm(shimRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("Generic Git keeps Source-Root-relative paths when filtering a nested Skill Root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-git-nested-"));
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
  await initBare(root, bare);
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
  const snapshot: RemoteSnapshot = {
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
    async readMany(paths: readonly string[]) {
      return Promise.all(paths.map((path) => this.read(path)));
    },
    async close() {},
    async inspectRoots() {
      throw new Error("Discovery must not inspect installed Roots");
    },
    async inspectRevisions() {
      throw new Error("Discovery must not inspect old revisions");
    },
  };
  const discovered = await discoverSnapshotSkills(snapshot);
  expect(discovered.skills.map((skill) => skill.name)).toEqual(["a", "z"]);
  expect(discovered.diagnostics).toHaveLength(1);
  const rootSnapshot: RemoteSnapshot = {
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

  const readManyPaths: string[][] = [];
  const nestedSnapshot = {
    ...snapshot,
    async *list() {
      yield { kind: "file" as const, path: "parent/SKILL.md", size: 40, executable: false };
      yield {
        kind: "file" as const,
        path: "parent/child/SKILL.md",
        size: 42,
        executable: false,
      };
      yield { kind: "file" as const, path: "other/SKILL.md", size: 42, executable: false };
    },
    async readMany(paths: readonly string[]) {
      readManyPaths.push([...paths]);
      return paths.map((path) => ({
        entry: { kind: "file" as const, path, size: 42, executable: false },
        bytes: new TextEncoder().encode(
          `---\nname: ${path === "parent/SKILL.md" ? "parent" : "other"}\ndescription: Skill\n---\n`,
        ),
      }));
    },
  };
  expect((await discoverSnapshotSkills(nestedSnapshot)).skills.map((skill) => skill.name)).toEqual([
    "other",
    "parent",
  ]);
  expect(readManyPaths).toEqual([["other/SKILL.md", "parent/SKILL.md"]]);
});
