import { expect, test as bunTest } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSkillCliCore } from "../../src/create-core";
import {
  StateCoordinator,
  setCoordinatorHookForTest,
  setSemanticStateReadHookForTest,
} from "../../src/storage/state";
import { getWorkspace } from "../../src/workspace/query";
import { forgetConfigSource, removeConfigSource } from "../../src/config/adoption";
import { readWorkspaceUnlocked } from "../../src/workspace/capture";
import { validateConfigBytes } from "../../src/config/document";

const test = bunTest.serial;

test("reviewed global Source removal works outside a project", async () => {
  const { root, cleanup } = await configResources("skill-cli-global-source-owner-");
  const file = join(root, "config.jsonc");
  try {
    await writeFile(
      file,
      JSON.stringify({ sources: { local: { kind: "local", path: "./skills", root: "" } } }),
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: file });
    const preview = await core.sources.previewRemoval({ source: "local" });
    expect(preview.value.allowed).toBe(true);
    await core.sources.remove({
      source: "local",
      level: "global",
      expectedOwner: preview.value.owner,
    });
    expect(JSON.parse(await readFile(file, "utf8")).sources).toEqual({});
  } finally {
    await cleanup();
  }
});

test("relation edits enforce the selected collection declaration at preview and publication", async () => {
  const { root, cleanup } = await configResources("skill-cli-relation-owner-");
  const file = join(root, "skill-cli.jsonc");
  try {
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          team: {
            references: { docs: { collection: "target", description: "Docs" } },
            links: ["target"],
          },
          target: {},
        },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const expectedOwner = {
      level: "project" as const,
      file: join(root, "other.jsonc"),
      pointer: "/collections/team",
    };
    const reference = {
      level: "project" as const,
      collection: "team",
      name: "docs",
      expected: { collection: "target", description: "Docs" },
      expectedOwner,
    };
    const link = {
      level: "project" as const,
      collection: "team",
      target: "target",
      linked: false,
      expectedOwner,
    };
    const before = await readFile(file, "utf8");
    await expect(core.collections.previewRemoveReference(reference)).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    await expect(core.collections.removeReference(reference)).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    await expect(core.collections.previewSetLink(link)).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    await expect(core.collections.setLink(link)).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
    const owner = { ...expectedOwner, file };
    await core.collections.removeReference({ ...reference, expectedOwner: owner });
    await core.collections.setLink({ ...link, expectedOwner: owner });
    expect(JSON.parse(await readFile(file, "utf8")).collections.team).toEqual({
      references: {},
      links: [],
    });
  } finally {
    await cleanup();
  }
});

test("global Link preview and publication work outside a project", async () => {
  const { root, cleanup } = await configResources("skill-cli-global-link-");
  const file = join(root, "config.jsonc");
  try {
    await writeFile(file, JSON.stringify({ collections: { source: {}, target: {} } }));
    const core = createSkillCliCore({ cwd: root, userConfigPath: file });
    const request = {
      level: "global" as const,
      collection: "source",
      target: "target",
      linked: true,
    };
    expect((await core.collections.previewSetLink(request)).value.allowed).toBe(true);
    await core.collections.setLink(request);
    expect(JSON.parse(await readFile(file, "utf8")).collections.source.links).toEqual(["target"]);
  } finally {
    await cleanup();
  }
});

test("cancellation during configuration validation prevents publication", async () => {
  const { root, cleanup } = await configResources("skill-cli-cancel-edit-");
  const file = join(root, "skill-cli.jsonc");
  const controller = new AbortController();
  try {
    await writeFile(file, "{}\n");
    setSemanticStateReadHookForTest(() => controller.abort());
    await expect(
      createSkillCliCore({ cwd: root }).collections.create(
        { level: "project", collection: "team" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readFile(file, "utf8")).toBe("{}\n");
  } finally {
    setSemanticStateReadHookForTest();
    await cleanup();
  }
});

test("single member preview uses the same strict name input as execution", async () => {
  const { root, cleanup } = await configResources("skill-cli-member-name-");
  try {
    const file = join(root, "skill-cli.jsonc");
    await writeFile(file, JSON.stringify({ collections: { team: {} } }));
    const core = createSkillCliCore({ cwd: root });
    const request = {
      level: "project" as const,
      collection: "team",
      name: " review ",
      address: { source: "local", path: "review" },
    };
    await expect(core.collections.previewAddMember(request)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(core.collections.addMember(request)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(JSON.parse(await readFile(file, "utf8")).collections.team).toEqual({});
  } finally {
    await cleanup();
  }
});

test("qualified Collection IDs do not change declaration owner interpretation", async () => {
  const { root, cleanup } = await configResources("skill-cli-qualified-owner-");
  const file = join(root, "skill-cli.jsonc");
  const collection = "team/members/docs";
  try {
    await writeFile(file, JSON.stringify({ collections: { [collection]: {}, target: {} } }));
    const core = createSkillCliCore({ cwd: root });
    const expectedOwner = {
      level: "project" as const,
      file,
      pointer: `/collections/${collection}`,
    };
    await core.collections.addMember({
      level: "project",
      collection,
      name: "review",
      address: { source: "local", path: "review" },
      expectedOwner,
    });
    await core.collections.addReference({
      level: "project",
      collection,
      name: "docs",
      target: "target",
      description: "Docs",
      expectedOwner,
    });
    const declaration = JSON.parse(await readFile(file, "utf8")).collections[collection];
    expect(declaration.members.review).toEqual({ source: "local", path: "review" });
    expect(declaration.references.docs).toEqual({ collection: "target", description: "Docs" });
  } finally {
    await cleanup();
  }
});

test("successful configuration publication does not depend on a later projection read", async () => {
  const { root, cleanup } = await configResources("skill-cli-committed-result-");
  const file = join(root, "skill-cli.jsonc");
  try {
    await writeFile(file, "{}\n");
    let published = false;
    setCoordinatorHookForTest((name) => {
      if (name === "rename-after") published = true;
    });
    setSemanticStateReadHookForTest(() => {
      if (published) throw new Error("post-commit projection unavailable");
    });
    const result = await createSkillCliCore({ cwd: root }).collections.create({
      level: "project",
      collection: "team",
    });
    expect(published).toBe(true);
    expect(result.value).toEqual({ level: "project", file, changed: true });
    expect(result.diagnostics).toMatchObject([
      { code: "WORKSPACE_REFRESH_FAILED", severity: "warning" },
    ]);
    expect(JSON.parse(await readFile(file, "utf8")).collections).toEqual({ team: {} });
  } finally {
    setCoordinatorHookForTest();
    setSemanticStateReadHookForTest();
    await cleanup();
  }
});

test("empty Use preview distinguishes a valid edit from an unavailable catalog", async () => {
  const { root, cleanup } = await configResources("skill-cli-empty-use-");
  try {
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ collections: { team: {} }, use: ["team"] }),
    );
    const core = createSkillCliCore({ cwd: root });
    expect((await core.use.previewSet({ level: "project", collections: [] })).value).toMatchObject({
      allowed: true,
      proposedComplete: false,
      blockers: [],
    });
    expect((await core.use.set({ level: "project", collections: [] })).value.use).toEqual({
      before: ["team"],
      after: [],
    });
  } finally {
    await cleanup();
  }
});

test("import preview reports adding direct members even when an equal Link already exposes them", async () => {
  const { root, cleanup } = await configResources("skill-cli-direct-import-");
  const file = join(root, "skill-cli.jsonc");
  try {
    const address = { source: "local", path: "review" };
    await writeFile(
      file,
      JSON.stringify({
        collections: { source: { members: { review: address } }, target: { links: ["source"] } },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const request = { level: "project" as const, from: "source", into: "target" };
    expect((await core.collections.previewImportMembers(request)).value).toMatchObject({
      allowed: true,
      additions: [{ name: "review", address }],
      skipped: [],
    });
    await core.collections.importMembers(request);
    expect(JSON.parse(await readFile(file, "utf8")).collections.target).toEqual({
      links: ["source"],
      members: { review: address },
    });
  } finally {
    await cleanup();
  }
});

test("reviewed declaration locations are checked at publication without changing bytes", async () => {
  const { root, cleanup } = await configResources("skill-cli-reviewed-owner-");
  const file = join(root, "skill-cli.jsonc");
  try {
    await writeFile(
      file,
      JSON.stringify({
        sources: { local: { kind: "local", path: "./skills", root: "" } },
        collections: { team: { members: { review: { source: "local", path: "review" } } } },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const before = await readFile(file, "utf8");
    const expectedOwner = { level: "project" as const, file, pointer: "/collections/team" };
    expect(
      (
        await core.collections.previewRemoveMember({
          level: "project",
          collection: "team",
          name: "review",
          expectedOwner,
        })
      ).value.allowed,
    ).toBe(true);
    await expect(
      core.collections.removeMember({
        level: "project",
        collection: "team",
        name: "review",
        expectedOwner: {
          level: "project",
          file: join(root, "other.jsonc"),
          pointer: "/collections/team/members/review",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await expect(
      core.sources.remove({
        source: "local",
        level: "project",
        expectedOwner: { level: "project", file, pointer: "/sources/other" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
    await core.collections.removeMember({
      level: "project",
      collection: "team",
      name: "review",
      expectedOwner: { level: "project", file, pointer: "/collections/team/members/review" },
    });
    expect(JSON.parse(await readFile(file, "utf8")).collections.team.members).toEqual({});
  } finally {
    await cleanup();
  }
});

async function configResources(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.SKILL_CLI_STATE_DIR;
  const state = join(root, "state");
  const cleanup = async () => {
    try {
      if (previous === undefined) delete process.env.SKILL_CLI_STATE_DIR;
      else process.env.SKILL_CLI_STATE_DIR = previous;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    return { root, state, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Config resource setup and cleanup failed");
    }
    throw error;
  }
}

test("config resources restore state and remove their root after a thrown operation", async () => {
  const previous = process.env.SKILL_CLI_STATE_DIR;
  process.env.SKILL_CLI_STATE_DIR = "outer-state";
  const failure = new Error("operation failed");
  let root: string | undefined;
  try {
    const resources = await configResources("skill-cli-cleanup-proof-");
    root = resources.root;
    try {
      throw failure;
    } finally {
      await resources.cleanup();
    }
  } catch (error) {
    expect(error).toBe(failure);
  } finally {
    try {
      expect(process.env.SKILL_CLI_STATE_DIR).toBe("outer-state");
      await expect(lstat(root!)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previous === undefined) delete process.env.SKILL_CLI_STATE_DIR;
      else process.env.SKILL_CLI_STATE_DIR = previous;
    }
  }
});

test("network is rejected by actual Project Local and reusable readers", async () => {
  const { root, cleanup } = await configResources("skill-cli-network-scopes-");
  const text = '{"network":{"proxy":"http://proxy.test:7890"}}';
  try {
    expect(() => validateConfigBytes(Buffer.from(text))).toThrow();
    for (const name of ["skill-cli.jsonc", "skill-cli.local.jsonc"]) {
      await writeFile(join(root, "skill-cli.jsonc"), "{}");
      await writeFile(join(root, name), text);
      expect(
        (await getWorkspace({ cwd: root, userConfigPath: join(root, "absent") })).value.effective
          .status,
      ).toBe("unavailable");
      await rm(join(root, name));
    }
    await mkdir(join(root, "module"));
    await writeFile(join(root, "module", "config.jsonc"), text);
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{"configSources":{"module":{"kind":"local","path":"./module","root":""}}}',
    );
    expect(
      (await getWorkspace({ cwd: root, userConfigPath: join(root, "absent") })).value.effective
        .status,
    ).toBe("unavailable");
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{"configSources":{"module":{"kind":"git","origin":"https://example.test/module.git","root":"","ref":"main"}}}',
    );
    const coordinator = new StateCoordinator();
    const override = { id: "module", commit: "a".repeat(40), value: JSON.parse(text) };
    const preview = await coordinator.withLock(() =>
      readWorkspaceUnlocked(
        { cwd: root, userConfigPath: join(root, "absent") },
        coordinator,
        override,
      ),
    );
    expect(preview.value.effective.status).toBe("unavailable");
  } finally {
    await cleanup();
  }
});

test("both manual Config state writers emit v3 and retain unrelated Remote tree evidence", async () => {
  const { root, cleanup } = await configResources("skill-cli-config-state-v3-");
  try {
    await writeFile(
      join(root, "skill-cli.jsonc"),
      '{"configSources":{"one":{"kind":"git","origin":"https://example.test/one.git","root":"","ref":"main"},"two":{"kind":"git","origin":"https://example.test/two.git","root":"","ref":"main"}}}',
    );
    const options = { cwd: root, userConfigPath: join(root, "missing") };
    const coordinator = new StateCoordinator();
    const digest = new Bun.CryptoHasher("sha256").update("{}").digest("hex");
    await coordinator.publishRemoteConfig("one", "a".repeat(40), Buffer.from("{}"));
    await coordinator.publishRemoteConfig("two", "a".repeat(40), Buffer.from("{}"));
    const item = {
      kind: "remote" as const,
      source: "retained",
      path: "review",
      name: "review",
      description: "Review",
      digest: "b".repeat(64),
      bindingDigest: "c".repeat(64),
      adoptedRevision: "a".repeat(40),
      identityEvidence: {
        status: "known" as const,
        canonicalOrigin: "https://example.test/retained.git",
        originRelativeSkillRoot: "skills/review",
      },
      treeIdentity: { objectFormat: "sha1" as const, objectId: "d".repeat(40) },
    };
    await coordinator.withLock(() =>
      coordinator.write(
        {
          installed: [item],
          configs: {
            one: { commit: "a".repeat(40), digest },
            two: { commit: "a".repeat(40), digest },
          },
        },
        2,
      ),
    );
    await forgetConfigSource(options, "one");
    expect(await coordinator.read()).toMatchObject({
      version: 3,
      generation: 4,
      installed: [item],
    });
    await removeConfigSource(options, "two");
    expect(await coordinator.read()).toEqual({
      version: 3,
      generation: 5,
      installed: [item],
      configs: {},
    });
  } finally {
    await cleanup();
  }
});

test("missing user document inherits but inaccessible user parent fails closed", async () => {
  const { root, cleanup } = await configResources("skill-cli-network-permissions-");
  const parent = join(root, "private");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    await mkdir(parent);
    const options = { cwd: root, userConfigPath: join(parent, "policy.jsonc") };
    expect((await getWorkspace(options)).value.effective.status).toBe("complete");
    await writeFile(options.userConfigPath, '{"network":{"proxy":"http://proxy.test:7890"}}');
    await chmod(parent, 0);
    const unavailable = (await getWorkspace(options)).value;
    expect(unavailable.effective.status).toBe("unavailable");
    expect(unavailable.configs.find((item) => item.level === "global")?.file.status).not.toBe(
      "missing",
    );
  } finally {
    try {
      await chmod(parent, 0o700);
    } finally {
      await cleanup();
    }
  }
});

test("user proxy survives JSONC declaration edits and never enters Workspace or binding facts", async () => {
  const { root, cleanup } = await configResources("skill-cli-user-network-");
  const global = join(root, "user", "config.jsonc");
  try {
    await mkdir(join(root, "user"));
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const proxy = "http://user:secret@proxy.test:7890";
    await writeFile(
      global,
      `{\n // keep network comment\n "network": { "proxy": "${proxy}" }\n}\n`,
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    await core.sources.register({
      level: "global",
      id: "team",
      binding: {
        kind: "git",
        origin: "https://example.test/repo.git",
        root: "skills",
        ref: "main",
      },
    });
    const before = (await core.workspace.get()).value;
    expect(before.effective.status).toBe("complete");
    const baseline = await core.installed.updateBaseline({ source: "team" });
    expect(JSON.stringify(before)).not.toContain("secret");
    expect(await readFile(global, "utf8")).toContain("// keep network comment");
    await core.collections.create({ level: "global", collection: "team" });
    expect(await readFile(global, "utf8")).toContain(proxy);
    await writeFile(
      global,
      (await readFile(global, "utf8")).replace(proxy, "https://other.test:8443"),
    );
    expect((await core.workspace.get()).value.effective.sources).toEqual(before.effective.sources);
    expect(await core.installed.updateBaseline({ source: "team" })).toEqual(baseline);
  } finally {
    await cleanup();
  }
});

test("MGMT-001 creates only the selected Global Project or Local Source target with exact bindings", async () => {
  const { root, cleanup } = await configResources("skill-cli-source-targets-");
  const global = join(root, "global", "config.jsonc");
  try {
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
      await core.sources.register({ level: item.level, id: item.id, binding: item.binding });
      expect(JSON.parse(await readFile(item.file, "utf8")).sources[item.id]).toEqual(item.binding);
      for (const [index, candidate] of cases.entries())
        if (candidate.file !== item.file && before[index] !== undefined)
          expect(await readFile(candidate.file, "utf8")).toBe(before[index]);
    }
    expect(await lstat(global)).toMatchObject({});
  } finally {
    await cleanup();
  }
});

test("GitHub Source shorthand remains readable after registration", async () => {
  const { root, cleanup } = await configResources("skill-cli-github-source-");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root });

    await core.sources.register({
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
    await cleanup();
  }
});

test("Use changes are atomic, report their locked delta, and reject duplicate set entries", async () => {
  const { root, cleanup } = await configResources("skill-cli-use-changes-");
  try {
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ collections: { alpha: {}, beta: {} }, use: [] }),
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: join(root, "global.jsonc") });
    const [alpha, beta] = await Promise.all([
      core.use.add({ level: "project", collection: "alpha" }),
      core.use.add({ level: "project", collection: "beta" }),
    ]);
    expect(JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).use.sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(alpha.value.use).toMatchObject({ after: expect.any(Array) });
    expect(beta.value.use).toMatchObject({ after: expect.any(Array) });
    const removedAlpha = await core.use.remove({ level: "project", collection: "alpha" });
    const removedBeta = await core.use.remove({ level: "project", collection: "beta" });
    expect([...(removedAlpha.value.use?.before ?? [])].sort()).toEqual(["alpha", "beta"]);
    expect(removedAlpha.value.use?.after).toEqual(["beta"]);
    expect(removedBeta.value.use).toEqual({ before: ["beta"], after: [] });
    expect(JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).use).toEqual([]);
    await expect(
      core.use.set({ level: "project", collections: ["alpha", "alpha"] }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    await cleanup();
  }
});

test("global mutations work without a project but project targets remain strict", async () => {
  const { root, cleanup } = await configResources("skill-cli-global-only-edit-");
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  try {
    await mkdir(cwd);

    await createSkillCliCore({ cwd, userConfigPath: global }).collections.create({
      level: "global",
      collection: "team",
    });
    expect(JSON.parse(await readFile(global, "utf8")).collections.team).toEqual({});

    await expect(
      createSkillCliCore({ cwd, userConfigPath: global }).collections.create({
        level: "project",
        collection: "project-team",
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(
      createSkillCliCore({
        cwd,
        project: join(root, "missing"),
        userConfigPath: global,
      }).collections.create({ level: "global", collection: "other-team" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  } finally {
    await cleanup();
  }
});

test("global mutations without an explicit project do not start Git", async () => {
  const { root, cleanup } = await configResources("skill-cli-global-no-git-");
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
    process.env.PATH = `${bin}:${previousPath}`;

    await createSkillCliCore({ cwd, userConfigPath: global }).collections.create({
      level: "global",
      collection: "team",
    });

    expect(await lstat(gitCalled).catch(() => undefined)).toBeUndefined();
    expect(JSON.parse(await readFile(global, "utf8")).collections.team).toEqual({});
  } finally {
    try {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    } finally {
      await cleanup();
    }
  }
});

test("global mutations ignore an invalid project config", async () => {
  const { root, cleanup } = await configResources("skill-cli-global-only-project-config-");
  const global = join(root, "global", "config.jsonc");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), '{ "unknown": true }\n');

    await createSkillCliCore({ cwd: root, userConfigPath: global }).collections.create({
      level: "global",
      collection: "team",
    });

    expect(JSON.parse(await readFile(global, "utf8")).collections.team).toEqual({});
  } finally {
    await cleanup();
  }
});

test("collection declaration errors identify the collection, scope, and target config", async () => {
  const { root, cleanup } = await configResources("skill-cli-collection-declaration-error-");
  const global = join(root, "global", "config.jsonc");
  try {
    await expect(
      createSkillCliCore({ cwd: root, userConfigPath: global }).collections.addMember({
        level: "global",
        collection: "team",
        name: "review",
        address: { source: "source", path: "review" },
      }),
    ).rejects.toThrow(`Collection "team" is not directly declared at global scope in ${global}`);
  } finally {
    await cleanup();
  }
});

test("member removal distinguishes a missing Collection from a missing membership", async () => {
  const { root, cleanup } = await configResources("skill-cli-member-removal-error-");
  const global = join(root, "global", "config.jsonc");
  try {
    await mkdir(join(root, "global"));
    await writeFile(global, '{ "collections": { "team": {} } }\n');
    await expect(
      createSkillCliCore({ cwd: root, userConfigPath: global }).collections.removeMember({
        level: "global",
        collection: "missing",
        name: "review",
      }),
    ).rejects.toThrow(`Collection "missing" is not directly declared at global scope in ${global}`);
    await expect(
      createSkillCliCore({ cwd: root, userConfigPath: global }).collections.removeMember({
        level: "global",
        collection: "team",
        name: "review",
      }),
    ).rejects.toThrow(
      `Membership "review" is not directly declared in Collection "team" at global scope in ${global}`,
    );
  } finally {
    await cleanup();
  }
});

test("local mutations remain strict without a project", async () => {
  const { root, cleanup } = await configResources("skill-cli-local-no-project-");
  const cwd = join(root, "outside-project");
  try {
    await mkdir(cwd);
    await expect(
      createSkillCliCore({ cwd }).collections.create({ level: "local", collection: "team" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  } finally {
    await cleanup();
  }
});

test("global mutations respect global Config Source contributions", async () => {
  const { root, cleanup } = await configResources("skill-cli-global-contribution-owner-");
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  const module = join(root, "module");
  try {
    await mkdir(cwd);
    await mkdir(module);
    await mkdir(join(root, "global"));
    await writeFile(
      join(module, "config.jsonc"),
      '{ "sources": { "core": { "kind": "local", "path": "./skills", "root": "" } } }\n',
    );
    await writeFile(
      global,
      '{ "configSources": { "team": { "kind": "local", "path": "../module", "root": "" } } }\n',
    );
    await expect(
      createSkillCliCore({ cwd, userConfigPath: global }).sources.register({
        level: "global",
        id: "team/core",
        binding: { kind: "local", path: "./other", root: "" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    await cleanup();
  }
});

test("global mutations respect adopted Remote Config Source contributions", async () => {
  const { root, state, cleanup } = await configResources(
    "skill-cli-global-remote-contribution-owner-",
  );
  const cwd = join(root, "outside-project");
  const global = join(root, "global", "config.jsonc");
  try {
    await mkdir(cwd);
    await mkdir(join(root, "global"));
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
      createSkillCliCore({ cwd, userConfigPath: global }).sources.register({
        level: "global",
        id: "remote/core",
        binding: { kind: "local", path: "./other", root: "" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    await cleanup();
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
  const { root, cleanup } = await configResources("skill-cli-edit-");
  const config = join(root, "skill-cli.jsonc");
  try {
    const initial = '{\n  // retain me\n  "collections": {}\n}\n';
    await writeFile(config, initial);
    await createSkillCliCore({ cwd: root }).sources.register({
      level: "project",
      id: "local",
      binding: { kind: "local", path: "./skills", root: "" },
    });
    const changed = await readFile(config, "utf8");
    expect(changed).toContain("// retain me");
    expect(changed.slice(0, changed.indexOf('"collections"'))).toBe(
      initial.slice(0, initial.indexOf('"collections"')),
    );
  } finally {
    await cleanup();
  }
});

test("direct qualified Source IDs remain editable while actual Config Source contributions are immutable", async () => {
  const { root, cleanup } = await configResources("skill-cli-config-owner-");
  const config = join(root, "skill-cli.jsonc");
  try {
    await writeFile(config, "{}\n");
    await createSkillCliCore({ cwd: root }).sources.register({
      level: "project",
      id: "team/core",
      binding: { kind: "local", path: "./skills", root: "" },
    });
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
      createSkillCliCore({ cwd: root }).sources.register({
        level: "project",
        id: "team/core",
        binding: { kind: "local", path: "./other", root: "" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(config, "utf8")).toBe(host);
  } finally {
    await cleanup();
  }
});

test("Source Roots reject absolute, empty-interior, and escaping paths before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-root-validation-"));
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    for (const sourceRoot of ["/outside", "../outside", "one//two", "one/./two", ".", "one\\two"]) {
      await expect(
        createSkillCliCore({ cwd: root }).sources.register({
          level: "project",
          id: "local",
          binding: { kind: "local", path: "./skills", root: sourceRoot },
        }),
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
        createSkillCliCore({ cwd: root }).configSources.register({
          level: "project",
          id: "shared",
          binding: {
            kind: "git",
            origin: "https://example.test/config.git",
            root: sourceRoot,
            ref: "main",
          },
        }),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(await readFile(config, "utf8")).toBe("{}\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid pre-existing host Config Source Roots block unrelated mutations", async () => {
  const { root, cleanup } = await configResources("skill-cli-existing-config-source-root-");
  const config = join(root, "skill-cli.jsonc");
  try {
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
        createSkillCliCore({ cwd: root }).collections.create({
          level: "project",
          collection: "team",
        }),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      expect(await readFile(config, "utf8")).toBe(`${initial}\n`);
    }
  } finally {
    await cleanup();
  }
});

test("rejected configuration reads and edits leave declaration bytes untouched", async () => {
  const { root, state, cleanup } = await configResources("skill-cli-edit-reject-");
  const config = join(root, "skill-cli.jsonc");
  try {
    await mkdir(join(state, "snapshots"), { recursive: true });
    await mkdir(join(state, "configs"));
    await mkdir(join(state, "transactions"));
    await mkdir(join(state, "staging"));
    const initial = '{ "unknown": true }\n';
    await writeFile(config, initial);
    const before = await privateTree(state);
    await expect(
      createSkillCliCore({ cwd: root }).use.set({ level: "project", collections: ["team"] }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await readFile(config, "utf8")).toBe(initial);
    expect(await privateTree(state)).toEqual(before);

    const linked = join(root, "linked.jsonc");
    await symlink(config, linked);
    await expect(
      createSkillCliCore({ cwd: root, userConfigPath: linked }).sources.register({
        level: "global",
        id: "team",
        binding: { kind: "local", path: "./skills", root: "" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await privateTree(state)).toEqual(before);
  } finally {
    await cleanup();
  }
});

test("invalid UTF-8 and oversized declarations are rejected without rewriting them", async () => {
  const { root, state, cleanup } = await configResources("skill-cli-config-text-");
  const config = join(root, "skill-cli.jsonc");
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
    await cleanup();
  }
});

test("MGMT-014 creates a real empty Collection and rejects duplicate creation atomically", async () => {
  const { root, cleanup } = await configResources("skill-cli-collection-edit-");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root });
    await core.collections.create({ level: "project", collection: "source" });
    await core.collections.create({ level: "project", collection: "target" });
    const parsed = JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8"));
    expect(parsed.collections.source).toEqual({});
    expect(parsed.collections.source.members).toBeUndefined();
    const duplicateBytes = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.collections.create({ level: "project", collection: "source" }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(duplicateBytes);
    await core.collections.addReference({
      level: "project",
      collection: "source",
      name: "target",
      target: "target",
      description: "Target",
    });
    const impact = await core.collections.previewRemoval({
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
      core.collections.remove({ level: "project", collection: "target" }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await core.collections.removeReference({
      level: "project",
      collection: "source",
      name: "target",
    });
    await core.collections.remove({ level: "project", collection: "target" });
    expect(
      JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).collections.target,
    ).toBeUndefined();
  } finally {
    await cleanup();
  }
});

test("MGMT-014 creates empty Collections only at selected Global Project and Local levels", async () => {
  const { root, cleanup } = await configResources("skill-cli-collection-levels-");
  const global = join(root, "global", "config.jsonc");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    for (const [level, collection, file] of [
      ["global", "global", global],
      ["project", "project", join(root, "skill-cli.jsonc")],
      ["local", "local", join(root, "skill-cli.local.jsonc")],
    ] as const) {
      await core.collections.create({ level, collection });
      expect(JSON.parse(await readFile(file, "utf8")).collections[collection]).toEqual({});
    }
  } finally {
    await cleanup();
  }
});

test("MGMT-017 adds and removes a named direct Reference with zero member exposure", async () => {
  const { root, cleanup } = await configResources("skill-cli-reference-edit-");
  try {
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({ collections: { source: {}, target: {} } }),
    );
    const core = createSkillCliCore({ cwd: root });
    const preview = await core.collections.previewAddReference({
      level: "project",
      collection: "source",
      name: "docs",
      target: "target",
      description: "Docs",
    });
    expect(preview.value).toMatchObject({
      allowed: true,
      owner: { pointer: "/collections/source" },
    });
    await core.collections.addReference({
      level: "project",
      collection: "source",
      name: "docs",
      target: "target",
      description: "Docs",
    });
    await core.collections.removeReference({
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
    const contributed = await core.collections.previewRemoveReference({
      level: "project",
      collection: "shared/contributed",
      name: "docs",
      expected: { collection: "target", description: "Docs" },
    });
    expect(contributed.value).toMatchObject({ decision: { kind: "contributed" }, allowed: false });
    const contributedTarget = await core.collections.previewAddReference({
      level: "project",
      collection: "target",
      name: "shared",
      target: "shared/contributed",
      description: "Shared",
    });
    expect(contributedTarget.value).toMatchObject({
      referencedCollection: "shared/contributed",
      allowed: true,
    });
    const hostBytes = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.collections.removeReference({
        level: "project",
        collection: "shared/contributed",
        name: "docs",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(hostBytes);
  } finally {
    await cleanup();
  }
});

test("MGMT-027 enables and disables managed OpenCode only at the selected Config level", async () => {
  const { root, cleanup } = await configResources("skill-cli-managed-levels-");
  const global = join(root, "global", "config.jsonc");
  try {
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
      await core.setManagedOpenCode({ level, managed: true });
      expect(JSON.parse(await readFile(file, "utf8")).agents).toEqual({ opencode: "managed" });
      const projection = (await core.workspace.get()).value;
      expect(
        projection.configs.find((config) => config.level === level)!.direct.integrations,
      ).toHaveLength(1);
      expect(projection.effective.agent.status).toBe("available");
      expect(JSON.stringify(projection.effective.agent)).not.toMatch(/native|hybrid/u);
      await core.setManagedOpenCode({ level, managed: false });
      expect(JSON.parse(await readFile(file, "utf8")).agents).toBeUndefined();
    }
  } finally {
    await cleanup();
  }
});

test("MGMT-028 blocks invalid target and sibling graph edits while preserving unknown bytes and state", async () => {
  const { root, cleanup } = await configResources("skill-cli-invalid-mutation-");
  const project = join(root, "skill-cli.jsonc");
  const local = join(root, "skill-cli.local.jsonc");
  try {
    const unknown = Buffer.from([0xff, 0xfe, 0xfd]);
    await writeFile(project, "{ invalid\n");
    await writeFile(local, unknown);
    const beforeState = await privateTree(join(root, "state"));
    await expect(
      createSkillCliCore({ cwd: root }).collections.create({
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
      createSkillCliCore({ cwd: root }).collections.create({
        level: "project",
        collection: "team",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_SYMLINK" });
    expect(await readFile(project, "utf8")).toBe(validTarget);
    expect((await lstat(local)).isSymbolicLink()).toBe(true);
  } finally {
    await cleanup();
  }
});

test("MGMT-032 configuration mutations return focused facts and never embed Workspace", async () => {
  const { root, cleanup } = await configResources("skill-cli-focused-result-");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
    const result = await createSkillCliCore({ cwd: root }).collections.create({
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
    await cleanup();
  }
});

test("MGMT-015/018/020/021 revalidate direct ownership and dependencies under the mutation lock", async () => {
  const { root, cleanup } = await configResources("skill-cli-collection-stale-");
  try {
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
      core.collections.removeMember({ level: "project", collection: "source", name: "review" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(beforeMember);

    await core.collections.addReference({
      level: "project",
      collection: "source",
      name: "target",
      target: "target",
      description: "late dependency",
    });
    const beforeRemoval = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.collections.remove({ level: "project", collection: "target" }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(beforeRemoval);
  } finally {
    await cleanup();
  }
});

test("MGMT-015/016/017 reject stale member, import, and Reference definitions without publishing bytes", async () => {
  const { root, cleanup } = await configResources("skill-cli-operation-stale-");
  const file = join(root, "skill-cli.jsonc");
  try {
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
      core.collections.removeMember({
        level: "project",
        collection: "target",
        name: "review",
        expectedAddress: { source: "local", path: "review" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await expect(
      core.collections.removeReference({
        level: "project",
        collection: "target",
        name: "docs",
        expected: { collection: "source", description: "Docs" },
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    await cleanup();
  }
});

test("MGMT-016 import validates all current source members atomically", async () => {
  const { root, cleanup } = await configResources("skill-cli-import-stale-");
  const file = join(root, "skill-cli.jsonc");
  try {
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
      core.collections.importMembers({ level: "project", from: "source", into: "target" }),
    ).rejects.toMatchObject({ code: "EXPOSURE_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    await cleanup();
  }
});

test("MGMT-019 Link execution revalidates a stale preview without publishing conflicting bytes", async () => {
  const { root, cleanup } = await configResources("skill-cli-link-stale-");
  const config = join(root, "skill-cli.jsonc");
  try {
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
        await core.collections.previewSetLink({
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
      core.collections.setLink({
        level: "project",
        collection: "source",
        target: "target",
        linked: true,
      }),
    ).rejects.toMatchObject({ code: "EXPOSURE_CONFLICT" });
    expect(await readFile(config, "utf8")).toBe(before);
  } finally {
    await cleanup();
  }
});

test("MGMT-019 Link removal revalidates current alternatives and exact Link ownership", async () => {
  const { root, cleanup } = await configResources("skill-cli-link-remove-stale-");
  const config = join(root, "skill-cli.jsonc");
  try {
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
        await core.collections.previewSetLink({
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
    await core.collections.setLink({
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
      core.collections.setLink({
        level: "project",
        collection: "source",
        target: "target",
        linked: false,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(config, "utf8")).toBe(before);
  } finally {
    await cleanup();
  }
});

test("MGMT-019 Link execution uses current graph facts after a preview is blocked or becomes cyclic", async () => {
  const { root, cleanup } = await configResources("skill-cli-link-current-");
  const config = join(root, "skill-cli.jsonc");
  try {
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
        await core.collections.previewSetLink({
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
    await core.collections.setLink({
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
        await core.collections.previewSetLink({
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
      core.collections.setLink({
        level: "project",
        collection: "source",
        target: "target",
        linked: true,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(config, "utf8")).toBe(before);
  } finally {
    await cleanup();
  }
});

test("MGMT-029 Collection Use rejects a newly incomplete graph unchanged then succeeds from current repaired facts", async () => {
  const { root, cleanup } = await configResources("skill-cli-use-stale-");
  const file = join(root, "skill-cli.jsonc");
  try {
    const complete = JSON.stringify({ collections: { team: {} } });
    await writeFile(file, complete);
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.use.previewSet({
          level: "project",
          collections: ["team"],
        })
      ).value.allowed,
    ).toBe(true);
    const incomplete = JSON.stringify({ collections: {} });
    await writeFile(file, incomplete);
    await expect(core.use.set({ level: "project", collections: ["team"] })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await readFile(file, "utf8")).toBe(incomplete);
    await writeFile(file, complete);
    await core.use.set({ level: "project", collections: ["team"] });
    expect(JSON.parse(await readFile(file, "utf8")).use).toEqual(["team"]);
  } finally {
    await cleanup();
  }
});

test("MGMT-029 Collection removal rejects a newly introduced dependency unchanged then succeeds after removal", async () => {
  const { root, cleanup } = await configResources("skill-cli-collection-remove-stale-");
  const file = join(root, "skill-cli.jsonc");
  try {
    const independent = JSON.stringify({ collections: { source: {}, target: {} } });
    await writeFile(file, independent);
    const core = createSkillCliCore({ cwd: root });
    expect(
      (
        await core.collections.previewRemoval({
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
      core.collections.remove({ level: "project", collection: "target" }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(dependent);
    await writeFile(file, independent);
    await core.collections.remove({ level: "project", collection: "target" });
    expect(JSON.parse(await readFile(file, "utf8")).collections.target).toBeUndefined();
  } finally {
    await cleanup();
  }
});

test("membership batches preview and publish one direct Collection delta atomically", async () => {
  const { root, cleanup } = await configResources("skill-cli-membership-batch-");
  const file = join(root, "skill-cli.jsonc");
  try {
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

    const preview = await core.collections.previewMemberEdit({
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

    await core.collections.editMembers({
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
    const removalPreview = await core.collections.previewMemberEdit({
      level: "project",
      collection: "team",
      additions: [],
      removals: [
        { name: "review", expectedAddress: { source: "local", path: "review" } },
        { name: "docs", expectedAddress: { source: "local", path: "docs" } },
      ],
    });
    await core.collections.editMembers({
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
        core.collections.editMembers({
          level: "project",
          collection: "team",
          ...request,
          reviewedAffected: [],
        }),
      ).rejects.toMatchObject({ code });
      expect(await readFile(file, "utf8")).toBe(before);
    }
  } finally {
    await cleanup();
  }
});

test("membership batches reject duplicate request names and contributed Collection ownership", async () => {
  const { root, cleanup } = await configResources("skill-cli-membership-batch-blocked-");
  const module = join(root, "module");
  try {
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
    expect((await core.collections.previewMemberEdit(request)).value).toMatchObject({
      decision: { kind: "contributed" },
      allowed: false,
    });
    const before = await readFile(join(root, "skill-cli.jsonc"), "utf8");
    await expect(
      core.collections.editMembers({ ...request, reviewedAffected: [] }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await readFile(join(root, "skill-cli.jsonc"), "utf8")).toBe(before);
    await expect(
      core.collections.previewMemberEdit({
        ...request,
        collection: "shared/team",
        additions: [
          { name: "review", address: { source: "local", path: "review" } },
          { name: "review", address: { source: "local", path: "docs" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  } finally {
    await cleanup();
  }
});

test("membership batch preview includes direct and incoming Link selector deltas", async () => {
  const { root, cleanup } = await configResources("skill-cli-membership-batch-links-");
  try {
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
    const preview = await createSkillCliCore({ cwd: root }).collections.previewMemberEdit({
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
    await cleanup();
  }
});

test("membership batch rejects a Link introduced after review without publishing bytes or state", async () => {
  const { root, state, cleanup } = await configResources(
    "skill-cli-membership-batch-reviewed-impact-",
  );
  const file = join(root, "skill-cli.jsonc");
  try {
    await writeFile(file, JSON.stringify({ collections: { parent: {}, team: {} } }));
    const core = createSkillCliCore({ cwd: root });
    const request = {
      level: "project" as const,
      collection: "team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    };
    const preview = await core.collections.previewMemberEdit(request);
    expect(preview.value.affected).toMatchObject([
      { selector: "team:review", address: { source: "local", path: "review" } },
    ]);

    await core.collections.setLink({
      level: "project",
      collection: "parent",
      target: "team",
      linked: true,
    });
    const before = await readFile(file, "utf8");
    const beforeState = await readFile(join(state, "state.json"), "utf8").catch(() => undefined);

    await expect(
      core.collections.editMembers({ ...request, reviewedAffected: preview.value.affected }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readFile(join(state, "state.json"), "utf8").catch(() => undefined)).toBe(
      beforeState,
    );
  } finally {
    await cleanup();
  }
});

test("membership batch accepts an unrelated graph change after review", async () => {
  const { root, cleanup } = await configResources("skill-cli-membership-batch-unrelated-impact-");
  const file = join(root, "skill-cli.jsonc");
  try {
    await writeFile(file, JSON.stringify({ collections: { other: {}, parent: {}, team: {} } }));
    const core = createSkillCliCore({ cwd: root });
    const request = {
      level: "project" as const,
      collection: "team",
      additions: [{ name: "review", address: { source: "local", path: "review" } }],
      removals: [],
    };
    const preview = await core.collections.previewMemberEdit(request);
    await core.collections.setLink({
      level: "project",
      collection: "parent",
      target: "other",
      linked: true,
    });

    await expect(
      core.collections.editMembers({ ...request, reviewedAffected: preview.value.affected }),
    ).resolves.toMatchObject({ value: { changed: true } });
  } finally {
    await cleanup();
  }
});

test("membership batch preview blocks unavailable effective management despite a direct owner", async () => {
  const { root, cleanup } = await configResources("skill-cli-membership-batch-unavailable-");
  try {
    await writeFile(join(root, "skill-cli.jsonc"), '{ "collections": { "team": {} } }\n');
    await writeFile(join(root, "skill-cli.local.jsonc"), "{ invalid\n");
    const preview = await createSkillCliCore({ cwd: root }).collections.previewMemberEdit({
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
    await cleanup();
  }
});

test("membership batches normalize names and leave effectless deltas unpublished", async () => {
  const { root, state, cleanup } = await configResources("skill-cli-membership-batch-noop-");
  const file = join(root, "skill-cli.jsonc");
  try {
    const normalized = "caf\u00e9";
    const decomposed = "cafe\u0301";
    await writeFile(
      file,
      JSON.stringify({
        collections: { team: { members: { [normalized]: { source: "local", path: "cafe" } } } },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const preview = await core.collections.previewMemberEdit({
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
        await core.collections.editMembers({
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
    await cleanup();
  }
});

test("membership batches preserve all bytes for mixed valid and invalid changes", async () => {
  const { root, cleanup } = await configResources("skill-cli-membership-batch-mixed-failure-");
  const file = join(root, "skill-cli.jsonc");
  try {
    await writeFile(
      file,
      JSON.stringify({
        collections: { team: { members: { old: { source: "local", path: "old" } } } },
      }),
    );
    const core = createSkillCliCore({ cwd: root });
    const before = await readFile(file, "utf8");
    await expect(
      core.collections.editMembers({
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
    await cleanup();
  }
});
