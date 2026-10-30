import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { scopeOptions } from "./shared";
import { IntegrationError } from "@skctl/integrations";
export function managedCommand(parent: Command, _context: CommandContext) {
  const managed = parent
    .command("managed")
    .description("Retired: use integration connect/disconnect to manage host entries.");
  scopeOptions(managed.command("set"))
    .description("Enable the managed OpenCode catalog at one configuration level.")
    .action(() => {
      throw new IntegrationError(
        "MANAGED_COMMAND_RETIRED",
        "Use integration connect <codex|opencode> --scope <global|project>. Use controls catalog disclosure.",
      );
    });
  scopeOptions(managed.command("unset"))
    .description("Disable the managed OpenCode catalog at one configuration level.")
    .action(() => {
      throw new IntegrationError(
        "MANAGED_COMMAND_RETIRED",
        "Use integration disconnect <codex|opencode> --scope <global|project>. Removing the legacy field no longer disables catalog access.",
      );
    });
}
