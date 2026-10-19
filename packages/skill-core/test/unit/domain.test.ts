import { describe, expect, test } from "bun:test";

import {
  canonicalLocalOrigin,
  canonicalRemoteOrigin,
  bindingDigest,
  parseSkillAddress,
} from "../../src/source/identity";
import { parseNameSegment, parseSelector } from "../../src/collection/names";
import { parseResourcePath } from "../../src/content/path";
import { parseSkillMetadata } from "../../src/content/text";
import { SkctlError } from "../../src/shared";

describe("domain identity", () => {
  test("normalizes remote origins without changing provider paths", () => {
    expect(parseNameSegment("cafe\u0301")).toBe("caf\u00e9");
    expect(parseSelector("team/lark:review")).toEqual({ source: "team/lark", skill: "review" });
    expect(canonicalRemoteOrigin("HTTPS://Example.TEST:443/A.git/")).toBe(
      "https://example.test/A.git",
    );
    expect(() => canonicalRemoteOrigin("https://user@example.test/a")).toThrow(SkctlError);
    expect(canonicalRemoteOrigin("HTTP://EXAMPLE.TEST:80/owner/repo.git/")).toBe(
      "http://example.test/owner/repo.git",
    );
    expect(canonicalRemoteOrigin("https://EXAMPLE.TEST:444/Owner/Repo//")).toBe(
      "https://example.test:444/Owner/Repo/",
    );
    for (const value of [
      "https://user:password@example.test/repo",
      "https://example.test/repo?ref=main",
      "https://example.test/repo#main",
      "ftp://example.test/repo",
      "not a url",
    ])
      expect(() => canonicalRemoteOrigin(value)).toThrow(SkctlError);
  });

  test("keeps a missing local root as a lexical identity and binds immutably", () => {
    expect(canonicalLocalOrigin("missing/../skills", "/tmp/project")).toBe("/tmp/project/skills");
    expect(
      bindingDigest({
        kind: "local",
        origin: "/tmp/project/skills",
        root: "",
        path: "/tmp/project/skills",
      }),
    ).not.toBe(
      bindingDigest({
        kind: "local",
        origin: "/tmp/project/skills",
        root: "other",
        path: "/tmp/project/skills",
      }),
    );
  });

  test("uses the longest registered source ID when parsing an address", () => {
    expect(parseSkillAddress("team/core/", ["team", "team/core"])).toEqual({
      source: "team/core",
      path: "",
    });
    expect(parseSkillAddress("team/core/review", ["team", "team/core"])).toEqual({
      source: "team/core",
      path: "review",
    });
    for (const address of [
      "team",
      "other/review",
      "team//review",
      "team/../review",
      "team/./review",
    ])
      expect(() => parseSkillAddress(address, ["team", "team/core"])).toThrow(SkctlError);
  });

  test("rejects aliases, invalid references, locators, and resource paths", () => {
    for (const parse of [
      () => parseNameSegment("cafe\u0301", false),
      () => parseSelector("source:one:two"),
      () => parseResourcePath("../secret"),
    ]) {
      expect(parse).toThrow(SkctlError);
    }
  });
});

test("Skill metadata accepts ordinary punctuation in YAML strings and ignores it in comments", () => {
  expect(
    parseSkillMetadata(`---
name: placement-exclusion-manager
description: 'Build a content-suitability & sensitive-topic block list.'
metadata: { note: "Use *literal* text, & labels and ! punctuation" }
# &not-an-anchor *not-an-alias !not-a-tag
---
# Placement Exclusion Manager
`),
  ).toEqual({
    name: "placement-exclusion-manager",
    description: "Build a content-suitability & sensitive-topic block list.",
  });
  expect(
    parseSkillMetadata(
      "---\nname: review\ndescription: |\n  *Review* evidence & flag ! unsupported claims.\n---\n",
    ),
  ).toEqual({ name: "review", description: "*Review* evidence & flag ! unsupported claims." });
});

test("Skill metadata still rejects actual YAML aliases, anchors, tags, duplicates and invalid required fields", () => {
  for (const header of [
    "name: review\ndescription: &shared Review\nmetadata: { repeat: *shared }",
    "name: review\ndescription: Review\nmetadata: { repeat: *missing }",
    "name: review\ndescription: Review\nmetadata: { nested: &unused [safe] }",
    "name: review\ndescription: !!str Review",
    "name: review\ndescription: Review\nmetadata: { nested: !custom safe }",
    "name: review\nname: duplicate\ndescription: Review",
    "name: review\ndescription: []",
    "name: review\ndescription: ' '",
  ])
    expect(() => parseSkillMetadata(`---\n${header}\n---\n`)).toThrow(SkctlError);
});
