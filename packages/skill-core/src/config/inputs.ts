import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ConfigLevel } from "./types";
import { SkctlError, type CoreOptions, type OperationOptions } from "../shared";
import { runProviderChild } from "../source/git";

export type ReadWorkspaceOptions = Pick<CoreOptions, "cwd" | "project" | "userConfigPath"> &
  OperationOptions;

export async function resolveProjectRoot(
  cwd: string,
  explicit?: string,
  signal?: AbortSignal,
): Promise<{ root: string; resolution: "explicit" | "nearest-config" | "git-root" }> {
  if (explicit) {
    const root = resolve(cwd, explicit);
    if ((await lstat(root).catch(() => undefined))?.isDirectory())
      return { root, resolution: "explicit" };
    throw new SkctlError("PROJECT_NOT_FOUND", "Project directory must exist");
  }
  let current = resolve(cwd);
  while (true) {
    const config = await lstat(join(current, "skctl.jsonc")).catch(() => undefined);
    if (config?.isFile() && !config.isSymbolicLink())
      return { root: current, resolution: "nearest-config" };
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    const result = await runProviderChild(
      { cmd: ["git", "rev-parse", "--show-toplevel"], cwd, stdout: "pipe", stderr: "pipe" },
      signal,
    );
    const output = new TextDecoder().decode(result.stdout).trim();
    if (result.status === 0 && output) return { root: output, resolution: "git-root" };
  } catch (error) {
    if (error instanceof SkctlError && error.code === "CANCELLED") throw error;
  }
  throw new SkctlError("PROJECT_NOT_FOUND", "Project not found");
}
export function userConfigFile(options: ReadWorkspaceOptions): string {
  return (
    options.userConfigPath ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
      "skctl",
      "config.jsonc",
    )
  );
}
export function configFile(
  options: ReadWorkspaceOptions,
  level: ConfigLevel,
  project: string,
): string {
  return level === "global"
    ? userConfigFile(options)
    : join(project, level === "project" ? "skctl.jsonc" : "skctl.local.jsonc");
}
export function configInputs(options: ReadWorkspaceOptions, project?: string) {
  return [
    { level: "global" as const, file: userConfigFile(options) },
    ...(project
      ? (["project", "local"] as const).map((level) => ({
          level,
          file: configFile(options, level, project),
        }))
      : []),
  ];
}
