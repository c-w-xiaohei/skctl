import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { formatObservation, revision } from "./shared";
export function updateCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  const update = parent
    .command("update")
    .description("Review and apply Source updates for already installed Skills.");
  update
    .command("check <source>")
    .description("Compare installed Skills with the Source's current tracked revision.")
    .option("--json")
    .action(async (source, flags, action) => {
      const { value } = await api.checkUpdate(environment(action), { source });
      const { baseline: _baseline, ...observation } = value;
      stdout.write(
        formatObservation(observation, !!flags.json, [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `source ${value.source}`,
          `kind ${value.kind}`,
          ...(["changed", "added", "removed", "unchanged"] as const).flatMap((status) =>
            value[status].map(
              ({ path, name, description }) => `${status} ${path}\t${name}\t${description}`,
            ),
          ),
        ]),
      );
    });
  update
    .command("apply <source> <path...>")
    .description("Apply reviewed Source changes at an exact remote revision.")
    .option("--remove <path...>")
    .option("--revision <revision>", "Exact remote commit to apply.", revision)
    .action(async (source, paths, flags, action) => {
      const remove = flags.remove ?? [];
      await api.updateSkills(environment(action), {
        source,
        paths,
        remove,
        exactRevision: flags.revision,
      });
      stdout.write(
        `Updated skills from source "${source}": ${paths.join(", ")}${remove.length ? `; removed: ${remove.join(", ")}` : ""}.\n`,
      );
    });
}
