import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { capture, digest, type FileSnapshot } from "./files";
import {
  diagnostic,
  type IntegrationDiagnostic,
  type IntegrationTarget,
  type Mechanism,
} from "./schema";

export function configHome(target: IntegrationTarget): string {
  return resolve(
    target.environment.configDirectory ??
      (target.environment.harness === "codex"
        ? (process.env.CODEX_HOME ?? join(homedir(), ".codex"))
        : (process.env.OPENCODE_CONFIG_DIR ??
          join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode"))),
  );
}
export function configRoot(target: IntegrationTarget): string {
  return target.scope.kind === "global"
    ? configHome(target)
    : join(target.scope.directory, target.environment.harness === "codex" ? ".codex" : ".opencode");
}
export async function executable(name: string): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (!isAbsolute(directory)) continue;
    for (const suffix of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const file = join(directory, name + suffix);
      try {
        await access(file, constants.X_OK);
        return file;
      } catch {}
    }
  }
  return undefined;
}

export interface Capability {
  mechanism: Mechanism | null;
  reason: string;
}
async function output(
  file: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const child = Bun.spawn([file, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, NO_COLOR: "1" },
  });
  let timedOut = false;
  const stop = () => {
    timedOut = true;
    child.kill("SIGKILL");
  };
  const timer = setTimeout(stop, 3000);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const reader = child.stdout.getReader();
    let text = "";
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
      if (text.length > 65_536) {
        stop();
        break;
      }
    }
    if ((await child.exited) !== 0 || timedOut) throw new Error("Host capability probe failed");
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
export async function capability(
  target: IntegrationTarget,
  signal?: AbortSignal,
): Promise<Capability> {
  const host = target.environment.harness;
  const file = target.environment.executable ?? (await executable(host));
  if (!file)
    return {
      mechanism: null,
      reason: `${host} executable was not found. Specify the executable for the intended host.`,
    };
  const cwd =
    target.workingDirectory ??
    (target.scope.kind === "project" ? target.scope.directory : homedir());
  try {
    if (host === "codex") {
      const version = (await output(file, ["--version"], cwd, signal)).trim();
      if (version === "codex-cli 0.118.0")
        return {
          mechanism: "default",
          reason:
            "Codex 0.118.0 lacks the required inline and compaction hook contract; use instruction guidance.",
        };
      if (version !== "codex-cli 0.164.0")
        return {
          mechanism: null,
          reason: `Unverified Codex version: ${version}. The native adapter is verified for 0.164.0; 0.118.0 uses instruction guidance.`,
        };
      const features = await output(file, ["features", "list"], cwd, signal);
      return /^hooks\s/m.test(features)
        ? {
            mechanism: "codex-hooks",
            reason: `Codex 0.164.0 command hooks selected (${file}); enable hooks and review definitions in /hooks before use.`,
          }
        : {
            mechanism: "default",
            reason: `The feature list from ${file} does not expose command hooks; use instruction guidance.`,
          };
    }
    const version = await output(file, ["--version"], cwd, signal);
    const match = /^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(version.trim());
    if (!match) return { mechanism: null, reason: `Cannot determine the version of ${file}.` };
    if (Number(match[1]) !== 2)
      return {
        mechanism: "default",
        reason: `No matching plugin adapter for ${version.trim()} (${file}).`,
      };
    if (Number(match[2]) === 0 && Number(match[3]) < 32)
      return {
        mechanism: "default",
        reason: "The V2 adapter requires OpenCode 2.0.32 or newer within V2.",
      };
    return {
      mechanism: "opencode-v2",
      reason: `V2 plugin API selected for ${version.trim()} (${file}); a separately running service may use another version.`,
    };
  } catch {
    return { mechanism: null, reason: `Could not inspect ${file}; no fallback was installed.` };
  }
}

export function createCapture() {
  const files = new Map<string, FileSnapshot>();
  const diagnostics: IntegrationDiagnostic[] = [];
  const failed = new Set<string>();
  return {
    files,
    diagnostics,
    failed,
    async read(file: string): Promise<FileSnapshot | undefined> {
      if (files.has(file)) return files.get(file);
      try {
        const value = await capture(file);
        files.set(file, value);
        return value;
      } catch (error) {
        failed.add(file);
        diagnostics.push(diagnostic(error));
        return undefined;
      }
    },
    revision: () =>
      digest(
        JSON.stringify([...files].map(([file, snapshot]) => [file, snapshot.revision]).sort()),
      ),
  };
}
export type Capture = ReturnType<typeof createCapture>;
