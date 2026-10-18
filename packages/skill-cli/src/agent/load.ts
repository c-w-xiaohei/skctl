import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";
export function loadCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("load")
    .description("Return the complete SKILL.md as text.")
    .addArgument(
      new Argument("<selector>", "Skill selector, not a collection ID").argParser(skillSelector),
    )
    .action(async (selector, _flags, action) => {
      stdout.write((await api.loadSkill(environment(action), { selector })).text);
    });
}
