import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { browseCommand } from "./browse";
import { searchCommand } from "./search";
import { loadCommand } from "./load";
import { readCommand } from "./read";
import { downloadCommand } from "./download";
import { runCommand } from "./run";
import { listCommand } from "./list";

export function agentCommand(
  parent: Command,
  context: CommandContext,
  setExitCode: (code: number) => void,
) {
  const agent = parent
    .command("agent")
    .description("Discover and consume installed Skills without network acquisition.")
    .enablePositionalOptions()
    .addHelpCommand(true)
    .addHelpText(
      "after",
      "\nCollection as Skill: description tells when to enter; its body contains custom\n" +
        "instructions and member descriptions. Follow the guidance; load members as needed.\n" +
        "\n  browse                  Root Collection descriptions\n" +
        "  browse <collection-id>  Collection body and child entries; no repeated description\n" +
        "  load <selector> [...]   Selected Skills' full instructions\n" +
        "\nUse displayed Collection IDs and Skill selectors (<collection-id>:<entry-name>).\n" +
        "run executes host commands; download writes a file. Configuration: skctl collection --help.\n",
    )
    .action(() => {
      if (agent.args.length) agent.error(`unknown command '${agent.args[0]}'`);
      agent.outputHelp();
    });
  browseCommand(agent, context);
  searchCommand(agent, context);
  loadCommand(agent, context);
  listCommand(agent, context);
  readCommand(agent, context);
  downloadCommand(agent, context);
  runCommand(agent, context, setExitCode);
  return agent.allowExcessArguments();
}
