import type { Command } from "commander";
import type { CoreOptions } from "@skctl/core";

export interface CommandContext {
  readonly cwd: string;
  readonly stdout: { write(value: string): unknown };
  readonly api: typeof import("@skctl/core");
  readonly environment: (command: Command) => CoreOptions;
}
