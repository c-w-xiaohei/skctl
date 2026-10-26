import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSource } from "../../src/source/service";
import { runProcess } from "../../src/runtime/process";

test("comparison uses complete trees without marker parsing; incomplete facts cannot become removals", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-comparison-")),
    work = join(root, "work"),
    bare = join(root, "remote.git");
  const saved = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
  const git = async (...args: string[]) => {
    const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd: work });
    if (result.status) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  try {
    const paths = ["same", "changed", "removed", "group/shadowed"];
    for (const path of paths) {
      await mkdir(join(work, path), { recursive: true });
      await writeFile(join(work, path, "SKILL.md"), "malformed marker, not needed for comparison");
    }
    await git("init", "-b", "main");
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "test@example.test");
    await git("add", ".");
    await git("commit", "-m", "before");
    const installed = [];
    for (const path of paths)
      installed.push({
        path,
        tree: { objectFormat: "sha1" as const, objectId: await git("rev-parse", `HEAD:${path}`) },
      });
    await writeFile(join(work, "changed", "resource.txt"), "resource-only change");
    await rm(join(work, "removed"), { recursive: true });
    await writeFile(join(work, "group", "SKILL.md"), "ancestor marker");
    await git("add", "-A");
    await git("commit", "-m", "after");
    const revision = await git("rev-parse", "HEAD");
    await git("clone", "--bare", work, bare);
    await git("--git-dir", bare, "config", "uploadpack.allowFilter", "true");
    await git("--git-dir", bare, "config", "uploadpack.allowAnySHA1InWant", "true");
    const context = {
      binding: {
        id: "remote",
        kind: "git" as const,
        origin: "https://example.test/comparison.git",
        root: "",
        ref: "main",
        selectors: [],
        provenance: { level: "project" as const },
      },
      transport: () => bare,
    };
    const result = await compareSource(context, installed, { commit: revision });
    expect(result).toMatchObject({
      unchanged: ["same"],
      changed: ["changed"],
      removed: ["removed", "group/shadowed"],
    });
    const key = new Bun.CryptoHasher("sha256").update(context.binding.origin).digest("hex");
    expect(
      await git(
        `--git-dir=${join(root, "cache", "origins", key, "objects.git")}`,
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objecttype)",
      ),
    ).not.toContain("blob");
    await expect(
      compareSource(context, [{ path: "same" }], { commit: revision }),
    ).rejects.toHaveProperty("code", "PINNED_COMMIT_UNAVAILABLE");
    await expect(
      compareSource(context, installed, { commit: "f".repeat(40) }),
    ).rejects.toHaveProperty("code", "PINNED_COMMIT_UNAVAILABLE");
  } finally {
    if (saved === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = saved;
    await rm(root, { recursive: true, force: true });
  }
});
