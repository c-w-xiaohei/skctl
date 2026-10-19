import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import plugin from "../src/index.ts";

const roots: string[] = [];
const originalPath = process.env.PATH;
const catalog =
  "Use `skctl agent browse <collection-id>` to inspect a Collection and `skctl agent load <selector>` to load a Skill.\n" +
  '<managed_skill_catalog scope="root"><collection><id>engineering</id><name>engineering</name><description>Code review</description></collection></managed_skill_catalog>\n';

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(catalog: string) {
  const parent = join(import.meta.dir, "../../../tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "skctl-adapter-test-"));
  roots.push(root);
  const catalogPath = join(root, "catalog.json");
  await writeFile(catalogPath, catalog);
  await writeFile(join(root, "skctl"), `#!/bin/sh\n/bin/cat '${catalogPath}'\n`);
  await chmod(join(root, "skctl"), 0o755);
  process.env.PATH = root;
  return root;
}

function input(directory: string): PluginInput {
  return { directory, project: {} as PluginInput["project"], worktree: directory } as PluginInput;
}

describe("OpenCode plugin", () => {
  test("passes the root browse prompt through unchanged", async () => {
    const root = await fixture(catalog);
    const hooks = await plugin(input(root));
    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output);
    expect(output.system).toEqual([catalog]);
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output);
    expect(output.system).toHaveLength(1);
  });

  test("preserves the managed catalog in compaction context", async () => {
    const root = await fixture(catalog);
    const hooks = await plugin(input(root));
    const output = { context: [] as string[], prompt: undefined };

    await hooks["experimental.session.compacting"]!({ sessionID: "session" }, output);

    expect(output.context).toEqual([catalog]);
  });

  test("refreshes the root prompt for compaction and subsequent chat requests", async () => {
    const root = await fixture(catalog);
    const hooks = await plugin(input(root));
    const initial = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, initial);

    const refreshed = catalog.replace("Code review", "Deployment review");
    await writeFile(join(root, "catalog.json"), refreshed);
    const compacted = { context: [] as string[], prompt: undefined };
    await hooks["experimental.session.compacting"]!({ sessionID: "session" }, compacted);
    const continued = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, continued);

    expect(initial.system).toEqual([catalog]);
    expect(compacted.context).toEqual([refreshed]);
    expect(continued.system).toEqual([refreshed]);
  });

  test.each(["missing CLI", "nonzero CLI with hostile output"])(
    "both hooks fail open and report only once for %s",
    async (failure) => {
      const parent = join(import.meta.dir, "../../../tmp");
      await mkdir(parent, { recursive: true });
      const root = await mkdtemp(join(parent, "skctl-adapter-test-"));
      roots.push(root);
      if (failure === "nonzero CLI with hostile output") {
        const stderr = `secret-token=very-secret\\000\\001\\037\\177😀${"x".repeat(2048)}`;
        await writeFile(
          join(root, "skctl"),
          `#!/bin/sh\n/bin/printf '%s' 'stdout-sensitive-marker'\n/bin/printf '%b' '${stderr}' >&2\nexit 7\n`,
        );
        await chmod(join(root, "skctl"), 0o755);
      }
      process.env.PATH = root;
      const log = console.error;
      const diagnostics: string[] = [];
      console.error = (value) => diagnostics.push(String(value));
      try {
        const hooks = await plugin(input(root));
        const chatOutput = { system: [] as string[] };
        const compactionOutput = { context: [] as string[], prompt: undefined };

        await hooks["experimental.chat.system.transform"]!({ model: {} as never }, chatOutput);
        await hooks["experimental.session.compacting"]!({ sessionID: "session" }, compactionOutput);

        expect(chatOutput.system).toEqual([]);
        expect(compactionOutput.context).toEqual([]);
        expect(diagnostics).toEqual(["skctl managed catalog is unavailable"]);
      } finally {
        console.error = log;
      }
    },
  );
});
