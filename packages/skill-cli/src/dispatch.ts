/** Only leading global options belong to dispatch; agent argv after its command is opaque. */
export function parseMainArgs(argv: readonly string[]) {
  let index = 0;
  let project: string | undefined;
  const takeProject = () => {
    if (project !== undefined) throw new Error("Duplicate option: --project");
    const option = argv[index++]!;
    const value = option.startsWith("--project=") ? option.slice(10) : argv[index++];
    if (!value || value.startsWith("-")) throw new Error("Option requires a value: --project");
    project = value;
  };
  while (argv[index] === "--project" || argv[index]?.startsWith("--project=")) takeProject();
  const command = argv[index];
  if (command === "agent") return { kind: "agent" as const, project, args: argv.slice(index + 1) };
  if (command !== undefined && command !== "tui")
    return { kind: "human" as const, project, args: argv };
  if (command === "tui") index++;
  let help = false;
  while (index < argv.length) {
    if (argv[index] === "--project" || argv[index]?.startsWith("--project=")) takeProject();
    else if (argv[index] === "--help" || argv[index] === "-h") {
      help = true;
      index++;
    } else throw new Error(`Unknown tui argument: ${argv[index]}`);
  }
  return { kind: "tui" as const, project, args: [], explicit: command === "tui", help };
}
