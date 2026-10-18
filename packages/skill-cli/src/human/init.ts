import type { Command } from "commander";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SkillCliError } from "@skill-cli/core";
import type { CommandContext } from "../command-context";

export function initCommand(parent: Command, { cwd, stdout }: CommandContext) {
  return parent
    .command("init [path]")
    .option("--host <host>", "project")
    .action(async (path, flags) => {
      if (flags.host !== "project" && flags.host !== "local")
        throw new SkillCliError("INVALID_ARGUMENT", "Host must be project or local");
      const root = resolve(cwd, path ?? ".");
      const file = join(root, flags.host === "local" ? "skill-cli.local.jsonc" : "skill-cli.jsonc");
      await mkdir(root, { recursive: true });
      const entry = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (entry?.isSymbolicLink())
        throw new SkillCliError("CONFIG_SYMLINK", `Configuration file is a symlink: ${file}`);
      if (entry && !entry.isFile())
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          `Configuration path is not an ordinary file: ${file}`,
        );
      if (!entry) await writeFile(file, "{}\n", { flag: "a" });
      stdout.write(
        entry
          ? `Configuration file already exists at ${file}; contents were not changed or validated.\n`
          : `Initialized configuration at ${file}.\n`,
      );
    });
}
