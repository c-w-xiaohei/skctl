import { describe, expect, test } from "bun:test";

import * as v from "valibot";
import {
  userConfigSchema,
  projectConfigSchema,
  reusableConfigSchema,
  configSchemaFor,
} from "../../src/config/schema";
import { schemaJson } from "../../../../scripts/schema";
import { resourcePathSchema, skillMetadataSchema } from "../../src/content/domain.schema";

const userProject = {
  $schema: "https://skctl.dev/schema.json",
  agents: { opencode: "managed" },
  sources: { team: { kind: "local", path: "../skills", root: "" } },
  collections: { development: { members: { review: { source: "team", path: "review" } } } },
  use: ["development"],
};

describe("persisted JSONC v1 schema", () => {
  test("domain schemas own normalization, selected output and path validation", () => {
    expect(
      v.parse(skillMetadataSchema, {
        name: " cafe\u0301 ",
        description: " Review\n ",
        ignored: true,
      }),
    ).toEqual({ name: "café", description: "Review" });
    expect(v.safeParse(resourcePathSchema, "../secret").success).toBe(false);
    expect(v.safeParse(resourcePathSchema, "nested/file.txt").success).toBe(true);
  });
  test("only user documents accept a strict HTTP(S) proxy URL", () => {
    for (const proxy of ["http://127.0.0.1:7890", "https://user:password@proxy.test:8443/"])
      expect(v.is(userConfigSchema, { ...userProject, network: { proxy } })).toBe(true);
    expect(v.is(userConfigSchema, { network: {} })).toBe(true);
    expect(v.is(userConfigSchema, {})).toBe(true);
    for (const schema of [projectConfigSchema, configSchemaFor("local"), reusableConfigSchema])
      expect(v.is(schema, { network: { proxy: "http://proxy.test:7890" } })).toBe(false);
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
      expect(v.is(userConfigSchema, { network: { proxy } })).toBe(false);
    for (const network of [
      null,
      { proxy: "http://proxy.test", mode: "direct" },
      { timeout: 1 },
      { unknown: true },
    ])
      expect(v.is(userConfigSchema, { network })).toBe(false);
    for (const proxy of [
      "http://proxy.test/.",
      "http://proxy.test/foo/..",
      "http://proxy.test/%2e",
      "http://proxy.test:",
    ])
      expect(v.is(userConfigSchema, { network: { proxy } })).toBe(false);
  });
  test("accepts only the three persisted document forms", () => {
    expect(v.is(userConfigSchema, userProject)).toBe(true);
    expect(v.is(projectConfigSchema, userProject)).toBe(true);
    const { agents: _agents, use: _use, ...local } = userProject;
    expect(v.is(configSchemaFor("local"), local)).toBe(true);
    expect(
      v.is(reusableConfigSchema, {
        collections: userProject.collections,
        sources: userProject.sources,
      }),
    ).toBe(true);

    expect(v.is(userConfigSchema, { ...userProject, unknown: true })).toBe(false);
    expect(v.is(reusableConfigSchema, userProject)).toBe(false);
    for (const oldField of ["profiles", "imports", "omit"])
      expect(v.is(userConfigSchema, { ...userProject, [oldField]: {} })).toBe(false);
    expect(v.is(userConfigSchema, { ...userProject, agents: { opencode: "native" } })).toBe(false);
    expect(v.is(reusableConfigSchema, { ...local, use: ["development"] })).toBe(false);
    expect(v.is(reusableConfigSchema, { ...local, agents: { opencode: "managed" } })).toBe(false);
    expect(
      v.is(userConfigSchema, {
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
      v.is(reusableConfigSchema, {
        configSources: { upstream: { kind: "local", path: "./config", root: "" } },
      }),
    ).toBe(false);
    expect(
      v.is(userConfigSchema, {
        ...userProject,
        configSources: { upstream: { kind: "local", path: "./config", root: "", ref: "main" } },
      }),
    ).toBe(false);
    expect(
      v.is(userConfigSchema, {
        ...userProject,
        sources: {
          bad: { kind: "local", path: "./skills", origin: "https://example.test", root: "" },
        },
      }),
    ).toBe(false);
    expect(
      v.is(userConfigSchema, {
        ...userProject,
        sources: { bad: { kind: "git", origin: "https://example.test", root: "" } },
      }),
    ).toBe(false);
  });

  test("has deterministic generated schema data and detects drift", async () => {
    expect(schemaJson).toEndWith("\n");
    expect(schemaJson).toContain('"$id": "https://skctl.dev/schema.json"');
    expect(schemaJson).toContain('"$schema": "https://json-schema.org/draft/2020-12/schema"');
    expect(JSON.parse(schemaJson)).toEqual(
      JSON.parse(await Bun.file("packages/skill-core/schema/skctl.schema.json").text()),
    );
  });
});
