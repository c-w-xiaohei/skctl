import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as core from "@skctl/core";
import * as api from "@skctl/core";
import { parse } from "jsonc-parser";
import { runMain } from "../src/main";

const impact: core.RebindImpact = {
  kind: "rebind",
  scope: "captured-workspace",
  limitation: "Other projects and external consumers are not inspected or rewritten.",
  baseline: "review-baseline",
  address: { source: "old", path: "review" },
  owner: "new",
  ownerPath: "renamed",
  proof: "proven",
  directMemberships: [
    {
      collection: "engineering",
      name: "review",
      owner: {
        level: "project",
        file: "/workspace/skctl.jsonc",
        pointer: "/collections/engineering/members/review",
      },
      before: { source: "old", path: "review" },
      after: { source: "new", path: "renamed" },
    },
  ],
  blockers: [],
  allowed: true,
};

test("rebind preview saves the complete impact and apply uses only the saved review", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-rebind-review-"));
  const calls: unknown[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  const options = {
    cwd: root,
    api: {
      previewRebind: async (_environment: core.CoreOptions, request: core.RebindRequest) => {
        calls.push(["preview", request]);
        return { value: impact, diagnostics: [] };
      },
      rebindSkill: async (_environment: core.CoreOptions, request: core.ReviewedRebindRequest) => {
        calls.push(["apply", request]);
        return { value: undefined, diagnostics: [] };
      },
    },
    stdout: { write: (value: string) => output.push(value) },
    stderr: { write: (value: string) => errors.push(value) },
  };
  try {
    expect(
      await runMain(
        ["rebind", "preview", "old", "review", "new", "--path", "renamed", "--json"],
        options,
      ),
    ).toBe(0);
    expect(JSON.parse(output.join(""))).toEqual(impact);
    await writeFile(join(root, "review.json"), output.join(""));
    output.length = 0;
    expect(await runMain(["rebind", "apply", "review.json"], options)).toBe(0);
    expect(calls).toEqual([
      ["preview", { source: "old", path: "review", owner: "new", ownerPath: "renamed" }],
      [
        "apply",
        {
          source: "old",
          path: "review",
          owner: "new",
          ownerPath: "renamed",
          reviewedImpact: impact,
        },
      ],
    ]);
    expect(output.join("")).toMatch(/1\s+(direct\s+)?membership/iu);
    expect(output.join("")).toMatch(/other projects/iu);
    expect(errors).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saved CLI review repairs actual memberships and rejects stale evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-rebind-real-"));
  const previous = process.env.SKCTL_STATE_DIR;
  const global = join(root, "global.jsonc");
  const project = join(root, "skctl.jsonc");
  const state = join(root, "state", "state.json");
  const skills = join(root, "skills");
  const environment = { cwd: root, userConfigPath: global };
  let output = "";
  let errors = "";
  const options = {
    cwd: root,
    environment: { userConfigPath: global },
    stdout: {
      write: (value: string) => {
        output += value;
      },
    },
    stderr: {
      write: (value: string) => {
        errors += value;
      },
    },
  };
  try {
    process.env.SKCTL_STATE_DIR = join(root, "state");
    await writeFile(global, "{}\n");
    await writeFile(project, "{}\n");
    await mkdir(join(skills, "guide"), { recursive: true });
    const content = "---\nname: guide\ndescription: Guide\n---\nBody\n";
    await writeFile(join(skills, "guide", "SKILL.md"), content);
    for (const id of ["first", "next"])
      await api.registerSource(environment, {
        level: "project",
        id,
        binding: { kind: "local", path: skills, root: "" },
      });
    await api.installSkills(environment, { source: "first", paths: ["guide"] });
    await api.createCollection(environment, { level: "project", collection: "daily" });
    await api.addMember(environment, {
      level: "project",
      collection: "daily",
      name: "alias",
      address: { source: "first", path: "guide" },
    });
    expect(await runMain(["rebind", "preview", "first", "guide", "next", "--json"], options)).toBe(
      0,
    );
    const review = output;
    expect(JSON.parse(review).directMemberships).toHaveLength(1);
    await writeFile(
      join(root, "review.json"),
      JSON.stringify({ ...JSON.parse(review), owner: "first" }),
    );
    const untampered = await Promise.all([project, state].map((file) => readFile(file, "utf8")));
    output = "";
    expect(await runMain(["rebind", "apply", "review.json"], options)).toBe(2);
    expect(errors).toContain("CONFIG_CONFLICT");
    expect(await Promise.all([project, state].map((file) => readFile(file, "utf8")))).toEqual(
      untampered,
    );
    errors = "";
    await writeFile(join(root, "review.json"), review);
    await api.addMember(environment, {
      level: "project",
      collection: "daily",
      name: "second",
      address: { source: "first", path: "guide" },
    });
    const before = await Promise.all([project, state].map((file) => readFile(file, "utf8")));
    output = "";
    expect(await runMain(["rebind", "apply", "review.json"], options)).toBe(2);
    expect(errors).toContain("CONFIG_CONFLICT");
    expect(await Promise.all([project, state].map((file) => readFile(file, "utf8")))).toEqual(
      before,
    );
    errors = "";
    expect(await runMain(["rebind", "preview", "first", "guide", "next", "--json"], options)).toBe(
      0,
    );
    await writeFile(join(root, "review.json"), output);
    output = "";
    expect(await runMain(["rebind", "apply", "review.json"], options)).toBe(0);
    expect(output).toMatch(/2\s+direct memberships/iu);
    expect(parse(await readFile(project, "utf8")).collections.daily.members).toEqual({
      alias: { source: "next", path: "guide" },
      second: { source: "next", path: "guide" },
    });
    expect((await api.getWorkspace(environment)).value.installedSkills[0]!.address).toEqual({
      source: "next",
      path: "guide",
    });
    expect(await readFile(join(skills, "guide", "SKILL.md"), "utf8")).toBe(content);
  } finally {
    if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("rebind rejects malformed reviews and the legacy immediate mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-rebind-invalid-"));
  const calls: unknown[] = [];
  const options = {
    cwd: root,
    api: {
      rebindSkill: async (_environment: core.CoreOptions, request: core.ReviewedRebindRequest) => {
        calls.push(request);
        return { value: undefined, diagnostics: [] };
      },
    },
    stdout: { write() {} },
    stderr: { write() {} },
  };
  try {
    for (const contents of [
      "{",
      "null",
      JSON.stringify({ ...impact, directMemberships: "invalid" }),
      JSON.stringify({ ...impact, owner: { source: "attacker" } }),
    ]) {
      await writeFile(join(root, "review.json"), contents);
      expect(await runMain(["rebind", "apply", "review.json"], options)).toBe(2);
    }
    expect(await runMain(["rebind", "old", "review", "new", "--path", "renamed"], options)).toBe(2);
    expect(calls).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-address rebind reports no membership repairs while retaining installed identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-rebind-same-address-"));
  const previous = process.env.SKCTL_STATE_DIR;
  const global = join(root, "global.jsonc");
  const project = join(root, "skctl.jsonc");
  const skills = join(root, "skills");
  const environment = { cwd: root, userConfigPath: global };
  let output = "";
  const options = {
    cwd: root,
    environment: { userConfigPath: global },
    stdout: {
      write: (value: string) => {
        output += value;
      },
    },
    stderr: { write() {} },
  };
  try {
    process.env.SKCTL_STATE_DIR = join(root, "state");
    await writeFile(global, "{}\n");
    await writeFile(project, "{}\n");
    await mkdir(join(skills, "guide"), { recursive: true });
    const content = "---\nname: guide\ndescription: Guide\n---\nBody\n";
    await writeFile(join(skills, "guide", "SKILL.md"), content);
    await api.registerSource(environment, {
      level: "project",
      id: "first",
      binding: { kind: "local", path: skills, root: "" },
    });
    await api.installSkills(environment, { source: "first", paths: ["guide"] });
    await api.createCollection(environment, { level: "project", collection: "daily" });
    await api.addMember(environment, {
      level: "project",
      collection: "daily",
      name: "guide",
      address: { source: "first", path: "guide" },
    });
    expect(await runMain(["rebind", "preview", "first", "guide", "first", "--json"], options)).toBe(
      0,
    );
    const review = JSON.parse(output);
    expect(review.allowed).toBe(true);
    expect(review.directMemberships).toHaveLength(1);
    expect(review.directMemberships[0].before).toEqual(review.directMemberships[0].after);
    await writeFile(join(root, "review.json"), output);
    const config = await readFile(project, "utf8");
    output = "";
    expect(await runMain(["rebind", "apply", "review.json"], options)).toBe(0);
    expect(output).toMatch(/0\s+direct memberships/iu);
    expect(output).toMatch(/(?:same|unchanged)/iu);
    expect(await readFile(project, "utf8")).toBe(config);
    expect((await api.getWorkspace(environment)).value.installedSkills[0]!.address).toEqual({
      source: "first",
      path: "guide",
    });
    expect(await readFile(join(skills, "guide", "SKILL.md"), "utf8")).toBe(content);
  } finally {
    if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
