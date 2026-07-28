import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/core/create-core";
import { setManagementPublicationHookForTest } from "../../src/core/management";
import { setCoordinatorHookForTest } from "../../src/core/internal/state";

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

test("MGMT-007 classifies Changed New Removed and unchanged while selecting only Changed for update", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-update-"));
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await mkdir(join(root, "skills", "removed"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: First\n---\n",
    );
    await writeFile(
      join(root, "skills", "removed", "SKILL.md"),
      "---\nname: removed\ndescription: Removed\n---\n",
    );
    const core = createSkillCliCore({ cwd: root });
    await core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await core.management.install({ source: "local", paths: ["review", "removed"] });
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
    expect((await core.management.checkUpdate({ source: "local" })).value).toEqual({
      source: "local",
      kind: "local",
      changed: [{ path: "review", name: "renamed", description: "Second" }],
      added: [{ path: "new", name: "new", description: "New" }],
      removed: [{ path: "removed", name: "removed", description: "Removed" }],
      unchanged: [],
    });
    await expect(core.management.update({ source: "local", paths: ["new"] })).rejects.toMatchObject(
      { code: "INVALID_ARGUMENT" },
    );
    await expect(
      core.management.update({ source: "local", paths: ["removed"] }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await core.management.update({ source: "local", paths: ["review"], remove: ["removed"] });
    expect(
      (await core.workspace.get()).value.installedSkills.map((item) => item.address.path),
    ).toEqual(["review"]);
    expect((await core.workspace.get()).value.installedSkills).toEqual([
      expect.objectContaining({
        address: { source: "local", path: "review" },
        name: "renamed",
        description: "Second",
      }),
    ]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-029 update rejects a Source removed after observation without publishing state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-update-binding-barrier-"));
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: First\n---\n",
    );
    const core = createSkillCliCore({ cwd: root });
    await core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await core.management.install({ source: "local", paths: ["review"] });
    const before = await Bun.file(join(root, "state", "state.json")).text();
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Changed\n---\n",
    );
    setManagementPublicationHookForTest(() => writeFile(join(root, "skill-cli.jsonc"), "{}\n"));
    await expect(
      core.management.update({ source: "local", paths: ["review"] }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-008 selected update is atomic when one root fails validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-update-atomic-"));
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    for (const name of ["one", "two"]) {
      await mkdir(join(root, "skills", name), { recursive: true });
      await writeFile(
        join(root, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: First\n---\n`,
      );
    }
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root });
    await core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await core.management.install({ source: "local", paths: ["one", "two"] });
    const before = await Bun.file(join(root, "state", "state.json")).text();
    await writeFile(
      join(root, "skills", "one", "SKILL.md"),
      "---\nname: one\ndescription: Changed\n---\n",
    );
    await writeFile(join(root, "skills", "two", "SKILL.md"), "not frontmatter\n");
    await expect(
      core.management.update({ source: "local", paths: ["one", "two"] }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-008 applies one reviewed Remote revision after the ref moves and preserves old bytes on publication failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-remote-update-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    for (const name of ["alpha", "beta", "removed"])
      await mkdir(join(work, "skills", name), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await git(work, "init");
    await git(work, "config", "user.email", "test@skill-cli.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    for (const name of ["alpha", "beta", "removed"])
      await writeFile(
        join(work, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: One\n---\n`,
      );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "one");
    await git(root, "init", "--bare", bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const core = createSkillCliCore({
      cwd: root,
      sourceTransport: (url) => (url === "https://example.test/skills.git" ? bare : undefined),
    });
    await core.configuration.change({
      type: "source.register",
      level: "project",
      id: "remote",
      binding: {
        kind: "git",
        origin: "https://example.test/skills.git",
        root: "skills",
        ref: "main",
      },
    });
    const initial = await core.management.discover({ source: "remote" });
    await core.management.install({
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
    const update = await core.management.checkUpdate({ source: "remote" });
    expect(update.value).toEqual({
      source: "remote",
      kind: "git",
      exactRevision: second,
      changed: [
        { path: "alpha", name: "alpha", description: "Two" },
        { path: "beta", name: "beta", description: "Two" },
      ],
      added: [{ path: "added", name: "added", description: "Two" }],
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
    await core.management.update({
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
      await Bun.file(join(root, "state", "snapshots", alpha.digest, "root", "SKILL.md")).text(),
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
    setCoordinatorHookForTest((name) => {
      if (name === "immutable-published" && ++publications === 2)
        throw new Error("second Snapshot publication failed");
    });
    await expect(
      core.management.update({
        source: "remote",
        paths: ["alpha", "beta"],
        exactRevision: (await core.management.checkUpdate({ source: "remote" })).value
          .exactRevision,
      }),
    ).rejects.toThrow("second Snapshot publication failed");
    setCoordinatorHookForTest();
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    expect(await readdir(join(root, "state", "snapshots"))).toEqual(snapshots);
    await core.management.gc();
    const remaining = await readdir(join(root, "state", "snapshots"));
    const referenced = JSON.parse(await Bun.file(join(root, "state", "state.json")).text())
      .installed.map((item: { digest: string }) => item.digest)
      .sort();
    expect(remaining.sort()).toEqual(referenced);
  } finally {
    setCoordinatorHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-007 reports exact Git and GitHub Changed metadata at one observed revision", async () => {
  for (const kind of ["git", "github"] as const) {
    const root = await mkdtemp(join(tmpdir(), `skill-cli-${kind}-update-categories-`));
    const work = join(root, "work");
    const bare = join(root, "remote.git");
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    try {
      await mkdir(join(work, "skills", "review"), { recursive: true });
      await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
      await git(work, "init", "-b", "main");
      await git(work, "config", "user.email", "test@skill-cli.invalid");
      await git(work, "config", "user.name", "Skill CLI");
      await writeFile(
        join(work, "skills", "review", "SKILL.md"),
        "---\nname: review\ndescription: One\n---\n",
      );
      await git(work, "add", ".");
      await git(work, "commit", "-m", "one");
      await git(root, "init", "--bare", bare);
      await git(work, "remote", "add", "origin", bare);
      await git(work, "push", "origin", "HEAD:main");
      const origin = `https://example.test/${kind}.git`;
      const core = createSkillCliCore({ cwd: root, sourceTransport: () => bare });
      await core.configuration.change({
        type: "source.register",
        level: "project",
        id: kind,
        binding: { kind, origin, root: "skills", ref: "main" },
      });
      const initial = await core.management.discover({ source: kind });
      await core.management.install({
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
      expect((await core.management.checkUpdate({ source: kind })).value).toMatchObject({
        source: kind,
        kind,
        exactRevision: revision,
        changed: [{ path: "review", name: "renamed", description: "Two" }],
        added: [],
        removed: [],
        unchanged: [],
      });
    } finally {
      delete process.env.SKILL_CLI_STATE_DIR;
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("MGMT-034 update rejects foreign or duplicate paths, unavailable commits, and binding drift without publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-update-integrity-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(work, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await git(work, "init", "-b", "main");
    await git(work, "config", "user.email", "test@skill-cli.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    await writeFile(
      join(work, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: One\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "one");
    await git(root, "init", "--bare", bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => bare });
    await core.configuration.change({
      type: "source.register",
      level: "project",
      id: "remote",
      binding: {
        kind: "git",
        origin: "https://example.test/skills.git",
        root: "skills",
        ref: "main",
      },
    });
    const initial = await core.management.discover({ source: "remote" });
    await core.management.install({
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
    const observed = await core.management.checkUpdate({ source: "remote" });
    const before = await Bun.file(join(root, "state", "state.json")).text();
    for (const paths of [["foreign"], ["review", "review"]] as readonly (readonly string[])[]) {
      await expect(
        core.management.update({
          source: "remote",
          paths,
          exactRevision: observed.value.exactRevision,
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    }
    await expect(
      core.management.update({
        source: "remote",
        paths: ["review"],
        exactRevision: "f".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "PINNED_COMMIT_UNAVAILABLE" });
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
    setManagementPublicationHookForTest(() =>
      writeFile(
        join(root, "skill-cli.jsonc"),
        '{ "sources": { "remote": { "kind": "git", "origin": "https://example.test/skills.git", "root": "other", "ref": "main" } } }\n',
      ),
    );
    await expect(
      core.management.update({
        source: "remote",
        paths: ["review"],
        exactRevision: observed.value.exactRevision,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await Bun.file(join(root, "state", "state.json")).text()).toBe(before);
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
