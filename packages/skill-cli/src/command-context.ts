import type { Command } from "commander";
import type { CoreOptions } from "@skill-cli/core";

export interface CommandContext {
  readonly cwd: string;
  readonly stdout: { write(value: string): unknown };
  readonly api: typeof import("@skill-cli/core");
  readonly environment: (command: Command) => CoreOptions;
}
