import type { Command } from "commander";
import type { CommandContext } from "../command-context";

export function uninstallCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("uninstall <source> <path...>")
    .description(
      "Remove installed Skill materializations while preserving their Source declarations.",
    )
    .action(async (source, paths, _flags, action) => {
      await core(action).management.uninstall({ source, paths });
      stdout.write(`Uninstalled ${paths.length} skills from source "${source}".\n`);
    });
}
