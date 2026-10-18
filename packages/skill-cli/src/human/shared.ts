import { Option, type Command } from "commander";
import { SkillCliError, type ConfigurationChangeResult } from "@skill-cli/core";

export function formatChange(result: ConfigurationChangeResult, message = "Updated configuration") {
  const at = `at ${result.level} level in ${result.file ?? "the configuration file"}`;
  return `${result.changed ? message : "No configuration changes were needed"} ${at}.\n`;
}

export function formatObservation(value: unknown, json: boolean, lines: readonly string[]) {
  return json ? `${JSON.stringify(value)}\n` : `${lines.join("\n")}\n`;
}

export function revision(value: string) {
  if (/^[a-f0-9]{40}$/u.test(value)) return value;
  throw new SkillCliError("INVALID_ARGUMENT", "Revision must be an exact 40-hex commit");
}

export function sourceBinding(
  kind: "local" | "git" | "github",
  origin: string,
  { root = "", ref = "" }: { root?: string; ref?: string },
) {
  return kind === "local" ? { kind, path: origin, root } : { kind, origin, root, ref };
}

export function scopeOptions(target: Command, defaultProject = true) {
  return target
    .addOption(
      new Option(
        "--scope <scope>",
        `Declaration scope: global writes the user config, project writes skill-cli.jsonc, local writes skill-cli.local.jsonc${defaultProject ? ". Writes default to project" : ""}`,
      )
        .choices(["global", "project", "local"])
        .conflicts(["level", "g", "p", "l"]),
    )
    .addOption(
      new Option("--level <level>", "Alias for --scope")
        .choices(["global", "project", "local"])
        .conflicts(["g", "p", "l"]),
    )
    .addOption(new Option("-g", "Use global declaration scope").conflicts(["p", "l"]))
    .addOption(new Option("-p", "Use project declaration scope").conflicts("l"))
    .option("-l", "Use local declaration scope");
}

export function scope(
  options: {
    scope?: "global" | "project" | "local";
    level?: "global" | "project" | "local";
    g?: boolean;
    p?: boolean;
    l?: boolean;
  },
  defaultScope: "global" | "project" | "local" | undefined = "project",
) {
  return (
    options.scope ??
    options.level ??
    (options.g ? "global" : options.p ? "project" : options.l ? "local" : defaultScope)
  );
}
