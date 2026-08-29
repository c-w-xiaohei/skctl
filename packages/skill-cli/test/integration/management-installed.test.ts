import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/core/create-core";
import { bindingDigest, canonicalLocalOrigin } from "../../src/core/internal/domain";
import { setManagementPublicationHookForTest } from "../../src/core/management";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-management-"));
  const skills = join(root, "skills");
  await mkdir(join(skills, "one"), { recursive: true });
  await mkdir(join(skills, "two"), { recursive: true });
  await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
  await writeFile(join(skills, "one", "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
  await writeFile(
    join(skills, "two", "SKILL.md"),
    "---\nname: publish\ndescription: Publish\n---\n",
  );
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  return { root, skills, core: createSkillCliCore({ cwd: root }) };
}

function legacyLocal(root: string, source: string, path: string) {
  const origin = canonicalLocalOrigin("./skills", root);
  return {
    kind: "local" as const,
    source,
    path,
    root: join(root, "skills", path),
    name: "review",
    description: "Review",
    digest: "a".repeat(64),
    bindingDigest: bindingDigest({ kind: "local", origin, root: "", path: origin }),
  };
}

test("MGMT-006 Local discovery installs an atomic selected set without an invented revision", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "team/local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await expect(
      value.core.configuration.change({
        type: "source.register",
        level: "project",
        id: "team/local",
        binding: { kind: "local", path: "./other", root: "" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await expect(
      value.core.configuration.change({
        type: "source.register",
        level: "project",
        id: "team/local",
        binding: { kind: "local", path: "./skills", root: "" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    const discovery = await value.core.management.discover({ source: "team/local" });
    expect(discovery.value.candidates.map((candidate) => candidate.path)).toEqual(["one", "two"]);
    await value.core.management.install({ source: "team/local", paths: ["two", "one"] });
    expect((await value.core.management.checkUpdate({ source: "team/local" })).value).toEqual({
      source: "team/local",
      kind: "local",
      changed: [],
      added: [],
      removed: [],
      unchanged: [
        { path: "one", name: "review", description: "Review" },
        { path: "two", name: "publish", description: "Publish" },
      ],
    });
    await value.core.management.uninstall({ source: "team/local", paths: ["two"] });
    await value.core.management.install({ source: "team/local", paths: ["two"] });
    expect(
      (await value.core.management.checkUpdate({ source: "team/local" })).value.unchanged.map(
        (item) => item.path,
      ),
    ).toEqual(["one", "two"]);
    expect((await value.core.workspace.get()).value.effective.sources).toHaveLength(1);
    expect(
      (await value.core.workspace.get()).value.installedSkills.map((item) => item.address.path),
    ).toEqual(["one", "two"]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-006 rejects the whole selected Local set when one candidate is invalid", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await expect(
      value.core.management.install({ source: "local", paths: ["one", "missing"] }),
    ).rejects.toMatchObject({
      code: "SKILL_NOT_FOUND",
    });
    expect((await value.core.workspace.get()).value.installedSkills).toEqual([]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("INS-001 permits same frontmatter names for distinct Local identities", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.root, "other", "review"), { recursive: true });
    await writeFile(
      join(value.root, "other", "review", "SKILL.md"),
      "---\nname: review\ndescription: Other\n---\n",
    );
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "second",
      binding: { kind: "local", path: "./other", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["one"] });
    await value.core.management.install({ source: "second", paths: ["review"] });
    expect((await value.core.workspace.get()).value.installedSkills).toHaveLength(2);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("INS-001 rejects a second Source that attempts to install the same Local identity", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "second",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["one"] });
    await expect(
      value.core.management.install({ source: "second", paths: ["one"] }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect((await value.core.workspace.get()).value.installedSkills).toHaveLength(1);
    expect((await value.core.workspace.get()).value.installedSkills[0]).toMatchObject({
      address: { source: "first", path: "one" },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("INS-001 rejects a first install whose owner is removed after acquisition", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    setManagementPublicationHookForTest(async () => {
      await writeFile(join(value.root, "skill-cli.jsonc"), "{}\n");
    });
    await expect(
      value.core.management.install({ source: "local", paths: ["one"] }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect((await value.core.workspace.get()).value.installedSkills).toEqual([]);
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-003 Source removal independently rejects every owned Installed address without changing state", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "local", paths: ["one", "two"] });
    const impact = await value.core.management.previewSourceRemoval({ source: "local" });
    expect(impact.value).toMatchObject({
      allowed: false,
      installed: [
        { source: "local", path: "one" },
        { source: "local", path: "two" },
      ],
      repairs: [{ actions: ["rebind", "uninstall"] }, { actions: ["rebind", "uninstall"] }],
    });
    const before = await readFile(join(value.root, "state", "state.json"), "utf8");
    await expect(value.core.management.removeSource({ source: "local" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await readFile(join(value.root, "state", "state.json"), "utf8")).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-005 diagnoses missing or drifted owners, keeps content readable, and limits repair to Rebind or Uninstall", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["one"] });
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "first": { "kind": "local", "path": "./other", "root": "" } } }\n',
    );
    await expect(value.core.management.discover({ source: "first" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(
      (await value.core.content.loadInstalled({ address: { source: "first", path: "one" } })).value
        .name,
    ).toBe("review");
    await writeFile(join(value.root, "skill-cli.jsonc"), "{}\n");
    await expect(value.core.management.discover({ source: "first" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "first": { "kind": "local", "path": "./skills", "root": "" }, "second": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    await value.core.management.rebind({ source: "first", path: "one", owner: "second" });
    expect((await value.core.workspace.get()).value.installedSkills[0]!.address.source).toBe(
      "second",
    );
    await value.core.management.uninstall({ source: "second", paths: ["one"] });
    expect((await value.core.workspace.get()).value.installedSkills).toEqual([]);
    expect(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).toContain('"second"');
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("SRC-003 rebinds same canonical identity through a different binding and rejects a distinct identity", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.skills, "nested", "one"), { recursive: true });
    await writeFile(
      join(value.skills, "nested", "one", "SKILL.md"),
      "---\nname: nested\ndescription: Nested\n---\n",
    );
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["nested/one"] });
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "first": { "kind": "local", "path": "./skills", "root": "" }, "second": { "kind": "local", "path": "./skills", "root": "nested" }, "third": { "kind": "local", "path": "./skills", "root": "other" } } }\n',
    );
    const before = await Bun.file(join(value.root, "state", "state.json")).text();
    await value.core.management.rebind({
      source: "first",
      path: "nested/one",
      owner: "second",
      ownerPath: "one",
    });
    const rebound = JSON.parse(await Bun.file(join(value.root, "state", "state.json")).text())
      .installed[0];
    expect(rebound).toMatchObject({ source: "second", path: "one" });
    await expect(
      value.core.management.rebind({ source: "second", path: "one", owner: "third" }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await Bun.file(join(value.root, "state", "state.json")).text()).not.toBe(before);
    expect(
      JSON.parse(await Bun.file(join(value.root, "state", "state.json")).text()).installed[0],
    ).toMatchObject({ source: "second", path: "one" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-009 rebinds a missing legacy owner only when retained identity evidence proves the replacement", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["one"] });
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "second": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    await value.core.management.rebind({ source: "first", path: "one", owner: "second" });
    expect((await value.core.workspace.get()).value.installedSkills[0]!.address).toEqual({
      source: "second",
      path: "one",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-009 preview reports proven, distinct, and unprovable Rebind proof without private state", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "second",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["one"] });
    expect(
      (await value.core.management.previewRebind({ source: "first", path: "one", owner: "second" }))
        .value,
    ).toMatchObject({ proof: "proven", allowed: true });
    const serialized = JSON.stringify(
      (await value.core.management.previewRebind({ source: "first", path: "one", owner: "second" }))
        .value,
    );
    for (const field of [
      "weight",
      "dialog",
      "task",
      "effects",
      "route",
      "label",
      "token",
      "generation",
      "digest",
      "cache",
      "state",
      "Snapshot",
      "target",
      "editable",
      "writable",
    ])
      expect(serialized).not.toContain(`"${field}"`);
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "other",
      binding: { kind: "local", path: "./other", root: "" },
    });
    expect(
      (await value.core.management.previewRebind({ source: "first", path: "one", owner: "other" }))
        .value,
    ).toMatchObject({ proof: "distinct", allowed: false });
    await writeFile(join(value.root, "skill-cli.jsonc"), "{}\n");
    expect(
      (await value.core.management.previewRebind({ source: "first", path: "one", owner: "other" }))
        .value,
    ).toMatchObject({ proof: "unprovable", allowed: false });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-009 migrates literal v1 Local evidence once, then proves a differently sliced replacement after owner removal", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.skills, "nested", "one"), { recursive: true });
    await writeFile(
      join(value.skills, "nested", "one", "SKILL.md"),
      "---\nname: nested\ndescription: Nested\n---\n",
    );
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "first": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    const legacy = legacyLocal(value.root, "first", "nested/one");
    await mkdir(join(value.root, "state"), { recursive: true });
    await writeFile(
      join(value.root, "state", "state.json"),
      `${JSON.stringify({ version: 1, generation: 4, installed: [legacy], configs: {} })}\n`,
    );
    const before = await readFile(join(value.root, "state", "state.json"), "utf8");
    expect((await value.core.workspace.get()).value.installedSkills).toHaveLength(1);
    expect(await readFile(join(value.root, "state", "state.json"), "utf8")).toBe(before);
    await value.core.management.install({ source: "first", paths: ["two"] });
    const migrated = JSON.parse(await readFile(join(value.root, "state", "state.json"), "utf8"));
    expect(migrated).toMatchObject({ version: 2, generation: 5 });
    expect(migrated.installed[0]).toMatchObject({
      source: "first",
      path: "nested/one",
      identityEvidence: {
        status: "known",
        canonicalOrigin: join(value.root, "skills"),
        originRelativeSkillRoot: "nested/one",
      },
    });
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "second": { "kind": "local", "path": "./skills", "root": "nested" } } }\n',
    );
    await value.core.management.rebind({
      source: "first",
      path: "nested/one",
      owner: "second",
      ownerPath: "one",
    });
    expect(
      (await value.core.workspace.get()).value.installedSkills.map((item) => item.address),
    ).toContainEqual({
      source: "second",
      path: "one",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-009 degrades an already-missing literal v1 owner without provider access and leaves it readable and uninstallable", async () => {
  const value = await fixture();
  try {
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "second": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    const legacy = legacyLocal(value.root, "missing", "one");
    await mkdir(join(value.root, "state"), { recursive: true });
    await writeFile(
      join(value.root, "state", "state.json"),
      `${JSON.stringify({ version: 1, generation: 2, installed: [legacy], configs: {} })}\n`,
    );
    const core = createSkillCliCore({
      cwd: value.root,
      sourceTransport: () => {
        throw new Error("migration must not contact a provider");
      },
    });
    await core.management.install({ source: "second", paths: ["two"] });
    const migrated = JSON.parse(await readFile(join(value.root, "state", "state.json"), "utf8"));
    expect(migrated).toMatchObject({ version: 2, generation: 3 });
    expect(migrated.installed[0]).toMatchObject({
      source: "missing",
      identityEvidence: { status: "unavailable" },
    });
    expect(
      (await core.workspace.get()).value.installedSkills.map((item) => item.address),
    ).toContainEqual({
      source: "missing",
      path: "one",
    });
    await expect(
      core.management.rebind({ source: "missing", path: "one", owner: "second" }),
    ).rejects.toMatchObject({ code: "REBIND_UNPROVABLE" });
    await core.management.uninstall({ source: "missing", paths: ["one"] });
    expect(
      (await core.workspace.get()).value.installedSkills.map((item) => item.address),
    ).not.toContainEqual({
      source: "missing",
      path: "one",
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-009 derives literal v1 Remote evidence during a state-only uninstall without resolving its ref", async () => {
  const value = await fixture();
  try {
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "remote": { "kind": "git", "origin": "https://example.test/skills.git", "root": "skills", "ref": "main" } } }\n',
    );
    await mkdir(join(value.root, "state"), { recursive: true });
    await writeFile(
      join(value.root, "state", "state.json"),
      `${JSON.stringify({
        version: 1,
        generation: 8,
        installed: [
          {
            kind: "remote",
            source: "remote",
            path: "review",
            name: "review",
            description: "Review",
            digest: "a".repeat(64),
            bindingDigest: bindingDigest({
              kind: "git",
              origin: "https://example.test/skills.git",
              root: "skills",
              ref: "main",
            }),
            adoptedRevision: "b".repeat(40),
          },
        ],
        configs: {},
      })}\n`,
    );
    const core = createSkillCliCore({
      cwd: value.root,
      sourceTransport: () => {
        throw new Error("migration must not resolve a remote ref");
      },
    });
    await core.management.uninstall({ source: "remote", paths: ["review"] });
    expect(JSON.parse(await readFile(join(value.root, "state", "state.json"), "utf8"))).toEqual({
      version: 2,
      generation: 9,
      installed: [],
      configs: {},
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("MGMT-029 Rebind ignores advisory preview and rejects a newly removed owner without state publication", async () => {
  const value = await fixture();
  try {
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "first",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    await value.core.management.install({ source: "first", paths: ["one"] });
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "first": { "kind": "local", "path": "./skills", "root": "" }, "second": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    const before = await Bun.file(join(value.root, "state", "state.json")).text();
    expect(
      (await value.core.management.previewRebind({ source: "first", path: "one", owner: "second" }))
        .value,
    ).toMatchObject({ proof: "proven", allowed: true });
    const removedOwnerBytes =
      '{ "sources": { "first": { "kind": "local", "path": "./skills", "root": "" } } }\n';
    setManagementPublicationHookForTest(() =>
      writeFile(join(value.root, "skill-cli.jsonc"), removedOwnerBytes),
    );
    await expect(
      value.core.management.rebind({ source: "first", path: "one", owner: "second" }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await Bun.file(join(value.root, "state", "state.json")).text()).toBe(before);
    expect(await Bun.file(join(value.root, "skill-cli.jsonc")).text()).toBe(removedOwnerBytes);
    setManagementPublicationHookForTest();
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      '{ "sources": { "first": { "kind": "local", "path": "./skills", "root": "" }, "second": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    await value.core.management.rebind({ source: "first", path: "one", owner: "second" });
    expect((await value.core.workspace.get()).value.installedSkills[0]!.address.source).toBe(
      "second",
    );
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

test("private snapshot fixture publication cannot forge a Remote Installed identity", async () => {
  const value = await fixture();
  try {
    const coordinator = new (await import("../../src/core/internal/state")).StateCoordinator(
      join(value.root, "state"),
    );
    const digest = await coordinator.snapshotDigest(join(value.skills, "one"));
    const state = Bun.file(join(value.root, "state", "state.json"));
    expect(await state.exists()).toBe(false);
    await expect(
      coordinator.publishSnapshot("0".repeat(64), join(value.skills, "one")),
    ).rejects.toMatchObject({
      code: "PROVIDER_INTEGRITY_FAILED",
    });
    expect(await state.exists()).toBe(false);
    expect(await Bun.file(join(value.root, "state", "snapshots", digest)).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(value.root, { recursive: true, force: true });
  }
});

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

test("MGMT-006 Remote discovery installs the reviewed exact commit after the tracked ref moves", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-managed-git-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(work, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await git(work, "init");
    await git(work, "config", "user.email", "test@skill-cli.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    await writeFile(
      join(work, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Remote\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const revision = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    try {
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
      const observation = await core.management.discover({ source: "remote" });
      expect(observation.value.candidates.map((candidate) => candidate.path)).toEqual(["review"]);
      await writeFile(
        join(work, "skills", "review", "SKILL.md"),
        "---\nname: review\ndescription: Moved\n---\n",
      );
      await git(work, "add", ".");
      await git(work, "commit", "-m", "moved");
      await git(work, "push", "origin", "HEAD:main");
      await core.management.install({
        source: "remote",
        paths: ["review"],
        exactRevision: observation.value.exactRevision,
      });
      const state = JSON.parse(await Bun.file(join(root, "state", "state.json")).text());
      expect(state.installed[0]).toMatchObject({
        kind: "remote",
        path: "review",
        adoptedRevision: revision,
      });
      expect(
        await Bun.file(
          join(root, "state", "snapshots", state.installed[0].digest, "root", "SKILL.md"),
        ).exists(),
      ).toBe(true);
      expect(
        await Bun.file(
          join(root, "state", "snapshots", state.installed[0].digest, "root", "SKILL.md"),
        ).text(),
      ).toContain("description: Remote");
      expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).not.toContain("members");
      expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).not.toContain('"use"');
    } finally {
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-034 install rejects foreign paths, duplicate selections, unavailable commits, and binding drift without publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-install-integrity-"));
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
      "---\nname: review\ndescription: Remote\n---\n",
    );
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const core = createSkillCliCore({
      cwd: root,
      sourceTransport: () => bare,
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
    const observed = await core.management.discover({ source: "remote" });
    for (const request of [
      { source: "remote", paths: ["foreign"], exactRevision: observed.value.exactRevision },
      {
        source: "remote",
        paths: ["review", "review"],
        exactRevision: observed.value.exactRevision,
      },
      { source: "remote", paths: ["review"], exactRevision: "f".repeat(40) },
    ]) {
      await expect(core.management.install(request)).rejects.toMatchObject({
        code: expect.stringMatching(/SKILL_NOT_FOUND|INVALID_ARGUMENT|PINNED_COMMIT_UNAVAILABLE/),
      });
      expect(await Bun.file(join(root, "state", "state.json")).exists()).toBe(false);
    }
    const beforeConfig = await Bun.file(join(root, "skill-cli.jsonc")).text();
    setManagementPublicationHookForTest(() =>
      writeFile(
        join(root, "skill-cli.jsonc"),
        beforeConfig.replace('"root": "skills"', '"root": "other"'),
      ),
    );
    await expect(
      core.management.install({
        source: "remote",
        paths: ["review"],
        exactRevision: observed.value.exactRevision,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await Bun.file(join(root, "state", "state.json")).exists()).toBe(false);
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-006 GitHub discovery and install use its controlled API at the reviewed exact revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-managed-github-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  process.env.SKILL_CLI_STATE_DIR = join(root, "state");
  try {
    await mkdir(join(work, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await git(work, "init");
    await git(work, "config", "user.email", "test@skill-cli.invalid");
    await git(work, "config", "user.name", "Skill CLI");
    const skill = "---\nname: review\ndescription: GitHub\n---\n";
    await writeFile(join(work, "skills", "review", "SKILL.md"), skill);
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    const revision = await git(work, "rev-parse", "HEAD");
    await initBare(root, bare);
    await git(work, "remote", "add", "origin", bare);
    await git(work, "push", "origin", "HEAD:main");
    const blob = createHash("sha1")
      .update(`blob ${Buffer.byteLength(skill)}\0`)
      .update(skill)
      .digest("hex");
    const tree = "b".repeat(40);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === `/repos/acme/skills/commits/${revision}`)
          return Response.json({ sha: revision, commit: { tree: { sha: tree } } });
        if (path === `/repos/acme/skills/git/trees/${tree}`)
          return Response.json({
            sha: tree,
            truncated: false,
            tree: [
              { path: "skills", mode: "040000", type: "tree", sha: "c".repeat(40) },
              { path: "skills/review", mode: "040000", type: "tree", sha: "d".repeat(40) },
              {
                path: "skills/review/SKILL.md",
                mode: "100644",
                type: "blob",
                sha: blob,
                size: Buffer.byteLength(skill),
              },
            ],
          });
        if (path === `/repos/acme/skills/git/trees/${"c".repeat(40)}`)
          return Response.json({
            sha: "c".repeat(40),
            truncated: false,
            tree: [
              { path: "review", mode: "040000", type: "tree", sha: "d".repeat(40) },
              {
                path: "review/SKILL.md",
                mode: "100644",
                type: "blob",
                sha: blob,
                size: Buffer.byteLength(skill),
              },
            ],
          });
        if (path === `/repos/acme/skills/git/blobs/${blob}`)
          return Response.json({
            sha: blob,
            encoding: "base64",
            content: Buffer.from(skill).toString("base64"),
          });
        return Response.json({ message: "not found" }, { status: 404 });
      },
    });
    try {
      const core = createSkillCliCore({
        cwd: root,
        sourceTransport: (url) => (url === "https://github.com/acme/skills.git" ? bare : undefined),
        githubApiBaseUrl: server.url.toString(),
      });
      await core.configuration.change({
        type: "source.register",
        level: "project",
        id: "github",
        binding: {
          kind: "github",
          origin: "https://github.com/acme/skills.git",
          root: "skills",
          ref: "main",
        },
      });
      const observation = await core.management.discover({ source: "github" });
      expect(observation.value.candidates.map((candidate) => candidate.path)).toEqual(["review"]);
      await core.management.install({
        source: "github",
        paths: ["review"],
        exactRevision: observation.value.exactRevision,
      });
      const state = JSON.parse(await Bun.file(join(root, "state", "state.json")).text());
      expect(state.installed[0]).toMatchObject({ kind: "remote", adoptedRevision: revision });
      expect((await core.management.checkUpdate({ source: "github" })).value).toMatchObject({
        source: "github",
        kind: "github",
        exactRevision: revision,
        changed: [],
        added: [],
        removed: [],
        unchanged: [{ path: "review", name: "review", description: "GitHub" }],
      });
    } finally {
      server.stop(true);
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
