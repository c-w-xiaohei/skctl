import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "../../src/runtime/process";

async function fixture() {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/skctl-operations-"),
    global = join(root, "global.jsonc");
  const previous = {
    state: process.env.SKCTL_STATE_DIR,
    cache: process.env.SKCTL_SOURCE_CACHE_DIR,
  };
  process.env.SKCTL_STATE_DIR = join(root, "state");
  process.env.SKCTL_SOURCE_CACHE_DIR = join(root, "cache");
  await writeFile(global, "{}");
  await writeFile(join(root, "skctl.jsonc"), "{}");
  return {
    root,
    options: { cwd: root, userConfigPath: global },
    dispose: async () => {
      if (previous.state === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous.state;
      if (previous.cache === undefined) delete process.env.SKCTL_SOURCE_CACHE_DIR;
      else process.env.SKCTL_SOURCE_CACHE_DIR = previous.cache;
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Local checks use live metadata; rebind, uninstall and removal independently enforce identity and Memberships", async () => {
  const value = await fixture();
  try {
    const skills = join(value.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(value.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(value.options, { source: "first", paths: ["guide"] });
    await expect(
      api.installSkills(value.options, { source: "next", paths: ["guide"] }),
    ).rejects.toHaveProperty("code", "CONFIG_CONFLICT");
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: renamed\ndescription: New description\n---\n",
    );
    const checked = (await api.checkUpdate(value.options, { source: "first" })).value;
    expect(checked.changed).toEqual([
      { path: "guide", name: "renamed", description: "New description" },
    ]);
    await api.updateSkills(value.options, {
      source: "first",
      paths: ["guide"],
      expectedBaseline: checked.baseline,
    });
    await api.rebindSkill(value.options, { source: "first", path: "guide", owner: "next" });
    expect((await api.getWorkspace(value.options)).value.installedSkills[0]!.address.source).toBe(
      "next",
    );
    await api.removeSource(value.options, { source: "first" });
    const host = join(value.root, "skctl.jsonc"),
      config = JSON.parse(await readFile(host, "utf8"));
    config.collections = { daily: { members: { guide: { source: "next", path: "guide" } } } };
    await writeFile(host, JSON.stringify(config));
    expect(
      (await api.previewUninstall(value.options, { source: "next", paths: ["guide"] })).value
        .allowed,
    ).toBe(false);
    await expect(
      api.uninstallSkills(value.options, { source: "next", paths: ["guide"] }),
    ).rejects.toHaveProperty("code", "CONFIG_CONFLICT");
    delete config.collections;
    await writeFile(host, JSON.stringify(config));
    await api.uninstallSkills(value.options, { source: "next", paths: ["guide"] });
    await api.removeSource(value.options, { source: "next" });
  } finally {
    await value.dispose();
  }
});

test("Config observe → preview → adopt reuses exact bytes offline and rechecks installed owners", async () => {
  const value = await fixture();
  try {
    const work = join(value.root, "work"),
      bare = join(value.root, "remote.git");
    await mkdir(join(work, "skills", "guide"), { recursive: true });
    await writeFile(
      join(work, "config.jsonc"),
      JSON.stringify({
        sources: { shared: { kind: "local", path: "./skills", root: "" } },
        collections: { daily: {} },
      }),
    );
    await writeFile(
      join(work, "skills", "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    const git = async (...args: string[]) => {
      const result = await runProcess({ cmd: ["/usr/bin/git", ...args], cwd: work });
      if (result.status) throw Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    await git("init", "-b", "main");
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "test@example.test");
    await git("add", ".");
    await git("commit", "-m", "first");
    await git("clone", "--bare", work, bare);
    await git("--git-dir", bare, "config", "uploadpack.allowFilter", "true");
    await git("--git-dir", bare, "config", "uploadpack.allowAnySHA1InWant", "true");
    const options = { ...value.options, sourceTransport: () => `file://${bare}` };
    await api.registerConfigSource(options, {
      level: "project",
      id: "shared",
      binding: { kind: "git", origin: "https://example.test/config.git", root: "", ref: "main" },
    });
    const observation = (await api.observeConfigSource(options, { id: "shared" })).value;
    const offline = { ...options, sourceTransport: () => "file:///unavailable" };
    const request = { id: "shared", exactRevision: observation.exactRevision!, observation };
    expect((await api.previewConfigAdoption(offline, request)).value.allowed).toBe(true);
    await api.adoptConfigSource(offline, request);
    expect(
      (await api.getWorkspace(options)).value.effective.sources.map((item) => item.id),
    ).toEqual(["shared/shared"]);
    // The relative Source shares the Config repository and fixed revision.
    await api.installSkills(options, {
      source: "shared/shared",
      paths: ["guide"],
      exactRevision: observation.exactRevision,
    });
    await expect(api.forgetConfig(options, { id: "shared" })).rejects.toHaveProperty(
      "code",
      "CONFIG_CONFLICT",
    );
    await writeFile(join(work, "config.jsonc"), "{}");
    await git("add", ".");
    await git("commit", "-m", "remove owner");
    await git("push", bare, "HEAD:main");
    const revision = await git("rev-parse", "HEAD");
    expect(
      (await api.previewConfigAdoption(options, { id: "shared", exactRevision: revision })).value
        .allowed,
    ).toBe(false);
    await expect(
      api.adoptConfigSource(options, { id: "shared", exactRevision: revision }),
    ).rejects.toHaveProperty("code", "CONFIG_CONFLICT");
    await api.uninstallSkills(options, { source: "shared/shared", paths: ["guide"] });
    await api.forgetConfig(options, { id: "shared" });
    await api.removeConfig(options, { id: "shared" });
  } finally {
    await value.dispose();
  }
});
