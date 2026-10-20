import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { renderAgentCatalog, unavailableCatalogPrompt } from "../agent-prompt";
import { collectionId } from "./arguments";
export function browseCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("browse")
    .description(
      "Return XML: root descriptions and usage guidance, or a Collection's custom instructions and immediate entry descriptions. No repeated Collection description or member bodies.",
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
