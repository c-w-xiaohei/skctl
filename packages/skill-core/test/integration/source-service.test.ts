import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "../../src/runtime/process";
import {
  compareSource,
  discoverSource,
  withPreparedSkills,
  type SourceContext,
} from "../../src/source/service";

test("business discovery, comparison and preparation share exact versions without leaking repository lifetime", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/skctl-service-");
  const work = join(root, "work"),
    bare = join(root, "remote.git"),
    trace = join(root, "trace");
  await mkdir(join(work, "library", "guide"), { recursive: true });
  await writeFile(
    join(work, "library", "guide", "SKILL.md"),
    "---\nname: guide\ndescription: A guide\n---\n",
  );
  await writeFile(join(work, "library", "guide", "resource.txt"), "original\n");
  const git = async (...args: string[]) => {
    const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd: work });
    if (result.status) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.test");
  await git("config", "user.name", "Fixture");
  await git("add", ".");
  await git("commit", "-m", "initial");
  await git("clone", "--bare", work, bare);
  await git("--git-dir", bare, "config", "uploadpack.allowFilter", "true");
  await git("--git-dir", bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const savedCache = process.env.SKCTL_SOURCE_CACHE_DIR,
    savedTrace = process.env.GIT_TRACE;
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
  process.env.GIT_TRACE = trace;
  const context: SourceContext = {
    binding: {
      id: "team",
      kind: "git",
      origin: "https://example.test/team.git",
      root: "library",
      ref: "main",
      provenance: { level: "project" },
      selectors: [],
    },
    transport: () => `file://${bare}`,
  };
  try {
    const discovery = await discoverSource(context);
    expect(discovery.candidates).toEqual([
      { path: "guide", name: "guide", description: "A guide" },
    ]);
    expect(discovery.version).toEqual({
      commit: await git("rev-parse", "HEAD"),
      tree: await git("rev-parse", "HEAD^{tree}"),
      observedAt: expect.any(Number),
    });
    let installed!: {
      path: string;
      digest: string;
      tree: { objectFormat: "sha1"; objectId: string };
      revision: string;
    };
    let directory = "";
    await withPreparedSkills(context, ["guide"], discovery.version!.commit, async (prepared) => {
      const skill = prepared[0]!;
      if (skill.kind !== "remote") throw new Error("Expected remote preparation");
      directory = skill.directory;
      expect(await readFile(join(directory, "resource.txt"), "utf8")).toBe("original\n");
      // A nested cache operation proves the publication callback runs after releasing its lock.
      expect(
        (
          await compareSource(context, [
            { path: skill.path, digest: skill.digest, tree: skill.tree },
          ])
        )?.unchanged,
      ).toEqual(["guide"]);
      installed = {
        path: skill.path,
        digest: skill.digest,
        tree: skill.tree!,
        revision: skill.revision!,
      };
    });
    await expect(readFile(join(directory, "SKILL.md"))).rejects.toHaveProperty("code", "ENOENT");
    await writeFile(join(work, "library", "guide", "resource.txt"), "changed resource\n");
    await git("add", ".");
    await git("commit", "-m", "resource only");
    await git("push", bare, "HEAD:main");
    const revision = await git("rev-parse", "HEAD");
    const before = await readFile(trace, "utf8");
    const checked = await compareSource(context, [installed], { commit: revision });
    expect(checked?.changed).toEqual(["guide"]);
    expect(checked?.version).toEqual({
      commit: revision,
      tree: await git("rev-parse", "HEAD^{tree}"),
    });
    const acquired = (await readFile(trace, "utf8")).slice(before.length);
    expect(
      acquired
        .split("\n")
        .filter((line) => /built-in: git fetch /.test(line) && line.includes("--stdin")),
    ).toEqual([]);
    await withPreparedSkills(context, ["guide"], discovery.version!.commit, async (prepared) => {
      expect(await readFile(join(prepared[0]!.directory, "resource.txt"), "utf8")).toBe(
        "original\n",
      );
    });
  } finally {
    if (savedCache === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = savedCache;
    if (savedTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = savedTrace;
  }
});

test("Local source content changes immediately and malformed candidate diagnostics remain visible", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/skctl-local-service-");
  await mkdir(join(root, "guide"));
  await writeFile(join(root, "guide", "SKILL.md"), "broken");
  const context: SourceContext = {
    binding: {
      id: "local",
      kind: "local",
      origin: root,
      root: "",
      provenance: { level: "project" },
      selectors: [],
    },
  };
  const broken = await discoverSource(context);
  expect(broken.candidates).toEqual([]);
  expect(broken.diagnostics[0]?.code).toBe("SKILL_FRONTMATTER_INVALID");
  await writeFile(join(root, "guide", "SKILL.md"), "---\nname: guide\ndescription: A guide\n---\n");
  expect((await discoverSource(context)).candidates).toHaveLength(1);
});
