import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createProcessClient,
  redactDiagnostic,
  type ChildProcess,
  type ProcessRunner,
} from "../src/process.ts";

const encoder = new TextEncoder();
const catalog = JSON.stringify({
  protocolVersion: 1,
  ok: true,
  operation: "list",
  result: {
    agent: { id: "opencode", version: "1.18.4" },
    mode: "managed",
    entries: [
      {
        selector: "team:deploy",
        aliases: ["team:release"],
        name: "deploy",
        description: "Deploy safely",
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
});

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function child(stdout = stream(catalog), stderr = stream(), status = 0): ChildProcess {
  return { stdout, stderr, exited: Promise.resolve(status), kill() {} };
}

function runner(calls: unknown[][], next: () => ChildProcess): ProcessRunner {
  return {
    spawn(argv, options) {
      calls.push([argv, options]);
      return next();
    },
  };
}

describe("process client", () => {
  test("resolves PATH executables, probes the candidate host, and invokes protocol v1", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools:/bin",
      exists: (path) => path === "/tools/skill-cli" || path === "/tools/opencode",
      runner: runner(calls, () => (calls.length === 1 ? child(stream("1.18.4\n")) : child())),
      env: { KEEP: "yes", PATH: "/tools:/bin", TOKEN: "ambient" },
    });

    await expect(client.list("/project")).resolves.toEqual([
      expect.objectContaining({ selector: "team:deploy" }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toEqual(["/tools/opencode", "--version"]);
    expect(calls[1]![0]).toEqual([
      "/tools/skill-cli",
      "agent",
      "list",
      "--json",
      "--protocol",
      "1",
    ]);
    expect(calls[1]![1]).toEqual(
      expect.objectContaining({
        cwd: "/project",
        env: expect.objectContaining({
          KEEP: "yes",
          TOKEN: "ambient",
          SKILL_CLI_AGENT: "opencode",
          SKILL_CLI_AGENT_VERSION: "1.18.4",
          NO_COLOR: "1",
          GIT_TERMINAL_PROMPT: "0",
        }),
      }),
    );
  });

  test("probes the exact host once per client while listing a fresh catalog for every request", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(
        calls,
        (() => {
          let count = 0;
          return () => (++count === 1 ? child(stream("1.18.4\n")) : child());
        })(),
      ),
    });
    await expect(client.list("/first")).resolves.toHaveLength(1);
    await expect(client.list("/second")).resolves.toHaveLength(1);
    expect(calls.filter(([argv]) => (argv as string[])[1] === "--version")).toHaveLength(1);
    expect(calls.filter(([argv]) => (argv as string[])[1] === "agent")).toHaveLength(2);
    expect(calls[2]![1]).toEqual(expect.objectContaining({ cwd: "/second" }));
  });

  test("resolves Windows PATH entries and executable suffixes without splitting drive letters", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "C:\\Tools;D:\\bin",
      env: { PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      platform: "win32",
      exists: (path) => path === "C:\\Tools\\skill-cli.CMD" || path === "D:\\bin\\opencode.EXE",
      runner: runner(calls, () => (calls.length === 1 ? child(stream("1.18.4\n")) : child())),
    });

    await expect(client.list("C:\\project")).resolves.toHaveLength(1);
    expect(calls[0]![0]).toEqual(["D:\\bin\\opencode.EXE", "--version"]);
    expect(calls[1]![0]).toEqual([
      "C:\\Tools\\skill-cli.CMD",
      "agent",
      "list",
      "--json",
      "--protocol",
      "1",
    ]);
  });

  test("resolves relative PATH entries to absolute executables before spawning", async () => {
    const calls: unknown[][] = [];
    const tools = resolve("tools");
    const client = createProcessClient({
      path: "tools",
      exists: (path) => path === `${tools}/skill-cli` || path === `${tools}/opencode`,
      runner: runner(calls, () => (calls.length === 1 ? child(stream("1.18.4\n")) : child())),
    });

    await expect(client.list("/project")).resolves.toHaveLength(1);
    expect(calls[0]![0]).toEqual([`${tools}/opencode`, "--version"]);
    expect(calls[1]![0]).toEqual([
      `${tools}/skill-cli`,
      "agent",
      "list",
      "--json",
      "--protocol",
      "1",
    ]);
  });

  test("rejects missing executables, malformed or mismatched host versions, and negative child results", async () => {
    for (const value of ["bad\n", "1.18.5\n", "1.18.4\n"]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: (path) => path === "/tools/skill-cli" || path === "/tools/opencode",
        runner: runner(calls, () =>
          calls.length === 1 ? child(stream(value)) : child(stream(), stream("bad"), 2),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({
        code: value === "1.18.4\n" ? "PROTOCOL" : "HOST_VERSION",
      });
    }
    await expect(
      createProcessClient({ path: "/tools", exists: () => false, runner: runner([], child) }).list(
        "/project",
      ),
    ).rejects.toMatchObject({ code: "SKILL_CLI_NOT_FOUND" });
  });

  test("enforces streamed bounds and deadlines by terminating and awaiting children", async () => {
    let killed = 0;
    let resolved = false;
    let finish!: (status: number) => void;
    const hanging: ChildProcess = {
      stdout: new ReadableStream({ start() {} }),
      stderr: stream(),
      exited: new Promise(
        (resolve) =>
          (finish = (status) => {
            resolved = true;
            resolve(status);
          }),
      ),
      kill() {
        killed++;
        finish(143);
      },
    };
    let calls = 0;
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: {
        spawn() {
          return ++calls === 1 ? child(stream("1.18.4\n")) : hanging;
        },
      },
      timeoutMs: 1,
    });
    await expect(client.list("/project")).rejects.toMatchObject({ code: "TIMEOUT" });
    const overflow = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(
        [],
        (() => {
          let count = 0;
          return () => (++count === 1 ? child(stream("1.18.4\n")) : child(stream("abcd")));
        })(),
      ),
      stdoutLimit: 3,
    });
    await expect(overflow.list("/project")).rejects.toMatchObject({ code: "OUTPUT_OVERFLOW" });
    let stderrOverflowCalls = 0;
    const stderrOverflow = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: {
        spawn() {
          if (++stderrOverflowCalls === 1) return child(stream("1.18.4\n"));
          return child(new ReadableStream({ start() {} }), stream("abcd"));
        },
      },
      stderrLimit: 3,
    });
    await expect(stderrOverflow.list("/project")).rejects.toMatchObject({
      code: "OUTPUT_OVERFLOW",
    });
    expect(killed).toBe(1);
    expect(resolved).toBe(true);
  });

  test("escalates a resistant child and bounds timeout cleanup for catalog and host probes", async () => {
    function resistant(): {
      child: ChildProcess;
      signals: NodeJS.Signals[];
      finished: () => boolean;
    } {
      let finish!: (status: number) => void;
      let done = false;
      const signals: NodeJS.Signals[] = [];
      const exited = new Promise<number>(
        (resolve) =>
          (finish = (status) => {
            done = true;
            resolve(status);
          }),
      );
      return {
        child: {
          stdout: new ReadableStream({ start() {} }),
          stderr: new ReadableStream({ start() {} }),
          exited,
          kill(signal = "SIGTERM") {
            signals.push(signal);
            if (signal === "SIGKILL") finish(137);
          },
        },
        signals,
        finished: () => done,
      };
    }
    for (const phase of ["catalog", "host"] as const) {
      const resistantChild = resistant();
      if (phase === "catalog") {
        // The catalog case needs a successful host probe before its resistant list child.
        let catalogCalls = 0;
        const catalogClient = createProcessClient({
          path: "/tools",
          exists: () => true,
          runner: {
            spawn() {
              catalogCalls++;
              return catalogCalls === 1 ? child(stream("1.18.4\n")) : resistantChild.child;
            },
          },
          timeoutMs: 1,
          terminationGraceMs: 1,
          cleanupTimeoutMs: 10,
        });
        await expect(catalogClient.list("/project")).rejects.toMatchObject({ code: "TIMEOUT" });
      } else {
        const client = createProcessClient({
          path: "/tools",
          exists: () => true,
          runner: { spawn: () => resistantChild.child },
          timeoutMs: 1,
          terminationGraceMs: 1,
          cleanupTimeoutMs: 10,
        });
        await expect(client.list("/project")).rejects.toMatchObject({
          code: "TIMEOUT",
          hostProbe: true,
        });
      }
      expect(resistantChild.signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(resistantChild.finished()).toBe(true);
    }
  });

  test("clears every deadline timer after successful child executions", async () => {
    const set = globalThis.setTimeout;
    const clear = globalThis.clearTimeout;
    const timers = new Set<number>();
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const timer = set(handler, timeout, ...args) as unknown as number;
      timers.add(timer);
      return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: number | undefined) => {
      timers.delete(timer ?? -1);
      clear(timer as never);
    }) as typeof clearTimeout;
    try {
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(
          [],
          (() => {
            let calls = 0;
            return () => (++calls === 1 ? child(stream("1.18.4\n")) : child());
          })(),
        ),
      });
      await expect(client.list("/project")).resolves.toHaveLength(1);
      expect([...timers]).toEqual([]);
    } finally {
      globalThis.setTimeout = set;
      globalThis.clearTimeout = clear;
    }
  });

  test("strictly validates UTF-8, one object, envelope, result fields, and redacts diagnostics", async () => {
    const invalid = new Uint8Array([0xff]);
    for (const stdout of [
      new ReadableStream({
        start(controller) {
          controller.enqueue(invalid);
          controller.close();
        },
      }),
      stream(`${catalog}${catalog}`),
      stream(JSON.stringify({ protocolVersion: 2, ok: true, operation: "list", result: {} })),
      stream(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          operation: "list",
          result: { entries: [{}] },
        }),
      ),
      stream(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          operation: "list",
          result: { agent: { id: "opencode", version: "1.18.4" }, mode: "other", entries: [] },
        }),
      ),
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1 ? child(stream("1.18.4\n")) : child(stdout),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
    expect(
      redactDiagnostic(
        "Authorization: Bearer token\nhttps://user:pass@example.test /tmp/a KEY=secret",
      ),
    ).not.toMatch(/token|user:pass|\/tmp\/a|secret/i);
  });

  test("accepts only a complete managed v1 catalog and rejects selector and alias inconsistencies", async () => {
    const valid = JSON.parse(catalog) as { result: { entries: Record<string, unknown>[] } };
    const entry = valid.result.entries[0]!;
    const provenance = entry.provenance as Record<string, unknown>;
    const invalidEntries = [
      { ...entry, aliases: undefined },
      { ...entry, aliases: ["team:deploy"] },
      { ...entry, aliases: ["team:z", "team:a"] },
      { ...entry, aliases: ["team:a", "team:a"] },
      { ...entry, selector: "team deploy" },
      { ...entry, loadingOwner: "host" },
      { ...entry, provenance: { ...provenance, origin: "native" } },
      { ...entry, provenance: { ...provenance, origin: "git" } },
      {
        ...entry,
        provenance: { ...provenance, origin: "git", stability: "immutable" },
      },
      {
        ...entry,
        provenance: { ...provenance, revision: "abc" },
      },
    ];
    for (const entry of invalidEntries) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1
            ? child(stream("1.18.4\n"))
            : child(
                stream(JSON.stringify({ ...valid, result: { ...valid.result, entries: [entry] } })),
              ),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }

    const duplicate = JSON.stringify({
      ...valid,
      result: {
        ...valid.result,
        entries: [
          valid.result.entries[0],
          { ...valid.result.entries[0], selector: "team:release", aliases: ["team:deploy"] },
        ],
      },
    });
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(calls, () =>
        calls.length === 1 ? child(stream("1.18.4\n")) : child(stream(duplicate)),
      ),
    });
    await expect(client.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });

    const duplicateIdentityCalls: unknown[][] = [];
    const duplicateIdentity = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(duplicateIdentityCalls, () =>
        duplicateIdentityCalls.length === 1
          ? child(stream("1.18.4\n"))
          : child(
              stream(
                JSON.stringify({
                  ...valid,
                  result: {
                    ...valid.result,
                    entries: [
                      { ...entry, aliases: [] },
                      { ...entry, selector: "other:deploy", aliases: [] },
                    ],
                  },
                }),
              ),
            ),
      ),
    });
    await expect(duplicateIdentity.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
  });

  test("handles v1 unavailable and error envelopes explicitly", async () => {
    for (const envelope of [
      {
        protocolVersion: 1,
        type: "unavailable",
        operation: "list",
        unavailable: { reason: "incomplete use" },
      },
      {
        protocolVersion: 1,
        type: "error",
        operation: "list",
        error: { code: "CONFIG_INVALID", message: "bad", diagnostics: [] },
      },
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1
            ? child(stream("1.18.4\n"))
            : child(stream(JSON.stringify(envelope)), stream(), envelope.type === "error" ? 1 : 0),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({
        code: envelope.type === "unavailable" ? "CATALOG_UNAVAILABLE" : "CATALOG_ERROR",
      });
    }
  });

  test("rejects malformed typed v1 unavailable and error envelopes at every child status", async () => {
    const unavailable = {
      protocolVersion: 1,
      type: "unavailable",
      operation: "list",
      unavailable: { reason: "incomplete use" },
    };
    const error = {
      protocolVersion: 1,
      type: "error",
      operation: "list",
      error: {
        code: "CONFIG_INVALID",
        message: "bad",
        diagnostics: [
          {
            code: "CONFIG_INVALID",
            severity: "warning",
            message: "bad",
            location: { file: "skill-cli.jsonc", pointer: "/use" },
            related: [{ message: "related", file: "skill-cli.jsonc", pointer: "/collections" }],
            suggestion: "fix it",
          },
        ],
      },
    };
    const malformed = [
      { ...unavailable, ok: true },
      { ...unavailable, result: {} },
      { ...unavailable, unavailable: {} },
      { ...unavailable, unavailable: { reason: "x", extra: true } },
      { ...unavailable, extra: true },
      { ...unavailable, error: {} },
      { ...error, ok: true },
      { ...error, result: {} },
      { ...error, error: { ...error.error, diagnostics: [{}] } },
      {
        ...error,
        error: { ...error.error, diagnostics: [{ ...error.error.diagnostics[0], extra: true }] },
      },
      { ...error, error: { ...error.error, extra: true } },
      { ...error, extra: true },
      { ...error, unavailable: {} },
      { ...JSON.parse(catalog), error: {} },
    ];
    for (const [envelope, status] of [
      ...malformed.map((value) => [value, 0] as const),
      ...malformed.map((value) => [value, 1] as const),
      [unavailable, 1] as const,
      [error, 0] as const,
      [error, 2] as const,
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1
            ? child(stream("1.18.4\n"))
            : child(stream(JSON.stringify(envelope)), stream(), status),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
  });

  test("recognizes a typed v1 error on a nonzero child without trusting arbitrary stdout", async () => {
    const error = JSON.stringify({
      protocolVersion: 1,
      type: "error",
      operation: "list",
      error: { code: "CONFIG_INVALID", message: "bad", diagnostics: [] },
    });
    for (const [stdout, code, status] of [
      [error, "CATALOG_ERROR", 1],
      ["not a protocol envelope", "PROTOCOL", undefined],
    ] as const) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1
            ? child(stream("1.18.4\n"))
            : child(stream(stdout), stream("token=secret"), 1),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({ code, status });
    }
  });

  test("requires the OpenCode identity and exact success envelope fields", async () => {
    const valid = JSON.parse(catalog) as Record<string, unknown>;
    const result = valid.result as Record<string, unknown>;
    const agent = result.agent as Record<string, unknown>;
    for (const output of [
      { ...valid, result: { ...result, agent: { ...agent, id: "other" } } },
      { ...valid, result: { ...result, agent: { ...agent, version: "1.18.3" } } },
      { ...valid, result: { ...result, agent: { id: "opencode" } } },
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1 ? child(stream("1.18.4\n")) : child(stream(JSON.stringify(output))),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
    for (const output of [
      { ...valid, type: "error" },
      { ...valid, extension: true },
      { ...valid, result: { ...result, extension: true } },
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1 ? child(stream("1.18.4\n")) : child(stream(JSON.stringify(output))),
        ),
      });
      await expect(client.list("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
  });

  test("redacts and truncates diagnostics by valid UTF-8 bytes with a marker", () => {
    const diagnostic = redactDiagnostic(
      `${"😀秘密".repeat(2_000)} Authorization: Bearer secret /tmp/secret %TEMP%\\secret`,
    );
    const bytes = encoder.encode(diagnostic);
    expect(bytes.byteLength).toBeLessThanOrEqual(4096);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(diagnostic);
    expect(diagnostic).toEndWith(" [truncated]");
    expect(diagnostic).not.toMatch(/secret|\/tmp\/|%temp%/i);
  });

  test("redacts complete Windows temporary paths with spaces without erasing surrounding fields", () => {
    const diagnostic = redactDiagnostic(
      'message="C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp\\skill-cli-secret\\stderr.log"; stderr=%TEMP%\\dir with spaces\\trace.log; C:\\Program Files\\skill-cli\\config.json',
    );
    expect(diagnostic).not.toMatch(
      /appdata\\local\\temp|%temp%|skill-cli-secret|dir with spaces|trace\.log/i,
    );
    expect(diagnostic).toContain("C:\\Program Files\\skill-cli\\config.json");
  });
});
