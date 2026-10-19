import type { Command } from "commander";
import { SkctlError } from "@skctl/core";
import type { CommandContext } from "../command-context";
export function contentCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  const content = parent
    .command("content")
    .description("Inspect or run installed Skills without changing catalog declarations.");
  content
    .command("load <selector>")
    .description("Load an installed Skill's SKILL.md and provenance.")
    .action(async (selector, _flags, action) => {
      const value = await api.loadSkill(environment(action), { selector });
      stdout.write(
        [
          `selector ${value.selector}`,
          `name ${value.name}`,
          `description ${value.description}`,
          `path ${value.path}`,
          `source ${value.provenance.source}`,
          ...(value.provenance.revision ? [`revision ${value.provenance.revision}`] : []),
          "---",
        ].join("\n") + `\n${value.text}`,
      );
    });
  content
    .command("run <selector> [argv...]")
    .description("Run a command with an installed Skill materialized as its working directory.")
    .allowUnknownOption()
    .action(async (selector, argv, _flags, action) => {
      if (!argv.length)
        throw new SkctlError("INVALID_ARGUMENT", "Run command requires child argv after --");
      const value = await api.runSkill(environment(action), { selector, argv });
      let outcome: string;
      if (value.cancelled) outcome = "was cancelled";
      else if (value.signal) outcome = `was terminated by signal ${value.signal}`;
      else outcome = `exited with code ${value.exitCode}`;
      stdout.write(`Skill "${value.selector}" ${outcome}.\n`);
    });
}
