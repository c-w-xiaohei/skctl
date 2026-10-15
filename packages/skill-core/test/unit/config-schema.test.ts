import { describe, expect, test } from "bun:test";

import {
  configModuleValidator,
  localConfigValidator,
  schemaJson,
  userConfigValidator,
  projectConfigValidator,
} from "../../src/internal/config";

const userProject = {
  $schema: "https://skill-cli.dev/schema.json",
  agents: { opencode: "managed" },
  sources: { team: { kind: "local", path: "../skills", root: "" } },
  collections: { development: { members: { review: { source: "team", path: "review" } } } },
  use: ["development"],
};

describe("persisted JSONC v1 schema", () => {
  test("only user documents accept a strict HTTP(S) proxy URL", () => {
    for (const proxy of ["http://127.0.0.1:7890", "https://user:password@proxy.test:8443/"])
      expect(userConfigValidator({ ...userProject, network: { proxy } })).toBe(true);
    expect(userConfigValidator({ network: {} })).toBe(true);
    expect(userConfigValidator({})).toBe(true);
    for (const validator of [projectConfigValidator, localConfigValidator, configModuleValidator])
      expect(validator({ network: { proxy: "http://proxy.test:7890" } })).toBe(false);
    for (const proxy of [
      "",
      null,
      "socks5://proxy.test:7890",
      "file:///proxy",
      "proxy.test:7890",
      "http://proxy.test:99999",
      "http://proxy.test/path",
      "http://proxy.test/?q=x",
      "http://proxy.test/#x",
      "http://proxy.test?",
      "http://proxy.test#",
      "http://proxy.test\n",
      "http:\\proxy.test",
      "http://",
    ])
      expect(userConfigValidator({ network: { proxy } })).toBe(false);
    for (const network of [
      null,
      { proxy: "http://proxy.test", mode: "direct" },
      { timeout: 1 },
      { unknown: true },
    ])
      expect(userConfigValidator({ network })).toBe(false);
    for (const proxy of [
      "http://proxy.test/.",
      "http://proxy.test/foo/..",
      "http://proxy.test/%2e",
      "http://proxy.test:",
    ])
      expect(userConfigValidator({ network: { proxy } })).toBe(false);
  });
  test("accepts only the three persisted document forms", () => {
    expect(userConfigValidator(userProject)).toBe(true);
    expect(projectConfigValidator(userProject)).toBe(true);
    const { agents: _agents, use: _use, ...local } = userProject;
    expect(localConfigValidator(local)).toBe(true);
    expect(
      configModuleValidator({ collections: userProject.collections, sources: userProject.sources }),
    ).toBe(true);

    expect(userConfigValidator({ ...userProject, unknown: true })).toBe(false);
    expect(configModuleValidator(userProject)).toBe(false);
    for (const oldField of ["profiles", "imports", "omit"])
      expect(userConfigValidator({ ...userProject, [oldField]: {} })).toBe(false);
    expect(userConfigValidator({ ...userProject, agents: { opencode: "native" } })).toBe(false);
    expect(configModuleValidator({ ...local, use: ["development"] })).toBe(false);
    expect(configModuleValidator({ ...local, agents: { opencode: "managed" } })).toBe(false);
    expect(
      userConfigValidator({
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
      userConfigValidator({
        ...userProject,
        configSources: { upstream: { kind: "local", path: "./config", root: "", ref: "main" } },
      }),
    ).toBe(false);
    expect(
      userConfigValidator({
        ...userProject,
        sources: {
          bad: { kind: "local", path: "./skills", origin: "https://example.test", root: "" },
        },
      }),
    ).toBe(false);
    expect(
      userConfigValidator({
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
