import { Argument, type Command } from "commander";
import { resolve } from "node:path";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";
export function downloadCommand(
  parent: Command,
  { cwd, api, environment, stdout }: CommandContext,
) {
  return parent
    .command("download")
    .description("Copy one resource and return its absolute output path.")
    .addArgument(new Argument("<selector>", "Skill selector").argParser(skillSelector))
    .argument("<root-relative-path>")
    .requiredOption("--output <host-path>", "Destination file")
    .option("--force", "Replace an existing regular file, never a symlink", false)
    .action(async (selector, path, flags, action) => {
      const value = await api.downloadResource(environment(action), {
        selector,
        path,
        output: resolve(cwd, flags.output),
        force: flags.force,
      });
      stdout.write(`${JSON.stringify({ output: value.output })}\n`);
    });
}
