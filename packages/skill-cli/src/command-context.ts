import type { Command } from "commander";
import type { SkillCliCore } from "@skill-cli/core";

export interface CommandContext {
  readonly cwd: string;
  readonly stdout: { write(value: string): unknown };
  readonly core: (command: Command) => SkillCliCore;
}
