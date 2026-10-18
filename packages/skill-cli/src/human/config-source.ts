import type { Command } from "commander";
import { SkillCliError } from "@skill-cli/core";
import type { CommandContext } from "../command-context";
import {
  formatChange,
  formatObservation,
  revision,
  scope,
  scopeOptions,
  sourceBinding,
} from "./shared";
export function configSourceCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  const configs = parent
    .command("config-source")
    .description("Manage reusable Config origins and their adopted declarations.");
  scopeOptions(configs.command("register <kind> <id> <origin>"))
    .description(
      "Declare a reusable Config origin: local, git (Git protocol), or github (GitHub API with safe Git fallback). Remote Config Sources require --ref; observe and adopt separately.",
    )
    .option(
      "--root <root>",
      "Origin root for local or remote config sources; defaults to the origin root",
      "",
    )
    .option("--ref <ref>", "Required tracked ref for remote git and github Config Sources.")
    .action(async (kind, id, origin, flags, action) => {
      if (kind !== "local" && kind !== "git" && kind !== "github")
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Config Source kind must be local, git, or github",
        );
      if (kind !== "local" && flags.ref === undefined)
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Config Source requires --ref");
      const { value } = await api.registerConfigSource(environment(action), {
        level: scope(flags)!,
        id,
        binding: sourceBinding(kind, origin, flags),
      });
      stdout.write(formatChange(value, `Registered config source "${id}"`));
    });
  scopeOptions(configs.command("remove <id>"), false)
    .description("Remove a directly declared Config Source at one scope.")
    .action(async (id, flags, action) => {
      const selectedScope = scope(flags, null);
      await api.removeConfig(environment(action), { id, level: selectedScope });
      stdout.write(
        `Removed config source "${id}"${selectedScope ? ` from ${selectedScope} scope` : ""}.\n`,
      );
    });
  configs
    .command("observe <id>")
    .option("--json")
    .action(async (id, flags, action) => {
      const { value } = await api.observeConfigSource(environment(action), { id });
      stdout.write(
        formatObservation(value, !!flags.json, [
          ...(value.exactRevision ? [`revision ${value.exactRevision}`] : []),
          `config-source ${value.id}`,
          `kind ${value.kind}`,
          ...value.contributions.sources.map((source) => `source ${source.id}`),
          ...value.contributions.collections.map((collection) => `collection ${collection.id}`),
        ]),
      );
    });
  configs
    .command("adopt <id>")
    .requiredOption("--revision <revision>", "Exact remote commit to adopt.", revision)
    .action(async (id, flags, action) => {
      await api.adoptConfigSource(environment(action), { id, exactRevision: flags.revision });
      stdout.write(`Adopted config source "${id}".\n`);
    });
  configs.command("forget <id>").action(async (id, _flags, action) => {
    await api.forgetConfig(environment(action), { id });
    stdout.write(`Forgot adopted config source "${id}".\n`);
  });
}
