import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSkillCliCore } from "../../src/create-core";

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "update-preview-"));
  const prior = process.env.SKILL_CLI_STATE_DIR;
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  const work = join(root, "work"),
    bare = join(root, "remote.git");
  const skill = join(work, "skills", "review");
  await mkdir(skill, { recursive: true });
  await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: review\ndescription: Review\n---\nOld instructions\n",
  );
  await writeFile(join(skill, "removed.txt"), "Removed\n");
  await writeFile(join(skill, "mode.sh"), "echo stable\n");
  await writeFile(join(skill, "image.bin"), Buffer.from([0, 1, 2]));
  await git(work, "init", "-b", "main");
  await git(work, "config", "user.email", "test@skill-cli.invalid");
  await git(work, "config", "user.name", "Skill CLI");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "installed");
  await git(root, "init", "--bare", bare);
  await git(root, `--git-dir=${bare}`, "config", "uploadpack.allowFilter", "true");
  await git(root, `--git-dir=${bare}`, "config", "uploadpack.allowReachableSHA1InWant", "true");
  await git(work, "remote", "add", "origin", bare);
  await git(work, "push", "origin", "main");
  const core = createSkillCliCore({
    cwd: root,
    userConfigPath: join(root, "user.jsonc"),
    sourceTransport: () => bare,
  });
  await core.configuration.change({
    type: "source.register",
    level: "project",
    id: "team",
    binding: {
      kind: "git",
      origin: "https://example.test/preview.git",
      root: "skills",
      ref: "main",
    },
  });
  await core.management.install({
    source: "team",
    paths: ["review"],
    exactRevision: await git(work, "rev-parse", "HEAD"),
  });
  const commit = async () => {
    await git(work, "add", "-A");
    await git(work, "commit", "-m", "change");
    await git(work, "push", "origin", "main");
  };
  return {
    root,
    work,
    skill,
    core,
    commit,
    dispose: async () => {
      if (prior === undefined) delete process.env.SKILL_CLI_STATE_DIR;
      else process.env.SKILL_CLI_STATE_DIR = prior;
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("preview compares installed bytes to the checked commit, covers every changed file and does not publish", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.skill, "SKILL.md"),
      "---\nname: review\ndescription: Review\n---\nChecked instructions\n",
    );
    await rm(join(f.skill, "removed.txt"));
    await writeFile(join(f.skill, "added.txt"), "Added\n");
    await writeFile(join(f.skill, "empty.txt"), "");
    await writeFile(join(f.skill, "image.bin"), Buffer.from([0, 1, 3]));
    await chmod(join(f.skill, "mode.sh"), 0o755);
    await f.commit();
    const checked = (await f.core.management.checkUpdate({ source: "team" })).value;
    const config = await readFile(join(f.root, "skill-cli.jsonc"));
    const state = await readFile(join(f.root, "state", "state.json"));
    await writeFile(
      join(f.skill, "SKILL.md"),
      "---\nname: review\ndescription: Future\n---\nFuture instructions\n",
    );
    await f.commit();
    const preview = (
      await f.core.management.previewUpdate({
        source: "team",
        path: "review",
        exactRevision: checked.exactRevision,
        expectedBaseline: checked.baseline!,
      })
    ).value;
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") throw new Error("Expected remote comparison");
    expect(preview.targetRevision).toBe(checked.exactRevision!);
    expect(preview.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "added.txt",
      "empty.txt",
      "image.bin",
      "mode.sh",
      "removed.txt",
    ]);
    const marker = preview.files.find((file) => file.path === "SKILL.md")!;
    expect(marker.content).toMatchObject({
      kind: "text",
      before: expect.stringContaining("Old instructions"),
      after: expect.stringContaining("Checked instructions"),
    });
    expect(preview.files.find((file) => file.path === "image.bin")!.content).toEqual({
      kind: "unavailable",
      reason: "binary",
    });
    expect(preview.files.find((file) => file.path === "mode.sh")).toMatchObject({
      status: "modified",
      before: { executable: false },
      after: { executable: true },
    });
    expect(preview.files.find((file) => file.path === "empty.txt")).toMatchObject({
      status: "added",
      content: { kind: "text", before: "", after: "" },
    });
    expect(await readFile(join(f.root, "skill-cli.jsonc"))).toEqual(config);
    expect(await readFile(join(f.root, "state", "state.json"))).toEqual(state);
    expect(
      (await f.core.content.loadInstalled({ address: { source: "team", path: "review" } })).value
        .rawText,
    ).toContain("Old instructions");
    await f.core.management.update({
      source: "team",
      paths: ["review"],
      exactRevision: checked.exactRevision,
      expectedBaseline: checked.baseline,
    });
    await expect(
      f.core.management.previewUpdate({
        source: "team",
        path: "review",
        exactRevision: checked.exactRevision,
        expectedBaseline: checked.baseline!,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
  } finally {
    await f.dispose();
  }
});

test("preview of a removed Root shows deleted installed files, never a fabricated empty comparison", async () => {
  const f = await fixture();
  try {
    await rm(f.skill, { recursive: true });
    await f.commit();
    const checked = (await f.core.management.checkUpdate({ source: "team" })).value;
    const preview = (
      await f.core.management.previewUpdate({
        source: "team",
        path: "review",
        exactRevision: checked.exactRevision,
        expectedBaseline: checked.baseline!,
      })
    ).value;
    expect(preview).toMatchObject({ status: "ready", removed: true });
    if (preview.status === "ready")
      expect(preview.files.every((file) => file.status === "deleted")).toBe(true);
  } finally {
    await f.dispose();
  }
});

test("preview rejects stale baselines, missing exact commits, unsafe addresses and cancellation", async () => {
  const f = await fixture();
  try {
    const checked = (await f.core.management.checkUpdate({ source: "team" })).value;
    const request = {
      source: "team",
      path: "review",
      exactRevision: checked.exactRevision,
      expectedBaseline: checked.baseline!,
    };
    await expect(
      f.core.management.previewUpdate({ ...request, expectedBaseline: "stale" }),
    ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    await expect(
      f.core.management.previewUpdate({ ...request, exactRevision: undefined }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      f.core.management.previewUpdate({ ...request, path: "../review" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      f.core.management.previewUpdate(request, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  } finally {
    await f.dispose();
  }
});

test("local live content is explicitly unavailable rather than compared with itself", async () => {
  const f = await fixture();
  try {
    await f.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./work", root: "skills" },
    });
    await f.core.management.install({ source: "local", paths: ["review"] });
    await writeFile(join(f.skill, "removed.txt"), "Changed in place\n");
    const checked = (await f.core.management.checkUpdate({ source: "local" })).value;
    const state = await readFile(join(f.root, "state", "state.json"));
    expect(
      (
        await f.core.management.previewUpdate({
          source: "local",
          path: "review",
          expectedBaseline: checked.baseline!,
        })
      ).value,
    ).toEqual({
      address: { source: "local", path: "review" },
      status: "unavailable",
      reason: "local-live-content",
    });
    expect(await readFile(join(f.root, "state", "state.json"))).toEqual(state);
  } finally {
    await f.dispose();
  }
});

test("large and aggregate-limited files remain listed without acquiring unbounded text", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.skill, "huge.txt"), "x".repeat(1_048_577));
    for (let i = 0; i < 5; i++)
      await writeFile(join(f.skill, `text-${i}.txt`), "x".repeat(1_048_576));
    await f.commit();
    const checked = (await f.core.management.checkUpdate({ source: "team" })).value;
    const result = (
      await f.core.management.previewUpdate({
        source: "team",
        path: "review",
        exactRevision: checked.exactRevision,
        expectedBaseline: checked.baseline!,
      })
    ).value;
    if (result.status !== "ready") throw new Error("Expected remote preview");
    expect(result.files).toHaveLength(6);
    expect(result.files.find((file) => file.path === "huge.txt")!.content).toEqual({
      kind: "unavailable",
      reason: "too-large",
    });
    expect(result.files.find((file) => file.path === "text-4.txt")!.content).toEqual({
      kind: "unavailable",
      reason: "preview-limit",
    });
    expect(result.files.filter((file) => file.content.kind === "text")).toHaveLength(4);
  } finally {
    await f.dispose();
  }
});
