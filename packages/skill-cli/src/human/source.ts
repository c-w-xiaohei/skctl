import type { Command } from "commander";
import { SkillCliError } from "@skill-cli/core";
import type { CommandContext } from "../command-context";
import { formatChange, formatObservation, scope, scopeOptions, sourceBinding } from "./shared";
export function sourceCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  const source = parent
    .command("source")
    .description("Register discovery boundaries and inspect their candidate Skill Roots.");
  scopeOptions(source.command("register <kind> <id> <origin>"))
    .description(
      "Declare a Source: local, git (Git protocol), or github (GitHub API with safe Git fallback). Remote Sources require --ref. Run discover next to inspect candidate Skill Roots.",
    )
    .option(
      "--root <root>",
      "Origin root for local or remote sources; defaults to the origin root",
      "",
    )
    .option("--ref <ref>", "Required tracked ref for remote git and github Sources.")
    .action(async (kind, id, origin, flags, action) => {
      if (kind !== "local" && kind !== "git" && kind !== "github")
        throw new SkillCliError("INVALID_ARGUMENT", "Source kind must be local, git, or github");
      if (kind !== "local" && flags.ref === undefined)
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires --ref");
      const { value } = await api.registerSource(environment(action), {
        level: scope(flags)!,
        id,
        binding: sourceBinding(kind, origin, flags),
      });
      stdout.write(formatChange(value, `Registered source "${id}"`));
    });
  scopeOptions(source.command("remove <id>"), false)
    .description("Remove a directly declared Source at one scope when it owns no installed Skills.")
    .action(async (id, flags, action) => {
      const selectedScope = scope(flags, null);
      await api.removeSource(environment(action), { source: id, level: selectedScope });
      stdout.write(
        `Removed source "${id}"${selectedScope ? ` from ${selectedScope} scope` : ""}.\n`,
      );
    });
  source
    .command("discover <id>")
    .description("Observe candidate Skill Roots at the tracked revision without installing them.")
    .option("--json")
    .action(async (id, flags, action) => {
      const { value } = await api.discoverSkills(environment(action), { source: id });
      stdout.write(
        formatObservation(value, !!flags.json, [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `source ${value.source}`,
          `kind ${value.kind}`,
          ...value.candidates.map(
            (candidate) =>
              `candidate ${candidate.path}\t${candidate.name}\t${candidate.description}`,
          ),
        ]),
      );
    });
}
