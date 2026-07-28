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

async function fixture(
  host = "1.18.4",
  hostScript = `printf '${host}\\n'`,
  skillCliScript?: string,
) {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-adapter-test-"));
  roots.push(root);
  const catalog = join(root, "catalog.json");
  const cwd = join(root, "cwd.txt");
  await writeFile(
    catalog,
    JSON.stringify({
      protocolVersion: 1,
      ok: true,
      operation: "list",
      result: { agent: { id: "opencode", version: host }, mode: "managed", entries: [] },
    }),
  );
  await writeFile(join(root, "opencode"), `#!/bin/sh\n${hostScript}\n`);
  await writeFile(
    join(root, "skill-cli"),
    skillCliScript ?? `#!/bin/sh\n/bin/pwd > '${cwd}'\n/bin/cat '${catalog}'\n`,
  );
  await Promise.all([chmod(join(root, "opencode"), 0o755), chmod(join(root, "skill-cli"), 0o755)]);
  process.env.PATH = root;
  return { root, catalog, cwd };
}

function input(directory: string): PluginInput {
  return { directory, project: {} as PluginInput["project"], worktree: directory } as PluginInput;
}

describe("OpenCode plugin", () => {
  test("exports only the system transform and appends a current catalog per request using project cwd", async () => {
    const files = await fixture();
    const hooks = await plugin(input(files.root));
    expect(Object.keys(hooks)).toEqual(["experimental.chat.system.transform"]);
    const transform = hooks["experimental.chat.system.transform"]!;
    const first = { system: [] as string[] };
    await transform({ model: {} as never }, first);
    expect(first.system).toHaveLength(1);
    expect(first.system[0]).toContain("No managed Skills are currently selected.");
    await expect(Bun.file(files.cwd).text()).resolves.toBe(`${files.root}\n`);
    await writeFile(
      files.catalog,
      JSON.stringify({
        protocolVersion: 1,
        ok: true,
        operation: "list",
        result: {
          agent: { id: "opencode", version: "1.18.4" },
          mode: "managed",
          entries: [
            {
              selector: "team:new",
              aliases: [],
              name: "new",
              description: "fresh",
              loadingOwner: "skill-cli",
              provenance: {
                source: "team",
                origin: "local",
                declaration: { layer: "project" },
                stability: "mutable-local",
              },
            },
          ],
        },
      }),
    );
    const second = { system: [] as string[] };
    await transform({ model: {} as never }, second);
    expect(second.system[0]).toContain('"selector":"team:new"');
  });

  test("never rejects and logs one redacted bounded diagnostic for missing, mismatch, nonzero, malformed, utf8, and render failures", async () => {
    const logs: string[] = [];
    const log = console.error;
    console.error = (...values: unknown[]) => logs.push(values.join(" "));
    try {
      const files = await fixture("1.18.5");
      const hooks = await plugin(input(files.root));
      const output = { system: [] as string[] };
      await expect(
        hooks["experimental.chat.system.transform"]!({ model: {} as never }, output),
      ).resolves.toBeUndefined();
      expect(output.system).toEqual([UNAVAILABLE_NOTICE]);
      expect(logs).toHaveLength(1);
      expect(new TextEncoder().encode(logs[0]!).byteLength).toBeLessThanOrEqual(4096);
      expect(logs[0]).not.toContain(files.root);
      const repeatedOutput = { system: [] as string[] };
      await expect(
        hooks["experimental.chat.system.transform"]!({ model: {} as never }, repeatedOutput),
      ).resolves.toBeUndefined();
      expect(repeatedOutput.system).toEqual([UNAVAILABLE_NOTICE]);
      expect(logs).toHaveLength(1);
      process.env.PATH = "/missing";
      const missing = await plugin(input(files.root));
      const missingOutput = { system: [] as string[] };
      await expect(
        missing["experimental.chat.system.transform"]!({ model: {} as never }, missingOutput),
      ).resolves.toBeUndefined();
      expect(missingOutput.system).toEqual([UNAVAILABLE_NOTICE]);
    } finally {
      console.error = log;
    }
  });

  test("deduplicates invalid UTF-8 host-probe stdout and stderr diagnostics per Plugin instance", async () => {
    const logs: string[] = [];
    const log = console.error;
    console.error = (...values: unknown[]) => logs.push(values.join(" "));
    try {
      for (const hostScript of ["printf '\\377'", "printf '\\377' >&2; exit 2"]) {
        const files = await fixture("1.18.4", hostScript);
        const hooks = await plugin(input(files.root));
        for (let request = 0; request < 2; request++) {
          const output = { system: [] as string[] };
          await expect(
            hooks["experimental.chat.system.transform"]!({ model: {} as never }, output),
          ).resolves.toBeUndefined();
          expect(output.system).toEqual([UNAVAILABLE_NOTICE]);
        }
      }
      expect(logs).toHaveLength(2);
    } finally {
      console.error = log;
    }
  });

  test("degrades typed unavailable and error list responses without exposing their body", async () => {
    const logs: string[] = [];
    const log = console.error;
    console.error = (...values: unknown[]) => logs.push(values.join(" "));
    try {
      for (const envelope of [
        {
          protocolVersion: 1,
          type: "unavailable",
          operation: "list",
          unavailable: { reason: "token=secret" },
        },
        {
          protocolVersion: 1,
          type: "error",
          operation: "list",
          error: { code: "CONFIG_INVALID", message: "token=secret", diagnostics: [] },
        },
      ]) {
        const files = await fixture();
        await writeFile(files.catalog, JSON.stringify(envelope));
        const hooks = await plugin(input(files.root));
        const output = { system: [] as string[] };
        await expect(
          hooks["experimental.chat.system.transform"]!({ model: {} as never }, output),
        ).resolves.toBeUndefined();
        expect(output.system).toEqual([UNAVAILABLE_NOTICE]);
      }
      expect(logs).toHaveLength(2);
      expect(logs.join("\n")).not.toContain("secret");
    } finally {
      console.error = log;
    }
  });

  test("bounds the emitted diagnostic by UTF-8 bytes without splitting emoji", async () => {
    const logs: string[] = [];
    const log = console.error;
    console.error = (...values: unknown[]) => logs.push(values.join(" "));
    try {
      const files = await fixture(
        "1.18.4",
        "printf '1.18.4\\n'",
        `#!/bin/sh\n/bin/cat '${join(tmpdir(), "missing")}'\n`,
      );
      await writeFile(
        files.catalog,
        JSON.stringify({
          protocolVersion: 1,
          type: "error",
          operation: "list",
          error: { code: "CONFIG_INVALID", message: "bad", diagnostics: [] },
        }),
      );
      await writeFile(
        join(files.root, "skill-cli"),
        `#!/bin/sh\n/bin/cat '${files.catalog}'\nprintf '${"😀".repeat(2_000)}' >&2\nexit 1\n`,
      );
      await chmod(join(files.root, "skill-cli"), 0o755);
      const hooks = await plugin(input(files.root));
      await hooks["experimental.chat.system.transform"]!({ model: {} as never }, { system: [] });
      expect(logs).toHaveLength(1);
      const bytes = new TextEncoder().encode(logs[0]!);
      expect(bytes.byteLength).toBeLessThanOrEqual(4096);
      expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(logs[0]);
      expect(logs[0]).toEndWith(" [truncated]");
    } finally {
      console.error = log;
    }
  });

  test("fails open when a resistant host probe requires forced termination", async () => {
    const logs: string[] = [];
    const log = console.error;
    console.error = (...values: unknown[]) => logs.push(values.join(" "));
    try {
      const files = await fixture();
      await writeFile(
        join(files.root, "opencode"),
        `#!/bin/sh\necho $$ > '${join(files.root, "pid")}'\ntrap '' TERM\nwhile :; do :; done\n`,
      );
      await chmod(join(files.root, "opencode"), 0o755);
      const hooks = await plugin(input(files.root));
      const output = { system: [] as string[] };
      await expect(
        hooks["experimental.chat.system.transform"]!({ model: {} as never }, output),
      ).resolves.toBeUndefined();
      expect(output.system).toEqual([UNAVAILABLE_NOTICE]);
      expect(logs).toHaveLength(1);
      const pid = Number(await Bun.file(join(files.root, "pid")).text());
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      console.error = log;
    }
  });
});
