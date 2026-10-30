import { Argument, InvalidArgumentError, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";
import { SkctlError } from "@skctl/core";

function integer(value: string, min: number, max: number) {
  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new InvalidArgumentError(`Expected an integer between ${min} and ${max}`);
  return Number(value);
}

function render(path: string, kind: "file" | "directory" | "unsupported") {
  const value = kind === "directory" ? `${path}/` : path;
  const escaped = /\p{Cc}|^# More:|^! |^"/u.test(value) ? JSON.stringify(value) : value;
  return kind === "unsupported" ? `! ${escaped} (unsupported)` : escaped;
}

export function listCommand(parent: Command, { api, environment, stdout, stderr }: CommandContext) {
  return parent
    .command("list")
    .alias("ls")
    .description("List Skill resources as root-relative paths; results are bounded.")
    .addArgument(new Argument("<selector>", "Skill selector").argParser(skillSelector))
    .argument("[directory]", "Directory relative to Skill Root")
    .option("-a, --all", "Include hidden entries (excluding . and ..)")
    .option("-R, --recursive", "List subdirectories recursively")
    .option("-1", "One entry per line (default)")
    .option("--limit <count>", "Maximum entries (1–200)", (value) => integer(value, 1, 200), 50)
    .option(
      "--offset <count>",
      "Skip entries (directory changes can affect pagination)",
      (value) => integer(value, 0, 10000),
      0,
    )
    .action(async (selector, directory, flags, action) => {
      const result = await api.listResources(environment(action), {
        selector,
        directory,
        all: !!flags.all,
        recursive: !!flags.recursive,
        limit: flags.limit,
        offset: flags.offset,
      });
      let bytes = 0;
      let count = 0;
      const lines: string[] = [];
      for (const entry of result.entries) {
        const line = `${render(entry.path, entry.kind)}\n`;
        if (bytes + Buffer.byteLength(line) > 8192) {
          if (!count)
            throw new SkctlError("TEXT_TOO_LARGE", "Resource path exceeds listing output limit");
          break;
        }
        lines.push(line);
        bytes += Buffer.byteLength(line);
        count++;
      }
      stdout.write(lines.join(""));
      if (result.more || count < result.entries.length)
        stderr.write(`More entries: --offset ${flags.offset + count}\n`);
    });
}
