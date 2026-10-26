import * as api from "../../src/index";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
import * as service from "../../src/source/service";
let cacheRoot: string;
beforeEach(async () => {
  cacheRoot = await mkdtemp(join(tmpdir(), "skctl-update-cache-"));
  process.env.SKCTL_SOURCE_CACHE_DIR = cacheRoot;
});
afterEach(async () => {
  delete process.env.SKCTL_SOURCE_CACHE_DIR;
  await rm(cacheRoot, { recursive: true, force: true });
});
async function expireRef() {
  for (const key of await readdir(join(cacheRoot, "origins"))) {
    const path = join(cacheRoot, "origins", key, "cache.json"),
      index = JSON.parse(await readFile(path, "utf8"));
    for (const ref of Object.values(index.refs) as { observedAt: number }[])
      ref.observedAt -= 31_000;
    await writeFile(path, JSON.stringify(index));
  }
}
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
test("remote update and installed reading accept quoted ampersands; invalid metadata identifies its Root and rejects before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-update-frontmatter-"));
  const work = join(root, "work"),
    bare = join(root, "remote.git");
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    for (const name of ["one", "placement"]) {
      await mkdir(join(work, "skills", name), { recursive: true });
      await writeFile(
        join(work, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Original\n---\n`,
      );
    }
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await git(work, "init", "-b", "main");
    await git(work, "config", "user.email", "test@skctl.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "original");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const core = { cwd: root, sourceTransport: () => bare };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: {
        kind: "git",
        origin: "https://example.test/skills.git",
        root: "skills",
        ref: "main",
      },
    });
    const initial = await api.discoverSkills(core, { source: "remote" });
    await api.installSkills(core, {
      source: "remote",
      paths: ["one", "placement"],
      exactRevision: initial.value.exactRevision,
    });
    const description = "Build a content-suitability & sensitive-topic block list.";
    for (const name of ["one", "placement"])
      await writeFile(
        join(work, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: '${description}'\n---\n# ${name}\n`,
      );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "ordinary punctuation");
    await git(work, "push", "origin", "HEAD:main");
    await expireRef();
    const valid = await api.checkUpdate(core, { source: "remote" });
    await api.updateSkills(core, {
      source: "remote",
      paths: ["one", "placement"],
      exactRevision: valid.value.exactRevision,
      expectedBaseline: valid.value.baseline,
    });
    const content = await api.loadInstalledSkill(core, {
      address: { source: "remote", path: "placement" },
    });
    expect(content.description).toBe(description);
    expect(content.markdownText).toBe("# placement\n");
    const before = await Bun.file(join(root, "state", "state.json")).text();
    await writeFile(
      join(work, "skills", "one", "SKILL.md"),
      "---\nname: one\ndescription: Valid newer content\n---\n",
    );
    await writeFile(
      join(work, "skills", "placement", "SKILL.md"),
      "---\nname: placement\ndescription: []\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "invalid required field");
    await git(work, "push", "origin", "HEAD:main");
    await expireRef();
    const invalid = await api.checkUpdate(core, { source: "remote" });
    const publication = spyOn(StateCoordinator.prototype, "write");
    try {
      await expect(
        api.updateSkills(core, {
          source: "remote",
          paths: ["one", "placement"],
          exactRevision: invalid.value.exactRevision,
          expectedBaseline: invalid.value.baseline,
        }),
      ).rejects.toMatchObject({
        code: "CONFIG_INVALID",
        message: expect.stringContaining("placement/SKILL.md"),
        diagnostics: [
          expect.objectContaining({
            code: "UPDATE_NOT_APPLIED",
            subject: { kind: "installed-skill", address: { source: "remote", path: "placement" } },
            suggestion: expect.stringContaining("recheck"),
          }),
        ],
      });
      expect(publication).not.toHaveBeenCalled();
    } finally {
      publication.mockRestore();
    }
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    expect(
      (await api.loadInstalledSkill(core, { address: { source: "remote", path: "one" } }))
        .description,
    ).toBe(description);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-007 classifies Changed New Removed and unchanged while selecting only Changed for update", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-update-"));
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await mkdir(join(root, "skills", "removed"), { recursive: true });
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: First\n---\n",
    );
    await writeFile(
      join(root, "skills", "removed", "SKILL.md"),
      "---\nname: removed\ndescription: Removed\n---\n",
    );
    const core = { cwd: root };
    await api.registerSource(core, {
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await api.installSkills(core, { source: "local", paths: ["review", "removed"] });
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: renamed\ndescription: Second\n---\n",
    );
    await rm(join(root, "skills", "removed"), { recursive: true, force: true });
    await mkdir(join(root, "skills", "new"));
    await writeFile(
      join(root, "skills", "new", "SKILL.md"),
      "---\nname: new\ndescription: New\n---\n",
    );
    expect((await api.checkUpdate(core, { source: "local" })).value).toMatchObject({
      source: "local",
      kind: "local",
      changed: [{ path: "review", name: "renamed", description: "Second" }],
      added: [],
      removed: [{ path: "removed", name: "removed", description: "Removed" }],
      unchanged: [],
    });
    await expect(api.updateSkills(core, { source: "local", paths: ["new"] })).rejects.toMatchObject(
      {
        code: "SKILL_NOT_FOUND",
      },
    );
    await expect(
      api.updateSkills(core, { source: "local", paths: ["removed"] }),
    ).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
    await api.updateSkills(core, { source: "local", paths: ["review"], remove: ["removed"] });
    expect(
      (await api.getWorkspace(core)).value.installedSkills.map((item) => item.address.path),
    ).toEqual(["review"]);
    expect((await api.getWorkspace(core)).value.installedSkills).toEqual([
      expect.objectContaining({
        address: { source: "local", path: "review" },
        name: "renamed",
        description: "Second",
      }),
    ]);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-029 update rejects a Source removed after observation without publishing state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-update-binding-barrier-"));
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: First\n---\n",
    );
    const core = { cwd: root };
    await api.registerSource(core, {
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await api.installSkills(core, { source: "local", paths: ["review"] });
    const before = await Bun.file(join(root, "state", "state.json")).text();
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Changed\n---\n",
    );
    const prepare = service.withPreparedSkills;
    const inspection = spyOn(service, "withPreparedSkills").mockImplementation(async function <T>(
      context: service.SourceContext,
      paths: readonly string[],
      revision: string | undefined,
      operation: (skills: readonly service.PreparedSkill[]) => Promise<T>,
    ): Promise<T> {
      return prepare(context, paths, revision, async (skills) => {
        await writeFile(join(root, "skctl.jsonc"), "{}\n");
        return operation(skills);
      });
    });
    try {
      await expect(
        api.updateSkills(core, { source: "local", paths: ["review"] }),
      ).rejects.toMatchObject({
        code: "CONFIG_CONFLICT",
      });
    } finally {
      inspection.mockRestore();
    }
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-008 selected update is atomic when one root fails validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-update-atomic-"));
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    for (const name of ["one", "two"]) {
      await mkdir(join(root, "skills", name), { recursive: true });
      await writeFile(
        join(root, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: First\n---\n`,
      );
    }
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    const core = { cwd: root };
    await api.registerSource(core, {
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await api.installSkills(core, { source: "local", paths: ["one", "two"] });
    const before = await Bun.file(join(root, "state", "state.json")).text();
    await writeFile(
      join(root, "skills", "one", "SKILL.md"),
      "---\nname: one\ndescription: Changed\n---\n",
    );
    await writeFile(join(root, "skills", "two", "SKILL.md"), "not frontmatter\n");
    await expect(
      api.updateSkills(core, { source: "local", paths: ["one", "two"] }),
    ).rejects.toMatchObject({
      code: "SKILL_NOT_FOUND",
    });
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-008 reports installed metadata, applies the reviewed revision after ref movement, and preserves bytes on publication failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-remote-update-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    for (const name of ["alpha", "beta", "removed"])
      await mkdir(join(work, "skills", name), { recursive: true });
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await git(work, "init");
    await git(work, "config", "user.email", "test@skctl.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    for (const name of ["alpha", "beta", "removed"])
      await writeFile(
        join(work, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: One\n---\n`,
      );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "one");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const core = {
      cwd: root,
      sourceTransport: (url: string) =>
        url === "https://example.test/skills.git" ? bare : undefined,
    };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: {
        kind: "git",
        origin: "https://example.test/skills.git",
        root: "skills",
        ref: "main",
      },
    });
    const initial = await api.discoverSkills(core, { source: "remote" });
    await api.installSkills(core, {
      source: "remote",
      paths: ["alpha", "beta", "removed"],
      exactRevision: initial.value.exactRevision,
    });
    await writeFile(
      join(work, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Two\n---\n",
    );
    await writeFile(
      join(work, "skills", "beta", "SKILL.md"),
      "---\nname: beta\ndescription: Two\n---\n",
    );
    await rm(join(work, "skills", "removed"), { recursive: true, force: true });
    await mkdir(join(work, "skills", "added"));
    await writeFile(
      join(work, "skills", "added", "SKILL.md"),
      "---\nname: added\ndescription: Two\n---\n",
    );
    await git(work, "add", "-A");
    await git(work, "commit", "-m", "two");
    const second = await git(work, "rev-parse", "HEAD");
    await git(work, "push", "origin", "HEAD:main");
    await expireRef();
    const update = await api.checkUpdate(core, { source: "remote" });
    expect(update.value).toMatchObject({
      source: "remote",
      kind: "git",
      exactRevision: second,
      changed: [
        { path: "alpha", name: "alpha", description: "One" },
        { path: "beta", name: "beta", description: "One" },
      ],
      added: [],
      removed: [{ path: "removed", name: "removed", description: "One" }],
      unchanged: [],
    });
    await writeFile(
      join(work, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Three\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "move after observation");
    await git(work, "push", "origin", "HEAD:main");
    await api.updateSkills(core, {
      source: "remote",
      paths: ["alpha", "beta"],
      exactRevision: update.value.exactRevision,
    });
    let state = JSON.parse(await Bun.file(join(root, "state", "state.json")).text());
    expect(
      state.installed
        .filter((item: { path: string }) => ["alpha", "beta"].includes(item.path))
        .map((item: { adoptedRevision: string }) => item.adoptedRevision),
    ).toEqual([second, second]);
    expect(state.installed.map((item: { path: string }) => item.path).sort()).toEqual([
      "alpha",
      "beta",
      "removed",
    ]);
    const alpha = state.installed.find((item: { path: string }) => item.path === "alpha");
    expect(
      await Bun.file(join(root, "state", "snapshots", alpha.snapshotId, "root", "SKILL.md")).text(),
    ).toContain("description: Two");
    expect(alpha).toMatchObject({ name: "alpha", description: "Two" });
    await writeFile(
      join(work, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Four\n---\n",
    );
    await writeFile(
      join(work, "skills", "beta", "SKILL.md"),
      "---\nname: beta\ndescription: Four\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "four");
    await git(work, "push", "origin", "HEAD:main");
    const before = await Bun.file(join(root, "state", "state.json")).text();
    const snapshots = await readdir(join(root, "state", "snapshots"));
    let publications = 0;
    const publish = StateCoordinator.prototype.publishSnapshot;
    const publication = spyOn(StateCoordinator.prototype, "publishSnapshot").mockImplementation(
      async function (this: StateCoordinator, ...args) {
        if (++publications === 2) throw new Error("second Snapshot publication failed");
        return publish.apply(this, args);
      },
    );
    await expireRef();
    try {
      await expect(
        api.updateSkills(core, {
          source: "remote",
          paths: ["alpha", "beta"],
          exactRevision: (await api.checkUpdate(core, { source: "remote" })).value.exactRevision,
        }),
      ).rejects.toThrow("second Snapshot publication failed");
    } finally {
      publication.mockRestore();
    }
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    expect(await readdir(join(root, "state", "snapshots"))).toEqual(
      expect.arrayContaining(snapshots),
    );
    await api.gc();
    const remaining = await readdir(join(root, "state", "snapshots"));
    const referenced = JSON.parse(await Bun.file(join(root, "state", "state.json")).text())
      .installed.map((item: { snapshotId: string }) => item.snapshotId)
      .sort();
    expect(remaining.sort()).toEqual(referenced);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-007 checks exact Git and GitHub revisions using installed metadata only", async () => {
  for (const kind of ["git", "github"] as const) {
    const root = await mkdtemp(join(tmpdir(), `skctl-${kind}-update-categories-`));
    const work = join(root, "work");
    const bare = join(root, "remote.git");
    process.env.SKCTL_STATE_DIR = join(root, "state");
    try {
      await mkdir(join(work, "skills", "review"), { recursive: true });
      await writeFile(join(root, "skctl.jsonc"), "{}\n");
      await git(work, "init", "-b", "main");
      await git(work, "config", "user.email", "test@skctl.invalid");
      await git(work, "config", "user.name", "Skill CLI");
      await writeFile(
        join(work, "skills", "review", "SKILL.md"),
        "---\nname: review\ndescription: One\n---\n",
      );
      await git(work, "add", ".");
      await git(work, "commit", "-m", "one");
      await initBare(root, bare);
      await git(work, "remote", "add", "origin", bare);
      await git(work, "push", "origin", "HEAD:main");
      const origin = `https://example.test/${kind}.git`;
      const core = { cwd: root, sourceTransport: () => bare };
      await api.registerSource(core, {
        level: "project",
        id: kind,
        binding: { kind, origin, root: "skills", ref: "main" },
      });
      const initial = await api.discoverSkills(core, { source: kind });
      await api.installSkills(core, {
        source: kind,
        paths: ["review"],
        exactRevision: initial.value.exactRevision,
      });
      await writeFile(
        join(work, "skills", "review", "SKILL.md"),
        "---\nname: renamed\ndescription: Two\n---\n",
      );
      await git(work, "add", ".");
      await git(work, "commit", "-m", "two");
      const revision = await git(work, "rev-parse", "HEAD");
      await git(work, "push", "origin", "HEAD:main");
      await expireRef();
      expect((await api.checkUpdate(core, { source: kind })).value).toMatchObject({
        source: kind,
        kind,
        exactRevision: revision,
        changed: [{ path: "review", name: "review", description: "One" }],
        added: [],
        removed: [],
        unchanged: [],
      });
    } finally {
      delete process.env.SKCTL_STATE_DIR;
      await rm(root, { recursive: true, force: true });
    }
  }
});
test("MGMT-034 update rejects foreign or duplicate paths, unavailable commits, and binding drift without publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-update-integrity-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(work, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    await git(work, "init", "-b", "main");
    await git(work, "config", "user.email", "test@skctl.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    await writeFile(
      join(work, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: One\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "one");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const core = { cwd: root, sourceTransport: () => bare };
    await api.registerSource(core, {
      level: "project",
      id: "remote",
      binding: {
        kind: "git",
        origin: "https://example.test/skills.git",
        root: "skills",
        ref: "main",
      },
    });
    const initial = await api.discoverSkills(core, { source: "remote" });
    await api.installSkills(core, {
      source: "remote",
      paths: ["review"],
      exactRevision: initial.value.exactRevision,
    });
    await writeFile(
      join(work, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Two\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "two");
    await git(work, "push", "origin", "HEAD:main");
    await expireRef();
    const observed = await api.checkUpdate(core, { source: "remote" });
    const before = await Bun.file(join(root, "state", "state.json")).text();
    for (const paths of [["foreign"], ["review", "review"]] as readonly (readonly string[])[]) {
      await expect(
        api.updateSkills(core, {
          source: "remote",
          paths,
          exactRevision: observed.value.exactRevision,
        }),
      ).rejects.toMatchObject({ code: paths.length > 1 ? "INVALID_ARGUMENT" : "SKILL_NOT_FOUND" });
      expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    }
    await expect(
      api.updateSkills(core, {
        source: "remote",
        paths: ["review"],
        exactRevision: "f".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "PINNED_COMMIT_UNAVAILABLE" });
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    const prepare = service.withPreparedSkills;
    const acquisition = spyOn(service, "withPreparedSkills").mockImplementation(async function <T>(
      context: service.SourceContext,
      paths: readonly string[],
      revision: string | undefined,
      operation: (skills: readonly service.PreparedSkill[]) => Promise<T>,
    ): Promise<T> {
      return prepare(context, paths, revision, async (skills) => {
        await writeFile(
          join(root, "skctl.jsonc"),
          '{ "sources": { "remote": { "kind": "git", "origin": "https://example.test/skills.git", "root": "other", "ref": "main" } } }\n',
        );
        return operation(skills);
      });
    });
    try {
      await expect(
        api.updateSkills(core, {
          source: "remote",
          paths: ["review"],
          exactRevision: observed.value.exactRevision,
        }),
      ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    } finally {
      acquisition.mockRestore();
    }
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
