import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { formatObservation, revision } from "./shared";
import { SkctlError } from "@skctl/core";
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
      stdout.write(
        formatObservation(value, !!flags.json, [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `baseline ${value.baseline}`,
          ...(value.observedAt ? [`observed ${new Date(value.observedAt).toISOString()}`] : []),
          ...(value.refreshError ? [`stale ${value.refreshError}`] : []),
          `source ${value.source}`,
          `kind ${value.kind}`,
          ...(["changed", "added", "removed", "unchanged"] as const).flatMap((status) =>
            value[status].map(
              ({ path, name, description }) => `${status} ${path}\t${name}\t${description}`,
            ),
          ),
        ]),
      );
      if (value.refreshError) throw new SkctlError("PROVIDER_UNAVAILABLE", value.refreshError);
    });
  update
    .command("apply <source> <path...>")
    .description("Apply reviewed Source changes at an exact remote revision.")
    .option("--remove <path...>")
    .option("--revision <revision>", "Exact remote commit to apply.", revision)
    .option("--baseline <baseline>", "Installed baseline returned by update check.")
    .action(async (source, paths, flags, action) => {
      const remove = flags.remove ?? [];
      await api.updateSkills(environment(action), {
        source,
        paths,
        remove,
        exactRevision: flags.revision,
        expectedBaseline: flags.baseline,
      });
      stdout.write(
        `Updated skills from source "${source}": ${paths.join(", ")}${remove.length ? `; removed: ${remove.join(", ")}` : ""}.\n`,
      );
    });
}
