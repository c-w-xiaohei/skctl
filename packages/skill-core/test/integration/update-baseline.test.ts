import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setManagementUpdateCheckHookForTest } from "../../src/installed/update";
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
  const core = { cwd: root };
  await api.registerSource(core, {
    level: "project",
    id: "local",
    binding: { kind: "local", path: "./skills", root: "" },
  });
  await api.installSkills(core, { source: "local", paths: ["review"] });
  return { root, core };
}
test("update baselines persist across Core instances and invalidate for local content or installed state", async () => {
  const value = await fixture();
  try {
    const initial = await api.getUpdateBaseline(value.core, { source: "local" });
    const restarted = { cwd: value.root };
    expect((await api.getUpdateBaseline(restarted, { source: "local" })).value).toBe(initial.value);
    await writeFile(
      join(value.root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Changed\n---\n",
    );
    const afterLocalEdit = await api.getUpdateBaseline(restarted, { source: "local" });
    expect(afterLocalEdit.value).not.toBe(initial.value);
    await api.uninstallSkills(restarted, { source: "local", paths: ["review"] });
    expect((await api.getUpdateBaseline(restarted, { source: "local" })).value).not.toBe(
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
    const firstBaseline = await api.getUpdateBaseline(value.core, { source: "local" });
    process.env.SKILL_CLI_STATE_DIR = join(value.root, "other-state");
    const isolated = { cwd: value.root };
    await api.installSkills(isolated, { source: "local", paths: ["review"] });
    const secondBaseline = await api.getUpdateBaseline(isolated, { source: "local" });
    expect(secondBaseline.value).not.toBe(firstBaseline.value);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
test("update baseline rejects an installed source whose binding changed across restart", async () => {
  const value = await fixture();
  try {
    const baseline = await api.getUpdateBaseline(value.core, { source: "local" });
    await mkdir(join(value.root, "other-skills"));
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "local": { "kind": "local", "path": "./other-skills", "root": "" } } }\n',
    );
    const restarted = { cwd: value.root };
    await expect(api.getUpdateBaseline(restarted, { source: "local" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
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
      paths: ["review"],
      exactRevision: initial.value.exactRevision,
    });
    const before = await api.getUpdateBaseline(core, { source: "remote" });
    process.env.SKILL_CLI_STATE_DIR = join(root, "other-state");
    const isolated = {
      cwd: root,
      sourceTransport: (url: string) =>
        url === "https://example.test/skills.git" ? bare : undefined,
    };
    await api.installSkills(isolated, {
      source: "remote",
      paths: ["review"],
      exactRevision: initial.value.exactRevision,
    });
    expect((await api.getUpdateBaseline(isolated, { source: "remote" })).value).not.toBe(
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
    await api.updateSkills(core, { source: "remote", paths: ["review"], exactRevision: revision });
    const restarted = { cwd: root };
    expect((await api.getUpdateBaseline(restarted, { source: "remote" })).value).not.toBe(
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
    const observation = await api.checkUpdate(value.core, { source: "local" });
    const baseline = observation.value.baseline;
    expect(baseline).toBeDefined();
    if (!baseline) throw new Error("checkUpdate must return an update baseline");
    expect((await api.getUpdateBaseline(value.core, { source: "local" })).value).toBe(baseline);
    await writeFile(
      join(value.root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Third\n---\n",
    );
    await expect(
      api.updateSkills(value.core, {
        source: "local",
        paths: ["review"],
        expectedBaseline: baseline,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_CONFLICT" });
    await api.updateSkills(value.core, { source: "local", paths: ["review"] });
    expect((await api.getWorkspace(value.core)).value.installedSkills[0]).toMatchObject({
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
    await expect(api.checkUpdate(value.core, { source: "local" })).rejects.toMatchObject({
      code: "TRANSACTION_CONFLICT",
    });
    expect((await api.getWorkspace(value.core)).value.installedSkills[0]).toMatchObject({
      description: "First",
    });
  } finally {
    setManagementUpdateCheckHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});
