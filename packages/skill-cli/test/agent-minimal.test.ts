import { expect, test } from "bun:test";
import type { SkillCliCore } from "@skill-cli/core";
import { runMain } from "../src/main";
import { unavailableCatalogPrompt } from "../src/agent-prompt";

async function command(argv: string[], core?: Partial<SkillCliCore>) {
  let stdout = "",
    stderr = "";
  const code = await runMain(["agent", ...argv], {
    cwd: "/project",
    createCore: () => core as SkillCliCore,
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  });
  return { code, stdout, stderr };
}

test("search bounds results and only discloses truncation when it actually occurs", async () => {
  let requested: number | undefined;
  const results = Array.from({ length: 10 }, (_, index) => ({
    selector: `team:s${index}`,
    name: `s${index}`,
    description: "Review",
  }));
  const core = {
    catalog: {
      browse: async () => {
        throw new Error("not used");
      },
      search: async (request: { limit?: number }) => {
        requested = request.limit;
        return {
          value: { results, truncated: request.limit === 10 },
          diagnostics: [],
        };
      },
    },
  };
  const response = await command(["search", "review"], core);
  expect(requested).toBe(10);
  expect(JSON.parse(response.stdout)).toEqual({
    results: results.map(({ selector, name, description }) => ({ selector, name, description })),
    truncated: true,
  });
  const bounded = await command(["search", "review", "--limit=20"], core);
  expect(JSON.parse(bounded.stdout)).not.toHaveProperty("truncated");
});

test("content reads preserve bytes without metadata, wrapping, or added newlines", async () => {
  const text = '---\nname: quoted\ndescription: "Review"\n---\nNo final newline';
  const content = {
    load: async () => ({ text }),
    read: async () => ({ text }),
  } as unknown as SkillCliCore["content"];
  for (const argv of [
    ["load", "team:quoted"],
    ["read", "team:quoted", "references/a.md"],
  ]) {
    expect(await command(argv, { content })).toEqual({ code: 0, stdout: text, stderr: "" });
  }
});

test("unavailable browse provides fallback instructions for system injection", async () => {
  const catalog = {
    browse: async () => ({
      value: { status: "unavailable", reason: "Collection Use is incomplete" },
      diagnostics: [],
    }),
  } as unknown as SkillCliCore["catalog"];
  expect(await command(["browse"], { catalog })).toEqual({
    code: 0,
    stdout: `${unavailableCatalogPrompt}\n`,
    stderr: "",
  });
});

test("run propagates child status and cleans up its own signal listeners without a JSON suffix", async () => {
  const before = process.listenerCount("SIGTERM");
  const argv = ["command", "agent", "--help", "--project", "child-path", "--", "-x"];
  const content = {
    run: async (request: { argv: string[] }) => {
      expect(request.argv).toEqual(argv);
      return { selector: "team:run", exitCode: 7, signal: null, cancelled: false };
    },
  } as unknown as SkillCliCore["content"];
  expect(await command(["run", "team:run", "--", ...argv], { content })).toEqual({
    code: 7,
    stdout: "",
    stderr: "",
  });
  expect(process.listenerCount("SIGTERM")).toBe(before);
});

test("help aliases and argument positions do not consume child help", async () => {
  for (const argv of [
    [],
    ["-h"],
    ["--help"],
    ["search", "-h"],
    ["load", "team:x", "--help"],
    ["run", "--help"],
  ]) {
    const response = await command(argv);
    expect(response.code).toBe(0);
    expect(response.stdout).toContain("Usage:");
    expect(response.stderr).toBe("");
  }
});
