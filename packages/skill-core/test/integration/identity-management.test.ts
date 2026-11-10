import * as api from "../../src/index";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "jsonc-parser";
import { StateCoordinator } from "../../src/storage/state";
import { bindingDigest } from "../../src/source/identity";
import * as v from "valibot";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skctl-identity-"));
  const global = join(root, "global", "config.jsonc");
  const project = join(root, "skctl.jsonc");
  const local = join(root, "skctl.local.jsonc");
  const previous = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  await mkdir(join(root, "global"), { recursive: true });
  await writeFile(global, "{}\n");
  await writeFile(project, "{}\n");
  await writeFile(local, "{}\n");
  return {
    root,
    global,
    project,
    local,
    options: { cwd: root, userConfigPath: global },
    dispose: async () => {
      if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("rename moves every direct declaration and target reference in the captured workspace, retaining comments and aliases", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.global,
      `{
      "collections": { "old": { // global contribution
        "description": "Global description", "instructions": "Keep these instructions"
      } },
      "use": ["old"]
    }\n`,
    );
    await writeFile(
      f.project,
      `{
      "collections": {
        // project relationship
        "parent": { "references": { "alias": { "collection": "old", "description": "Child" } }, "links": ["old"] }
      }
    }\n`,
    );
    await writeFile(f.local, '{ "use": ["old"] }\n');
    const request = { collection: "old", target: "new" };
    const impact = (await api.previewCollectionRename(f.options, request)).value;
    expect(impact.allowed).toBe(true);
    expect(impact.scope).toBe("captured-workspace");
    await api.renameCollection(f.options, { ...request, reviewedImpact: impact });
    const global = await readFile(f.global, "utf8");
    const project = await readFile(f.project, "utf8");
    expect(global).toContain("// global contribution");
    expect(project).toContain("// project relationship");
    expect(parse(global)).toMatchObject({
      collections: {
        new: { description: "Global description", instructions: "Keep these instructions" },
      },
      use: ["new"],
    });
    expect(parse(project)).toMatchObject({
      collections: {
        parent: {
          references: { alias: { collection: "new", description: "Child" } },
          links: ["new"],
        },
      },
    });
    expect(parse(await readFile(f.local, "utf8")).use).toEqual(["new"]);
    expect(parse(global).collections.old).toBeUndefined();
    expect(parse(project).collections.old).toBeUndefined();
  } finally {
    await f.dispose();
  }
});

test("rename rejects stale review without modifying any declaration", async () => {
  const f = await fixture();
  try {
    await writeFile(f.project, '{ "collections": { "old": {} } }\n');
    const request = { collection: "old", target: "new" };
    const impact = (await api.previewCollectionRename(f.options, request)).value;
    await writeFile(f.local, '{ "use": ["old"] }\n');
    const before = await Promise.all(
      [f.global, f.project, f.local].map((p) => readFile(p, "utf8")),
    );
    await expect(
      api.renameCollection(f.options, { ...request, reviewedImpact: impact }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(
      await Promise.all([f.global, f.project, f.local].map((p) => readFile(p, "utf8"))),
    ).toEqual(before);
  } finally {
    await f.dispose();
  }
});

test("rename preview blocks a target collision and immutable old identity", async () => {
  const f = await fixture();
  try {
    await writeFile(f.project, '{ "collections": { "old": {}, "new": {} } }\n');
    expect(
      (await api.previewCollectionRename(f.options, { collection: "old", target: "new" })).value
        .allowed,
    ).toBe(false);
    await mkdir(join(f.root, "module"), { recursive: true });
    await writeFile(join(f.root, "module", "config.jsonc"), '{ "collections": { "old": {} } }\n');
    await writeFile(
      f.project,
      '{ "configSources": { "shared": { "kind": "local", "path": "./module", "root": "" } } }\n',
    );
    expect(
      (await api.previewCollectionRename(f.options, { collection: "shared/old", target: "new" }))
        .value.allowed,
    ).toBe(false);
  } finally {
    await f.dispose();
  }
});

test("reviewed rebind repairs direct memberships alongside installed ownership without changing content", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    const content = "---\nname: guide\ndescription: Guide\n---\nBody\n";
    await writeFile(join(skills, "guide", "SKILL.md"), content);
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    await api.createCollection(f.options, { level: "project", collection: "daily" });
    await api.addMember(f.options, {
      level: "project",
      collection: "daily",
      name: "alias",
      address: { source: "first", path: "guide" },
    });
    const request = { source: "first", path: "guide", owner: "next" };
    const impact = (await api.previewRebind(f.options, request)).value;
    expect(impact.allowed).toBe(true);
    expect(impact.directMemberships).toHaveLength(1);
    await api.rebindSkill(f.options, { ...request, reviewedImpact: impact });
    expect(parse(await readFile(f.project, "utf8")).collections.daily.members.alias).toEqual({
      source: "next",
      path: "guide",
    });
    expect((await api.getWorkspace(f.options)).value.installedSkills[0]!.address).toEqual({
      source: "next",
      path: "guide",
    });
    expect(await readFile(join(skills, "guide", "SKILL.md"), "utf8")).toBe(content);
  } finally {
    await f.dispose();
  }
});

test("reviewed rebind rejects a newly added membership without changing state or config", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    await api.createCollection(f.options, { level: "project", collection: "daily" });
    const request = { source: "first", path: "guide", owner: "next" };
    const impact = (await api.previewRebind(f.options, request)).value;
    await api.addMember(f.options, {
      level: "project",
      collection: "daily",
      name: "guide",
      address: { source: "first", path: "guide" },
    });
    const configBefore = await readFile(f.project, "utf8");
    const stateBefore = await readFile(join(f.root, "state", "state.json"), "utf8");
    await expect(
      api.rebindSkill(f.options, { ...request, reviewedImpact: impact }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(f.project, "utf8")).toBe(configBefore);
    expect(await readFile(join(f.root, "state", "state.json"), "utf8")).toBe(stateBefore);
  } finally {
    await f.dispose();
  }
});

test("rebind without reviewed impact is rejected without publishing ownership", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    const stateBefore = await readFile(join(f.root, "state", "state.json"), "utf8");
    const configBefore = await readFile(f.project, "utf8");
    // Exercise the untyped boundary: callers can supply malformed requests at runtime.
    await expect(
      Reflect.apply(api.rebindSkill, undefined, [
        f.options,
        { source: "first", path: "guide", owner: "next" },
      ]),
    ).rejects.toBeDefined();
    expect(await readFile(join(f.root, "state", "state.json"), "utf8")).toBe(stateBefore);
    expect(await readFile(f.project, "utf8")).toBe(configBefore);
  } finally {
    await f.dispose();
  }
});

test("rename blocks repository-derived identity and incomplete configuration", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.project,
      JSON.stringify({
        sources: {
          remote: {
            kind: "github",
            origin: "https://github.com/acme/skills",
            root: "",
            ref: "main",
          },
        },
        collections: { "acme/skills": {} },
      }),
    );
    const coordinator = new StateCoordinator();
    await coordinator.write(
      {
        configs: {},
        installed: [
          {
            kind: "remote",
            source: "remote",
            path: "guide",
            name: "guide",
            description: "Guide",
            snapshotId: "a".repeat(64),
            bindingDigest: bindingDigest({
              kind: "github",
              origin: "https://github.com/acme/skills",
              root: "",
              ref: "main",
            }),
            adoptedRevision: "b".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://github.com/acme/skills",
              originRelativeSkillRoot: "guide",
            },
          },
        ],
      },
      0,
    );
    expect(
      (await api.previewCollectionRename(f.options, { collection: "acme/skills", target: "new" }))
        .value,
    ).toMatchObject({ allowed: false, blockers: [{ reason: "repository-derived" }] });
    await writeFile(f.local, "{ invalid json");
    expect(
      (await api.previewCollectionRename(f.options, { collection: "acme/skills", target: "new" }))
        .value,
    ).toMatchObject({ allowed: false, blockers: [{ reason: "incomplete" }] });
  } finally {
    await f.dispose();
  }
});

test("rename blocks an unresolved Use in an otherwise valid captured workspace", async () => {
  const f = await fixture();
  try {
    await writeFile(f.project, '{ "collections": { "old": {} }, "use": ["missing"] }\n');
    const impact = (
      await api.previewCollectionRename(f.options, { collection: "old", target: "new" })
    ).value;
    expect(impact).toMatchObject({ allowed: false, blockers: [{ reason: "incomplete" }] });
  } finally {
    await f.dispose();
  }
});

test("rebind blocks readonly contributed membership and leaves state unchanged", async () => {
  const f = await fixture();
  try {
    const module = join(f.root, "module");
    await mkdir(join(module, "skills", "guide"), { recursive: true });
    await writeFile(
      join(module, "skills", "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    await writeFile(
      join(module, "config.jsonc"),
      JSON.stringify({
        sources: {
          first: { kind: "local", path: "./skills", root: "" },
          next: { kind: "local", path: "./skills", root: "" },
        },
        collections: { daily: { members: { guide: { source: "first", path: "guide" } } } },
      }),
    );
    await writeFile(
      f.project,
      JSON.stringify({ configSources: { shared: { kind: "local", path: "./module", root: "" } } }),
    );
    await api.installSkills(f.options, { source: "shared/first", paths: ["guide"] });
    const request = { source: "shared/first", path: "guide", owner: "shared/next" };
    const impact = (await api.previewRebind(f.options, request)).value;
    expect(impact).toMatchObject({
      proof: "proven",
      allowed: false,
      blockers: [{ reason: "immutable" }],
    });
    const state = await readFile(join(f.root, "state", "state.json"), "utf8");
    await expect(
      api.rebindSkill(f.options, { ...request, reviewedImpact: impact }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(f.root, "state", "state.json"), "utf8")).toBe(state);
  } finally {
    await f.dispose();
  }
});

test("cancelled rename and rebind leave configuration and state unchanged", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    await api.createCollection(f.options, { level: "project", collection: "old" });
    const rename = { collection: "old", target: "new" },
      rebind = { source: "first", path: "guide", owner: "next" };
    const renameReview = (await api.previewCollectionRename(f.options, rename)).value;
    const rebindReview = (await api.previewRebind(f.options, rebind)).value;
    const before = await Promise.all(
      [f.project, join(f.root, "state", "state.json")].map((file) => readFile(file, "utf8")),
    );
    const signal = AbortSignal.abort();
    await expect(
      api.renameCollection(f.options, { ...rename, reviewedImpact: renameReview }, { signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      api.rebindSkill(f.options, { ...rebind, reviewedImpact: rebindReview }, { signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      await Promise.all(
        [f.project, join(f.root, "state", "state.json")].map((file) => readFile(file, "utf8")),
      ),
    ).toEqual(before);
  } finally {
    await f.dispose();
  }
});

test("committed rebind crash rolls config and installed state forward together", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    await api.createCollection(f.options, { level: "project", collection: "daily" });
    await api.addMember(f.options, {
      level: "project",
      collection: "daily",
      name: "guide",
      address: { source: "first", path: "guide" },
    });
    const request = { source: "first", path: "guide", owner: "next" };
    const reviewedImpact = (await api.previewRebind(f.options, request)).value;
    const entry = join(import.meta.dir, "../../src/index.ts");
    const script = `import { rebindSkill } from ${JSON.stringify(entry)}; await rebindSkill(${JSON.stringify(f.options)}, ${JSON.stringify({ ...request, reviewedImpact })});`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: { ...process.env, SKCTL_TEST_CRASH_AT: "transaction-config-replaced" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await Promise.race([
      child.exited,
      Bun.sleep(15000).then(() => {
        child.kill();
        return -1;
      }),
    ]);
    expect(exit).toBe(97);
    const workspace = (await api.getWorkspace(f.options)).value;
    expect(workspace.installedSkills[0]!.address).toEqual({ source: "next", path: "guide" });
    expect(parse(await readFile(f.project, "utf8")).collections.daily.members.guide).toEqual({
      source: "next",
      path: "guide",
    });
  } finally {
    await f.dispose();
  }
});

test("committed multi-file rename crash rolls all declaration files forward", async () => {
  const f = await fixture();
  try {
    await writeFile(f.global, '{ "collections": { "old": {} }, "use": ["old"] }\n');
    await writeFile(f.project, '{ "collections": { "parent": { "links": ["old"] } } }\n');
    const request = { collection: "old", target: "new" };
    const reviewedImpact = (await api.previewCollectionRename(f.options, request)).value;
    const entry = join(import.meta.dir, "../../src/index.ts");
    const script = `import { renameCollection } from ${JSON.stringify(entry)}; await renameCollection(${JSON.stringify(f.options)}, ${JSON.stringify({ ...request, reviewedImpact })});`;
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: { ...process.env, SKCTL_TEST_CRASH_AT: "transaction-config-replaced" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await Promise.race([
      child.exited,
      Bun.sleep(15000).then(() => {
        child.kill();
        return -1;
      }),
    ]);
    expect(exit).toBe(97);
    await api.getWorkspace(f.options);
    expect(parse(await readFile(f.global, "utf8"))).toMatchObject({
      collections: { new: {} },
      use: ["new"],
    });
    expect(parse(await readFile(f.project, "utf8"))).toMatchObject({
      collections: { parent: { links: ["new"] } },
    });
  } finally {
    await f.dispose();
  }
});

test("rename rejects ambiguous duplicate Collection keys without changing bytes", async () => {
  const f = await fixture();
  try {
    const bytes =
      '{ "collections": { "old": {"description":"first"}, "old": {"description":"second"} } }\n';
    await writeFile(f.project, bytes);
    const request = { collection: "old", target: "new" };
    try {
      const impact = (await api.previewCollectionRename(f.options, request)).value;
      if (impact.allowed)
        await api.renameCollection(f.options, { ...request, reviewedImpact: impact });
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFIG_INVALID" });
    }
    expect(await readFile(f.project, "utf8")).toBe(bytes);
  } finally {
    await f.dispose();
  }
});

test("rename rejects duplicate nested relationship keys without changing bytes", async () => {
  const f = await fixture();
  try {
    const bytes =
      '{ "collections": { "old": {}, "parent": { "references": { "alias": { "collection": "old", "collection": "old", "description": "child" } } } } }\n';
    await writeFile(f.project, bytes);
    const request = { collection: "old", target: "new" };
    try {
      const impact = (await api.previewCollectionRename(f.options, request)).value;
      if (impact.allowed)
        await api.renameCollection(f.options, { ...request, reviewedImpact: impact });
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFIG_INVALID" });
    }
    expect(await readFile(f.project, "utf8")).toBe(bytes);
  } finally {
    await f.dispose();
  }
});

test("rename blocks unresolved memberships outside Use", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.project,
      JSON.stringify({
        collections: {
          old: {},
          unrelated: { members: { absent: { source: "missing", path: "guide" } } },
        },
        use: [],
      }),
    );
    const before = await readFile(f.project, "utf8");
    const request = { collection: "old", target: "new" };
    const impact = (await api.previewCollectionRename(f.options, request)).value;
    expect(impact).toMatchObject({ allowed: false, blockers: [{ reason: "incomplete" }] });
    await expect(
      api.renameCollection(f.options, { ...request, reviewedImpact: impact }),
    ).rejects.toBeDefined();
    expect(await readFile(f.project, "utf8")).toBe(before);
  } finally {
    await f.dispose();
  }
});

for (const dependency of ["target", "host", "contribution"] as const) {
  test(`rename preserves an external edit to ${dependency} after validation before publication`, async () => {
    const f = await fixture();
    const moduleFile = join(f.root, "module", "config.jsonc");
    try {
      await mkdir(join(f.root, "module"), { recursive: true });
      await writeFile(moduleFile, '{ "collections": { "other": {} } }\n');
      await writeFile(
        f.project,
        '{ "configSources": { "shared": { "kind": "local", "path": "./module", "root": "" } }, "collections": { "old": {} } }\n',
      );
      const request = { collection: "old", target: "new" };
      const impact = (await api.previewCollectionRename(f.options, request)).value;
      const changed =
        dependency === "target" ? f.project : dependency === "host" ? f.global : moduleFile;
      const edited = `${await readFile(changed, "utf8")}\n// external edit\n`;
      const originalPublish = StateCoordinator.prototype.publish;
      const hook = spyOn(StateCoordinator.prototype, "publish").mockImplementation(async function (
        this: StateCoordinator,
        ...args
      ) {
        await writeFile(changed, edited);
        return originalPublish.apply(this, args);
      });
      try {
        await expect(
          api.renameCollection(f.options, { ...request, reviewedImpact: impact }),
        ).rejects.toBeDefined();
      } finally {
        hook.mockRestore();
      }
      expect(await readFile(changed, "utf8")).toBe(edited);
      expect(parse(await readFile(f.project, "utf8")).collections.old).toBeDefined();
      expect(parse(await readFile(f.project, "utf8")).collections.new).toBeUndefined();
    } finally {
      await f.dispose();
    }
  });
}

test("rebind preserves an external target edit made after validation before publication", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    await api.createCollection(f.options, { level: "project", collection: "daily" });
    await api.addMember(f.options, {
      level: "project",
      collection: "daily",
      name: "guide",
      address: { source: "first", path: "guide" },
    });
    const request = { source: "first", path: "guide", owner: "next" };
    const impact = (await api.previewRebind(f.options, request)).value;
    const state = await readFile(join(f.root, "state", "state.json"), "utf8");
    const edited = `${await readFile(f.project, "utf8")}\n// external edit\n`;
    const originalPublish = StateCoordinator.prototype.publish;
    const hook = spyOn(StateCoordinator.prototype, "publish").mockImplementation(async function (
      this: StateCoordinator,
      ...args
    ) {
      await writeFile(f.project, edited);
      return originalPublish.apply(this, args);
    });
    try {
      await expect(
        api.rebindSkill(f.options, { ...request, reviewedImpact: impact }),
      ).rejects.toBeDefined();
    } finally {
      hook.mockRestore();
    }
    expect(await readFile(f.project, "utf8")).toBe(edited);
    expect(await readFile(join(f.root, "state", "state.json"), "utf8")).toBe(state);
  } finally {
    await f.dispose();
  }
});

test("public Core exports a schema for validating saved rebind reviews", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    const impact = (
      await api.previewRebind(f.options, { source: "first", path: "guide", owner: "next" })
    ).value;
    const schema = Reflect.get(api, "rebindImpactSchema");
    expect(schema).toBeDefined();
    expect(v.safeParse(schema, impact).success).toBe(true);
    expect(v.safeParse(schema, {}).success).toBe(false);
  } finally {
    await f.dispose();
  }
});

test("rename succeeds with unchanged BOM-prefixed target and non-target host documents", async () => {
  const f = await fixture();
  try {
    await writeFile(f.project, '\ufeff{ "collections": { "old": {} } }\n');
    await writeFile(f.global, "\ufeff{}\n");
    const request = { collection: "old", target: "new" };
    const impact = (await api.previewCollectionRename(f.options, request)).value;
    await api.renameCollection(f.options, { ...request, reviewedImpact: impact });
    expect(parse(await readFile(f.project, "utf8")).collections.new).toEqual({});
    expect(await readFile(f.global, "utf8")).toBe("\ufeff{}\n");
  } finally {
    await f.dispose();
  }
});

test("rebind succeeds with an unchanged BOM-prefixed membership document", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    await api.createCollection(f.options, { level: "project", collection: "daily" });
    await api.addMember(f.options, {
      level: "project",
      collection: "daily",
      name: "guide",
      address: { source: "first", path: "guide" },
    });
    await writeFile(f.project, `\ufeff${await readFile(f.project, "utf8")}`);
    const request = { source: "first", path: "guide", owner: "next" };
    const impact = (await api.previewRebind(f.options, request)).value;
    await api.rebindSkill(f.options, { ...request, reviewedImpact: impact });
    expect(parse(await readFile(f.project, "utf8")).collections.daily.members.guide.source).toBe(
      "next",
    );
    expect((await api.getWorkspace(f.options)).value.installedSkills[0]!.address.source).toBe(
      "next",
    );
  } finally {
    await f.dispose();
  }
});

test("BOM-only change after review invalidates rename evidence without writes", async () => {
  const f = await fixture();
  try {
    const config = '{ "collections": { "old": {} } }\n';
    await writeFile(f.project, config);
    const request = { collection: "old", target: "new" };
    const impact = (await api.previewCollectionRename(f.options, request)).value;
    await writeFile(f.project, `\ufeff${config}`);
    await expect(
      api.renameCollection(f.options, { ...request, reviewedImpact: impact }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(f.project, "utf8")).toBe(`\ufeff${config}`);
  } finally {
    await f.dispose();
  }
});

test("rebind preview exposes retained local identity when the old Source binding has drifted", async () => {
  const f = await fixture();
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    );
    for (const id of ["first", "next"])
      await api.registerSource(f.options, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(f.options, { source: "first", paths: ["guide"] });
    const config = parse(await readFile(f.project, "utf8"));
    config.sources.first.path = join(f.root, "drifted");
    await writeFile(f.project, JSON.stringify(config));
    const request = { source: "first", path: "guide", owner: "next" };
    const impact = (await api.previewRebind(f.options, request)).value;
    expect(impact).toMatchObject({
      proof: "proven",
      identity: {
        kind: "local",
        canonicalOrigin: skills,
        originRelativeSkillRoot: "guide",
        localRoot: join(skills, "guide"),
      },
    });
    expect(v.safeParse(api.rebindImpactSchema, impact).success).toBe(true);
    const tampered = {
      ...impact,
      identity: {
        kind: "local" as const,
        canonicalOrigin: join(f.root, "drifted"),
        originRelativeSkillRoot: "guide",
        localRoot: join(skills, "guide"),
      },
    };
    await expect(
      api.rebindSkill(f.options, { ...request, reviewedImpact: tampered }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    await api.rebindSkill(f.options, { ...request, reviewedImpact: impact });
    expect((await api.getWorkspace(f.options)).value.installedSkills[0]!.address.source).toBe(
      "next",
    );
  } finally {
    await f.dispose();
  }
});

test("rebind preview exposes retained remote identity without a local root", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.project,
      JSON.stringify({
        sources: {
          first: { kind: "git", origin: "https://example.test/drift.git", root: "", ref: "main" },
          next: { kind: "git", origin: "https://example.test/original.git", root: "", ref: "main" },
        },
      }),
    );
    const coordinator = new StateCoordinator();
    await coordinator.write(
      {
        configs: {},
        installed: [
          {
            kind: "remote",
            source: "first",
            path: "guide",
            name: "guide",
            description: "Guide",
            snapshotId: "a".repeat(64),
            bindingDigest: bindingDigest({
              kind: "git",
              origin: "https://example.test/original.git",
              root: "",
              ref: "main",
            }),
            adoptedRevision: "b".repeat(40),
            identityEvidence: {
              status: "known",
              canonicalOrigin: "https://example.test/original.git",
              originRelativeSkillRoot: "guide",
            },
          },
        ],
      },
      0,
    );
    const impact = (
      await api.previewRebind(f.options, { source: "first", path: "guide", owner: "next" })
    ).value;
    expect(impact).toMatchObject({
      proof: "proven",
      identity: {
        kind: "remote",
        canonicalOrigin: "https://example.test/original.git",
        originRelativeSkillRoot: "guide",
      },
    });
    expect(Reflect.get(impact, "identity")).not.toHaveProperty("localRoot");
  } finally {
    await f.dispose();
  }
});
