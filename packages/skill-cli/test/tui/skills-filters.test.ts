import { expect, test } from "bun:test";
import { filterSkills, filterValues } from "../../src/tui/skills-filter";
import { readerProjection } from "./installed-reader.fixture";

test("STATE-012 filters Skills locally by literal query and every semantic dimension", () => {
  const projection = readerProjection();
  const [guide, reference] = projection.installedSkills;
  const skills = [
    {
      ...guide!,
      collections: [
        {
          id: "engineering",
          entry: "guide-entry",
          paths: [],
        },
      ],
      selectors: ["engineering:guide-entry"],
      selectorViews: {
        status: "complete" as const,
        values: [
          {
            selector: "engineering:guide-entry",
            collection: "engineering",
            entry: "guide-entry",
            paths: [],
            useOwners: [],
          },
        ],
      },
    },
    {
      ...reference!,
      owner: { ...reference!.owner, health: "missing" as const },
      collections: [{ id: "docs", entry: "reference", paths: [] }],
      selectors: ["docs:reference"],
      selectorViews: { status: "unavailable" as const },
      aliases: ["docs:reference"],
      problems: [{ code: "SOURCE_MISSING", severity: "warning" as const, message: "Missing" }],
    },
  ];

  expect(filterSkills(skills, { query: "TEAM-MAIN/GUIDE" })).toEqual([skills[0]]);
  expect(filterSkills(skills, { query: "guide-entry" })).toEqual([skills[0]]);
  expect(filterSkills(skills, { filters: { Collection: "engineering" } })).toEqual([skills[0]]);
  expect(filterSkills(skills, { filters: { Source: "team-main" } })).toEqual(skills);
  expect(filterSkills(skills, { filters: { Config: "project" } })).toEqual(skills);
  expect(
    filterSkills(skills, { agentStatus: "available", filters: { "For agents": "Available" } }),
  ).toEqual([skills[0]]);
  expect(
    filterSkills(skills, { agentStatus: "unavailable", filters: { "For agents": "Unavailable" } }),
  ).toEqual(skills);
  expect(filterSkills(skills, { filters: { Problems: "Has problems" } })).toEqual([skills[1]]);
  expect(
    filterSkills(skills, {
      query: "reference",
      source: "team-main",
      filters: { Collection: "docs", Problems: "Has problems" },
    }),
  ).toEqual([skills[1]]);
});

test("STATE-012 queries undisclosed Collection IDs and stable entries from public facts", () => {
  const projection = readerProjection();
  const [guide, reference] = projection.installedSkills;
  const skills = [
    {
      ...guide!,
      collections: [{ id: "engineering", entry: "private-guide", paths: [] }],
      selectors: [],
      selectorViews: { status: "unavailable" as const },
      aliases: [],
    },
    {
      ...reference!,
      collections: [{ id: "documentation", entry: "reference", paths: [] }],
      selectors: [],
      selectorViews: { status: "unavailable" as const },
      aliases: [],
    },
  ];

  expect(filterSkills(skills, { query: "EnGiNeErInG" })).toEqual([skills[0]]);
  expect(filterSkills(skills, { query: "PRIVATE-GUIDE" })).toEqual([skills[0]]);
});

test("STATE-012 uses exact semantic owners and exposes deterministic filter values", () => {
  const projection = readerProjection();
  const [guide, reference] = projection.installedSkills;
  const skills = [
    {
      ...guide!,
      collections: [{ id: "alpha", entry: "guide", paths: [] }],
      selectors: ["alpha:guide"],
      selectorViews: {
        status: "complete" as const,
        values: [
          {
            selector: "alpha:guide",
            collection: "alpha",
            entry: "guide",
            paths: [],
            useOwners: [],
          },
        ],
      },
      aliases: ["alpha:guide-copy"],
    },
    {
      ...reference!,
      address: { source: "team-main-extra", path: "reference" },
      owner: { ...reference!.owner, source: "team-main-extra", health: "drifted" as const },
      source: {
        ...reference!.source!,
        id: "team-main-extra",
        provenance: { level: "global" as const, file: "/global.jsonc", pointer: "/sources/extra" },
        contribution: {
          configSource: {
            level: "global" as const,
            file: "/global.jsonc",
            pointer: "/configSources/shared",
          },
          declaration: {
            level: "local" as const,
            file: "/shared.jsonc",
            pointer: "/sources/reference",
          },
        },
      },
      collections: [{ id: "beta", entry: "reference", paths: [] }],
      selectors: [],
      selectorViews: { status: "unavailable" as const },
      aliases: [],
      problems: [{ code: "DRIFT", severity: "warning" as const, message: "Binding drift" }],
    },
  ];

  expect(filterSkills(skills, { filters: { Source: "team-main" } })).toEqual([skills[0]]);
  expect(filterSkills(skills, { filters: { Config: "project" } })).toEqual([skills[0]]);
  expect(filterSkills(skills, { filters: { Config: "global /configSources/shared" } })).toEqual([
    skills[1],
  ]);
  expect(
    filterSkills(skills, { agentStatus: "available", filters: { "For agents": "Not disclosed" } }),
  ).toEqual([skills[1]]);
  expect(filterSkills(skills, { filters: { Problems: "Has problems" } })).toEqual([skills[1]]);
  expect(filterValues(skills, "Collection")).toEqual(["alpha", "beta"]);
  expect(filterValues(skills, "Source")).toEqual(["team-main", "team-main-extra"]);
  expect(filterValues(skills, "Config")).toEqual(["global /configSources/shared", "project"]);
  expect(filterValues(skills, "For agents", "available")).toEqual(["Available", "Not disclosed"]);
  expect(filterValues(skills, "For agents", "unavailable")).toEqual(["Unavailable"]);
  expect(filterValues(skills, "Problems")).toEqual(["Has problems"]);
});
