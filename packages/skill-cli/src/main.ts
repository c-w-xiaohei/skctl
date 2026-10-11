import { createHumanCommand, runHumanCommand } from "./human";
import { runAgentCommand } from "./agent";
import { parseMainArgs } from "./dispatch";
import { launchInstalledTui } from "./tui-launcher";

type Output = { write(chunk: string): unknown };
export interface MainOptions {
  readonly cwd?: string;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly launchTui?: typeof launchInstalledTui;
}

export async function runMain(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdinIsTTY = options.stdinIsTTY ?? process.stdin.isTTY === true;
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const parsed = parseMainArgs(argv);
    if (parsed.kind === "agent")
      return runAgentCommand(parsed.args, { cwd, project: parsed.project, stdout, stderr });
    if (parsed.kind === "human") return runHumanCommand(argv, { cwd, stdout, stderr });
    if (parsed.help) {
      stdout.write(
        "Usage: skill-cli tui [--project <path>]\nOpen the installed skill-tui in an interactive terminal.\n",
      );
      return 0;
    }
    if (!stdinIsTTY || !stdoutIsTTY) {
      if (parsed.explicit)
        throw new Error("skill-tui requires an interactive input/output terminal.");
      createHumanCommand({ cwd, stdout, stderr }).outputHelp();
      return 0;
    }
    return await (options.launchTui ?? launchInstalledTui)({ cwd, project: parsed.project });
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await runMain(process.argv.slice(2));
  process.exitCode = code;
}
