import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";

export function readCommand(parent: Command, { core, stdout }: CommandContext) {
  return parent
    .command("read")
    .description(
      "Return one UTF-8 text resource. Paths are relative to the Skill Root; binary assets use download.",
    )
    .addArgument(new Argument("<selector>", "Skill selector").argParser(skillSelector))
    .argument("<root-relative-path>")
    .action(async (selector, path, _flags, action) => {
      stdout.write((await core(action).content.read({ selector, path })).value.text);
    });
}
