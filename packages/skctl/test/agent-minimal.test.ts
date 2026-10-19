import { expect, test } from "bun:test";
import type * as api from "@skctl/core";
import { runMain } from "../src/main";
import { unavailableCatalogPrompt } from "../src/agent-prompt";
async function command(argv: string[], core?: Partial<typeof api>) {
  let stdout = "",
    stderr = "";
  const code = await runMain(["agent", ...argv], {
    cwd: "/project",
    api: core as typeof api,
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
  const core: Partial<typeof api> = {
    browseCatalog: async (_environment) => {
      throw new Error("not used");
    },
    searchSkills: async (
      _environment,
      request: {
        limit?: number;
      },
    ) => {
      requested = request.limit;
      return {
        value: { results, truncated: request.limit === 10 },
        diagnostics: [],
      };
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
    loadSkill: async () => ({ text }),
    readResource: async () => ({ text }),
  } as unknown as Partial<typeof api>;
  for (const argv of [
    ["load", "team:quoted"],
    ["read", "team:quoted", "references/a.md"],
  ]) {
    expect(await command(argv, content)).toEqual({ code: 0, stdout: text, stderr: "" });
  }
});
test("unavailable browse provides fallback instructions for system injection", async () => {
  const catalog = {
    browseCatalog: async () => ({
      value: { status: "unavailable", reason: "Collection Use is incomplete" },
      diagnostics: [],
    }),
  } as unknown as Partial<typeof api>;
  expect(await command(["browse"], catalog)).toEqual({
    code: 0,
    stdout: `${unavailableCatalogPrompt}\n`,
    stderr: "",
  });
});
test("run propagates child status and cleans up its own signal listeners without a JSON suffix", async () => {
  const before = process.listenerCount("SIGTERM");
  const argv = ["command", "agent", "--help", "--project", "child-path", "--", "-x"];
  const content = {
    runSkill: async (
      _environment: api.CoreOptions,
      request: {
        argv: string[];
      },
    ) => {
      expect(request.argv).toEqual(argv);
      return { selector: "team:run", exitCode: 7, signal: null, cancelled: false };
    },
  } as unknown as Partial<typeof api>;
  expect(await command(["run", "team:run", "--", ...argv], content)).toEqual({
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
