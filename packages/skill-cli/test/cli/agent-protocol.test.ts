import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentCommand } from "../../src/cli/agent";
import { createSkillCliCore } from "../../src/core/create-core";
import { StateCoordinator } from "../../src/core/internal/state";

const encoder = new TextEncoder();
type ChildProcess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number | null>;
  kill(): void;
};
type ProcessClient = {
  list(
    cwd: string,
  ): Promise<readonly { readonly provenance: { readonly declaration: Record<string, string> } }[]>;
};
type ProcessFactory = {
  createProcessClient(options: {
    path: string;
    exists(path: string): boolean;
    runner: { spawn(argv: readonly string[]): ChildProcess };
  }): ProcessClient;
};

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(value));
      controller.close();
    },
  });
}
test("agent list emits a typed unavailable protocol result on stdout", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAgentCommand(["list", "--json", "--protocol", "1"], {
    cwd: "/tmp",
    stdout: { write: (value) => out.push(String(value)) },
    stderr: { write: (value) => err.push(String(value)) },
    createCore: () => ({
      workspace: { get: async () => ({ value: {} as never, diagnostics: [] }) },
      configuration: {
        change: async () => ({ value: {} as never, diagnostics: [] }),
        previewAddToCollection: async () => ({ value: {} as never, diagnostics: [] }),
        previewMembershipRemoval: async () => ({ value: {} as never, diagnostics: [] }),
        previewImport: async () => ({ value: {} as never, diagnostics: [] }),
        previewReference: async () => ({ value: {} as never, diagnostics: [] }),
        previewLinkChange: async () => ({ value: {} as never, diagnostics: [] }),
        previewCollectionUse: async () => ({ value: {} as never, diagnostics: [] }),
        previewCollectionRemoval: async () => ({ value: {} as never, diagnostics: [] }),
      },
      management: {} as never,
      catalog: {
        list: async () => ({
          value: { status: "unavailable", reason: "missing", catalog: [] },
          diagnostics: [],
        }),
        search: async () => ({ value: { query: "", results: [] }, diagnostics: [] }),
      },
      content: {} as never,
    }),
  });
  expect(code).toBe(0);
  expect(JSON.parse(out.join(""))).toEqual({
    protocolVersion: 1,
    type: "unavailable",
    operation: "list",
    unavailable: { reason: "missing" },
  });
  expect(err.join("")).toBe("");
});

test("agent protocol v1 emits success envelopes for every content operation and errors on stdout", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const content = {
    load: async () => ({ value: { text: "skill" }, diagnostics: [] }),
    read: async () => ({ value: { text: "resource" }, diagnostics: [] }),
    download: async () => ({ value: { output: "/tmp/out" }, diagnostics: [] }),
    run: async () => ({ value: { exitCode: 0 }, diagnostics: [] }),
    listResources: async () => ({ value: [], diagnostics: [] }),
  };
  const core = () =>
    ({
      workspace: { get: async () => ({ value: {} as never, diagnostics: [] }) },
      configuration: { change: async () => ({ value: {} as never, diagnostics: [] }) },
      management: {} as never,
      catalog: {
        list: async () => ({
          value: { status: "available" as const, mode: "managed" as const, catalog: [] },
          diagnostics: [],
        }),
        search: async () => ({ value: { query: "review", results: [] }, diagnostics: [] }),
      },
      content,
    }) as never;
  for (const argv of [
    ["search", "review", "--json", "--protocol", "1"],
    ["load", "c:skill", "--json", "--protocol", "1"],
    ["read", "c:skill", "note.txt", "--json", "--protocol", "1"],
    ["download", "c:skill", "note.txt", "--output", "/tmp/out", "--json", "--protocol", "1"],
    ["run", "c:skill", "--json", "--protocol", "1", "--", "true"],
  ]) {
    out.length = 0;
    err.length = 0;
    expect(
      await runAgentCommand(argv, {
        cwd: "/tmp",
        stdout: { write: (value) => out.push(String(value)) },
        stderr: { write: (value) => err.push(String(value)) },
        createCore: core,
      }),
    ).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ protocolVersion: 1, ok: true });
    expect(err).toEqual([]);
  }
  out.length = 0;
  expect(
    await runAgentCommand(["load", "--json", "--protocol", "1"], {
      cwd: "/tmp",
      stdout: { write: (value) => out.push(String(value)) },
      stderr: { write: (value) => err.push(String(value)) },
      createCore: core,
    }),
  ).toBe(1);
  expect(JSON.parse(out.join(""))).toMatchObject({
    protocolVersion: 1,
    type: "error",
    operation: "load",
    error: { code: "INVALID_ARGUMENT" },
  });
});

test("REG-007 projects a real managed Core catalog through the unchanged OpenCode process consumer", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-agent-consumer-"));
  const state = join(root, "state");
  const global = join(root, "global.jsonc");
  const previousAgentVersion = process.env.SKILL_CLI_AGENT_VERSION;
  try {
    const skill = join(root, "skills", "review");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(global, JSON.stringify({ agents: { opencode: "managed" } }));
    await writeFile(
      join(root, "skill-cli.jsonc"),
      JSON.stringify({
        sources: { source: { kind: "local", path: "./skills", root: "" } },
        collections: { team: { members: { review: { source: "source", path: "review" } } } },
        use: ["team"],
      }),
    );
    process.env.SKILL_CLI_STATE_DIR = state;
    process.env.SKILL_CLI_AGENT_VERSION = "1.18.4";
    await new StateCoordinator(state).installLocal("source", "review", skill);
    // This dynamic import reaches the unchanged adapter consumer without pulling its source into this package's TS root.
    const { createProcessClient } = (await import(
      join(import.meta.dir, "../../../opencode-adapter/src/process.ts")
    )) as ProcessFactory;
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: {
        spawn(argv): ChildProcess {
          if (argv[1] === "--version")
            return {
              stdout: stream("1.18.4\n"),
              stderr: stream(""),
              exited: Promise.resolve(0),
              kill() {},
            };
          const out: string[] = [];
          const err: string[] = [];
          const status = runAgentCommand(argv.slice(2), {
            cwd: root,
            createCore: (options) => createSkillCliCore({ ...options, userConfigPath: global }),
            stdout: { write: (value) => out.push(String(value)) },
            stderr: { write: (value) => err.push(String(value)) },
          });
          return {
            stdout: new ReadableStream({
              async start(controller) {
                await status;
                controller.enqueue(encoder.encode(out.join("")));
                controller.close();
              },
            }),
            stderr: stream(err.join("")),
            exited: status,
            kill() {},
          };
        },
      },
    });
    const entries = await client.list(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.provenance.declaration).toEqual({ layer: "project" });
    expect(Object.keys(entries[0]!.provenance.declaration)).toEqual(["layer"]);
  } finally {
    delete process.env.SKILL_CLI_STATE_DIR;
    if (previousAgentVersion === undefined) delete process.env.SKILL_CLI_AGENT_VERSION;
    else process.env.SKILL_CLI_AGENT_VERSION = previousAgentVersion;
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI-002 rejects unknown, duplicate, missing, and inapplicable Agent v1 arguments", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const core = () => {
    throw new Error("invalid arguments must not invoke the Core");
  };
  for (const argv of [
    ["list", "--json", "--protocol", "1", "--unexpected"],
    ["list", "--json", "--protocol", "1", "--output", "/tmp/out"],
    ["search", "review", "--json", "--protocol", "1", "--protocol", "1"],
    ["load", "c:skill", "--json", "--json", "--protocol", "1"],
    ["read", "c:skill", "note.txt", "--agent", "--json", "--protocol", "1"],
    [
      "download",
      "c:skill",
      "note.txt",
      "--output",
      "/tmp/one",
      "--output",
      "/tmp/two",
      "--json",
      "--protocol",
      "1",
    ],
    ["run", "c:skill", "--force", "--json", "--protocol", "1", "--", "true"],
    ["search", "review", "--limit", "--json", "--protocol", "1"],
  ]) {
    out.length = 0;
    err.length = 0;
    expect(
      await runAgentCommand(argv, {
        cwd: "/tmp",
        stdout: { write: (value) => out.push(String(value)) },
        stderr: { write: (value) => err.push(String(value)) },
        createCore: core,
      }),
    ).toBe(1);
    const envelope = JSON.parse(out.join(""));
    expect(envelope).toMatchObject({
      protocolVersion: 1,
      type: "error",
      operation: argv[0],
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(envelope.ok).toBeUndefined();
    expect(err.join("")).toContain("INVALID_ARGUMENT");
  }
});
