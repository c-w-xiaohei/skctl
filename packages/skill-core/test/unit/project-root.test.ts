import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProjectRoot } from "../../src/internal/config";
import { SkillCliError } from "../../src/internal/domain";

async function git(cwd: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  await child.exited;
  if (child.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

test("resolves explicit directories and nearest ordinary project config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-root-"));
  const nested = join(root, "project", "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, "project", "skill-cli.jsonc"), "{}");
  expect(await resolveProjectRoot(nested)).toEqual({
    root: join(root, "project"),
    resolution: "nearest-config",
  });
  expect(await resolveProjectRoot(nested, root)).toEqual({ root, resolution: "explicit" });
});

test("rejects symlink project config and reports absent project", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-root-"));
  await writeFile(join(root, "actual.jsonc"), "{}");
  await symlink(join(root, "actual.jsonc"), join(root, "skill-cli.jsonc"));
  await expect(resolveProjectRoot(root)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  await expect(resolveProjectRoot(join(root, "missing"))).rejects.toBeInstanceOf(SkillCliError);
});

test("uses the Git worktree root when no project config exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-root-"));
  const nested = join(root, "nested", "child");
  await mkdir(nested, { recursive: true });
  await git(root, "init");
  await expect(resolveProjectRoot(nested)).resolves.toEqual({ root, resolution: "git-root" });
});

test("prefers the nearest project config over the Git worktree root", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-git-config-"));
  const project = join(root, "project");
  const nested = join(project, "nested");
  await mkdir(nested, { recursive: true });
  await git(root, "init");
  await writeFile(join(project, "skill-cli.jsonc"), "{}");
  await expect(resolveProjectRoot(nested)).resolves.toEqual({
    root: project,
    resolution: "nearest-config",
  });
});

test("returns PROJECT_NOT_FOUND outside a Git worktree without a config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-no-project-"));
  await expect(resolveProjectRoot(root)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
});
