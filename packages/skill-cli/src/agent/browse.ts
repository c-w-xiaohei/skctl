import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { renderAgentCatalog, unavailableCatalogPrompt } from "../agent-prompt";
import { collectionId } from "./arguments";
export function browseCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("browse")
    .description(
      "Return a system-prompt-ready XML catalog. Root browse includes loading instructions; collection browse returns immediate Skills and child Collections.",
    )
    .addArgument(
      new Argument("[collection-id]", "Collection ID, not a Skill selector").argParser(
        collectionId,
      ),
    )
    .action(async (collection, _flags, action) => {
      const { value } = await api.browseCatalog(environment(action), { collection });
      stdout.write(
        value.status === "unavailable"
          ? `${unavailableCatalogPrompt}\n`
          : renderAgentCatalog(value.scope, value.items),
      );
    });
}
