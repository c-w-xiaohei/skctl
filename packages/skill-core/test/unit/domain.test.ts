import { describe, expect, test } from "bun:test";

import {
  canonicalLocalOrigin,
  canonicalRemoteOrigin,
  bindingDigest,
  parseSkillAddress,
  parseNameSegment,
  parseResourcePath,
  parseSelector,
  SkillCliError,
} from "../../src/internal/domain";

describe("domain identity", () => {
  test("normalizes remote origins without changing provider paths", () => {
    expect(parseNameSegment("cafe\u0301")).toBe("caf\u00e9");
    expect(parseSelector("team/lark:review")).toEqual({ source: "team/lark", skill: "review" });
    expect(canonicalRemoteOrigin("HTTPS://Example.TEST:443/A.git/")).toBe(
      "https://example.test/A.git",
    );
    expect(() => canonicalRemoteOrigin("https://user@example.test/a")).toThrow(SkillCliError);
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
      expect(() => canonicalRemoteOrigin(value)).toThrow(SkillCliError);
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
      expect(() => parseSkillAddress(address, ["team", "team/core"])).toThrow(SkillCliError);
  });

  test("rejects aliases, invalid references, locators, and resource paths", () => {
    for (const parse of [
      () => parseNameSegment("cafe\u0301", false),
      () => parseSelector("source:one:two"),
      () => parseResourcePath("../secret"),
    ]) {
      expect(parse).toThrow(SkillCliError);
    }
  });
});
