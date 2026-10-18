import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { formatChange, scope, scopeOptions } from "./shared";
export function managedCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  const managed = parent
    .command("managed")
    .description("Enable or disable the managed OpenCode catalog projection.");
  scopeOptions(managed.command("set"))
    .description("Enable the managed OpenCode catalog at one configuration level.")
    .action(async (flags, action) => {
      const { value } = await api.setManagedOpenCode(environment(action), {
        level: scope(flags)!,
        managed: true,
      });
      stdout.write(formatChange(value, "Enabled managed OpenCode"));
    });
  scopeOptions(managed.command("unset"))
    .description("Disable the managed OpenCode catalog at one configuration level.")
    .action(async (flags, action) => {
      const { value } = await api.setManagedOpenCode(environment(action), {
        level: scope(flags)!,
        managed: false,
      });
      stdout.write(formatChange(value, "Disabled managed OpenCode"));
    });
}
