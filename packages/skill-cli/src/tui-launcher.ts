import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";

interface Runtime {
  readonly main: string;
  readonly execPath: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cwd: string;
  readonly path: string;
}

/** Bun.main is virtual in a compiled executable; argv[0] remains "bun". */
export function installedTuiCandidates(runtime: Runtime): string[] {
  const windows = runtime.platform === "win32";
  const paths = windows ? win32 : { dirname, join, resolve };
  const name = `skill-tui${windows ? ".exe" : ""}`;
  const candidates: string[] = [];
  if (runtime.main.replaceAll("\\", "/").includes("/$bunfs/")) {
    const directory = paths.dirname(runtime.execPath);
    const host = windows ? "windows" : runtime.platform;
    candidates.push(
      paths.join(directory, name),
      paths.join(directory, `skill-tui-${host}-${runtime.arch}${windows ? ".exe" : ""}`),
    );
  }
  for (const directory of runtime.path.split(windows ? ";" : ":"))
    candidates.push(paths.resolve(runtime.cwd, directory, name));
  return [...new Set(candidates)];
}

export async function resolveInstalledTui(runtime: Runtime): Promise<string | undefined> {
  for (const candidate of installedTuiCandidates(runtime)) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, runtime.platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(code ?? "")) throw error;
    }
  }
  return undefined;
}

type Child = Pick<Bun.Subprocess, "exited" | "kill" | "signalCode">;
interface Signals {
  on(signal: string, handler: () => void): unknown;
  removeListener(signal: string, handler: () => void): unknown;
}
const terminationSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Await cleanup, preserve child status, and never leave process signal listeners behind. */
export async function superviseTui(
  child: Child,
  signals: Signals = process,
  platform: NodeJS.Platform = process.platform,
): Promise<number> {
  let live = true;
  const forwardedSignals: readonly NodeJS.Signals[] =
    platform === "win32" ? terminationSignals : [...terminationSignals, "SIGWINCH"];
  const handlers = forwardedSignals.map((signal) => {
    const handler = () => {
      if (live) child.kill(signal);
    };
    signals.on(signal, handler);
    return { signal, handler };
  });
  try {
    const status = await child.exited;
    return status !== 0 || !child.signalCode
      ? status
      : 128 +
          (typeof child.signalCode === "number"
            ? child.signalCode
            : (osConstants.signals[child.signalCode] ?? 1));
  } finally {
    live = false;
    for (const { signal, handler } of handlers) signals.removeListener(signal, handler);
  }
}

export async function launchInstalledTui(options: {
  readonly cwd: string;
  readonly project?: string;
}): Promise<number> {
  const executable = await resolveInstalledTui({
    main: Bun.main,
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    cwd: options.cwd,
    path: process.env.PATH ?? "",
  });
  if (!executable)
    throw new Error(
      "skill-tui is not installed. Download the matching skill-tui release next to skill-cli or put skill-tui on PATH, then run skill-cli tui (or skill-tui).",
    );
  const child = Bun.spawn(
    [executable, ...(options.project === undefined ? [] : ["--project", options.project])],
    {
      cwd: options.cwd,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return superviseTui(child);
}
