import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { revision } from "./shared";

export function installCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("install <source> <path...>")
    .description(
      "Install reviewed candidate Skill Roots as machine-local content. Remote Sources require --revision with an exact 40-hex commit; install does not add a global catalog root.",
    )
    .option("--revision <revision>", "Exact 40-hex remote commit to materialize.", revision)
    .action(async (source, paths, flags, action) => {
      const exactRevision = flags.revision;
      const { value } = await core(action).installed.install({ source, paths, exactRevision });
      const candidates = value.map((candidate) => candidate.path).join(", ");
      stdout.write(
        `Installed ${value.length} skills from source "${source}"${exactRevision ? ` at revision ${exactRevision}` : ""}${candidates ? `: ${candidates}` : ""}.\n`,
      );
    });
}
