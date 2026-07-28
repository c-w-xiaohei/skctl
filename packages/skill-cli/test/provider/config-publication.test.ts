import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/core/create-core";
import { setManagementPublicationHookForTest } from "../../src/core/management";

function assertPublicConfigImpact(value: unknown) {
  const forbidden = new Set([
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
    "snapshot",
    "target",
    "editable",
    "writable",
  ]);
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      expect(forbidden.has(key.toLowerCase())).toBe(false);
      visit(child);
    }
  };
  visit(JSON.parse(JSON.stringify(value)));
}

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}

test("MGMT-023 adopts the observed exact Remote Config commit after the tracked ref moves", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-publication-"));
  const state = join(root, "state");
  const remote = join(root, "remote");
  const bytes = Buffer.from(
    '{ "sources": { "shared": { "kind": "local", "path": "./skills", "root": "" } } }\n',
  );
  try {
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(join(remote, "config.jsonc"), bytes);
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observation = await core.management.observeConfig({ id: "remote" });
    await writeFile(join(remote, "config.jsonc"), "{}\n");
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "move after observation");
    await core.management.adoptConfig({
      id: "remote",
      exactRevision: observation.value.exactRevision,
    });
    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    expect(await readFile(join(state, "configs", digest, "config.jsonc"))).toEqual(bytes);
    expect((await core.workspace.get()).value.effective.sources.map((source) => source.id)).toEqual(
      ["remote/shared"],
    );
    const workspace = (await core.workspace.get()).value;
    expect(workspace.installedSkills).toEqual([]);
    expect(workspace.configs.flatMap((config) => config.direct.collectionUse)).toEqual([]);
    expect(workspace.configs.flatMap((config) => config.direct.integrations)).toEqual([]);
    await core.management.gc();
    expect(await Bun.file(join(state, "configs", digest, "config.jsonc")).exists()).toBe(true);
    await core.management.forgetConfig({ id: "remote" });
    await core.management.gc();
    expect(await Bun.file(join(state, "configs", digest, "config.jsonc")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-029 Config Source Adopt rejects a declaration changed after preview without cache or state publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-adopt-barrier-"));
  const state = join(root, "state");
  const remote = join(root, "remote");
  try {
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(join(remote, "config.jsonc"), "{}\n");
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const changedBytes =
      '{ "configSources": { "module": { "kind": "local", "path": "./module", "root": "changed" } } }\n';
    setManagementPublicationHookForTest(() =>
      writeFile(join(root, "skill-cli.jsonc"), changedBytes),
    );
    const observation = await core.management.observeConfig({ id: "remote" });
    expect(
      (
        await core.management.previewAdoptConfig({
          id: "remote",
          exactRevision: observation.value.exactRevision!,
        })
      ).value.allowed,
    ).toBe(true);
    await expect(
      core.management.adoptConfig({ id: "remote", exactRevision: observation.value.exactRevision }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await Bun.file(join(state, "state.json")).exists()).toBe(false);
    expect(await Bun.file(join(state, "configs")).exists()).toBe(false);
    expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).toBe(changedBytes);
    setManagementPublicationHookForTest();
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    await core.management.adoptConfig({
      id: "remote",
      exactRevision: observation.value.exactRevision,
    });
    expect(await Bun.file(join(state, "state.json")).text()).toContain(
      observation.value.exactRevision!,
    );
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("Config adoption cancellation before publication preserves state and cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-adopt-cancel-"));
  const state = join(root, "state");
  const remote = join(root, "remote");
  try {
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(join(remote, "config.jsonc"), "{}\n");
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observation = await core.management.observeConfig({ id: "remote" });
    const controller = new AbortController();
    setManagementPublicationHookForTest(() => controller.abort());
    await expect(
      core.management.adoptConfig(
        { id: "remote", exactRevision: observation.value.exactRevision },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await Bun.file(join(state, "state.json")).exists()).toBe(false);
    expect(await Bun.file(join(state, "configs")).exists()).toBe(false);
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("Config observation cancels a blocked real Git child without publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-observe-cancel-"));
  const state = join(root, "state");
  const bin = join(root, "bin");
  const ready = join(root, "ready");
  const pid = join(root, "pid");
  await mkdir(bin);
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
if [ "$3" = "init" ]; then
  : > "${ready}"
  printf '%s' "$$" > "${pid}"
  trap '' TERM
  i=0; while [ "$i" -lt 8192 ]; do printf 'blocked stderr %s\\n' "$i" >&2; i=$((i + 1)); done
  while :; do sleep 1; done
fi
exec /usr/bin/git "$@"
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const controller = new AbortController();
    const pending = createSkillCliCore({ cwd: root }).management.observeConfig(
      { id: "remote" },
      { signal: controller.signal },
    );
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await Bun.file(ready).exists()) break;
      await Bun.sleep(10);
    }
    expect(await Bun.file(ready).exists()).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    const blockedPid = Number(await readFile(pid, "utf8"));
    expect(() => process.kill(blockedPid, 0)).toThrow();
    expect(await Bun.file(join(state, "state.json")).exists()).toBe(false);
    expect(await Bun.file(join(state, "configs")).exists()).toBe(false);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-024 and MGMT-025 reject Config Source lifecycle changes that orphan an Installed owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-owner-"));
  const state = join(root, "state");
  const remote = join(root, "remote");
  try {
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(
      join(remote, "config.jsonc"),
      '{ "sources": { "skill": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "initial");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observation = await core.management.observeConfig({ id: "remote" });
    await core.management.adoptConfig({
      id: "remote",
      exactRevision: observation.value.exactRevision,
    });
    const before = await Bun.file(join(state, "state.json")).text();
    const parsed = JSON.parse(before);
    parsed.installed = [
      {
        source: "remote/skill",
        path: "review",
        root: join(root, "skills", "review"),
        name: "review",
        description: "Review",
        kind: "local",
        digest: "a".repeat(64),
        bindingDigest: "a".repeat(64),
        identityEvidence: { status: "unavailable" },
      },
    ];
    parsed.generation += 1;
    await writeFile(join(state, "state.json"), JSON.stringify(parsed));
    await expect(core.management.forgetConfig({ id: "remote" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).toContain('"remote"');
    await writeFile(join(remote, "config.jsonc"), "{}\n");
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "remove owner");
    const changed = await core.management.observeConfig({ id: "remote" });
    await expect(
      core.management.adoptConfig({ id: "remote", exactRevision: changed.value.exactRevision }),
    ).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await Bun.file(join(state, "state.json")).text()).toBe(JSON.stringify(parsed));
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-025 and MGMT-031 keep declaration removal management-owned for Local Config Sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-impact-"));
  const state = join(root, "state");
  const local = join(root, "module");
  try {
    await mkdir(local);
    await writeFile(join(local, "config.jsonc"), "{}\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "module": { "kind": "local", "path": "./module", "root": "" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root });
    const previews = await Promise.all([
      core.management.previewForgetConfig({ id: "module" }),
      core.management.previewRemoveConfig({ id: "module" }),
    ]);
    for (const preview of previews) {
      expect(preview.value).toMatchObject({
        id: "module",
        allowed: true,
        owner: { pointer: "/configSources/module" },
      });
      expect(JSON.stringify(preview.value)).not.toContain("digest");
    }
    await core.management.removeConfig({ id: "module" });
    expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).not.toContain('"module"');
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-024 previews exact Forget consequences while retaining the declaration", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-impact-exact-"));
  const state = join(root, "state");
  const remote = join(root, "remote");
  try {
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(
      join(remote, "config.jsonc"),
      JSON.stringify({
        sources: { shared: { kind: "local", path: "./skills", root: "" } },
        collections: { team: { members: { review: { source: "shared", path: "review" } } } },
      }),
    );
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observed = await core.management.observeConfig({ id: "remote" });
    if (!observed.value.exactRevision)
      throw new Error("Remote observation must include an exact revision");
    const before = await core.management.previewForgetConfig({ id: "remote" });
    expect(before.value).toMatchObject({
      declarationRetained: true,
      contributions: { sources: [], collections: [] },
      allowed: true,
    });
    const adopt = await core.management.previewAdoptConfig({
      id: "remote",
      exactRevision: observed.value.exactRevision,
    });
    expect(adopt.value).toMatchObject({
      exactRevision: observed.value.exactRevision,
      binding: { kind: "git", origin: "https://example.test/config", root: "", ref: "main" },
      contributions: {
        sources: [{ id: "remote/shared", owner: { pointer: "/sources/shared" } }],
        collections: [{ id: "remote/team", owner: { pointer: "/collections/team" } }],
      },
      delta: { addedSources: [{ id: "remote/shared" }], addedCollections: [{ id: "remote/team" }] },
    });
    assertPublicConfigImpact(adopt.value);
    await core.management.adoptConfig({
      id: "remote",
      exactRevision: observed.value.exactRevision,
    });
    const forget = await core.management.previewForgetConfig({ id: "remote" });
    expect(forget.value).toMatchObject({
      currentAppliedCommit: observed.value.exactRevision,
      declarationRetained: true,
      contributions: {
        sources: [{ id: "remote/shared" }],
        collections: [{ id: "remote/team" }],
      },
    });
    assertPublicConfigImpact(forget.value);
    assertPublicConfigImpact((await core.management.previewRemoveConfig({ id: "remote" })).value);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-025 removes an adopted Remote Config declaration and state atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-remove-remote-"));
  const remote = join(root, "remote");
  const host = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    await mkdir(remote);
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(join(remote, "config.jsonc"), "{}\n");
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    await writeFile(
      host,
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observed = await core.management.observeConfig({ id: "remote" });
    await core.management.adoptConfig({
      id: "remote",
      exactRevision: observed.value.exactRevision,
    });
    expect((await core.management.previewRemoveConfig({ id: "remote" })).value).toMatchObject({
      declarationRetained: false,
      allowed: true,
    });
    await core.management.removeConfig({ id: "remote" });
    expect(await readFile(host, "utf8")).not.toContain('"remote"');
    expect(await Bun.file(join(state, "state.json")).text()).not.toContain('"remote"');
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-034 rejects tampered foreign or unavailable Config observations without publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-observation-integrity-"));
  const remote = join(root, "remote");
  const state = join(root, "state");
  try {
    await mkdir(remote);
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(join(remote, "config.jsonc"), JSON.stringify({ collections: { team: {} } }));
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observed = (await core.management.observeConfig({ id: "remote" })).value;
    for (const observation of [
      { ...observed, id: "foreign" },
      { ...observed, exactRevision: "f".repeat(40) },
      { ...observed, contributions: { sources: [], collections: [] } },
    ])
      await expect(
        core.management.adoptConfig({
          id: "remote",
          exactRevision: observed.exactRevision,
          observation,
        }),
      ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await expect(
      core.management.adoptConfig({ id: "remote", exactRevision: "f".repeat(40) }),
    ).rejects.toMatchObject({ code: "PINNED_COMMIT_UNAVAILABLE" });
    expect(await Bun.file(join(state, "state.json")).exists()).toBe(false);
    expect(await Bun.file(join(state, "configs")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-029 declaration removal rejects stale host bytes and leaves execution-start bytes and state untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-remove-stale-"));
  const state = join(root, "state");
  const module = join(root, "module");
  try {
    await mkdir(module);
    await writeFile(join(module, "config.jsonc"), "{}\n");
    const host =
      '{ "configSources": { "module": { "kind": "local", "path": "./module", "root": "" } } }\n';
    await writeFile(join(root, "skill-cli.jsonc"), host);
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root });
    await core.management.previewRemoveConfig({ id: "module" });
    setManagementPublicationHookForTest(() => writeFile(join(root, "skill-cli.jsonc"), "{}\n"));
    await expect(core.management.removeConfig({ id: "module" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).toBe("{}\n");
    expect(await Bun.file(join(state, "state.json")).exists()).toBe(false);
    setManagementPublicationHookForTest();
    await writeFile(join(root, "skill-cli.jsonc"), host);
    await core.management.removeConfig({ id: "module" });
    expect(await Bun.file(join(root, "skill-cli.jsonc")).text()).not.toContain('"module"');
  } finally {
    setManagementPublicationHookForTest();
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-022 registers Local Git and GitHub Config Sources at exact G/P/L hosts with no adoption or disclosure side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-register-"));
  const global = join(root, "global", "config.jsonc");
  const module = join(root, "module");
  try {
    await mkdir(join(root, "global"));
    await mkdir(module);
    await writeFile(join(module, "config.jsonc"), "{}\n");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    const cases = [
      {
        level: "global" as const,
        id: "local",
        file: global,
        binding: { kind: "local" as const, path: "./../../module", root: "" },
      },
      {
        level: "project" as const,
        id: "git",
        file: join(root, "skill-cli.jsonc"),
        binding: {
          kind: "git" as const,
          origin: "https://example.test/config.git",
          root: "",
          ref: "main",
        },
      },
      {
        level: "local" as const,
        id: "github",
        file: join(root, "skill-cli.local.jsonc"),
        binding: {
          kind: "github" as const,
          origin: "https://github.com/acme/config",
          root: "config",
          ref: "stable",
        },
      },
    ];
    for (const item of cases)
      await core.configuration.change({
        type: "config-source.register",
        level: item.level,
        id: item.id,
        binding: item.binding,
      });
    const workspace = (await core.workspace.get()).value;
    for (const item of cases) {
      expect(JSON.parse(await readFile(item.file, "utf8")).configSources[item.id]).toEqual(
        item.binding,
      );
      const view = workspace.configs
        .find((config) => config.level === item.level)!
        .direct.configSources.find((source) => source.id === item.id)!;
      expect(view.owner).toMatchObject({
        level: item.level,
        file: item.file,
        pointer: `/configSources/${item.id}`,
      });
      expect(view.adoption.status).toBe(item.binding.kind === "local" ? "live" : "not-adopted");
      expect(view.contributed).toEqual({ sources: [], collections: [] });
    }
    expect(workspace.installedSkills).toEqual([]);
    expect(await Bun.file(join(root, "state", "state.json")).exists()).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-023 observes and previews Remote Config contributions at their Global, Project, and Local hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-host-level-"));
  const remote = join(root, "remote");
  const global = join(root, "global.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(
      join(remote, "config.jsonc"),
      JSON.stringify({
        sources: { shared: { kind: "local", path: "./skills", root: "" } },
        collections: { team: {} },
      }),
    );
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    const binding = { kind: "git", origin: "https://example.test/config", root: "", ref: "main" };
    await writeFile(global, JSON.stringify({ configSources: { "global-source": binding } }));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ configSources: { "project-source": binding } }),
    );
    await writeFile(
      join(root, "skill-cli.local.jsonc"),
      JSON.stringify({ configSources: { "local-source": binding } }),
    );
    for (const [level, id] of [
      ["global", "global-source"],
      ["project", "project-source"],
      ["local", "local-source"],
    ] as const) {
      const core = createSkillCliCore({
        cwd: root,
        userConfigPath: global,
        sourceTransport: () => remote,
      });
      const observed = await core.management.observeConfig({ id });
      const preview = await core.management.previewAdoptConfig({
        id,
        exactRevision: observed.value.exactRevision!,
      });
      for (const contribution of [
        ...observed.value.contributions.sources,
        ...observed.value.contributions.collections,
      ])
        expect(contribution.owner).toMatchObject({ level, pointer: expect.any(String) });
      for (const contribution of [
        ...preview.value.contributions.sources,
        ...preview.value.contributions.collections,
      ])
        expect(contribution.owner).toMatchObject({ level, pointer: expect.any(String) });
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-023 re-adoption compares current immutable contributions with the proposed exact revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-readopt-delta-"));
  const remote = join(root, "remote");
  const state = join(root, "state");
  try {
    await mkdir(remote, { recursive: true });
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(
      join(remote, "config.jsonc"),
      JSON.stringify({
        sources: {
          changed: { kind: "local", path: "./one", root: "" },
          removed: { kind: "local", path: "./removed", root: "" },
        },
        collections: {
          changed: { members: { one: { source: "changed", path: "review" } } },
          removed: {},
        },
      }),
    );
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "first");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config", "root": "", "ref": "main" } } }\n',
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const first = await core.management.observeConfig({ id: "remote" });
    await core.management.adoptConfig({ id: "remote", exactRevision: first.value.exactRevision! });
    const stateBefore = await readFile(join(state, "state.json"), "utf8");
    await writeFile(
      join(remote, "config.jsonc"),
      JSON.stringify({
        sources: {
          changed: { kind: "local", path: "./two", root: "" },
          added: { kind: "local", path: "./added", root: "" },
        },
        collections: {
          changed: { members: { two: { source: "changed", path: "review" } } },
          added: {},
        },
      }),
    );
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "second");
    const second = await core.management.observeConfig({ id: "remote" });
    const preview = await core.management.previewAdoptConfig({
      id: "remote",
      exactRevision: second.value.exactRevision!,
    });
    expect(preview.value).toMatchObject({
      currentAppliedCommit: first.value.exactRevision,
      exactRevision: second.value.exactRevision,
      delta: {
        changedSources: [{ id: "remote/changed" }],
        removedSources: [{ id: "remote/removed" }],
        addedSources: [{ id: "remote/added" }],
        changedCollections: [{ id: "remote/changed" }],
        removedCollections: [{ id: "remote/removed" }],
        addedCollections: [{ id: "remote/added" }],
      },
    });
    expect(await readFile(join(state, "state.json"), "utf8")).toBe(stateBefore);
    const equal = await core.management.previewAdoptConfig({
      id: "remote",
      exactRevision: first.value.exactRevision!,
    });
    expect(equal.value.delta).toEqual({
      addedSources: [],
      changedSources: [],
      removedSources: [],
      addedCollections: [],
      changedCollections: [],
      removedCollections: [],
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-029 Forget uses current dependency facts, rejects a new blocker unchanged, then succeeds after blocker removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-forget-stale-"));
  const remote = join(root, "remote");
  const host = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    await mkdir(remote);
    await git(remote, "init", "-b", "main");
    await git(remote, "config", "user.email", "test@skill-cli.invalid");
    await git(remote, "config", "user.name", "Skill CLI");
    await writeFile(join(remote, "config.jsonc"), JSON.stringify({ collections: { shared: {} } }));
    await git(remote, "add", ".");
    await git(remote, "commit", "-m", "config");
    const declaration = {
      configSources: {
        remote: {
          kind: "git",
          origin: "https://example.test/config",
          root: "",
          ref: "main",
        },
      },
    };
    await writeFile(host, JSON.stringify(declaration));
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root, sourceTransport: () => remote });
    const observed = await core.management.observeConfig({ id: "remote" });
    await core.management.adoptConfig({
      id: "remote",
      exactRevision: observed.value.exactRevision,
    });
    expect((await core.management.previewForgetConfig({ id: "remote" })).value.allowed).toBe(true);
    await writeFile(host, JSON.stringify({ ...declaration, use: ["remote/shared"] }));
    const executionBytes = await readFile(host, "utf8");
    const stateBytes = await readFile(join(state, "state.json"), "utf8");
    await expect(core.management.forgetConfig({ id: "remote" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await readFile(host, "utf8")).toBe(executionBytes);
    expect(await readFile(join(state, "state.json"), "utf8")).toBe(stateBytes);
    await writeFile(host, JSON.stringify(declaration));
    await core.management.forgetConfig({ id: "remote" });
    expect(await Bun.file(join(state, "state.json")).text()).not.toContain('"remote"');
    expect(await readFile(host, "utf8")).toContain('"remote"');
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
