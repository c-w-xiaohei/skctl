import type { Command } from "commander";
import type { CommandContext } from "../command-context";

export function gcCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("gc")
    .description("Permanently delete unreferenced cache material.")
    .action(async (_flags, action) => {
      await core(action).management.gc();
      stdout.write("Garbage-collected unreferenced cache data.\n");
    });
}
