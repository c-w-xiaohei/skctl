import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";

export function loadCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("load")
    .description("Return the complete SKILL.md as text.")
    .addArgument(
      new Argument("<selector>", "Skill selector, not a collection ID").argParser(skillSelector),
    )
    .action(async (selector, _flags, action) => {
      stdout.write((await core(action).content.load({ selector })).value.text);
    });
}
