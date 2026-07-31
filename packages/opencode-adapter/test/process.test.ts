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
  scope: { kind: "root" },
  items: [{ kind: "collection", id: "team", name: "team", description: "Team skills" }],
});
const unavailable = JSON.stringify({ unavailable: true });

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
  test("resolves PATH executables, probes the candidate host, and invokes clean agent browse", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools:/bin",
      exists: (path) => path === "/tools/skill-cli" || path === "/tools/opencode",
      runner: runner(calls, () => (calls.length === 1 ? child(stream("1.18.4\n")) : child())),
      env: { KEEP: "yes", PATH: "/tools:/bin", TOKEN: "ambient" },
    });

    await expect(client.browse("/project")).resolves.toEqual({
      scope: { kind: "root" },
      items: [expect.objectContaining({ id: "team" })],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toEqual(["/tools/opencode", "--version"]);
    expect(calls[1]![0]).toEqual(["/tools/skill-cli", "agent", "browse"]);
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
    await expect(client.browse("/first")).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(client.browse("/second")).resolves.toMatchObject({ items: expect.any(Array) });
    expect(calls.filter(([argv]) => (argv as string[])[1] === "--version")).toHaveLength(1);
    expect(calls.filter(([argv]) => (argv as string[])[1] === "agent")).toHaveLength(2);
    expect(calls[2]![1]).toEqual(expect.objectContaining({ cwd: "/second" }));
  });

  test("rejects a child collection response or Skills from its fixed root browse", async () => {
    for (const output of [
      { scope: { kind: "collection", id: "team" }, items: [] },
      {
        scope: { kind: "root" },
        items: [{ kind: "skill", selector: "team:deploy", name: "deploy", description: "Deploy" }],
      },
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1 ? child(stream("1.18.4\n")) : child(stream(JSON.stringify(output))),
        ),
      });
      await expect(client.browse("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
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

    await expect(client.browse("C:\\project")).resolves.toMatchObject({ items: expect.any(Array) });
    expect(calls[0]![0]).toEqual(["D:\\bin\\opencode.EXE", "--version"]);
    expect(calls[1]![0]).toEqual(["C:\\Tools\\skill-cli.CMD", "agent", "browse"]);
  });

  test("resolves relative PATH entries to absolute executables before spawning", async () => {
    const calls: unknown[][] = [];
    const tools = resolve("tools");
    const client = createProcessClient({
      path: "tools",
      exists: (path) => path === `${tools}/skill-cli` || path === `${tools}/opencode`,
      runner: runner(calls, () => (calls.length === 1 ? child(stream("1.18.4\n")) : child())),
    });

    await expect(client.browse("/project")).resolves.toMatchObject({ items: expect.any(Array) });
    expect(calls[0]![0]).toEqual([`${tools}/opencode`, "--version"]);
    expect(calls[1]![0]).toEqual([`${tools}/skill-cli`, "agent", "browse"]);
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
      await expect(client.browse("/project")).rejects.toMatchObject({
        code: value === "1.18.4\n" ? "PROTOCOL" : "HOST_VERSION",
      });
    }
    await expect(
      createProcessClient({
        path: "/tools",
        exists: () => false,
        runner: runner([], child),
      }).browse("/project"),
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
    await expect(client.browse("/project")).rejects.toMatchObject({ code: "TIMEOUT" });
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
    await expect(overflow.browse("/project")).rejects.toMatchObject({ code: "OUTPUT_OVERFLOW" });
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
    await expect(stderrOverflow.browse("/project")).rejects.toMatchObject({
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
        await expect(catalogClient.browse("/project")).rejects.toMatchObject({ code: "TIMEOUT" });
      } else {
        const client = createProcessClient({
          path: "/tools",
          exists: () => true,
          runner: { spawn: () => resistantChild.child },
          timeoutMs: 1,
          terminationGraceMs: 1,
          cleanupTimeoutMs: 10,
        });
        await expect(client.browse("/project")).rejects.toMatchObject({
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
      await expect(client.browse("/project")).resolves.toMatchObject({ items: expect.any(Array) });
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
      await expect(client.browse("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
    expect(
      redactDiagnostic(
        "Authorization: Bearer token\nhttps://user:pass@example.test /tmp/a KEY=secret",
      ),
    ).not.toMatch(/token|user:pass|\/tmp\/a|secret/i);
  });

  test("strictly validates clean catalog nodes", async () => {
    for (const output of [
      {
        skills: [{ selector: "team:deploy", name: "deploy", description: "safe", extra: true }],
        references: [],
      },
      {
        skills: [{ selector: "team:deploy", name: "deploy", description: "safe" }],
        references: [{ name: "x", description: "x" }],
      },
      {
        skills: [
          { selector: "team:deploy", name: "deploy", description: "safe" },
          { selector: "team:deploy", name: "again", description: "safe" },
        ],
        references: [],
      },
      { unavailable: true, extra: true },
    ]) {
      const calls: unknown[][] = [];
      const client = createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner(calls, () =>
          calls.length === 1 ? child(stream("1.18.4\n")) : child(stream(JSON.stringify(output))),
        ),
      });
      await expect(client.browse("/project")).rejects.toMatchObject({ code: "PROTOCOL" });
    }
  });

  test("accepts differently named root Collection nodes with the same target ID and recognizes unavailable", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(calls, () =>
        calls.length === 1
          ? child(stream("1.18.4\n"))
          : child(
              stream(
                JSON.stringify({
                  scope: { kind: "root" },
                  items: [
                    { kind: "collection", id: "shared", name: "first", description: "First" },
                    { kind: "collection", id: "shared", name: "second", description: "Second" },
                  ],
                }),
              ),
            ),
      ),
    });
    await expect(client.browse("/project")).resolves.toMatchObject({ items: expect.any(Array) });
    const unavailableClient = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(
        [],
        (() => {
          let count = 0;
          return () => (++count === 1 ? child(stream("1.18.4\n")) : child(stream(unavailable)));
        })(),
      ),
    });
    await expect(unavailableClient.browse("/project")).rejects.toMatchObject({
      code: "CATALOG_UNAVAILABLE",
    });
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
