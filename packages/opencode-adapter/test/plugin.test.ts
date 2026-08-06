import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import plugin from "../src/index.ts";

const roots: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(catalog: string) {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-adapter-test-"));
  roots.push(root);
  const catalogPath = join(root, "catalog.json");
  await writeFile(catalogPath, catalog);
  await writeFile(join(root, "skill-cli"), `#!/bin/sh\n/bin/cat '${catalogPath}'\n`);
  await chmod(join(root, "skill-cli"), 0o755);
  process.env.PATH = root;
  return root;
}

function input(directory: string): PluginInput {
  return { directory, project: {} as PluginInput["project"], worktree: directory } as PluginInput;
}

describe("OpenCode plugin", () => {
  test("renders root Collection nodes from the clean catalog", async () => {
    const catalog =
      '<managed_skill_catalog scope="root">\n<collection>engineering</collection>\n</managed_skill_catalog>\n';
    const root = await fixture(catalog);
    const hooks = await plugin(input(root));
    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output);
    expect(output.system).toEqual([catalog]);
  });

  test("fails open without exposing malformed catalog output", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-adapter-test-"));
    roots.push(root);
    process.env.PATH = root;
    const log = console.error;
    const diagnostics: string[] = [];
    console.error = (value) => diagnostics.push(String(value));
    try {
      const hooks = await plugin(input(root));
      const output = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output);
      expect(output.system).toEqual([]);
      expect(diagnostics).toEqual(["skill-cli managed catalog is unavailable"]);
    } finally {
      console.error = log;
    }
  });
});
