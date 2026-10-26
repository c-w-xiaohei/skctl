import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { discoverSkills } from "../../src/source/discover";
import { installSkills } from "../../src/installed/install";
import { loadInstalledSkill } from "../../src/content/operations";
import { StateCoordinator } from "../../src/storage/state";
import { runProcess } from "../../src/runtime/process";
import { checkUpdate, previewUpdate, updateSkills } from "../../src/installed/update";

test("actual install uses shared acquisition, publishes complete immutable content and remains offline after remote collection", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/skctl-installation-");
  const work = join(root, "work"),
    bare = join(root, "remote.git"),
    project = join(root, "project"),
    global = join(root, "global.jsonc");
  await mkdir(join(work, "guide"), { recursive: true });
  await mkdir(project);
  await writeFile(global, "{}");
  await writeFile(
    join(project, "skctl.jsonc"),
    JSON.stringify({
      sources: {
        team: { kind: "git", origin: "https://example.test/installed.git", root: "", ref: "main" },
      },
    }),
  );
  await writeFile(
    join(work, "guide", "SKILL.md"),
    "---\nname: guide\ndescription: A guide\n---\nOffline body\n",
  );
  await writeFile(join(work, "guide", "resource.txt"), "complete content");
  const git = async (...args: string[]) => {
    const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd: work });
    if (result.status) throw Error(result.stderr.toString());
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "test@example.test");
  await git("add", ".");
  await git("commit", "-m", "first");
  await git("clone", "--bare", work, bare);
  await git("--git-dir", bare, "config", "uploadpack.allowFilter", "true");
  await git("--git-dir", bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const savedState = process.env.SKCTL_STATE_DIR,
    savedCache = process.env.SKCTL_SOURCE_CACHE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
  const options = { cwd: project, userConfigPath: global, sourceTransport: () => `file://${bare}` };
  try {
    const discovery = await discoverSkills(options, { source: "team" });
    const source = resolve("packages/skill-core/src/installed/install.ts");
    const script = `import {installSkills} from ${JSON.stringify(source)};await installSkills({...${JSON.stringify({ cwd: project, userConfigPath: global })},sourceTransport:()=>${JSON.stringify(`file://${bare}`)}},{source:'team',paths:['guide'],exactRevision:${JSON.stringify(discovery.value.exactRevision)}});`;
    const child = await runProcess({ cmd: [process.execPath, "-e", script] });
    expect(child.status).toBe(0);
    const coordinator = new StateCoordinator();
    const state = await coordinator.withLock(() => coordinator.read());
    expect(state).toMatchObject({
      version: 4,
      generation: 1,
      installed: [
        { source: "team", path: "guide", kind: "remote", treeIdentity: { objectFormat: "sha1" } },
      ],
    });
    const installed = state.installed[0]!;
    if (installed.kind !== "remote") throw new Error("Expected remote installation");
    const snapshot = await coordinator.snapshotRoot(installed.snapshotId);
    expect(await readFile(join(snapshot, "resource.txt"), "utf8")).toBe("complete content");
    // A fixed-version reinstall works with an unavailable origin and no ref lookup.
    await installSkills(
      { ...options, sourceTransport: () => "file:///unavailable" },
      { source: "team", paths: ["guide"], exactRevision: discovery.value.exactRevision },
    );
    const checked = await checkUpdate(options, { source: "team" });
    expect(checked.value.unchanged).toHaveLength(1);
    await writeFile(join(work, "guide", "resource.txt"), "updated content");
    await git("add", ".");
    await git("commit", "-m", "resource only");
    await git("push", bare, "HEAD:main");
    const revision = (
      await runProcess({ cmd: ["/usr/bin/git", "rev-parse", "HEAD"], cwd: work })
    ).stdout
      .toString()
      .trim();
    const preview = await previewUpdate(options, {
      source: "team",
      path: "guide",
      exactRevision: revision,
      expectedBaseline: checked.value.baseline,
    });
    expect(preview.value).toMatchObject({
      status: "ready",
      removed: false,
      files: [
        {
          path: "resource.txt",
          content: { kind: "text", before: "complete content", after: "updated content" },
        },
      ],
    });
    await updateSkills(
      { ...options, sourceTransport: () => "file:///unavailable" },
      {
        source: "team",
        paths: ["guide"],
        exactRevision: revision,
        expectedBaseline: checked.value.baseline,
      },
    );
    const updated = (await coordinator.read()).installed[0]!;
    if (updated.kind !== "remote") throw new Error("Expected remote installation");
    expect(updated.snapshotId).not.toBe(installed.snapshotId);
    await expect(
      updateSkills(options, {
        source: "team",
        paths: ["guide"],
        exactRevision: revision,
        expectedBaseline: checked.value.baseline,
      }),
    ).rejects.toHaveProperty("code", "TRANSACTION_CONFLICT");
    await rm(join(root, "cache"), { recursive: true });
    expect(
      (await loadInstalledSkill(options, { address: { source: "team", path: "guide" } }))
        .markdownText,
    ).toBe("Offline body\n");
    expect(await readdir(join(root, "state", "uses"))).toEqual([]);
    await coordinator.gc();
    expect(
      await readFile(
        join(await coordinator.snapshotRoot(updated.snapshotId), "resource.txt"),
        "utf8",
      ),
    ).toBe("updated content");
    await expect(coordinator.snapshotRoot(installed.snapshotId)).rejects.toBeDefined();
  } finally {
    if (savedState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = savedState;
    if (savedCache === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
    else process.env.SKCTL_SOURCE_CACHE_DIR = savedCache;
  }
});
