import { describe, expect, test } from "bun:test";

import {
  configModuleValidator,
  localConfigValidator,
  schemaJson,
  userProjectConfigValidator,
} from "../../src/internal/config";

const userProject = {
  $schema: "https://skill-cli.dev/schema.json",
  agents: { opencode: "managed" },
  sources: { team: { kind: "local", path: "../skills", root: "" } },
  collections: { development: { members: { review: { source: "team", path: "review" } } } },
  use: ["development"],
};

describe("persisted JSONC v1 schema", () => {
  test("accepts only the three persisted document forms", () => {
    expect(userProjectConfigValidator(userProject)).toBe(true);
    const { agents: _agents, use: _use, ...local } = userProject;
    expect(localConfigValidator(local)).toBe(true);
    expect(
      configModuleValidator({ collections: userProject.collections, sources: userProject.sources }),
    ).toBe(true);

    expect(userProjectConfigValidator({ ...userProject, unknown: true })).toBe(false);
    expect(configModuleValidator(userProject)).toBe(false);
    for (const oldField of ["profiles", "imports", "omit"])
      expect(userProjectConfigValidator({ ...userProject, [oldField]: {} })).toBe(false);
    expect(userProjectConfigValidator({ ...userProject, agents: { opencode: "native" } })).toBe(
      false,
    );
    expect(configModuleValidator({ ...local, use: ["development"] })).toBe(false);
    expect(configModuleValidator({ ...local, agents: { opencode: "managed" } })).toBe(false);
    expect(
      userProjectConfigValidator({
        ...userProject,
        configSources: {
          upstream: {
            kind: "git",
            origin: "https://example.test/config.git",
            root: "",
            ref: "main",
          },
        },
      }),
    ).toBe(true);
    expect(
      configModuleValidator({
        configSources: { upstream: { kind: "local", path: "./config", root: "" } },
      }),
    ).toBe(false);
    expect(
      userProjectConfigValidator({
        ...userProject,
        configSources: { upstream: { kind: "local", path: "./config", root: "", ref: "main" } },
      }),
    ).toBe(false);
    expect(
      userProjectConfigValidator({
        ...userProject,
        sources: {
          bad: { kind: "local", path: "./skills", origin: "https://example.test", root: "" },
        },
      }),
    ).toBe(false);
    expect(
      userProjectConfigValidator({
        ...userProject,
        sources: { bad: { kind: "git", origin: "https://example.test", root: "" } },
      }),
    ).toBe(false);
  });

  test("has deterministic generated schema data and detects drift", async () => {
    expect(schemaJson).toEndWith("\n");
    expect(schemaJson).toContain('"$id": "https://skill-cli.dev/schema.json"');
    expect(schemaJson).toContain('"$schema": "https://json-schema.org/draft/2020-12/schema"');
    expect(JSON.parse(schemaJson)).toEqual(
      JSON.parse(await Bun.file("packages/skill-core/schema/skill-cli.schema.json").text()),
    );
  });
});
