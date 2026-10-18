import type { Command } from "commander";
import type { CommandContext } from "../command-context";

export function repairCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("repair")
    .description("Check workspace configuration and installed Skill state for diagnostics.")
    .action(async (_flags, action) => {
      const result = await core(action).workspace.get();
      stdout.write(
        `Checked workspace state${result.diagnostics.length ? ` with ${result.diagnostics.length} diagnostics` : ""}.\n`,
      );
    });
}
