import { Argument, type Command } from "commander";
import { SkillCliError } from "@skill-cli/core";
import { constants } from "node:os";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";

export function runCommand(
  parent: Command,
  { core }: CommandContext,
  setExitCode: (code: number) => void,
) {
  return parent
    .command("run")
    .description(
      "Run in a temporary copy of the Skill Root, deleted after exit. Child output and exit status pass through. This is not a sandbox; commands may access the host and network.",
    )
    .addHelpText(
      "after",
      "\nExample: skill-cli agent run <selector> -- <command> [args...]\nWrite persistent outputs to absolute paths.\n",
    )
    .addArgument(new Argument("<selector>", "Skill selector").argParser(skillSelector))
    .argument("<argv...>", "-- followed by the command and its arguments")
    .passThroughOptions()
    .action(async (selector, argv: string[], _flags, action) => {
      const [separator, executable, ...args] = argv;
      if (separator !== "--" || !executable)
        throw new SkillCliError("INVALID_ARGUMENT", "Selector and argv after -- are required");
      const controller = new AbortController();
      let interrupted: NodeJS.Signals | undefined;
      const signals: NodeJS.Signals[] =
        process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
      const handlers = signals.map((signal) => {
        const handler = () => {
          interrupted = signal;
          controller.abort();
        };
        process.on(signal, handler);
        return { signal, handler };
      });
      try {
        const { value } = await core(action).content.run(
          { selector, argv: [executable, ...args] },
          { signal: controller.signal },
        );
        const signal = interrupted ?? value.signal;
        setExitCode(
          signal ? 128 + (constants.signals[signal as NodeJS.Signals] ?? 1) : (value.exitCode ?? 1),
        );
      } finally {
        for (const { signal, handler } of handlers) process.removeListener(signal, handler);
      }
    });
}
