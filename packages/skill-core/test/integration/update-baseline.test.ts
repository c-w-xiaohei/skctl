import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/create-core";
import { setManagementUpdateCheckHookForTest } from "../../src/management";

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-update-baseline-"));
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
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
  return { root, core };
}

test("update baselines persist across Core instances and invalidate for local content or installed state", async () => {
  const value = await fixture();
  try {
    const initial = await value.core.management.getUpdateBaseline({ source: "local" });
    const restarted = createSkillCliCore({ cwd: value.root });
    expect((await restarted.management.getUpdateBaseline({ source: "local" })).value).toBe(
      initial.value,
    );

    await writeFile(
      join(value.root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Changed\n---\n",
    );
    const afterLocalEdit = await restarted.management.getUpdateBaseline({ source: "local" });
    expect(afterLocalEdit.value).not.toBe(initial.value);

    await restarted.management.uninstall({ source: "local", paths: ["review"] });
    expect((await restarted.management.getUpdateBaseline({ source: "local" })).value).not.toBe(
      afterLocalEdit.value,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("identical bindings in isolated installation storage never share an update baseline", async () => {
  const value = await fixture();
  try {
    const firstBaseline = await value.core.management.getUpdateBaseline({ source: "local" });
    process.env.SKILL_CLI_STATE_DIR = join(value.root, "other-state");
    const isolated = createSkillCliCore({ cwd: value.root });
    await isolated.management.install({ source: "local", paths: ["review"] });
    const secondBaseline = await isolated.management.getUpdateBaseline({ source: "local" });
    expect(secondBaseline.value).not.toBe(firstBaseline.value);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("update baseline rejects an installed source whose binding changed across restart", async () => {
  const value = await fixture();
  try {
    const baseline = await value.core.management.getUpdateBaseline({ source: "local" });
    await mkdir(join(value.root, "other-skills"));
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "local": { "kind": "local", "path": "./other-skills", "root": "" } } }\n',
    );
    const restarted = createSkillCliCore({ cwd: value.root });
    await expect(restarted.management.getUpdateBaseline({ source: "local" })).rejects.toMatchObject(
      {
        code: "CONFIG_CONFLICT",
      },
    );
    expect(baseline.value).toBeDefined();
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("update baseline changes after a remote skill is re-materialized across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-remote-update-baseline-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(work, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await writeFile(
      join(work, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: First\n---\n",
    );
    await git(work, "init", "-b", "main");
    await git(work, "config", "user.email", "test@skill-cli.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "first");
    await git(root, "init", "--bare", bare);
    await git(root, `--git-dir=${bare}`, "config", "uploadpack.allowFilter", "true");
    await git(root, `--git-dir=${bare}`, "config", "uploadpack.allowReachableSHA1InWant", "true");
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
      paths: ["review"],
      exactRevision: initial.value.exactRevision,
    });
    const before = await core.management.getUpdateBaseline({ source: "remote" });
    process.env.SKILL_CLI_STATE_DIR = join(root, "other-state");
    const isolated = createSkillCliCore({
      cwd: root,
      sourceTransport: (url) => (url === "https://example.test/skills.git" ? bare : undefined),
    });
    await isolated.management.install({
      source: "remote",
      paths: ["review"],
      exactRevision: initial.value.exactRevision,
    });
    expect((await isolated.management.getUpdateBaseline({ source: "remote" })).value).not.toBe(
      before.value,
    );
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");

    await writeFile(
      join(work, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Second\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "second");
    const revision = await git(work, "rev-parse", "HEAD");
    await git(work, "push", "origin", "HEAD:main");
    await core.management.update({ source: "remote", paths: ["review"], exactRevision: revision });

    const restarted = createSkillCliCore({ cwd: root });
    expect((await restarted.management.getUpdateBaseline({ source: "remote" })).value).not.toBe(
      before.value,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("checkUpdate baseline guards update at the commit lock while callers without it remain compatible", async () => {
  const value = await fixture();
  try {
    await writeFile(
      join(value.root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Second\n---\n",
    );
    const observation = await value.core.management.checkUpdate({ source: "local" });
    const baseline = observation.value.baseline;
    expect(baseline).toBeDefined();
    if (!baseline) throw new Error("checkUpdate must return an update baseline");
    expect((await value.core.management.getUpdateBaseline({ source: "local" })).value).toBe(
      baseline,
    );

    await writeFile(
      join(value.root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Third\n---\n",
    );
    await expect(
      value.core.management.update({
        source: "local",
        paths: ["review"],
        expectedBaseline: baseline,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });

    await value.core.management.update({ source: "local", paths: ["review"] });
    expect((await value.core.workspace.get()).value.installedSkills[0]).toMatchObject({
      description: "Third",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("checkUpdate rejects a local change after candidate capture instead of returning mixed metadata and baseline", async () => {
  const value = await fixture();
  try {
    setManagementUpdateCheckHookForTest(() =>
      writeFile(
        join(value.root, "skills", "review", "SKILL.md"),
        "---\nname: review\ndescription: Unseen\n---\n",
      ),
    );
    await expect(value.core.management.checkUpdate({ source: "local" })).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
    expect((await value.core.workspace.get()).value.installedSkills[0]).toMatchObject({
      description: "First",
    });
  } finally {
    setManagementUpdateCheckHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
