import { expect, test as bunTest } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changeConfiguration } from "../../src/configuration";
import { createSkillCliCore } from "../../src/create-core";
import { StateCoordinator } from "../../src/internal/state";
import { getWorkspace } from "../../src/workspace";

const test = bunTest.serial;

test("MGMT-001 creates only the selected Global Project or Local Source target with exact bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-source-targets-"));
  const global = join(root, "global", "config.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    const cases = [
      {
        level: "global" as const,
        id: "global",
        file: global,
        binding: { kind: "local" as const, path: "./skills", root: "" },
      },
      {
        level: "project" as const,
        id: "project",
        file: join(root, "skill-cli.jsonc"),
        binding: {
          kind: "git" as const,
          origin: "https://example.test/project.git",
          root: "skills",
          ref: "main",
        },
      },
      {
        level: "local" as const,
        id: "local",
        file: join(root, "skill-cli.local.jsonc"),
        binding: {
          kind: "github" as const,
          origin: "https://github.com/acme/local",
          root: "",
          ref: "stable",
        },
      },
    ];
    for (const item of cases) {
      const before = await Promise.all(
        cases.map((candidate) =>
          Bun.file(candidate.file)
            .text()
            .catch(() => undefined),
        ),
      );
      await core.configuration.change({
        type: "source.register",
        level: item.level,
        id: item.id,
        binding: item.binding,
      });
      expect(JSON.parse(await readFile(item.file, "utf8")).sources[item.id]).toEqual(item.binding);
      for (const [index, candidate] of cases.entries())
        if (candidate.file !== item.file && before[index] !== undefined)
          expect(await readFile(candidate.file, "utf8")).toBe(before[index]);
    }
    expect(await lstat(global)).toMatchObject({});
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub Source shorthand remains readable after registration", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-github-source-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root });

    await core.configuration.change({
      type: "source.register",
      level: "project",
      id: "example",
      binding: { kind: "github", origin: "acme/example", root: "skills", ref: "main" },
    });

    expect((await core.workspace.get()).value.effective.sources).toContainEqual(
      expect.objectContaining({
        id: "example",
        kind: "github",
        origin: "https://github.com/acme/example",
        root: "skills",
        ref: "main",
      }),
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("Use changes are atomic, report their locked delta, and reject duplicate set entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-use-changes-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ collections: { alpha: {}, beta: {} }, use: [] }),
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: join(root, "global.jsonc") });
    const [alpha, beta] = await Promise.all([
      core.configuration.change({ type: "use.add", level: "project", collection: "alpha" }),
      core.configuration.change({ type: "use.add", level: "project", collection: "beta" }),
    ]);
    expect(JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).use.sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(alpha.value.use).toMatchObject({ after: expect.any(Array) });
    expect(beta.value.use).toMatchObject({ after: expect.any(Array) });
    const removedAlpha = await core.configuration.change({
      type: "use.remove",
      level: "project",
      collection: "alpha",
    });
    const removedBeta = await core.configuration.change({
      type: "use.remove",
      level: "project",
      collection: "beta",
    });
    expect([...(removedAlpha.value.use?.before ?? [])].sort()).toEqual(["alpha", "beta"]);
    expect(removedAlpha.value.use?.after).toEqual(["beta"]);
    expect(removedBeta.value.use).toEqual({ before: ["beta"], after: [] });
    expect(JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).use).toEqual([]);
    await expect(
      core.configuration.change({
        type: "use.set",
        level: "project",
        collections: ["alpha", "alpha"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("global mutations work without a project but project targets remain strict", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-global-only-edit-"));
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  try {
    await mkdir(cwd);
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");

    await changeConfiguration(
      { cwd, userConfigPath: global },
      {
        type: "collection.create",
        level: "global",
        collection: "team",
      },
    );
    expect(JSON.parse(await readFile(global, "utf8")).collections.team).toEqual({});

    await expect(
      changeConfiguration(
        { cwd, userConfigPath: global },
        { type: "collection.create", level: "project", collection: "project-team" },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(
      changeConfiguration(
        { cwd, project: join(root, "missing"), userConfigPath: global },
        { type: "collection.create", level: "global", collection: "other-team" },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("global mutations without an explicit project do not start Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-global-no-git-"));
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  const bin = join(root, "bin");
  const gitCalled = join(root, "git-called");
  const previousPath = process.env.PATH;
  try {
    await mkdir(cwd);
    await mkdir(bin);
    await writeFile(join(bin, "git"), `#!/bin/sh\n: > "${gitCalled}"\nexit 1\n`, {
      mode: 0o755,
    });
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    process.env.PATH = `${bin}:${previousPath}`;

    await changeConfiguration(
      { cwd, userConfigPath: global },
      { type: "collection.create", level: "global", collection: "team" },
    );

    expect(await lstat(gitCalled).catch(() => undefined)).toBeUndefined();
    expect(JSON.parse(await readFile(global, "utf8")).collections.team).toEqual({});
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("global mutations ignore an invalid project config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-global-only-project-config-"));
  const global = join(root, "global", "config.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(join(root, "skill-cli.jsonc"), '{ "unknown": true }\n');

    await changeConfiguration(
      { cwd: root, userConfigPath: global },
      { type: "collection.create", level: "global", collection: "team" },
    );

    expect(JSON.parse(await readFile(global, "utf8")).collections.team).toEqual({});
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("collection declaration errors identify the collection, scope, and target config", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-declaration-error-"));
  const global = join(root, "global", "config.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await expect(
      changeConfiguration(
        { cwd: root, userConfigPath: global },
        {
          type: "collection.member.set",
          level: "global",
          collection: "team",
          name: "review",
          address: { source: "source", path: "review" },
        },
      ),
    ).rejects.toThrow(`Collection "team" is not directly declared at global scope in ${global}`);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("member removal distinguishes a missing Collection from a missing membership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-member-removal-error-"));
  const global = join(root, "global", "config.jsonc");
  try {
    await mkdir(join(root, "global"));
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(global, '{ "collections": { "team": {} } }\n');
    await expect(
      changeConfiguration(
        { cwd: root, userConfigPath: global },
        {
          type: "collection.member.remove",
          level: "global",
          collection: "missing",
          name: "review",
        },
      ),
    ).rejects.toThrow(`Collection "missing" is not directly declared at global scope in ${global}`);
    await expect(
      changeConfiguration(
        { cwd: root, userConfigPath: global },
        { type: "collection.member.remove", level: "global", collection: "team", name: "review" },
      ),
    ).rejects.toThrow(
      `Membership "review" is not directly declared in Collection "team" at global scope in ${global}`,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("local mutations remain strict without a project", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-local-no-project-"));
  const cwd = join(root, "outside-project");
  try {
    await mkdir(cwd);
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await expect(
      changeConfiguration(
        { cwd },
        { type: "collection.create", level: "local", collection: "team" },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("global mutations respect global Config Source contributions", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-global-contribution-owner-"));
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  const module = join(root, "module");
  try {
    await mkdir(cwd);
    await mkdir(module);
    await mkdir(join(root, "global"));
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      join(module, "config.jsonc"),
      '{ "sources": { "core": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    await writeFile(
      global,
      '{ "configSources": { "team": { "kind": "local", "path": "../module", "root": "" } } }\n',
    );
    await expect(
      changeConfiguration(
        { cwd, userConfigPath: global },
        {
          type: "source.register",
          level: "global",
          id: "team/core",
          binding: { kind: "local", path: "./other", root: "" },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("global mutations respect adopted Remote Config Source contributions", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-global-remote-contribution-owner-"));
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  const state = join(root, "state");
  try {
    await mkdir(cwd);
    await mkdir(join(root, "global"));
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      global,
      '{ "configSources": { "remote": { "kind": "git", "origin": "https://example.test/config.git", "root": "", "ref": "main" } } }\n',
    );
    await new StateCoordinator(state).publishRemoteConfig(
      "remote",
      "a".repeat(40),
      Buffer.from(
        '{ "sources": { "core": { "kind": "local", "path": "./skills", "root": "" } } }\n',
      ),
    );

    await expect(
      changeConfiguration(
        { cwd, userConfigPath: global },
        {
          type: "source.register",
          level: "global",
          id: "remote/core",
          binding: { kind: "local", path: "./other", root: "" },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

async function privateTree(root: string) {
  const output: Record<string, string> = {};
  async function collect(path: string, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      const key = join(prefix, entry.name);
      // The empty coordinator-owned tombstone parent is persistent infrastructure.
      if (key === "locks") continue;
      if (entry.isDirectory()) {
        output[`${key}/`] = "directory";
        await collect(child, key);
      } else output[key] = await readFile(child, "utf8");
    }
  }
  await collect(root);
  return output;
}

test("selected-target declaration edits preserve unrelated JSONC comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-edit-"));
  const config = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const initial = '{\n  // retain me\n  "collections": {}\n}\n';
    await writeFile(config, initial);
    await changeConfiguration(
      { cwd: root },
      {
        type: "source.register",
        level: "project",
        id: "local",
        binding: { kind: "local", path: "./skills", root: "" },
      },
    );
    const changed = await readFile(config, "utf8");
    expect(changed).toContain("// retain me");
    expect(changed.slice(0, changed.indexOf('"collections"'))).toBe(
      initial.slice(0, initial.indexOf('"collections"')),
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("direct qualified Source IDs remain editable while actual Config Source contributions are immutable", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-owner-"));
  const config = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(config, "{}\n");
    await changeConfiguration(
      { cwd: root },
      {
        type: "source.register",
        level: "project",
        id: "team/core",
        binding: { kind: "local", path: "./skills", root: "" },
      },
    );
    expect(await readFile(config, "utf8")).toContain('"team/core"');

    const reusable = join(root, "reusable");
    await mkdir(reusable);
    await writeFile(
      join(reusable, "config.jsonc"),
      '{ "sources": { "core": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    const host =
      '{ "configSources": { "team": { "kind": "local", "path": "./reusable", "root": "" } } }\n';
    await writeFile(config, host);
    await expect(
      changeConfiguration(
        { cwd: root },
        {
          type: "source.register",
          level: "project",
          id: "team/core",
          binding: { kind: "local", path: "./other", root: "" },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(config, "utf8")).toBe(host);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("Source Roots reject absolute, empty-interior, and escaping paths before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-root-validation-"));
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    for (const sourceRoot of ["/outside", "../outside", "one//two", "one/./two", ".", "one\\two"]) {
      await expect(
        changeConfiguration(
          { cwd: root },
          {
            type: "source.register",
            level: "project",
            id: "local",
            binding: { kind: "local", path: "./skills", root: sourceRoot },
          },
        ),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe("{}\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Config Source Roots reject invalid paths before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-source-root-validation-"));
  const config = join(root, "skill-cli.jsonc");
  try {
    await writeFile(config, "{}\n");
    for (const sourceRoot of ["/outside", "../outside", "one//two", "one/./two", ".", "one\\two"]) {
      await expect(
        changeConfiguration(
          { cwd: root },
          {
            type: "config-source.register",
            level: "project",
            id: "shared",
            binding: {
              kind: "git",
              origin: "https://example.test/config.git",
              root: sourceRoot,
              ref: "main",
            },
          },
        ),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(await readFile(config, "utf8")).toBe("{}\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid pre-existing host Config Source Roots block unrelated mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-existing-config-source-root-"));
  const config = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    for (const binding of [
      { kind: "local" as const, path: "./module", root: "." },
      {
        kind: "github" as const,
        origin: "acme/module",
        root: "one\\two",
        ref: "main",
      },
    ]) {
      const initial = JSON.stringify({ configSources: { shared: binding } });
      await writeFile(config, `${initial}\n`);
      await expect(
        changeConfiguration(
          { cwd: root },
          { type: "collection.create", level: "project", collection: "team" },
        ),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(await readFile(config, "utf8")).toBe(`${initial}\n`);
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("rejected configuration reads and edits leave declaration bytes untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-edit-reject-"));
  const config = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  process.env.SKILL_CLI_STATE_DIR = state;
  await mkdir(join(state, "snapshots"), { recursive: true });
  await mkdir(join(state, "configs"));
  await mkdir(join(state, "transactions"));
  await mkdir(join(state, "staging"));
  const initial = '{ "unknown": true }\n';
  await writeFile(config, initial);
  const before = await privateTree(state);
  await expect(
    changeConfiguration(
      { cwd: root },
      { type: "use.set", level: "project", collections: ["team"] },
    ),
  ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  expect(await readFile(config, "utf8")).toBe(initial);
  expect(await privateTree(state)).toEqual(before);

  const linked = join(root, "linked.jsonc");
  await symlink(config, linked);
  await expect(
    changeConfiguration(
      { cwd: root, userConfigPath: linked },
      {
        type: "source.register",
        level: "global",
        id: "team",
        binding: { kind: "local", path: "./skills", root: "" },
      },
    ),
  ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
  expect((await lstat(linked)).isSymbolicLink()).toBe(true);
  expect(await privateTree(state)).toEqual(before);
  delete process.env.SKILL_CLI_STATE_DIR;
});

test("invalid UTF-8 and oversized declarations are rejected without rewriting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-config-text-"));
  const config = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  process.env.SKILL_CLI_STATE_DIR = state;
  try {
    await mkdir(join(state, "snapshots"), { recursive: true });
    await mkdir(join(state, "configs"));
    await mkdir(join(state, "transactions"));
    await mkdir(join(state, "staging"));
    const invalid = Buffer.from([0xff, 0xfe]);
    await writeFile(config, invalid);
    const beforeInvalid = await privateTree(state);
    const invalidProjection = (await getWorkspace({ cwd: root })).value;
    expect(invalidProjection.configs.find((view) => view.level === "project")?.file.status).toBe(
      "invalid",
    );
    expect(invalidProjection.effective.status).toBe("unavailable");
    expect(await readFile(config)).toEqual(invalid);
    expect(await privateTree(state)).toEqual(beforeInvalid);

    const oversized = Buffer.alloc(1_048_577, 0x20);
    await writeFile(config, oversized);
    const beforeOversized = await privateTree(state);
    const oversizedProjection = (await getWorkspace({ cwd: root })).value;
    expect(oversizedProjection.configs.find((view) => view.level === "project")?.file.status).toBe(
      "invalid",
    );
    expect(oversizedProjection.effective.status).toBe("unavailable");
    expect((await readFile(config)).byteLength).toBe(oversized.byteLength);
    expect(await privateTree(state)).toEqual(beforeOversized);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-014 creates a real empty Collection and rejects duplicate creation atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-edit-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root });
    await core.configuration.change({
      type: "collection.create",
      level: "project",
      collection: "source",
    });
    await core.configuration.change({
      type: "collection.create",
      level: "project",
      collection: "target",
    });
    const parsed = JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8"));
    expect(parsed.collections.source).toEqual({});
    expect(parsed.collections.source.members).toBeUndefined();
    const duplicateBytes = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.configuration.change({
        type: "collection.create",
        level: "project",
        collection: "source",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(duplicateBytes);
    await core.configuration.change({
      type: "collection.reference.set",
      level: "project",
      collection: "source",
      name: "target",
      target: "target",
      description: "Target",
    });
    const impact = await core.configuration.previewCollectionRemoval({
      level: "project",
      collection: "target",
    });
    expect(impact.value).toMatchObject({
      allowed: false,
      blockers: [
        { reason: "reference", owner: { pointer: "/collections/source/references/target" } },
      ],
    });
    await expect(
      core.configuration.change({
        type: "collection.remove",
        level: "project",
        collection: "target",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await core.configuration.change({
      type: "collection.reference.remove",
      level: "project",
      collection: "source",
      name: "target",
    });
    await core.configuration.change({
      type: "collection.remove",
      level: "project",
      collection: "target",
    });
    expect(
      JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).collections.target,
    ).toBeUndefined();
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-014 creates empty Collections only at selected Global Project and Local levels", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-levels-"));
  const global = join(root, "global", "config.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    for (const [level, collection, file] of [
      ["global", "global", global],
      ["project", "project", join(root, "skill-cli.jsonc")],
      ["local", "local", join(root, "skill-cli.local.jsonc")],
    ] as const) {
      await core.configuration.change({ type: "collection.create", level, collection });
      expect(JSON.parse(await readFile(file, "utf8")).collections[collection]).toEqual({});
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-017 adds and removes a named direct Reference with zero member exposure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-reference-edit-"));
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ collections: { source: {}, target: {} } }),
    );
    const core = createSkillCliCore({ cwd: root });
    const preview = await core.configuration.previewReference({
      level: "project",
      collection: "source",
      name: "docs",
      target: "target",
      description: "Docs",
    });
    expect(preview.value).toMatchObject({
      allowed: true,
      exposure: [],
      owner: { pointer: "/collections/source" },
    });
    await core.configuration.change({
      type: "collection.reference.set",
      level: "project",
      collection: "source",
      name: "docs",
      target: "target",
      description: "Docs",
    });
    await core.configuration.change({
      type: "collection.reference.remove",
      level: "project",
      collection: "source",
      name: "docs",
      expected: { collection: "target", description: "Docs" },
    });
    expect(
      JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).collections.source
        .references,
    ).toEqual({});

    const module = join(root, "module");
    await mkdir(module);
    await writeFile(
      join(module, "config.jsonc"),
      JSON.stringify({
        collections: {
          contributed: {
            references: { docs: { collection: "target", description: "Docs" } },
          },
          target: {},
        },
      }),
    );
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        configSources: { shared: { kind: "local", path: "./module", root: "" } },
        collections: { target: {} },
      }),
    );
    const contributed = await core.configuration.previewReference({
      level: "project",
      collection: "shared/contributed",
      name: "docs",
      target: "target",
      description: "Docs",
      remove: true,
    });
    expect(contributed.value).toMatchObject({ decision: { kind: "contributed" }, allowed: false });
    const contributedTarget = await core.configuration.previewReference({
      level: "project",
      collection: "target",
      name: "shared",
      target: "shared/contributed",
      description: "Shared",
    });
    expect(contributedTarget.value).toMatchObject({
      referencedCollection: "shared/contributed",
      exposure: [],
      allowed: true,
    });
    const hostBytes = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.configuration.change({
        type: "collection.reference.remove",
        level: "project",
        collection: "shared/contributed",
        name: "docs",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(hostBytes);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-027 enables and disables managed OpenCode only at the selected Config level", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-managed-levels-"));
  const global = join(root, "global", "config.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await mkdir(join(root, "global"));
    await writeFile(global, "{}\n");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ collections: { team: {} }, use: ["team"] }),
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    for (const [level, file] of [
      ["global", global],
      ["project", join(root, "skill-cli.jsonc")],
      ["local", join(root, "skill-cli.local.jsonc")],
    ] as const) {
      await core.configuration.change({ type: "agent.managed.set", level, managed: true });
      expect(JSON.parse(await readFile(file, "utf8")).agents).toEqual({ opencode: "managed" });
      const projection = (await core.workspace.get()).value;
      expect(
        projection.configs.find((config) => config.level === level)!.direct.integrations,
      ).toHaveLength(1);
      expect(projection.effective.agent.status).toBe("available");
      expect(JSON.stringify(projection.effective.agent)).not.toMatch(/native|hybrid/u);
      await core.configuration.change({ type: "agent.managed.set", level, managed: false });
      expect(JSON.parse(await readFile(file, "utf8")).agents).toBeUndefined();
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-028 blocks invalid target and sibling graph edits while preserving unknown bytes and state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-invalid-mutation-"));
  const project = join(root, "skill-cli.jsonc");
  const local = join(root, "skill-cli.local.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    const unknown = Buffer.from([0xff, 0xfe, 0xfd]);
    await writeFile(project, "{ invalid\n");
    await writeFile(local, unknown);
    const beforeState = await privateTree(join(root, "state"));
    await expect(
      createSkillCliCore({ cwd: root }).configuration.change({
        type: "collection.create",
        level: "project",
        collection: "team",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await readFile(project, "utf8")).toBe("{ invalid\n");
    expect(await readFile(local)).toEqual(unknown);
    expect(await privateTree(join(root, "state"))).toEqual(beforeState);

    await writeFile(project, "{}\n");
    await rm(local);
    await symlink(project, local);
    const validTarget = await readFile(project, "utf8");
    await expect(
      createSkillCliCore({ cwd: root }).configuration.change({
        type: "collection.create",
        level: "project",
        collection: "team",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
    expect(await readFile(project, "utf8")).toBe(validTarget);
    expect((await lstat(local)).isSymbolicLink()).toBe(true);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-032 configuration mutations return focused facts and never embed Workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-focused-result-"));
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const result = await createSkillCliCore({ cwd: root }).configuration.change({
      type: "collection.create",
      level: "project",
      collection: "team",
    });
    expect(result.value).toEqual({
      level: "project",
      file: join(root, "skill-cli.jsonc"),
      changed: true,
    });
    expect("workspace" in result.value).toBe(false);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-015/018/020/021 revalidate direct ownership and dependencies under the mutation lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-stale-"));
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        collections: {
          source: {},
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const beforeMember = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.configuration.change({
        type: "collection.member.remove",
        level: "project",
        collection: "source",
        name: "review",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(beforeMember);

    await core.configuration.change({
      type: "collection.reference.set",
      level: "project",
      collection: "source",
      name: "target",
      target: "target",
      description: "late dependency",
    });
    const beforeRemoval = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.configuration.change({
        type: "collection.remove",
        level: "project",
        collection: "target",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(beforeRemoval);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-015/016/017 reject stale member, import, and Reference definitions without publishing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-operation-stale-"));
  const state = join(root, "state");
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "local", path: "review" } } },
          target: {
            members: { review: { source: "local", path: "review" } },
            references: { docs: { collection: "source", description: "Docs" } },
          },
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "local", path: "review" } } },
          target: {
            members: { review: { source: "other", path: "review" } },
            references: { docs: { collection: "source", description: "Changed" } },
          },
        },
      }),
    );
    const before = await readFile(file, "utf8");
    await expect(
      core.configuration.change({
        type: "collection.member.remove",
        level: "project",
        collection: "target",
        name: "review",
        expectedAddress: { source: "local", path: "review" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await expect(
      core.configuration.change({
        type: "collection.reference.remove",
        level: "project",
        collection: "target",
        name: "docs",
        expected: { collection: "source", description: "Docs" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-016 import validates all current source members atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-import-stale-"));
  const state = join(root, "state");
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "local", path: "review" } } },
          target: {},
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          source: {
            members: {
              review: { source: "local", path: "review" },
              keep: { source: "local", path: "keep" },
            },
          },
          target: { members: { keep: { source: "other", path: "keep" } } },
        },
      }),
    );
    const before = await readFile(file, "utf8");
    await expect(
      core.configuration.change({
        type: "collection.import",
        level: "project",
        from: "source",
        into: "target",
      }),
    ).rejects.toMatchObject({ code: "EXPOSURE_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-019 Link execution revalidates a stale preview without publishing conflicting bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-link-stale-"));
  const state = join(root, "state");
  const config = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: {},
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.configuration.previewLinkChange({
          level: "project",
          collection: "source",
          target: "target",
          linked: true,
        })
      ).value.allowed,
    ).toBe(true);
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "other", path: "review" } } },
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    const before = await readFile(config, "utf8");
    await expect(
      core.configuration.change({
        type: "collection.link.set",
        level: "project",
        collection: "source",
        target: "target",
        linked: true,
      }),
    ).rejects.toMatchObject({ code: "EXPOSURE_CONFLICT" });
    expect(await readFile(config, "utf8")).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-019 Link removal revalidates current alternatives and exact Link ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-link-remove-stale-"));
  const state = join(root, "state");
  const config = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: { links: ["target"] },
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.configuration.previewLinkChange({
          level: "project",
          collection: "source",
          target: "target",
          linked: false,
        })
      ).value.disappearingSelectors,
    ).toMatchObject([{ selector: "source:review" }]);
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: {
            members: { review: { source: "local", path: "review" } },
            links: ["target"],
          },
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    await core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: false,
    });
    expect(JSON.parse(await readFile(config, "utf8")).collections.source).toEqual({
      members: { review: { source: "local", path: "review" } },
      links: [],
    });
    const before = await readFile(config, "utf8");
    await expect(
      core.configuration.change({
        type: "collection.link.set",
        level: "project",
        collection: "source",
        target: "target",
        linked: false,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(config, "utf8")).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-019 Link execution uses current graph facts after a preview is blocked or becomes cyclic", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-link-current-"));
  const state = join(root, "state");
  const config = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "other", path: "review" } } },
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.configuration.previewLinkChange({
          level: "project",
          collection: "source",
          target: "target",
          linked: true,
        })
      ).value,
    ).toMatchObject({
      allowed: false,
      blockers: [
        {
          reason: "conflict",
          name: "review",
          existing: { address: { source: "other", path: "review" } },
          proposed: { address: { source: "local", path: "review" } },
        },
      ],
    });
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: {},
          target: { members: { review: { source: "local", path: "review" } } },
        },
      }),
    );
    await core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: true,
    });

    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: {},
          target: {},
        },
      }),
    );
    expect(
      (
        await core.configuration.previewLinkChange({
          level: "project",
          collection: "source",
          target: "target",
          linked: true,
        })
      ).value.allowed,
    ).toBe(true);
    await writeFile(
      config,
      JSON.stringify({
        collections: {
          source: {},
          target: { links: ["source"] },
        },
      }),
    );
    const before = await readFile(config, "utf8");
    await expect(
      core.configuration.change({
        type: "collection.link.set",
        level: "project",
        collection: "source",
        target: "target",
        linked: true,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(config, "utf8")).toBe(before);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-029 Collection Use rejects a newly incomplete graph unchanged then succeeds from current repaired facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-use-stale-"));
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    const complete = JSON.stringify({ collections: { team: {} } });
    await writeFile(file, complete);
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.configuration.previewCollectionUse({
          level: "project",
          collections: ["team"],
        })
      ).value.allowed,
    ).toBe(true);
    const incomplete = JSON.stringify({ collections: {} });
    await writeFile(file, incomplete);
    await expect(
      core.configuration.change({ type: "use.set", level: "project", collections: ["team"] }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(incomplete);
    await writeFile(file, complete);
    await core.configuration.change({ type: "use.set", level: "project", collections: ["team"] });
    expect(JSON.parse(await readFile(file, "utf8")).use).toEqual(["team"]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("MGMT-029 Collection removal rejects a newly introduced dependency unchanged then succeeds after removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-remove-stale-"));
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    const independent = JSON.stringify({ collections: { source: {}, target: {} } });
    await writeFile(file, independent);
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.configuration.previewCollectionRemoval({
          level: "project",
          collection: "target",
        })
      ).value.allowed,
    ).toBe(true);
    const dependent = JSON.stringify({
      collections: {
        source: { references: { target: { collection: "target", description: "Target" } } },
        target: {},
      },
    });
    await writeFile(file, dependent);
    await expect(
      core.configuration.change({
        type: "collection.remove",
        level: "project",
        collection: "target",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(dependent);
    await writeFile(file, independent);
    await core.configuration.change({
      type: "collection.remove",
      level: "project",
      collection: "target",
    });
    expect(JSON.parse(await readFile(file, "utf8")).collections.target).toBeUndefined();
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batches preview and publish one direct Collection delta atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-"));
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          team: {
            members: {
              old: { source: "local", path: "old" },
              keep: { source: "local", path: "keep" },
            },
          },
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const additions = [
      { name: "review", address: { source: "local", path: "review" } },
      { name: "docs", address: { source: "local", path: "docs" } },
    ];
    const removals = [{ name: "old", expectedAddress: { source: "local", path: "old" } }];

    const preview = await core.configuration.previewMembershipBatch({
      level: "project",
      collection: "team",
      additions,
      removals,
    });
    expect(preview.value).toMatchObject({
      decision: { kind: "direct", owner: { pointer: "/collections/team" } },
      additions,
      removals,
      affected: [
        { selector: "team:docs", address: additions[1]!.address },
        { selector: "team:old", address: removals[0]!.expectedAddress },
        { selector: "team:review", address: additions[0]!.address },
      ],
      blockers: [],
      allowed: true,
    });

    await core.configuration.change({
      type: "collection.members.change",
      level: "project",
      collection: "team",
      additions,
      removals,
      reviewedAffected: preview.value.affected,
    });
    expect(JSON.parse(await readFile(file, "utf8")).collections.team.members).toEqual({
      keep: { source: "local", path: "keep" },
      review: { source: "local", path: "review" },
      docs: { source: "local", path: "docs" },
    });
    const removalPreview = await core.configuration.previewMembershipBatch({
      level: "project",
      collection: "team",
      additions: [],
      removals: [
        { name: "review", expectedAddress: { source: "local", path: "review" } },
        { name: "docs", expectedAddress: { source: "local", path: "docs" } },
      ],
    });
    await core.configuration.change({
      type: "collection.members.change",
      level: "project",
      collection: "team",
      additions: [],
      removals: [
        { name: "review", expectedAddress: { source: "local", path: "review" } },
        { name: "docs", expectedAddress: { source: "local", path: "docs" } },
      ],
      reviewedAffected: removalPreview.value.affected,
    });
    expect(JSON.parse(await readFile(file, "utf8")).collections.team.members).toEqual({
      keep: { source: "local", path: "keep" },
    });

    const before = await readFile(file, "utf8");
    for (const [request, code] of [
      [
        { additions: [{ name: "keep", address: { source: "local", path: "one" } }], removals: [] },
        "CONFIG_CONFLICT",
      ],
      [
        {
          additions: [],
          removals: [{ name: "keep", expectedAddress: { source: "local", path: "changed" } }],
        },
        "CONFIG_CONFLICT",
      ],
      [
        {
          additions: [{ name: "same", address: { source: "local", path: "same" } }],
          removals: [{ name: "same", expectedAddress: { source: "local", path: "same" } }],
        },
        "INVALID_ARGUMENT",
      ],
    ] as const) {
      await expect(
        core.configuration.change({
          type: "collection.members.change",
          level: "project",
          collection: "team",
          ...request,
          reviewedAffected: [],
        }),
      ).rejects.toMatchObject({ code });
      expect(await readFile(file, "utf8")).toBe(before);
    }
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batches reject duplicate request names and contributed Collection ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-blocked-"));
  const module = join(root, "module");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await mkdir(module);
    await writeFile(join(module, "config.jsonc"), '{ "collections": { "team": {} } }\n');
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{ "configSources": { "shared": { "kind": "local", "path": "./module", "root": "" } } }\n',
    );
    const core = createSkillCliCore({ cwd: root });
    const request = {
      level: "project" as const,
      collection: "shared/team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    };
    expect((await core.configuration.previewMembershipBatch(request)).value).toMatchObject({
      decision: { kind: "contributed" },
      allowed: false,
    });
    const before = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.configuration.change({
        type: "collection.members.change",
        ...request,
        reviewedAffected: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(before);
    await expect(
      core.configuration.previewMembershipBatch({
        ...request,
        collection: "shared/team",
        additions: [
          { name: "review", address: { source: "local", path: "review" } },
          { name: "review", address: { source: "local", path: "docs" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batch preview includes direct and incoming Link selector deltas", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-links-"));
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        collections: {
          parent: { links: ["team"] },
          referenceParent: { references: { team: { collection: "team", description: "Team" } } },
          team: {},
        },
      }),
    );
    const preview = await createSkillCliCore({ cwd: root }).configuration.previewMembershipBatch({
      level: "project",
      collection: "team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    });
    expect(preview.value.affected).toMatchObject([
      { selector: "parent:review", address: { source: "local", path: "review" } },
      { selector: "team:review", address: { source: "local", path: "review" } },
    ]);
    expect(preview.value.affected.find((item) => item.selector === "parent:review")?.paths).toEqual(
      [expect.objectContaining({ kind: "via-link" })],
    );
    expect(preview.value.affected.some((item) => item.selector === "referenceParent:review")).toBe(
      false,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batch rejects a Link introduced after review without publishing bytes or state", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-reviewed-impact-"));
  const file = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await writeFile(file, JSON.stringify({ collections: { parent: {}, team: {} } }));
    const core = createSkillCliCore({ cwd: root });
    const request = {
      level: "project" as const,
      collection: "team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    };
    const preview = await core.configuration.previewMembershipBatch(request);
    expect(preview.value.affected).toMatchObject([
      { selector: "team:review", address: { source: "local", path: "review" } },
    ]);

    await core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "parent",
      target: "team",
      linked: true,
    });
    const before = await readFile(file, "utf8");
    const beforeState = await readFile(join(state, "state.json"), "utf8").catch(() => undefined);

    await expect(
      core.configuration.change({
        type: "collection.members.change",
        ...request,
        reviewedAffected: preview.value.affected,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readFile(join(state, "state.json"), "utf8").catch(() => undefined)).toBe(
      beforeState,
    );
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batch accepts an unrelated graph change after review", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-unrelated-impact-"));
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(file, JSON.stringify({ collections: { other: {}, parent: {}, team: {} } }));
    const core = createSkillCliCore({ cwd: root });
    const request = {
      level: "project" as const,
      collection: "team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    };
    const preview = await core.configuration.previewMembershipBatch(request);
    await core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "parent",
      target: "other",
      linked: true,
    });

    await expect(
      core.configuration.change({
        type: "collection.members.change",
        ...request,
        reviewedAffected: preview.value.affected,
      }),
    ).resolves.toMatchObject({ value: { changed: true } });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batch preview blocks unavailable effective management despite a direct owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-unavailable-"));
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(join(root, "skill-cli.jsonc"), '{ "collections": { "team": {} } }\n');
    await writeFile(join(root, "skill-cli.local.jsonc"), "{ invalid\n");
    const preview = await createSkillCliCore({ cwd: root }).configuration.previewMembershipBatch({
      level: "project",
      collection: "team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    });
    expect(preview.value).toMatchObject({
      decision: { kind: "direct", owner: { pointer: "/collections/team" } },
      blockers: [{ reason: "incomplete" }],
      allowed: false,
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batches normalize names and leave effectless deltas unpublished", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-noop-"));
  const file = join(root, "skill-cli.jsonc");
  const state = join(root, "state");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    const normalized = "caf\u00e9";
    const decomposed = "cafe\u0301";
    await writeFile(
      file,
      JSON.stringify({
        collections: { team: { members: { [normalized]: { source: "local", path: "cafe" } } } },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const preview = await core.configuration.previewMembershipBatch({
      level: "project",
      collection: "team",
      additions: [{ name: decomposed, address: { source: "local", path: "cafe" } }],
      removals: [],
    });
    expect(preview.value).toMatchObject({
      additions: [{ name: normalized, address: { source: "local", path: "cafe" } }],
      affected: [],
      effectful: false,
      allowed: true,
    });
    const before = await readFile(file, "utf8");
    const generation = (await new StateCoordinator(state).read()).generation;
    expect(
      (
        await core.configuration.change({
          type: "collection.members.change",
          level: "project",
          collection: "team",
          additions: [{ name: decomposed, address: { source: "local", path: "cafe" } }],
          removals: [],
          reviewedAffected: preview.value.affected,
        })
      ).value.changed,
    ).toBe(false);
    expect(await readFile(file, "utf8")).toBe(before);
    expect((await new StateCoordinator(state).read()).generation).toBe(generation);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("membership batches preserve all bytes for mixed valid and invalid changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-membership-batch-mixed-failure-"));
  const file = join(root, "skill-cli.jsonc");
  try {
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    await writeFile(
      file,
      JSON.stringify({
        collections: { team: { members: { old: { source: "local", path: "old" } } } },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const before = await readFile(file, "utf8");
    await expect(
      core.configuration.change({
        type: "collection.members.change",
        level: "project",
        collection: "team",
        additions: [{ name: "new", address: { source: "local", path: "new" } }],
        removals: [{ name: "old", expectedAddress: { source: "local", path: "changed" } }],
        reviewedAffected: [],
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
    expect(JSON.parse(await readFile(file, "utf8")).collections.team.members).toEqual({
      old: { source: "local", path: "old" },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
