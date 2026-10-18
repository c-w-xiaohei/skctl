import type { Command } from "commander";
import type { CommandContext } from "../command-context";
export function rebindCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("rebind <source> <path> <owner>")
    .description("Move an installed Skill to a different Source owner after review.")
    .option("--path <path>")
    .action(async (source, path, owner, flags, action) => {
      await api.rebindSkill(environment(action), { source, path, owner, ownerPath: flags.path });
      stdout.write(`Rebound skill "${path}" from source "${source}" to "${owner}".\n`);
    });
}
