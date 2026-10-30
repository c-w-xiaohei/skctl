import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";
import { SkctlError } from "@skctl/core";
export function readCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("read")
    .description(
      "Return one UTF-8 text resource. Paths are relative to the Skill Root; binary assets use download.",
    )
    .addArgument(new Argument("<selector>", "Skill selector").argParser(skillSelector))
    .argument("<root-relative-path>")
    .action(async (selector, path, _flags, action) => {
      try {
        stdout.write((await api.readResource(environment(action), { selector, path })).text);
      } catch (error) {
        if (error instanceof SkctlError && error.code === "RESOURCE_NOT_FOUND")
          throw new SkctlError(
            "RESOURCE_NOT_FOUND",
            `Resource not found: ${JSON.stringify(path)}\nUse skctl agent ls <selector> to inspect resources.`,
          );
        throw error;
      }
    });
}
