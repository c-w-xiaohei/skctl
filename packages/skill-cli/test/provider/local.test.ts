import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as localModule from "../../src/core/internal/source-local";
import { openLocalSource } from "../../src/core/internal/source-local";

test("Local snapshots expose deterministic entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-local-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "SKILL.md"), "---\nname: local\ndescription: Local\n---\n");
  await writeFile(join(root, "nested", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  await symlink("nested/run.sh", join(root, "link"));
  const local = await openLocalSource("local", root, {
    source: "local",
    origin: "local",
    declaration: { level: "project" },
    stability: "mutable-local",
  });
  expect((await Array.fromAsync(local.list(""))).map((entry) => [entry.kind, entry.path])).toEqual([
    ["file", "SKILL.md"],
    ["symlink", "link"],
    ["directory", "nested"],
    ["file", "nested/run.sh"],
  ]);
  expect("openNativeSource" in localModule).toBe(false);
  expect(new TextDecoder().decode((await local.read("link")).bytes)).toBe("#!/bin/sh\n");
  await local.close();
});

test("Local snapshots expose initialized submodule files, retain uninitialized gitlink directories, and never invoke Git", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "skill-cli-submodule-"));
  const nested = join(fixture, "nested-repository");
  const parent = join(fixture, "parent-repository");
  const initialized = join(fixture, "initialized-parent");
  const uninitialized = join(fixture, "uninitialized-parent");
  const provenance = {
    source: "local",
    origin: "local" as const,
    declaration: { level: "project" as const },
    stability: "mutable-local" as const,
  };
  const git = async (args: string[], cwd?: string) => {
    const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (await child.exited) throw new Error(await new Response(child.stderr).text());
  };

  try {
    await git(["init", nested]);
    await git(["config", "user.email", "test@skill-cli.invalid"], nested);
    await git(["config", "user.name", "skill-cli test"], nested);
    await writeFile(join(nested, "SKILL.md"), "---\nname: nested\ndescription: Nested\n---\n");
    await writeFile(join(nested, "helper.txt"), "present on host\n");
    await git(["add", "."], nested);
    await git(["commit", "-m", "nested skill"], nested);

    await git(["init", parent]);
    await git(["config", "user.email", "test@skill-cli.invalid"], parent);
    await git(["config", "user.name", "skill-cli test"], parent);
    await mkdir(join(parent, "source"));
    await git(
      ["-c", "protocol.file.allow=always", "submodule", "add", nested, "source/nested"],
      parent,
    );
    await git(["commit", "-am", "parent submodule"], parent);

    await git(["clone", parent, initialized]);
    await git(["-c", "protocol.file.allow=always", "submodule", "update", "--init"], initialized);
    await git(["clone", parent, uninitialized]);
    expect((await lstat(join(uninitialized, "source", "nested"))).isDirectory()).toBe(true);
    await symlink("nested", join(initialized, "source", "linked-nested"));
    await symlink("missing.txt", join(initialized, "source", "dangling.txt"));

    const sentinel = join(fixture, "git-sentinel");
    await mkdir(sentinel);
    await writeFile(join(sentinel, "git"), "#!/bin/sh\nexit 97\n", { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = sentinel;
    try {
      const initializedSnapshot = await openLocalSource(
        "local",
        join(initialized, "source"),
        provenance,
      );
      const uninitializedSnapshot = await openLocalSource(
        "local",
        join(uninitialized, "source"),
        provenance,
      );
      expect(
        (await Array.fromAsync(initializedSnapshot.list(""))).map((entry) => entry.path),
      ).toEqual([
        "dangling.txt",
        "linked-nested",
        "nested",
        "nested/.git",
        "nested/SKILL.md",
        "nested/helper.txt",
      ]);
      expect(
        new TextDecoder().decode((await initializedSnapshot.read("nested/helper.txt")).bytes),
      ).toBe("present on host\n");
      await expect(initializedSnapshot.read("dangling.txt")).rejects.toMatchObject({
        code: "RESOURCE_NOT_FOUND",
      });
      expect(
        (await Array.fromAsync(uninitializedSnapshot.list(""))).map((entry) => [
          entry.kind,
          entry.path,
        ]),
      ).toEqual([["directory", "nested"]]);
      await initializedSnapshot.close();
      await uninitializedSnapshot.close();
    } finally {
      process.env.PATH = originalPath;
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
