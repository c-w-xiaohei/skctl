import type { Command } from "commander";
import { resolve } from "node:path";
import * as integrations from "@skctl/integrations";
import type { CommandContext } from "../command-context";

export function integrationCommand(
  parent: Command,
  context: CommandContext,
  setExit: (code: number) => void,
) {
  const root = parent
    .command("integration")
    .description(
      "Connect Codex or OpenCode using a native adapter, with instruction guidance as fallback.",
    );
  for (const name of ["connect", "inspect", "disconnect"] as const) {
    root
      .command(`${name} <harness>`)
      .requiredOption("--scope <scope>", "Host scope: global or project")
      .option("--project <path>", "Project directory to configure")
      .option("--config-dir <path>", "Host configuration home")
      .option("--executable <path>", "Executable of the intended host")
      .option("--cwd <path>", "Session working directory to inspect")
      .option("--file <path>", "Existing default instruction entry")
      .option("--config-file <path>", "Existing adapter configuration entry")
      .option("--ack-file-impact", "Acknowledge shared-file and instruction fallback effects")
      .option("--json", "Print structured inspection or mutation outcome")
      .action(async (harness: string, flags, command: Command) => {
        const project = command.optsWithGlobals().project;
        if (harness !== "codex" && harness !== "opencode")
          throw new integrations.IntegrationError("INVALID_HARNESS", "Expected codex or opencode");
        if (flags.scope !== "global" && flags.scope !== "project")
          throw new integrations.IntegrationError("INVALID_SCOPE", "Expected global or project");
        if (flags.scope === "project" && !project)
          throw new integrations.IntegrationError(
            "PROJECT_REQUIRED",
            "Project scope requires --project <directory>",
          );
        if (flags.file && flags.configFile)
          throw new integrations.IntegrationError(
            "INVALID_ENTRY",
            "Use either --file or --config-file",
          );
        if (flags.ackFileImpact && !flags.file)
          throw new integrations.IntegrationError(
            "INVALID_ENTRY",
            "--ack-file-impact requires --file",
          );
        const path = (value?: string) => (value ? resolve(context.cwd, value) : undefined);
        const target: integrations.IntegrationTarget = {
          environment: {
            harness,
            configDirectory: path(flags.configDir),
            executable: path(flags.executable),
          },
          scope:
            flags.scope === "global"
              ? { kind: "global" }
              : { kind: "project", directory: path(project)! },
          workingDirectory: path(flags.cwd),
        };
        const entry = flags.file
          ? { mechanism: "default" as const, file: path(flags.file)! }
          : flags.configFile
            ? {
                mechanism:
                  harness === "codex" ? ("codex-hooks" as const) : ("opencode-v2" as const),
                file: path(flags.configFile)!,
              }
            : undefined;
        const value =
          name === "inspect"
            ? await integrations.inspect(target)
            : await integrations[name]({
                target,
                entry,
                acknowledgeFileImpact: flags.ackFileImpact,
              });
        if (flags.json) context.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
        else if ("outcome" in value) {
          context.stdout.write(
            `${value.outcome}: ${value.mechanism ?? harness}${value.file ? ` · ${value.file}` : ""}\n`,
          );
          for (const d of value.diagnostics) context.stdout.write(`${d.code}: ${d.message}\n`);
          for (const step of value.inspection?.nextSteps ?? []) context.stdout.write(`${step}\n`);
          if (value.backup) context.stdout.write(`Previous file: ${value.backup}\n`);
        } else {
          context.stdout.write(
            `${harness}: ${value.recommended ?? "unknown"}\n${value.selectionReason}\n`,
          );
          for (const e of value.entries)
            context.stdout.write(
              `${e.inherited ? "inherited " : ""}${e.mechanism} · ${e.status} · ${e.file}\n`,
            );
          for (const d of value.diagnostics) context.stdout.write(`${d.code}: ${d.message}\n`);
          for (const step of value.nextSteps) context.stdout.write(`${step}\n`);
        }
        if (
          "outcome" in value &&
          (!["applied", "unchanged"].includes(value.outcome) || value.durability === "unconfirmed")
        )
          setExit(2);
      });
  }
}
