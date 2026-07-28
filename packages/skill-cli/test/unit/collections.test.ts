import { expect, test } from "bun:test";

import { resolveCollections, type CollectionContribution } from "../../src/core/collections";
import { createSkillCliCore } from "../../src/core/create-core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/core/internal/state";
import { bindingDigest } from "../../src/core/internal/domain";

test("PROJ-011 references reveal targets without members while Links expose members", () => {
  const resolved = resolveCollections(
    {
      engineering: {
        members: { review: { source: "local", path: "review" } },
        links: ["shared"],
        references: { docs: { collection: "shared", description: "Shared documentation" } },
      },
      shared: { members: { write: { source: "local", path: "write" } } },
    },
    new Set(["local/review", "local/write"]),
  );
  expect([...resolved.members.get("engineering")!.keys()]).toEqual(["review", "write"]);
  expect(resolved.references.get("engineering")).toEqual({
    docs: { collection: "shared", description: "Shared documentation" },
  });
});

test("rejects link cycles and conflicting linked names before publication", () => {
  expect(() =>
    resolveCollections({ a: { links: ["b"] }, b: { links: ["a"] } }, new Set()),
  ).toThrow();
  expect(() =>
    resolveCollections(
      {
        a: { members: { x: { source: "s", path: "a" } }, links: ["b"] },
        b: { members: { x: { source: "s", path: "b" } } },
      },
      new Set(),
    ),
  ).toThrow();
});

test("MGMT-018 previews legal transitive and equal-direct Links while cycles and name conflicts reject", () => {
  const installed = new Set(["s/review", "s/write", "other/review"]);
  const legal = resolveCollections(
    {
      source: {
        members: { review: { source: "s", path: "review" } },
        links: ["middle"],
      },
      middle: { links: ["target"] },
      target: {
        members: {
          review: { source: "s", path: "review" },
          write: { source: "s", path: "write" },
        },
      },
    },
    installed,
  );
  expect([...legal.members.get("source")!]).toEqual([
    ["review", { source: "s", path: "review" }],
    ["write", { source: "s", path: "write" }],
  ]);
  expect(legal.origins.get("source")!.get("review")).toHaveLength(2);
  expect(() =>
    resolveCollections({ source: { links: ["target"] }, target: { links: ["source"] } }, installed),
  ).toThrow(/acyclic/i);
  expect(() =>
    resolveCollections(
      {
        source: {
          members: { review: { source: "other", path: "review" } },
          links: ["target"],
        },
        target: { members: { review: { source: "s", path: "review" } } },
      },
      installed,
    ),
  ).toThrow(/conflict/i);
});

test("PROJ-008 retains duplicate JSONC Collection conflicts", () => {
  const contributions: readonly CollectionContribution[] = [
    {
      kind: "declared",
      id: "engineering",
      declaration: { members: { review: { source: "global", path: "review" } } },
      owner: { level: "global", file: "/global.jsonc", pointer: "/collections/engineering" },
    },
    {
      kind: "declared",
      id: "engineering",
      declaration: { members: { write: { source: "project", path: "write" } } },
      owner: {
        level: "project",
        file: "/project/skill-cli.jsonc",
        pointer: "/collections/engineering",
      },
    },
  ];
  expect(() => resolveCollections(contributions, new Set())).toThrow(
    "Collection is declared more than once: engineering",
  );
});

test("rejects two Config Source JSONC contributions for one effective Collection", () => {
  expect(() =>
    resolveCollections(
      [
        {
          kind: "declared",
          id: "team/shared",
          declaration: {},
          owner: {
            level: "global",
            file: "/global.jsonc",
            pointer: "/configSources/team/collections/shared",
          },
        },
        {
          kind: "declared",
          id: "team/shared",
          declaration: {},
          owner: {
            level: "project",
            file: "/project/skill-cli.jsonc",
            pointer: "/configSources/team/collections/shared",
          },
        },
      ],
      new Set(),
    ),
  ).toThrow("Collection is declared more than once: team/shared");
});

test("PROJ-007/008 composes declared and repository-derived Collection contributions", () => {
  const resolved = resolveCollections(
    {
      "acme/skills": { members: { review: { source: "remote", path: "review" } } },
    },
    [{ source: "remote", path: "review", name: "review", repository: "acme/skills" }],
  );
  expect(resolved.origins.get("acme/skills")!.get("review")).toEqual([
    { kind: "direct", collection: "acme/skills", entryName: "review" },
    {
      kind: "repository-derived",
      repository: "acme/skills",
      source: "remote",
      path: "review",
    },
  ]);
  expect(
    resolveCollections({}, [{ source: "local", path: "review", name: "review" }]).members.has(
      "local",
    ),
  ).toBe(false);
});

test("PROJ-009/010 preserves direct, independent, and multi-hop Link origin paths", () => {
  const address = { source: "local", path: "review" };
  const resolved = resolveCollections(
    {
      engineering: { members: { review: address }, links: ["quality", "shared"] },
      quality: { members: { review: address }, links: ["shared"] },
      shared: { members: { review: address } },
    },
    new Set(["local/review"]),
  );
  expect(resolved.origins.get("engineering")!.get("review")).toEqual([
    { kind: "direct", collection: "engineering", entryName: "review" },
    { kind: "via-link", links: [{ collection: "engineering", linkedCollection: "quality" }] },
    {
      kind: "via-link",
      links: [
        { collection: "engineering", linkedCollection: "quality" },
        { collection: "quality", linkedCollection: "shared" },
      ],
    },
    { kind: "via-link", links: [{ collection: "engineering", linkedCollection: "shared" }] },
  ]);
});

test("PROJ-009 retains exact Membership and Link owners through deterministic routes", () => {
  const address = { source: "local", path: "review" };
  const owner = {
    level: "project" as const,
    file: "/project/skill-cli.jsonc",
    pointer: "/collections",
  };
  const contributions: readonly CollectionContribution[] = [
    {
      kind: "declared",
      id: "engineering",
      owner: { ...owner, pointer: "/collections/engineering" },
      declaration: { members: { review: address }, links: ["shared", "quality"] },
    },
    {
      kind: "declared",
      id: "quality",
      owner: { ...owner, pointer: "/collections/quality" },
      declaration: { links: ["shared"] },
    },
    {
      kind: "declared",
      id: "shared",
      owner: { ...owner, pointer: "/collections/shared" },
      declaration: { members: { review: address } },
    },
  ];
  const origins = resolveCollections(contributions, new Set(["local/review"]))
    .origins.get("engineering")!
    .get("review");
  expect(origins).toEqual([
    {
      kind: "direct",
      collection: "engineering",
      entryName: "review",
      owner: { ...owner, pointer: "/collections/engineering/members/review" },
    },
    {
      kind: "via-link",
      links: [
        {
          collection: "engineering",
          linkedCollection: "quality",
          owner: { ...owner, pointer: "/collections/engineering/links/1" },
        },
        {
          collection: "quality",
          linkedCollection: "shared",
          owner: { ...owner, pointer: "/collections/quality/links/0" },
        },
      ],
    },
    {
      kind: "via-link",
      links: [
        {
          collection: "engineering",
          linkedCollection: "shared",
          owner: { ...owner, pointer: "/collections/engineering/links/0" },
        },
      ],
    },
  ]);
});

test("derives repository collections, requires explicit Local memberships, and collapses equal identities", () => {
  const resolved = resolveCollections(
    {
      "acme/skills": { members: { again: { source: "remote", path: "review" } } },
      local: { members: { review: { source: "local", path: "review" } } },
    },
    [
      { source: "remote", path: "review", name: "review", repository: "acme/skills" },
      { source: "local", path: "review", name: "review" },
    ],
  );
  expect([...resolved.members.get("acme/skills")!.entries()]).toEqual([
    ["again", { source: "remote", path: "review" }],
    ["review", { source: "remote", path: "review" }],
  ]);
  expect(resolved.members.get("local")!.get("review")).toEqual({ source: "local", path: "review" });
});

test("rejects derived collection entry collisions and validates conflicts through every reverse link", () => {
  expect(() =>
    resolveCollections(
      { "acme/skills": { members: { review: { source: "other", path: "review" } } } },
      [
        { source: "remote", path: "review", name: "review", repository: "acme/skills" },
        { source: "other", path: "review", name: "review" },
      ],
    ),
  ).toThrow(/conflict/i);
  expect(() =>
    resolveCollections(
      {
        parent: { members: { review: { source: "a", path: "review" } }, links: ["child"] },
        child: { members: { review: { source: "b", path: "review" } } },
      },
      new Set(["a/review", "b/review"]),
    ),
  ).toThrow(/conflict/i);
});

test("MGMT-016 imports effective memberships as ordinary direct entries and rejects conflicts atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-import-"));
  const state = join(root, "state");
  try {
    const file = join(root, "skill-cli.jsonc");
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "s", path: "review" } } },
          target: { members: { keep: { source: "s", path: "keep" } } },
        },
      }),
    );
    for (const name of ["review", "keep"]) {
      const skill = join(root, "skills", name);
      await mkdir(skill, { recursive: true });
      await writeFile(join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
      await new StateCoordinator(state).installLocal("s", name, skill);
    }
    process.env.SKILL_CLI_STATE_DIR = state;
    const core = createSkillCliCore({ cwd: root });
    await core.configuration.change({
      type: "collection.import",
      level: "project",
      from: "source",
      into: "target",
    });
    expect(JSON.parse(await readFile(file, "utf8")).collections.target.members).toEqual({
      keep: { source: "s", path: "keep" },
      review: { source: "s", path: "review" },
    });
    await writeFile(
      file,
      JSON.stringify({
        collections: {
          source: { members: { review: { source: "s", path: "review" } } },
          target: { members: { review: { source: "s", path: "keep" } } },
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

test("MGMT-016 imports contributed derived and composed effective Collections into one direct owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-collection-import-origins-"));
  const state = join(root, "state");
  const module = join(root, "module");
  try {
    process.env.SKILL_CLI_STATE_DIR = state;
    await mkdir(module);
    await writeFile(
      join(module, "config.jsonc"),
      JSON.stringify({
        sources: { reusable: { kind: "local", path: "./skills", root: "" } },
        collections: {
          contributed: {
            members: { contributed: { source: "reusable", path: "contributed" } },
          },
        },
      }),
    );
    await writeFile(
      join(root, "skill-cli.jsonc"),
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
        collections: {
          "acme/skills": {
            members: { declared: { source: "remote", path: "declared" } },
          },
          target: {},
        },
      }),
    );
    const coordinator = new StateCoordinator(state);
    for (const [source, path, name] of [
      ["shared/reusable", "contributed", "contributed"],
      ["remote", "derived", "derived"],
      ["remote", "declared", "declared"],
    ] as const) {
      const skill = join(root, "skills", name);
      await mkdir(skill, { recursive: true });
      await writeFile(join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
      if (source === "remote")
        await coordinator.installRemoteForTest({
          source,
          path,
          name,
          description: name,
          kind: "remote",
          digest: new Bun.CryptoHasher("sha256").update(name).digest("hex"),
          bindingDigest: bindingDigest({
            kind: "github",
            origin: "https://github.com/acme/skills",
            root: "",
            ref: "main",
          }),
          adoptedRevision: "a".repeat(40),
          identityEvidence: { status: "unavailable" },
        });
      else await coordinator.installLocal(source, path, skill);
    }
    const core = createSkillCliCore({ cwd: root });
    await core.configuration.change({
      type: "collection.import",
      level: "project",
      from: "shared/contributed",
      into: "target",
    });
    await core.configuration.change({
      type: "collection.import",
      level: "project",
      from: "acme/skills",
      into: "target",
    });
    expect(
      JSON.parse(await readFile(join(root, "skill-cli.jsonc"), "utf8")).collections.target.members,
    ).toEqual({
      contributed: { source: "shared/reusable", path: "contributed" },
      declared: { source: "remote", path: "declared" },
      derived: { source: "remote", path: "derived" },
    });
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
