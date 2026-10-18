import { Command, CommanderError } from "commander";
import * as api from "@skill-cli/core";
import { SkillCliError } from "@skill-cli/core";
import { registerHumanCommands } from "./human";
import { agentCommand } from "./agent";
import type { CommandContext } from "./command-context";
import { launchInstalledTui } from "./tui-launcher";
type Output = {
  write(chunk: string): unknown;
};
export interface MainOptions {
  readonly cwd?: string;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly launchTui?: typeof launchInstalledTui;
  readonly api?: Partial<typeof api>;
  readonly environment?: Partial<api.CoreOptions>;
}
export async function runMain(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdinIsTTY = options.stdinIsTTY ?? process.stdin.isTTY === true;
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let code = 0;
  const launch = async (project?: string) => {
    active = tui;
    if (!stdinIsTTY || !stdoutIsTTY)
      throw new Error("skill-tui requires an interactive input/output terminal.");
    code = await (options.launchTui ?? launchInstalledTui)({ cwd, project });
  };
  const command = new Command("skill-cli")
    .exitOverride()
    .enablePositionalOptions()
    .addHelpCommand(true)
    .configureOutput({
      writeOut: (value) => void stdout.write(value),
      writeErr: (value) => void stderr.write(value),
    })
    .option("--project <path>", "Resolve project and local declarations from this path.");
  let active = command;
  const context: CommandContext = {
    cwd,
    stdout,
    api: { ...api, ...options.api },
    environment: (action) => ({
      ...options.environment,
      cwd,
      project: action.optsWithGlobals().project,
    }),
  };
  registerHumanCommands(command, context);
  const agent = agentCommand(command, context, (status) => {
    code = status;
  });
  const tui = command
    .command("tui")
    .description("Open the installed skill-tui in an interactive terminal.")
    .action(() => launch(tui.optsWithGlobals().project));
  for (const child of command.commands)
    child.option("--project <path>", "Resolve project and local declarations from this path.");
  command
    .allowExcessArguments()
    .hook("preSubcommand", (_parent, child) => {
      active = child;
    })
    .action(async () => {
      if (command.args.length) command.error(`unknown command '${command.args[0]}'`);
      if (stdinIsTTY && stdoutIsTTY) await launch(command.opts().project);
      else command.outputHelp();
    });
  try {
    await command.parseAsync(argv, { from: "user" });
    return code;
  } catch (error) {
    const human = active !== agent && active !== tui;
    const failureCode = human ? 2 : 1;
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : failureCode;
    let message = error instanceof Error ? error.message : "Internal error";
    if (human)
      message = `${error instanceof SkillCliError ? error.code : "INVALID_ARGUMENT"}: ${message}`;
    else if (active === agent && !(error instanceof SkillCliError)) message = "Internal error";
    stderr.write(`${message}\n`);
    return failureCode;
  }
}
if (import.meta.main) {
  const code = await runMain(process.argv.slice(2));
  process.exitCode = code;
}
