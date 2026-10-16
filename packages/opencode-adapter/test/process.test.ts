import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createProcessClient,
  redactDiagnostic,
  type ChildProcess,
  type ProcessRunner,
} from "../src/process.ts";

const encoder = new TextEncoder();
const catalog =
  '<managed_skill_catalog scope="root"><collection id="team">Team workflows</collection>\n' +
  "Use `skill-cli agent browse <collection-id>` to inspect a Collection and `skill-cli agent load <selector>` to load a Skill.\n" +
  "</managed_skill_catalog>\n";

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
  test("runs agent browse and returns stdout unchanged", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools:/bin",
      exists: (path) => path === "/tools/skill-cli",
      runner: runner(calls, child),
      env: { KEEP: "yes", PATH: "/tools:/bin", TOKEN: "ambient" },
    });

    await expect(client.browse("/project")).resolves.toBe(catalog);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual(["/tools/skill-cli", "agent", "browse"]);
    expect(calls[0]![1]).toEqual(
      expect.objectContaining({
        cwd: "/project",
        env: expect.objectContaining({
          KEEP: "yes",
          TOKEN: "ambient",
          SKILL_CLI_AGENT: "opencode",
          NO_COLOR: "1",
          GIT_TERMINAL_PROMPT: "0",
        }),
      }),
    );
  });

  test("runs a fresh browse for every request and resolves cross-host PATH entries", async () => {
    const calls: unknown[][] = [];
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner(calls, child),
    });
    await client.browse("/first");
    await client.browse("/second");
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]).toEqual(expect.objectContaining({ cwd: "/second" }));

    const windowsCalls: unknown[][] = [];
    const windows = createProcessClient({
      path: "C:\\Tools;D:\\bin",
      env: { PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      platform: "win32",
      exists: (path) => path === "C:\\Tools\\skill-cli.CMD",
      runner: runner(windowsCalls, child),
    });
    await windows.browse("C:\\project");
    expect(windowsCalls[0]![0]).toEqual(["C:\\Tools\\skill-cli.CMD", "agent", "browse"]);

    const relativeCalls: unknown[][] = [];
    const tools = resolve("tools");
    const relative = createProcessClient({
      path: "tools",
      exists: (path) => path === `${tools}/skill-cli`,
      runner: runner(relativeCalls, child),
    });
    await relative.browse("/project");
    expect(relativeCalls[0]![0]).toEqual([`${tools}/skill-cli`, "agent", "browse"]);
  });

  test("rejects missing executables, failed commands, empty output, and invalid UTF-8", async () => {
    await expect(
      createProcessClient({ path: "/tools", exists: () => false }).browse("/project"),
    ).rejects.toMatchObject({ code: "SKILL_CLI_NOT_FOUND" });
    await expect(
      createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner([], () => child(stream(), stream("failed"), 2)),
      }).browse("/project"),
    ).rejects.toMatchObject({ code: "CATALOG_ERROR", status: 2, stderr: "failed" });
    await expect(
      createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner([], () => child(stream())),
      }).browse("/project"),
    ).rejects.toMatchObject({ code: "PROTOCOL" });
    const invalid = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      },
    });
    await expect(
      createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner([], () => child(invalid)),
      }).browse("/project"),
    ).rejects.toMatchObject({ code: "PROTOCOL" });
  });

  test("enforces output bounds and deadlines while awaiting child cleanup", async () => {
    let killed = 0;
    let finish!: (status: number) => void;
    const hanging: ChildProcess = {
      stdout: new ReadableStream({ start() {} }),
      stderr: stream(),
      exited: new Promise((resolve) => (finish = resolve)),
      kill() {
        killed++;
        finish(143);
      },
    };
    const timed = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: { spawn: () => hanging },
      timeoutMs: 1,
    });
    await expect(timed.browse("/project")).rejects.toMatchObject({ code: "TIMEOUT" });
    const overflow = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: runner([], () => child(stream("abcd"))),
      stdoutLimit: 3,
    });
    await expect(overflow.browse("/project")).rejects.toMatchObject({ code: "OUTPUT_OVERFLOW" });
    expect(killed).toBe(1);
  });

  test("escalates resistant children and clears successful deadline timers", async () => {
    let finish!: (status: number) => void;
    const signals: NodeJS.Signals[] = [];
    const resistant: ChildProcess = {
      stdout: new ReadableStream({ start() {} }),
      stderr: new ReadableStream({ start() {} }),
      exited: new Promise((resolve) => (finish = resolve)),
      kill(signal = "SIGTERM") {
        signals.push(signal);
        if (signal === "SIGKILL") finish(137);
      },
    };
    const client = createProcessClient({
      path: "/tools",
      exists: () => true,
      runner: { spawn: () => resistant },
      timeoutMs: 1,
      terminationGraceMs: 1,
      cleanupTimeoutMs: 10,
    });
    await expect(client.browse("/project")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);

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
      await createProcessClient({
        path: "/tools",
        exists: () => true,
        runner: runner([], child),
      }).browse("/project");
      expect([...timers]).toEqual([]);
    } finally {
      globalThis.setTimeout = set;
      globalThis.clearTimeout = clear;
    }
  });

  test("redacts and truncates diagnostics", () => {
    const diagnostic = redactDiagnostic(
      `${"😀秘密".repeat(2_000)} Authorization: Bearer secret /tmp/secret %TEMP%\\secret`,
    );
    expect(encoder.encode(diagnostic).byteLength).toBeLessThanOrEqual(4096);
    expect(diagnostic).toEndWith(" [truncated]");
    expect(diagnostic).not.toMatch(/secret|\/tmp\/|%temp%/i);
  });

  test("replaces control characters in diagnostics without changing Unicode", () => {
    expect(redactDiagnostic("a\u0000b\n\u007fc😀")).toBe("a b  c😀");
  });
});
