import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import plugin from "../src/index.ts";

const roots: string[] = [];
const originalPath = process.env.PATH;
afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const parent = join(import.meta.dir, "../../../tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "v2-plugin-"));
  roots.push(root);
  await writeFile(
    join(root, "skctl"),
    '#!/bin/sh\npwd > called-cwd\nprintf "%s" "$SKCTL_AGENT" > called-agent\n/bin/cat catalog.txt\n',
  );
  await chmod(join(root, "skctl"), 0o755);
  await writeFile(join(root, "catalog.txt"), "current catalog");
  process.env.PATH = root;
  const callbacks = new Map<string, (event: SessionContext) => Promise<void>>();
  const context = {
    location: { directory: "/wrong-instance-directory" },
    session: {
      get: async () => ({ location: { directory: root } }),
      hook: async (name: string, callback: (event: SessionContext) => Promise<void>) => {
        callbacks.set(name, callback);
      },
    },
  } as unknown as Plugin.Context;
  const cleanup = await plugin.setup(context);
  const event = () =>
    ({
      sessionID: "session",
      system: [{ type: "text", text: "user instructions" }],
    }) as SessionContext;
  return { root, callbacks, cleanup, event };
}
test("V2 hooks use the session directory, preserve instructions and refresh on compaction", async () => {
  const { root, callbacks, cleanup, event } = await fixture();
  try {
    const first = event();
    await callbacks.get("context")!(first);
    await callbacks.get("context")!(first);
    expect(first.system).toEqual([
      { type: "text", text: "user instructions" },
      { type: "text", text: "current catalog" },
    ]);
    expect((await readFile(join(root, "called-cwd"), "utf8")).trim()).toBe(root);
    expect(await readFile(join(root, "called-agent"), "utf8")).toBe("opencode");
    await writeFile(join(root, "catalog.txt"), "updated catalog");
    const compacted = event();
    await callbacks.get("compaction")!(compacted);
    expect(compacted.system.at(-1)).toEqual({ type: "text", text: "updated catalog" });
  } finally {
    cleanup();
  }
});
test("unloaded plugin stops injecting and a missing command does not erase instructions", async () => {
  const { root, callbacks, cleanup, event } = await fixture();
  await rm(join(root, "skctl"));
  const original = console.error;
  const diagnostics: string[] = [];
  console.error = (value) => diagnostics.push(value);
  try {
    const request = event();
    await callbacks.get("context")!(request);
    await callbacks.get("compaction")!(request);
    expect(request.system).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    cleanup();
    await callbacks.get("context")!(request);
    expect(request.system).toHaveLength(1);
  } finally {
    cleanup();
    console.error = original;
  }
});
