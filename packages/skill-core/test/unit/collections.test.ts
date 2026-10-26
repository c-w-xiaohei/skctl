import * as api from "../../src/index";
import { expect, test } from "bun:test";
import { resolveCollections, type CollectionContribution } from "../../src/collection/graph";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCoordinator } from "../../src/storage/state";
import { bindingDigest } from "../../src/source/identity";
test("PROJ-011 references reveal targets without members while Links expose members", () => {
  const resolved = resolveCollections(
    [
      {
        id: "engineering",
        declaration: {
          members: { review: { source: "local", path: "review" } },
          links: ["shared"],
          references: { docs: { collection: "shared", description: "Shared documentation" } },
        },
      },
      { id: "shared", declaration: { members: { write: { source: "local", path: "write" } } } },
    ],
    [
      { source: "local", path: "review", name: "review" },
      { source: "local", path: "write", name: "write" },
    ],
  );
  expect([...resolved.members.get("engineering")!.keys()]).toEqual(["review", "write"]);
  expect(resolved.references.get("engineering")).toEqual({
    docs: { collection: "shared", description: "Shared documentation" },
  });
});
test("rejects link cycles and conflicting linked names before publication", () => {
  expect(() =>
    resolveCollections(
      [
        { id: "a", declaration: { links: ["b"] } },
        { id: "b", declaration: { links: ["a"] } },
      ],
      [],
    ),
  ).toThrow();
  expect(() =>
    resolveCollections(
      [
        { id: "a", declaration: { members: { x: { source: "s", path: "a" } }, links: ["b"] } },
        { id: "b", declaration: { members: { x: { source: "s", path: "b" } } } },
      ],
      [],
    ),
  ).toThrow();
});
test("Collection resolution treats source and path as a structural Skill address", () => {
  expect(() =>
    resolveCollections(
      [
        {
          id: "source",
          declaration: {
            members: { guide: { source: "team", path: "main/guide" } },
            links: ["target"],
          },
        },
        {
          id: "target",
          declaration: { members: { guide: { source: "team/main", path: "guide" } } },
        },
      ],
      [
        { source: "team", path: "main/guide", name: "guide" },
        { source: "team/main", path: "guide", name: "guide" },
      ],
    ),
  ).toThrow(/conflict/i);
});
test("MGMT-018 previews legal transitive and equal-direct Links while cycles and name conflicts reject", () => {
  const installed = [
    { source: "s", path: "review", name: "review" },
    { source: "s", path: "write", name: "write" },
    { source: "other", path: "review", name: "review" },
  ];
  const legal = resolveCollections(
    [
      {
        id: "source",
        declaration: {
          members: { review: { source: "s", path: "review" } },
          links: ["middle"],
        },
      },
      { id: "middle", declaration: { links: ["target"] } },
      {
        id: "target",
        declaration: {
          members: {
            review: { source: "s", path: "review" },
            write: { source: "s", path: "write" },
          },
        },
      },
    ],
    installed,
  );
  expect([...legal.members.get("source")!]).toEqual([
    ["review", { source: "s", path: "review" }],
    ["write", { source: "s", path: "write" }],
  ]);
  expect(legal.origins.get("source")!.get("review")).toHaveLength(2);
  expect(() =>
    resolveCollections(
      [
        { id: "source", declaration: { links: ["target"] } },
        { id: "target", declaration: { links: ["source"] } },
      ],
      installed,
    ),
  ).toThrow(/acyclic/i);
  expect(() =>
    resolveCollections(
      [
        {
          id: "source",
          declaration: {
            members: { review: { source: "other", path: "review" } },
            links: ["target"],
          },
        },
        { id: "target", declaration: { members: { review: { source: "s", path: "review" } } } },
      ],
      installed,
    ),
  ).toThrow(/conflict/i);
});
test("PROJ-008 retains duplicate JSONC Collection conflicts", () => {
  const contributions: readonly CollectionContribution[] = [
    {
      id: "engineering",
      declaration: { members: { review: { source: "global", path: "review" } } },
      owner: { level: "global", file: "/global.jsonc", pointer: "/collections/engineering" },
    },
    {
      id: "engineering",
      declaration: { members: { write: { source: "project", path: "write" } } },
      owner: {
        level: "project",
        file: "/project/skctl.jsonc",
        pointer: "/collections/engineering",
      },
    },
  ];
  expect(() => resolveCollections(contributions, [])).toThrow(
    "Collection is declared more than once: engineering",
  );
});
test("rejects two Config Source JSONC contributions for one effective Collection", () => {
  expect(() =>
    resolveCollections(
      [
        {
          id: "team/shared",
          declaration: {},
          owner: {
            level: "global",
            file: "/global.jsonc",
            pointer: "/configSources/team/collections/shared",
          },
        },
        {
          id: "team/shared",
          declaration: {},
          owner: {
            level: "project",
            file: "/project/skctl.jsonc",
            pointer: "/configSources/team/collections/shared",
          },
        },
      ],
      [],
    ),
  ).toThrow("Collection is declared more than once: team/shared");
});
test("PROJ-007/008 composes declared and repository-derived Collection contributions", () => {
  const resolved = resolveCollections(
    [
      {
        id: "acme/skills",
        declaration: { members: { review: { source: "remote", path: "review" } } },
      },
    ],
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
    resolveCollections([], [{ source: "local", path: "review", name: "review" }]).members.has(
      "local",
    ),
  ).toBe(false);
});
test("PROJ-009/010 preserves direct, independent, and multi-hop Link origin paths", () => {
  const address = { source: "local", path: "review" };
  const resolved = resolveCollections(
    [
      {
        id: "engineering",
        declaration: { members: { review: address }, links: ["quality", "shared"] },
      },
      { id: "quality", declaration: { members: { review: address }, links: ["shared"] } },
      { id: "shared", declaration: { members: { review: address } } },
    ],
    [{ ...address, name: "review" }],
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
    file: "/project/skctl.jsonc",
    pointer: "/collections",
  };
  const contributions: readonly CollectionContribution[] = [
    {
      id: "engineering",
      owner: { ...owner, pointer: "/collections/engineering" },
      declaration: { members: { review: address }, links: ["shared", "quality"] },
    },
    {
      id: "quality",
      owner: { ...owner, pointer: "/collections/quality" },
      declaration: { links: ["shared"] },
    },
    {
      id: "shared",
      owner: { ...owner, pointer: "/collections/shared" },
      declaration: { members: { review: address } },
    },
  ];
  const origins = resolveCollections(contributions, [{ ...address, name: "review" }])
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
    [
      {
        id: "acme/skills",
        declaration: { members: { again: { source: "remote", path: "review" } } },
      },
      { id: "local", declaration: { members: { review: { source: "local", path: "review" } } } },
    ],
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
      [
        {
          id: "acme/skills",
          declaration: { members: { review: { source: "other", path: "review" } } },
        },
      ],
      [
        { source: "remote", path: "review", name: "review", repository: "acme/skills" },
        { source: "other", path: "review", name: "review" },
      ],
    ),
  ).toThrow(/conflict/i);
  expect(() =>
    resolveCollections(
      [
        {
          id: "parent",
          declaration: { members: { review: { source: "a", path: "review" } }, links: ["child"] },
        },
        { id: "child", declaration: { members: { review: { source: "b", path: "review" } } } },
      ],
      [
        { source: "a", path: "review", name: "review" },
        { source: "b", path: "review", name: "review" },
      ],
    ),
  ).toThrow(/conflict/i);
});
test("MGMT-016 imports effective memberships as ordinary direct entries and rejects conflicts atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-collection-import-"));
  const state = join(root, "state");
  try {
    const file = join(root, "skctl.jsonc");
    await writeFile(
      file,
      JSON.stringify({
        sources: { s: { kind: "local", path: "./skills", root: "" } },
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
    }
    process.env.SKCTL_STATE_DIR = state;
    const core = { cwd: root };
    await api.installSkills(core, { source: "s", paths: ["review", "keep"] });
    await api.importMembers(core, { level: "project", from: "source", into: "target" });
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
      api.importMembers(core, { level: "project", from: "source", into: "target" }),
    ).rejects.toMatchObject({ code: "EXPOSURE_CONFLICT" });
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
test("MGMT-016 imports contributed derived and composed effective Collections into one direct owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-collection-import-origins-"));
  const state = join(root, "state");
  const module = join(root, "module");
  try {
    process.env.SKCTL_STATE_DIR = state;
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
      join(root, "skctl.jsonc"),
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
      const current = await coordinator.read();
      if (source === "remote")
        await coordinator.write(
          {
            configs: {},
            installed: [
              ...current.installed,
              {
                source,
                path,
                name,
                description: name,
                kind: "remote",
                snapshotId: crypto.randomUUID(),
                bindingDigest: bindingDigest({
                  kind: "github",
                  origin: "https://github.com/acme/skills",
                  root: "",
                  ref: "main",
                }),
                adoptedRevision: "a".repeat(40),
                identityEvidence: { status: "unavailable" },
              },
            ],
          },
          current.generation,
        );
      else {
        await mkdir(join(module, "skills"), { recursive: true });
        await cp(skill, join(module, "skills", path), { recursive: true });
        await api.installSkills({ cwd: root }, { source, paths: [path] });
      }
    }
    const core = { cwd: root };
    await api.importMembers(core, {
      level: "project",
      from: "shared/contributed",
      into: "target",
    });
    await api.importMembers(core, { level: "project", from: "acme/skills", into: "target" });
    expect(
      JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8")).collections.target.members,
    ).toEqual({
      contributed: { source: "shared/reusable", path: "contributed" },
      declared: { source: "remote", path: "declared" },
      derived: { source: "remote", path: "derived" },
    });
  } finally {
    delete process.env.SKCTL_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
