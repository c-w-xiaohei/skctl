import type { Command } from "commander";
import type { CommandContext } from "../command-context";
export function repairCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("repair")
    .description("Check workspace configuration and installed Skill state for diagnostics.")
    .action(async (_flags, action) => {
      const result = await api.getWorkspace(environment(action));
      stdout.write(
        `Checked workspace state${result.diagnostics.length ? ` with ${result.diagnostics.length} diagnostics` : ""}.\n`,
      );
    });
}
