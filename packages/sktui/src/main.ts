import {} from "@skctl/core";
export function parseTuiArgs(argv: readonly string[]) {
  let project: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--project" || argument.startsWith("--project=")) {
      if (project !== undefined) throw new Error("Duplicate option: --project");
      project = argument.startsWith("--project=") ? argument.slice(10) : argv[++index];
      if (!project || project.startsWith("-"))
        throw new Error("Option requires a value: --project");
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return { project, help };
}
if (import.meta.main) {
  try {
    const options = parseTuiArgs(process.argv.slice(2));
    if (options.help)
      process.stdout.write(
        "Usage: sktui [--project <path>]\nOpen the interactive Skill workspace.\n",
      );
    else {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error("sktui requires an interactive input/output terminal.");
      // Renderer owns signal teardown; retain conventional status after its awaited destruction.
      const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
      const handlers = signals.map((signal, index) => {
        const handler = () => {
          process.exitCode = [130, 143, 129][index];
        };
        process.on(signal, handler);
        return { signal, handler };
      });
      try {
        const { runTui } = await import("./app");
        await runTui({ cwd: process.cwd(), project: options.project });
      } finally {
        for (const { signal, handler } of handlers) process.removeListener(signal, handler);
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
