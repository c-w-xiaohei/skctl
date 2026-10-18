import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillCliCore } from "../../src/create-core";
import { bindingDigest } from "../../src/internal/domain";
import { StateCoordinator, type IdentityEvidence } from "../../src/internal/state";

async function installRemoteReview(
  state: string,
  identityEvidence: IdentityEvidence = { status: "unavailable" },
) {
  await new StateCoordinator(state).installRemoteForTest({
    source: "remote",
    path: "review",
    name: "review",
    description: "Review",
    kind: "remote",
    digest: "a".repeat(64),
    bindingDigest: bindingDigest({
      kind: "github",
      origin: "https://github.com/acme/skills",
      root: "",
      ref: "main",
    }),
    adoptedRevision: "b".repeat(40),
    identityEvidence,
  });
}

async function fixture(config = "{}\n") {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-impact-"));
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
    const global = join(root, "global.jsonc");
    await mkdir(join(root, "skills", "review"), { recursive: true });
    await writeFile(join(root, "skill-cli.jsonc"), config);
    await writeFile(global, "{}\n");
    await writeFile(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review\n---\n",
    );
    const core = createSkillCliCore({ cwd: root, userConfigPath: global });
    return { root, state, global, core, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Impact fixture setup and cleanup failed");
    }
    throw error;
  }
}

async function registerLocalSource(core: Awaited<ReturnType<typeof fixture>>["core"]) {
  await core.configuration.change({
    type: "source.register",
    level: "project",
    id: "local",
    binding: { kind: "local", path: "./skills", root: "" },
  });
}

function assertPublicImpact(value: unknown) {
  const forbidden = new Set([
    "weight",
    "dialog",
    "task",
    "effects",
    "generation",
    "digest",
    "token",
    "label",
    "route",
    "cache",
    "state",
    "snapshot",
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

test("MGMT-002 removes a direct zero-installed Source while preserving other declarations and state", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    const empty = await value.core.management.previewSourceRemoval({ source: "local" });
    expect(empty.value).toMatchObject({
      kind: "source-removal",
      allowed: true,
      owner: { level: "project", pointer: "/sources/local" },
      installed: [],
    });
    assertPublicImpact(empty.value);
    await value.core.configuration.change({
      type: "source.register",
      level: "project",
      id: "other",
      binding: { kind: "local", path: "./other", root: "" },
    });
    const stateBefore = await Bun.file(join(value.state, "state.json"))
      .text()
      .catch(() => undefined);
    await value.core.management.removeSource({ source: "local" });
    const config = JSON.parse(await readFile(join(value.root, "skill-cli.jsonc"), "utf8"));
    expect(config.sources.local).toBeUndefined();
    expect(config.sources.other).toBeDefined();
    expect(
      await Bun.file(join(value.state, "state.json"))
        .text()
        .catch(() => undefined),
    ).toBe(stateBefore);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-003 stale Source removal rejects newly installed owners then permits current unblocked execution", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    expect(
      (await value.core.management.previewSourceRemoval({ source: "local" })).value.allowed,
    ).toBe(true);

    await value.core.management.install({ source: "local", paths: ["review"] });
    const configBefore = await readFile(join(value.root, "skill-cli.jsonc"), "utf8");
    const stateBefore = await readFile(join(value.state, "state.json"), "utf8");
    await expect(value.core.management.removeSource({ source: "local" })).rejects.toMatchObject({
      code: "CONFIG_CONFLICT",
    });
    expect(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).toBe(configBefore);
    expect(await readFile(join(value.state, "state.json"), "utf8")).toBe(stateBefore);
    const source = await value.core.management.previewSourceRemoval({ source: "local" });
    expect(source.value).toMatchObject({
      allowed: false,
      installed: [{ source: "local", path: "review" }],
      repairs: [
        {
          address: { source: "local", path: "review" },
          actions: ["rebind", "uninstall"],
        },
      ],
    });
    assertPublicImpact(source.value);
    await value.core.management.uninstall({ source: "local", paths: ["review"] });
    await value.core.management.removeSource({ source: "local" });
    expect(JSON.parse(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).sources).toEqual(
      {},
    );
  } finally {
    await value.cleanup();
  }
});

test("MGMT-010 Uninstall impact preserves repository-derived and Link origin paths and leaves Source declared", async () => {
  const value = await fixture(
    JSON.stringify({
      sources: {
        remote: {
          kind: "github",
          origin: "https://github.com/acme/skills",
          root: "",
          ref: "main",
        },
      },
      collections: { "acme/skills": {}, linked: { links: ["acme/skills"] } },
      use: ["acme/skills", "linked"],
    }),
  );
  try {
    await installRemoteReview(value.state, {
      status: "known",
      canonicalOrigin: "https://github.com/acme/skills",
      originRelativeSkillRoot: "review",
    });
    const impact = await value.core.management.previewUninstall({
      source: "remote",
      paths: ["review"],
    });
    expect(impact.value).toMatchObject({
      allowed: true,
      directMemberships: [],
      disappearingSelectors: [
        {
          selector: "acme/skills:review",
          paths: [{ kind: "repository-derived", source: "remote", path: "review" }],
        },
        {
          selector: "linked:review",
          paths: [{ kind: "via-link", links: [{ linkedCollection: "acme/skills" }] }],
        },
      ],
    });
    assertPublicImpact(impact.value);
    await value.core.management.uninstall({ source: "remote", paths: ["review"] });
    expect((await value.core.workspace.get()).value.installedSkills).toEqual([]);
    expect(
      JSON.parse(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).sources.remote,
    ).toBeDefined();
  } finally {
    await value.cleanup();
  }
});

test("MGMT-011 stale Uninstall rejects a new direct Membership without changing bytes then succeeds after removal", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    await value.core.management.install({ source: "local", paths: ["review"] });
    const uninstall = await value.core.management.previewUninstall({
      source: "local",
      paths: ["review"],
    });
    expect(uninstall.value).toMatchObject({
      kind: "uninstall",
      allowed: true,
      installed: [{ source: "local", path: "review" }],
    });
    assertPublicImpact(uninstall.value);

    await value.core.configuration.change({
      type: "collection.create",
      level: "project",
      collection: "team",
    });
    await value.core.configuration.change({
      type: "collection.member.set",
      level: "project",
      collection: "team",
      name: "review",
      address: { source: "local", path: "review" },
    });
    const blocked = await value.core.management.previewUninstall({
      source: "local",
      paths: ["review"],
    });
    expect(blocked.value).toMatchObject({
      allowed: false,
      directMemberships: [{ level: "project", pointer: "/collections/team/members/review" }],
    });
    const before = await readFile(join(value.root, "state", "state.json"), "utf8");
    const blockedConfig = await readFile(join(value.root, "skill-cli.jsonc"), "utf8");
    await expect(
      value.core.management.uninstall({ source: "local", paths: ["review"] }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(value.root, "state", "state.json"), "utf8")).toBe(before);
    expect(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).toBe(blockedConfig);
    await value.core.configuration.change({
      type: "collection.member.remove",
      level: "project",
      collection: "team",
      name: "review",
      expectedAddress: { source: "local", path: "review" },
    });
    await value.core.management.uninstall({ source: "local", paths: ["review"] });
    expect((await value.core.workspace.get()).value.installedSkills).toEqual([]);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-004 contributed Sources allow management reads but reject host removal or edits", async () => {
  const value = await fixture(
    JSON.stringify({
      configSources: { shared: { kind: "local", path: "./module", root: "" } },
    }),
  );
  try {
    await mkdir(join(value.root, "module"));
    await mkdir(join(value.root, "module", "skills"));
    await mkdir(join(value.root, "module", "skills", "review"));
    await writeFile(
      join(value.root, "module", "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review\n---\n",
    );
    await writeFile(
      join(value.root, "module", "config.jsonc"),
      JSON.stringify({ sources: { skills: { kind: "local", path: "./skills", root: "" } } }),
    );
    const core = createSkillCliCore({ cwd: value.root });
    expect(
      (await core.management.discover({ source: "shared/skills" })).value.candidates,
    ).toMatchObject([{ path: "review" }]);
    await core.management.install({ source: "shared/skills", paths: ["review"] });
    expect(
      (await core.management.checkUpdate({ source: "shared/skills" })).value.unchanged.map(
        (item) => item.path,
      ),
    ).toEqual(["review"]);
    await expect(
      core.management.previewSourceRemoval({ source: "shared/skills" }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(core.management.removeSource({ source: "shared/skills" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-018/019/020/021 Link, Use, and Collection impacts retain exact declaration dependencies", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    await value.core.management.install({ source: "local", paths: ["review"] });
    for (const collection of ["source", "target"])
      await value.core.configuration.change({
        type: "collection.create",
        level: "project",
        collection,
      });
    await value.core.configuration.change({
      type: "collection.member.set",
      level: "project",
      collection: "target",
      name: "review",
      address: { source: "local", path: "review" },
    });
    const add = await value.core.configuration.previewLinkChange({
      level: "project",
      collection: "source",
      target: "target",
      linked: true,
    });
    expect(add.value).toMatchObject({
      allowed: true,
      members: [{ name: "review", address: { source: "local", path: "review" } }],
    });
    await value.core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: true,
    });
    const remove = await value.core.configuration.previewLinkChange({
      level: "project",
      collection: "source",
      target: "target",
      linked: false,
    });
    expect(remove.value.disappearingSelectors).toMatchObject([{ selector: "source:review" }]);
    await value.core.configuration.change({
      type: "use.set",
      level: "project",
      collections: ["source"],
    });
    const use = await value.core.configuration.previewCollectionUse({
      level: "project",
      collections: ["target"],
    });
    expect(use.value).toMatchObject({
      allowed: true,
      affectedSelectors: [{ selector: "target:review" }],
    });
    const removal = await value.core.configuration.previewCollectionRemoval({
      level: "project",
      collection: "target",
    });
    expect(removal.value).toMatchObject({
      allowed: false,
      blockers: [{ reason: "link", owner: { pointer: "/collections/source/links/0" } }],
    });
    await expect(
      value.core.configuration.change({
        type: "collection.remove",
        level: "project",
        collection: "target",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-020 Collection Use reports selected-owner deltas, completeness, and alternate owners", async () => {
  const value = await fixture(
    JSON.stringify({
      collections: {
        team: { members: { review: { source: "local", path: "review" } } },
        other: { members: { review: { source: "local", path: "review" } } },
      },
      use: ["team"],
    }),
  );
  try {
    await registerLocalSource(value.core);
    await value.core.management.install({ source: "local", paths: ["review"] });
    await writeFile(join(value.root, "skill-cli.local.jsonc"), JSON.stringify({ use: ["other"] }));

    const impact = await value.core.configuration.previewCollectionUse({
      level: "project",
      collections: ["other"],
    });
    expect(impact.value).toMatchObject({
      newlyExposed: [{ selector: "other:review" }],
      removedAtOwner: [{ selector: "team:review" }],
      retained: [
        {
          selector: "team:review",
          alternateOwners: [{ level: "local", pointer: "/use" }],
        },
      ],
      alternateOwners: [{ level: "local", pointer: "/use" }],
    });
    assertPublicImpact(impact.value);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-026 keeps Membership Link and Use removal choices distinct", async () => {
  const value = await fixture(
    JSON.stringify({
      collections: {
        direct: { members: { review: { source: "local", path: "review" } } },
        linked: { links: ["direct"] },
      },
      use: ["linked"],
    }),
  );
  try {
    const membership = await value.core.configuration.previewMembershipRemoval({
      level: "project",
      collection: "direct",
      name: "review",
    });
    const link = await value.core.configuration.previewLinkChange({
      level: "project",
      collection: "linked",
      target: "direct",
      linked: false,
    });
    const use = await value.core.configuration.previewCollectionUse({
      level: "project",
      collections: ["direct"],
    });
    expect(membership.value.kind).toBe("membership-removal");
    expect(link.value).toMatchObject({
      kind: "link-change",
      disappearingSelectors: [{ selector: "linked:review" }],
    });
    expect(use.value).toMatchObject({
      kind: "collection-use",
      removedAtOwner: [{ selector: "linked:review" }],
    });
    for (const impact of [membership.value, link.value, use.value]) assertPublicImpact(impact);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-021 Collection removal distinguishes selected ownership and retained derived members", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    await value.core.management.install({ source: "local", paths: ["review"] });
    await value.core.configuration.change({
      type: "collection.create",
      level: "project",
      collection: "team",
    });
    await value.core.configuration.change({
      type: "collection.member.set",
      level: "project",
      collection: "team",
      name: "review",
      address: { source: "local", path: "review" },
    });
    const wrongLevel = await value.core.configuration.previewCollectionRemoval({
      level: "local",
      collection: "team",
    });
    expect(wrongLevel.value).toMatchObject({ decision: { kind: "missing" }, allowed: false });

    const impact = await value.core.configuration.previewCollectionRemoval({
      level: "project",
      collection: "team",
    });
    expect(impact.value).toMatchObject({
      allowed: true,
      disappearingSelectors: [{ selector: "team:review" }],
      retainedSelectors: [],
    });
    assertPublicImpact(impact.value);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-021 Collection removal reports exact outgoing Link dependencies", async () => {
  const value = await fixture(
    JSON.stringify({ collections: { source: { links: ["target"] }, target: {} } }),
  );
  try {
    const impact = await value.core.configuration.previewCollectionRemoval({
      level: "project",
      collection: "source",
    });
    expect(impact.value).toMatchObject({
      allowed: false,
      blockers: [{ reason: "link", owner: { pointer: "/collections/source/links/0" } }],
    });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-021 Collection removal execution revalidates outgoing Links without changing bytes", async () => {
  const value = await fixture(
    JSON.stringify({ collections: { source: { links: ["target"] }, target: {} } }),
  );
  try {
    expect(
      (
        await value.core.configuration.previewCollectionRemoval({
          level: "project",
          collection: "source",
        })
      ).value.allowed,
    ).toBe(false);
    const blocked = await readFile(join(value.root, "skill-cli.jsonc"), "utf8");
    await expect(
      value.core.configuration.change({
        type: "collection.remove",
        level: "project",
        collection: "source",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).toBe(blocked);

    await value.core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: false,
    });
    expect(
      (
        await value.core.configuration.previewCollectionRemoval({
          level: "project",
          collection: "source",
        })
      ).value.allowed,
    ).toBe(true);
    await value.core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: true,
    });
    const stale = await readFile(join(value.root, "skill-cli.jsonc"), "utf8");
    await expect(
      value.core.configuration.change({
        type: "collection.remove",
        level: "project",
        collection: "source",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_CONFLICT" });
    expect(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).toBe(stale);
    await value.core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: false,
    });
    await value.core.configuration.change({
      type: "collection.remove",
      level: "project",
      collection: "source",
    });
    expect(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).not.toContain('"source"');
  } finally {
    await value.cleanup();
  }
});

test("MGMT-013/015/026 previews direct membership ownership and alternate link paths", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    await value.core.management.install({ source: "local", paths: ["review"] });
    for (const collection of ["source", "target"])
      await value.core.configuration.change({
        type: "collection.create",
        level: "project",
        collection,
      });
    await value.core.configuration.change({
      type: "collection.member.set",
      level: "project",
      collection: "target",
      name: "review",
      address: { source: "local", path: "review" },
    });
    await value.core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "source",
      target: "target",
      linked: true,
    });
    const add = await value.core.configuration.previewAddToCollection({
      level: "project",
      collection: "target",
      address: { source: "local", path: "review" },
      name: "review",
    });
    expect(add.value).toMatchObject({
      kind: "add-to-collection",
      decision: { kind: "direct", owner: { pointer: "/collections/target" } },
    });
    const remove = await value.core.configuration.previewMembershipRemoval({
      level: "project",
      collection: "target",
      name: "review",
    });
    expect(remove.value).toMatchObject({
      kind: "membership-removal",
      decision: { kind: "direct", owner: { pointer: "/collections/target/members/review" } },
      affected: [{ selector: "target:review" }],
    });
    assertPublicImpact(add.value);
    assertPublicImpact(remove.value);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-013/015/016/017 expose owner-specific collection operations without UI state", async () => {
  const value = await fixture(
    JSON.stringify({
      collections: {
        direct: { members: { review: { source: "local", path: "review" } } },
        linked: { links: ["direct"] },
        empty: {},
      },
    }),
  );
  try {
    const address = { source: "local", path: "review" };
    const add = await value.core.configuration.previewAddToCollection({
      collection: "direct",
      address,
      name: "review",
    });
    expect(add.value).toMatchObject({
      decision: { kind: "direct", owner: { pointer: "/collections/direct" } },
      intent: { owner: { pointer: "/collections/direct" }, address },
      allowed: true,
    });
    const missing = await value.core.configuration.previewAddToCollection({
      collection: "missing",
      address,
      name: "review",
    });
    expect(missing.value).toMatchObject({ decision: { kind: "missing" }, allowed: false });

    const removal = await value.core.configuration.previewMembershipRemoval({
      collection: "direct",
      name: "review",
    });
    expect(removal.value).toMatchObject({
      decision: { kind: "direct", owner: { pointer: "/collections/direct/members/review" } },
      disappearing: [{ selector: "direct:review" }],
    });
    const linked = await value.core.configuration.previewMembershipRemoval({
      collection: "linked",
      name: "review",
    });
    expect(linked.value).toMatchObject({
      decision: { kind: "via-link" },
      linkActions: [{ owner: { pointer: "/collections/linked/links/0" } }],
    });

    const imported = await value.core.configuration.previewImport({
      from: "direct",
      into: "empty",
      level: "project",
    });
    expect(imported.value).toMatchObject({
      owner: { pointer: "/collections/empty" },
      additions: [{ name: "review", address }],
      conflicts: [],
      allowed: true,
    });
    const reference = await value.core.configuration.previewReference({
      collection: "empty",
      name: "docs",
      target: "direct",
      description: "Docs",
      level: "project",
    });
    expect(reference.value).toMatchObject({
      allowed: true,
      owner: { pointer: "/collections/empty" },
      exposure: [],
    });
    assertPublicImpact(add.value);
    assertPublicImpact(removal.value);
    assertPublicImpact(imported.value);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-013/015 reports repository-derived choices and preserves direct alternatives", async () => {
  const value = await fixture(
    JSON.stringify({
      sources: {
        remote: { kind: "github", origin: "https://github.com/acme/skills", root: "", ref: "main" },
      },
      collections: {
        "acme/skills": { members: { review: { source: "local", path: "review" } } },
        linked: { links: ["acme/skills"] },
      },
    }),
  );
  try {
    const address = { source: "local", path: "review" };
    const composed = await value.core.configuration.previewAddToCollection({
      collection: "acme/skills",
      address,
      name: "review",
    });
    expect(composed.value).toMatchObject({
      decision: { kind: "direct", owner: { pointer: "/collections/acme/skills" } },
    });
    const via = await value.core.configuration.previewMembershipRemoval({
      collection: "linked",
      name: "review",
    });
    expect(via.value).toMatchObject({ decision: { kind: "via-link" }, allowed: false });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-012/018/019/026 previews prospective Link graphs with exact retained origins", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    await value.core.management.install({ source: "local", paths: ["review"] });
    for (const collection of ["source", "middle", "target"])
      await value.core.configuration.change({
        type: "collection.create",
        level: "project",
        collection,
      });
    await value.core.configuration.change({
      type: "collection.member.set",
      level: "project",
      collection: "source",
      name: "review",
      address: { source: "local", path: "review" },
    });
    await value.core.configuration.change({
      type: "collection.member.set",
      level: "project",
      collection: "target",
      name: "review",
      address: { source: "local", path: "review" },
    });
    await value.core.configuration.change({
      type: "collection.link.set",
      level: "project",
      collection: "middle",
      target: "target",
      linked: true,
    });
    const add = await value.core.configuration.previewLinkChange({
      level: "project",
      collection: "source",
      target: "middle",
      linked: true,
    });
    expect(add.value).toMatchObject({
      allowed: true,
      owner: { pointer: "/collections/source/links/0" },
      members: [
        {
          name: "review",
          address: { source: "local", path: "review" },
          paths: [
            { kind: "direct", collection: "source", entryName: "review" },
            {
              kind: "via-link",
              links: [
                { collection: "source", linkedCollection: "middle" },
                { collection: "middle", linkedCollection: "target" },
              ],
            },
          ],
        },
      ],
    });
    assertPublicImpact(add.value);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-012 reports repository and plural Link paths without a false direct Membership blocker", async () => {
  const value = await fixture(
    JSON.stringify({
      sources: {
        remote: {
          kind: "github",
          origin: "https://github.com/acme/skills",
          root: "",
          ref: "main",
        },
      },
      collections: {
        "acme/skills": {},
        first: { links: ["acme/skills"] },
        second: { links: ["acme/skills"] },
      },
      use: ["first", "second"],
    }),
  );
  try {
    await installRemoteReview(value.state);
    const impact = await value.core.management.previewUninstall({
      source: "remote",
      paths: ["review"],
    });
    expect(impact.value.directMemberships).toEqual([]);
    expect(impact.value.disappearingSelectors.map((item) => item.selector)).toEqual([
      "first:review",
      "second:review",
    ]);
    for (const selector of impact.value.disappearingSelectors)
      expect(selector.paths).toMatchObject([
        { kind: "via-link", links: [{ linkedCollection: "acme/skills" }] },
      ]);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-013 distinguishes direct contributed derived and composed Add-to-Collection decisions", async () => {
  const value = await fixture();
  try {
    const module = join(value.root, "module");
    await mkdir(module);
    await writeFile(
      join(module, "config.jsonc"),
      JSON.stringify({ collections: { contributed: {} } }),
    );
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          remote: {
            kind: "github",
            origin: "https://github.com/acme/skills",
            root: "",
            ref: "main",
          },
        },
        configSources: { shared: { kind: "local", path: "./module", root: "" } },
        collections: { direct: {} },
      }),
    );
    await installRemoteReview(value.state);
    const address = { source: "remote", path: "review" };
    expect(
      (
        await value.core.configuration.previewAddToCollection({
          collection: "direct",
          address,
          name: "review",
        })
      ).value,
    ).toMatchObject({ decision: { kind: "direct" }, allowed: true });
    expect(
      (
        await value.core.configuration.previewAddToCollection({
          collection: "shared/contributed",
          address,
          name: "review",
        })
      ).value,
    ).toMatchObject({ decision: { kind: "contributed" }, allowed: false });
    expect(
      (
        await value.core.configuration.previewAddToCollection({
          collection: "acme/skills",
          address,
          name: "review",
        })
      ).value,
    ).toMatchObject({
      decision: { kind: "repository-derived" },
      createDirectContribution: { collection: "acme/skills" },
      allowed: false,
    });
    await value.core.configuration.change({
      type: "collection.create",
      level: "project",
      collection: "acme/skills",
    });
    expect(
      (
        await value.core.configuration.previewAddToCollection({
          collection: "acme/skills",
          address,
          name: "review",
        })
      ).value,
    ).toMatchObject({ decision: { kind: "direct" }, allowed: true });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-015 removes only direct Memberships while derived and via-Link origins remain owner actions", async () => {
  const value = await fixture(
    JSON.stringify({
      collections: {
        direct: { members: { review: { source: "local", path: "review" } } },
        linked: { links: ["direct"] },
      },
    }),
  );
  try {
    const direct = await value.core.configuration.previewMembershipRemoval({
      collection: "direct",
      name: "review",
    });
    const linked = await value.core.configuration.previewMembershipRemoval({
      collection: "linked",
      name: "review",
    });
    expect(direct.value).toMatchObject({ decision: { kind: "direct" }, allowed: true });
    expect(linked.value).toMatchObject({
      decision: { kind: "via-link" },
      linkActions: [{ owner: { pointer: "/collections/linked/links/0" } }],
      allowed: false,
    });
    await value.core.configuration.change({
      type: "collection.member.remove",
      level: "project",
      collection: "direct",
      name: "review",
      expectedAddress: { source: "local", path: "review" },
    });
    expect(
      JSON.parse(await readFile(join(value.root, "skill-cli.jsonc"), "utf8")).collections.direct
        .members,
    ).toEqual({});
  } finally {
    await value.cleanup();
  }
});

test("MGMT-015 reports repository-derived Membership removal as a producer action", async () => {
  const value = await fixture(
    JSON.stringify({
      sources: {
        remote: {
          kind: "github",
          origin: "https://github.com/acme/skills",
          root: "",
          ref: "main",
        },
      },
    }),
  );
  try {
    await installRemoteReview(value.state);
    expect(
      (
        await value.core.configuration.previewMembershipRemoval({
          collection: "acme/skills",
          name: "review",
        })
      ).value,
    ).toMatchObject({
      decision: {
        kind: "repository-derived",
        producers: [{ source: "remote", path: "review" }],
      },
      allowed: false,
    });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-019 Remove Link reports whole-member fan-out and retained direct alternatives", async () => {
  const value = await fixture(
    JSON.stringify({
      collections: {
        source: {
          members: { review: { source: "local", path: "review" } },
          links: ["target"],
        },
        target: {
          members: {
            review: { source: "local", path: "review" },
            write: { source: "local", path: "write" },
          },
        },
      },
    }),
  );
  try {
    const impact = await value.core.configuration.previewLinkChange({
      level: "project",
      collection: "source",
      target: "target",
      linked: false,
    });
    expect(impact.value.disappearingSelectors).toMatchObject([{ selector: "source:write" }]);
    expect(impact.value.retainedSelectors).toMatchObject([
      {
        selector: "source:review",
        paths: [{ kind: "direct", collection: "source", entryName: "review" }],
      },
    ]);
    assertPublicImpact(impact.value);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-021 blocks dependent direct removal and refuses contributed or derived removal as direct", async () => {
  const value = await fixture(
    JSON.stringify({
      collections: {
        direct: {},
        dependent: { references: { direct: { collection: "direct", description: "Direct" } } },
      },
    }),
  );
  try {
    expect(
      (
        await value.core.configuration.previewCollectionRemoval({
          level: "project",
          collection: "direct",
        })
      ).value,
    ).toMatchObject({ allowed: false, blockers: [{ reason: "reference" }] });
    expect(
      (
        await value.core.configuration.previewCollectionRemoval({
          level: "local",
          collection: "direct",
        })
      ).value,
    ).toMatchObject({ decision: { kind: "missing" }, allowed: false });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-021 refuses contributed and repository-derived Collection removal as direct declarations", async () => {
  const value = await fixture();
  try {
    const module = join(value.root, "module");
    await mkdir(module);
    await writeFile(join(module, "config.jsonc"), JSON.stringify({ collections: { team: {} } }));
    await writeFile(
      join(value.root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: {
          remote: {
            kind: "github",
            origin: "https://github.com/acme/skills",
            root: "",
            ref: "main",
          },
        },
        configSources: { shared: { kind: "local", path: "./module", root: "" } },
      }),
    );
    await installRemoteReview(value.state);
    expect(
      (
        await value.core.configuration.previewCollectionRemoval({
          level: "project",
          collection: "shared/team",
        })
      ).value,
    ).toMatchObject({ decision: { kind: "contributed" }, allowed: false });
    expect(
      (
        await value.core.configuration.previewCollectionRemoval({
          level: "project",
          collection: "acme/skills",
        })
      ).value,
    ).toMatchObject({ decision: { kind: "repository-derived" }, allowed: false });
  } finally {
    await value.cleanup();
  }
});

test("MGMT-033 explicit observations remain caller-owned and absent from declarations and private state", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    const discovered = await value.core.management.discover({ source: "local" });
    await value.core.management.install({ source: "local", paths: ["review"] });
    const checked = await value.core.management.checkUpdate({ source: "local" });
    expect(discovered.value.candidates).toHaveLength(1);
    expect(checked.value.unchanged.map((item) => item.path)).toEqual(["review"]);
    const persisted = `${await readFile(join(value.root, "skill-cli.jsonc"), "utf8")}\n${await readFile(join(value.state, "state.json"), "utf8")}`;
    for (const field of ["candidates", "changed", "added", "removed", "unchanged", "exactRevision"])
      expect(persisted).not.toContain(`"${field}"`);
  } finally {
    await value.cleanup();
  }
});

test("MGMT-032 management mutations return focused results without an embedded Workspace", async () => {
  const value = await fixture();
  try {
    await registerLocalSource(value.core);
    const result = await value.core.management.removeSource({ source: "local" });
    expect(result).toEqual({ value: undefined, diagnostics: [] });
    expect("workspace" in result).toBe(false);
  } finally {
    await value.cleanup();
  }
});
