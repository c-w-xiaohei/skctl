import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMainArgs } from "../src/dispatch";
import { installedTuiCandidates, resolveInstalledTui, superviseTui } from "../src/tui-launcher";
import { runMain } from "../src/main";

const runtime = {
  main: "/$bunfs/root/main.js",
  execPath: "/installed/skill-cli",
  platform: "linux" as const,
  arch: "x64",
  cwd: "/work",
  path: "/bin:/tools",
};

test("compiled sibling canonical, host release then PATH; source never searches beside Bun", () => {
  expect(installedTuiCandidates(runtime)).toEqual([
    "/installed/skill-tui",
    "/installed/skill-tui-linux-x64",
    "/bin/skill-tui",
    "/tools/skill-tui",
  ]);
  expect(installedTuiCandidates({ ...runtime, main: "/source/main.ts" })).toEqual([
    "/bin/skill-tui",
    "/tools/skill-tui",
  ]);
  expect(
    installedTuiCandidates({
      ...runtime,
      platform: "win32",
      main: "B:/$bunfs/root/main.js",
      execPath: "C:\\installed\\skill-cli.exe",
      cwd: "C:\\work",
      path: "C:\\tools",
    }),
  ).toEqual([
    "C:\\installed\\skill-tui.exe",
    "C:\\installed\\skill-tui-windows-x64.exe",
    "C:\\tools\\skill-tui.exe",
  ]);
});

test("resolver checks files and executable eligibility before selecting a candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-cli-resolver-"));
  const canonical = join(root, "skill-tui");
  const release = join(root, "skill-tui-linux-x64");
  const options = { ...runtime, execPath: join(root, "skill-cli"), path: join(root, "path") };
  try {
    await mkdir(canonical);
    await writeFile(release, "fixture");
    await chmod(release, 0o755);
    expect(await resolveInstalledTui(options)).toBe(release);
    await rm(canonical, { recursive: true });
    await writeFile(canonical, "fixture");
    await chmod(canonical, 0o644);
    if (process.platform !== "win32") expect(await resolveInstalledTui(options)).toBe(release);
    await chmod(canonical, 0o755);
    expect(await resolveInstalledTui(options)).toBe(canonical);
    expect(await resolveInstalledTui({ ...options, main: "/source/main.ts" })).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supervision forwards termination, awaits child status and removes listeners", async () => {
  const signals = new EventEmitter();
  const received: unknown[] = [];
  let finish!: (status: number) => void;
  const exited = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const result = superviseTui(
    {
      exited,
      signalCode: "SIGTERM",
      kill: (signal) => {
        received.push(signal);
      },
    },
    signals,
  );
  const lateForward = signals.listeners("SIGTERM")[0];
  expect(lateForward).toBeDefined();
  signals.emit("SIGTERM");
  expect(received).toEqual(["SIGTERM"]);
  expect(signals.listenerCount("SIGTERM")).toBe(1);
  finish(143);
  expect(await result).toBe(143);
  lateForward?.();
  signals.emit("SIGTERM");
  expect(received).toEqual(["SIGTERM"]);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGWINCH"])
    expect(signals.listenerCount(signal)).toBe(0);
  expect(
    await superviseTui({ exited: Promise.resolve(7), signalCode: null, kill: () => {} }, signals),
  ).toBe(7);
  expect(
    await superviseTui(
      { exited: Promise.resolve(0), signalCode: "SIGTERM", kill: () => {} },
      signals,
    ),
  ).toBe(143);
  expect(
    await superviseTui({ exited: Promise.resolve(0), signalCode: 35, kill: () => {} }, signals),
  ).toBe(163);
  expect(
    await superviseTui({ exited: Promise.resolve(7), signalCode: 35, kill: () => {} }, signals),
  ).toBe(7);
  expect(
    await superviseTui({ exited: Promise.resolve(0), signalCode: 0, kill: () => {} }, signals),
  ).toBe(0);
  expect(
    await superviseTui({ exited: Promise.resolve(0), signalCode: null, kill: () => {} }, signals),
  ).toBe(0);
  await expect(
    superviseTui(
      { exited: Promise.reject(new Error("wait failed")), signalCode: null, kill: () => {} },
      signals,
    ),
  ).rejects.toThrow("wait failed");
  expect(signals.listenerCount("SIGTERM")).toBe(0);
});

test("POSIX resize is relayed without settling supervision; Windows does not subscribe", async () => {
  for (const platform of ["linux", "win32"] as const) {
    const signals = new EventEmitter();
    const received: unknown[] = [];
    let finish!: (status: number) => void;
    let settled = false;
    const exited = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const result = superviseTui(
      {
        exited,
        signalCode: null,
        kill: (signal) => {
          received.push(signal);
        },
      },
      signals,
      platform,
    );
    void result.then(() => {
      settled = true;
    });
    signals.emit("SIGWINCH");
    await Promise.resolve();
    expect(received).toEqual(platform === "win32" ? [] : ["SIGWINCH"]);
    expect(settled).toBe(false);
    finish(7);
    expect(await result).toBe(7);
    expect(signals.listenerCount("SIGWINCH")).toBe(0);
  }
});

test("bounded dispatch preserves agent child argv and values named agent", () => {
  expect(parseMainArgs(["--project", "agent", "tui"])).toMatchObject({
    kind: "tui",
    project: "agent",
  });
  expect(parseMainArgs(["tui", "--project", "agent"])).toMatchObject({
    kind: "tui",
    project: "agent",
  });
  expect(parseMainArgs(["init", "agent"])).toMatchObject({ kind: "human" });
  expect(parseMainArgs(["--unknown", "agent", "browse"])).toMatchObject({ kind: "human" });
  const child = ["run", "c:s", "--", "binary", "agent", "--project", "child-path"];
  expect(parseMainArgs(["--project", "parent", "agent", ...child])).toEqual({
    kind: "agent",
    project: "parent",
    args: child,
  });
  expect(() => parseMainArgs(["--project"])).toThrow("requires a value");
  expect(() => parseMainArgs(["tui", "--unknown"])).toThrow("Unknown");
});

test("implicit TTY and explicit UI forward project/status; nonTTY never launches", async () => {
  const launches: unknown[] = [];
  let output = "";
  const options = {
    cwd: "/work",
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stdout: {
      write: (text: string) => {
        output += text;
      },
    },
    stderr: {
      write: (text: string) => {
        output += text;
      },
    },
    launchTui: async (value: unknown) => {
      launches.push(value);
      return 7;
    },
  };
  expect(await runMain(["--project", "P"], options)).toBe(7);
  expect(await runMain(["tui", "--project", "Q"], options)).toBe(7);
  expect(launches).toEqual([
    { cwd: "/work", project: "P" },
    { cwd: "/work", project: "Q" },
  ]);
  const nonTTY = { ...options, stdinIsTTY: false };
  expect(await runMain([], nonTTY)).toBe(0);
  expect(await runMain(["tui"], nonTTY)).toBe(1);
  expect(await runMain(["tui", "--help"], nonTTY)).toBe(0);
  expect(await runMain(["--unknown", "agent", "browse"], nonTTY)).not.toBe(0);
  expect(launches).toHaveLength(2);
  expect(output).toContain("interactive input/output terminal");
});
