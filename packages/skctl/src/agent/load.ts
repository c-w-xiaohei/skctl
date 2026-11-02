import { Argument, type Command } from "commander";
import type { CommandContext } from "../command-context";
import { skillSelector } from "./arguments";

const xml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function loadCommand(parent: Command, { api, environment, stdout }: CommandContext) {
  return parent
    .command("load")
    .description(
      "Load one or more Skills. A single Skill returns its exact SKILL.md; multiple Skills return XML.",
    )
    .addArgument(new Argument("<selectors...>", "Skill selectors, not collection IDs"))
    .action(async (selectors: string[], _flags, action) => {
      const validated = selectors.map(skillSelector);
      const loaded = [];
      for (const selector of validated)
        loaded.push(await api.loadSkill(environment(action), { selector }));
      if (loaded.length === 1) {
        stdout.write(loaded[0]!.text);
        return;
      }
      stdout.write(
        loaded
          .map(
            ({ selector, text }) =>
              `<skill selector="${xml(selector)}">\n${xml(text)}${text.endsWith("\n") ? "" : "\n"}</skill>\n`,
          )
          .join(""),
      );
    });
}
