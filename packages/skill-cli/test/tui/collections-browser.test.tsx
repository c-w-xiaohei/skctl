import { expect, test } from "bun:test";
import { collectionFilterValues, filterCollections } from "../../src/tui/collections-filter";
import { collectionMemberOriginIntent } from "../../src/tui/collections-page";

test("FILTER Collections combines semantic facts without Core calls", () => {
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/a" };
  const collections = [
    {
      id: "engineering",
      declared: [owner],
      repository: { derived: false, producers: [] },
      members: [{ name: "review", address: { source: "main", path: "review" }, paths: [] }],
      references: [{ name: "docs", collection: "docs", description: "Read docs", owner }],
      links: [],
    },
    {
      id: "empty",
      declared: [],
      repository: { derived: false, producers: [] },
      members: [],
      references: [],
      links: [],
    },
  ];
  expect(
    filterCollections(collections, {
      query: "READ",
      filters: { "Contains Skill": "main/review", Config: "project" },
    }).map((item) => item.id),
  ).toEqual(["engineering"]);
  expect(filterCollections(collections, { query: "missing", filters: {} })).toEqual([]);
});

test("COLLECTION direct Membership intent preserves entry, address, Collection, and owner", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/engineering",
  };
  expect(
    collectionMemberOriginIntent(
      "engineering",
      { name: "stable-review", address: { source: "team-main", path: "review" } },
      { kind: "direct", collection: "engineering", entryName: "stable-review", owner },
    ),
  ).toEqual({
    kind: "collection-direct",
    collection: "engineering",
    name: "stable-review",
    address: { source: "team-main", path: "review" },
    owner,
  });
});

test("COLLECTION member origins preserve contribution, producer, and outer Link routes", () => {
  const owner = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/collections/engineering",
    contribution: {
      configSource: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/configSources/team",
      },
      declaration: { level: "global" as const, pointer: "/collections/engineering" },
    },
  };
  const member = { name: "guide", address: { source: "team", path: "guide" } };
  expect(
    collectionMemberOriginIntent("engineering", member, {
      kind: "direct",
      collection: "engineering",
      entryName: "guide",
      owner,
    }),
  ).toMatchObject({ kind: "collection-contribution", collection: "engineering", owner });
  expect(
    collectionMemberOriginIntent("engineering", member, {
      kind: "repository-derived",
      repository: "acme/team",
      source: "team",
      path: "guide",
    }),
  ).toEqual({
    kind: "collection-producer",
    collection: "engineering",
    address: { source: "team", path: "guide" },
  });
  expect(
    collectionMemberOriginIntent("engineering", member, {
      kind: "via-link",
      links: [
        { collection: "engineering", linkedCollection: "shared", owner },
        { collection: "shared", linkedCollection: "nested", owner },
      ],
    }),
  ).toMatchObject({ kind: "collection-link", collection: "engineering", target: "shared", owner });
});

test("FILTER Collection values are exact structural and explicit booleans", () => {
  const owner = { level: "global" as const, file: "/global.jsonc", pointer: "/collections/docs" };
  const collection = {
    id: "docs",
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [{ name: "guide", address: { source: "team", path: "guide" }, paths: [] }],
    references: [],
    links: [],
  };
  expect(collectionFilterValues("Contains Skill", [collection])).toEqual(["team/guide"]);
  expect(collectionFilterValues("Config", [collection])).toEqual(["global"]);
  expect(collectionFilterValues("For agents", [collection])).toEqual(["Included", "Excluded"]);
  expect(collectionFilterValues("Problems", [collection])).toEqual(["Has problems", "No problems"]);
});
