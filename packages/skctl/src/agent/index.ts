import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { browseCommand } from "./browse";
import { searchCommand } from "./search";
import { loadCommand } from "./load";
import { readCommand } from "./read";
import { downloadCommand } from "./download";
import { runCommand } from "./run";

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
      "\nCollection IDs address browse; Skill selectors (<collection-id>:<entry-name>) address content. Use displayed addresses.\nRun executes host commands; download writes the requested file.\n",
    )
    .action(() => {
      if (agent.args.length) agent.error(`unknown command '${agent.args[0]}'`);
      agent.outputHelp();
    });
  browseCommand(agent, context);
  searchCommand(agent, context);
  loadCommand(agent, context);
  readCommand(agent, context);
  downloadCommand(agent, context);
  runCommand(agent, context, setExitCode);
  return agent.allowExcessArguments();
}
