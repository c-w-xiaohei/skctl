import type { Command } from "commander";
import type { UseWriteResult } from "@skill-cli/core";
import type { CommandContext } from "../command-context";
import { scope, scopeOptions } from "./shared";
function formatUse(result: UseWriteResult) {
  const delta = result.use;
  const added = delta.after.filter((id) => !delta.before.includes(id));
  const removed = delta.before.filter((id) => !delta.after.includes(id));
  const retained = delta.after.filter((id) => delta.before.includes(id));
  return `Scope: ${result.level}. Added: ${added.join(", ") || "none"}. Retained: ${retained.join(", ") || "none"}. Removed: ${removed.join(", ") || "none"}.\n`;
}
export function useCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  const use = parent
    .command("use")
    .description("Manage direct catalog roots declared at one configuration scope.");
  scopeOptions(use.command("list"))
    .description(
      "List direct catalog roots at one scope; this does not show the effective catalog.",
    )
    .option("--json")
    .action(async (flags, action) => {
      const selectedLevel = scope(flags);
      const { value } = await api.getWorkspace(environment(action));
      const collections =
        value.configs
          ?.find((item) => item.level === selectedLevel)
          ?.direct.collectionUse.map((item) => item.collection) ?? [];
      stdout.write(
        flags.json
          ? `${JSON.stringify({ scope: selectedLevel, collections })}\n`
          : `${collections.join("\n")}${collections.length ? "\n" : ""}`,
      );
    });
  scopeOptions(use.command("add <id>"))
    .description(
      "Add one direct catalog root at one scope. Repository-derived Collections need this separately (use add <owner/repository> -g) to appear as global catalog roots.",
    )
    .action(async (collection, flags, action) => {
      const { value } = await api.addUse(environment(action), {
        level: scope(flags)!,
        collection,
      });
      stdout.write(formatUse(value));
    });
  scopeOptions(use.command("remove <id>"))
    .description("Remove one direct catalog root from one scope.")
    .action(async (collection, flags, action) => {
      const { value } = await api.removeUse(environment(action), {
        level: scope(flags)!,
        collection,
      });
      stdout.write(formatUse(value));
    });
  scopeOptions(use.command("set <collection...>"))
    .description("Replace all direct catalog roots at one scope.")
    .action(async (collections, flags, action) => {
      const { value } = await api.setUse(environment(action), {
        level: scope(flags)!,
        collections,
      });
      stdout.write(formatUse(value));
    });
}
