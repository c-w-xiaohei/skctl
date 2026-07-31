import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import plugin from "../src/index.ts";
import { UNAVAILABLE_NOTICE } from "../src/prompt.ts";

const roots: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(catalog: unknown) {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-adapter-test-"));
  roots.push(root);
  const catalogPath = join(root, "catalog.json");
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(join(root, "opencode"), "#!/bin/sh\nprintf '1.18.4\\n'\n");
  await writeFile(join(root, "skill-cli"), `#!/bin/sh\n/bin/cat '${catalogPath}'\n`);
  await Promise.all([chmod(join(root, "opencode"), 0o755), chmod(join(root, "skill-cli"), 0o755)]);
  process.env.PATH = root;
  return root;
}

function input(directory: string): PluginInput {
  return { directory, project: {} as PluginInput["project"], worktree: directory } as PluginInput;
}

describe("OpenCode plugin", () => {
  test("renders root Collection nodes from the clean catalog", async () => {
    const root = await fixture({
      scope: { kind: "root" },
      items: [
        {
          kind: "collection",
          id: "engineering",
          name: "engineering",
          description: "Engineering skills",
        },
      ],
    });
    const hooks = await plugin(input(root));
    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output);
    expect(output.system[0]).toContain('"id":"engineering"');
    expect(output.system[0]).toContain("skill-cli agent browse <collection-id>");
  });

  test("fails open without exposing malformed catalog output", async () => {
    const root = await fixture({ protocolVersion: 1, ok: true });
    const log = console.error;
    const diagnostics: string[] = [];
    console.error = (value) => diagnostics.push(String(value));
    try {
      const hooks = await plugin(input(root));
      const output = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]!({ model: {} as never }, output);
      expect(output.system).toEqual([UNAVAILABLE_NOTICE]);
      expect(diagnostics).toEqual(["skill-cli managed catalog is unavailable"]);
    } finally {
      console.error = log;
    }
  });
});
