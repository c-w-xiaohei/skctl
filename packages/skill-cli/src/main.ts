import { createHumanCommand, runHumanCommand } from "./cli/human";
import { runAgentCommand } from "./cli/agent";
import { createSkillCliCore } from "./core/create-core";

type Output = { write(chunk: string): unknown };
export interface MainOptions {
  readonly cwd?: string;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
  readonly stdout?: Output;
  readonly stderr?: Output;
}

export async function runMain(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdinIsTTY = options.stdinIsTTY ?? process.stdin.isTTY === true;
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  if (argv.length !== 0) {
    const agentIndex = argv.indexOf("agent");
    if (agentIndex !== -1) {
      let project: string | undefined;
      for (let index = 0; index < agentIndex; index++) {
        const option = argv[index];
        const value = argv[index + 1];
        if (option === "--project") project = value;
        if (option?.startsWith("--")) index++;
      }
      return runAgentCommand(argv.slice(agentIndex + 1), {
        cwd,
        project,
        stdout,
        stderr,
      });
    }
    return runHumanCommand(argv, { cwd, stdout, stderr });
  }
  if (!stdinIsTTY || !stdoutIsTTY) {
    const command = createHumanCommand({ cwd, stdout, stderr });
    await command.outputHelp();
    return 0;
  }
  try {
    const { runTui } = await import("./tui/app");
    await runTui(createSkillCliCore({ cwd }));
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Internal error"}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await runMain(process.argv.slice(2));
  process.exitCode = code;
}
