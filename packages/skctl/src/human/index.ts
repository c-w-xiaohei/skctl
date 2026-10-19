import type { Command } from "commander";
import type { CommandContext } from "../command-context";
import { initCommand } from "./init";
import { sourceCommand } from "./source";
import { installCommand } from "./install";
import { updateCommand } from "./update";
import { rebindCommand } from "./rebind";
import { uninstallCommand } from "./uninstall";
import { configSourceCommand } from "./config-source";
import { collectionCommand } from "./collection";
import { useCommand } from "./use";
import { managedCommand } from "./managed";
import { gcCommand } from "./gc";
import { repairCommand } from "./repair";
import { contentCommand } from "./content";

export function registerHumanCommands(command: Command, context: CommandContext) {
  initCommand(command, context);
  sourceCommand(command, context);
  installCommand(command, context);
  updateCommand(command, context);
  rebindCommand(command, context);
  uninstallCommand(command, context);
  configSourceCommand(command, context);
  collectionCommand(command, context);
  useCommand(command, context);
  managedCommand(command, context);
  gcCommand(command, context);
  repairCommand(command, context);
  contentCommand(command, context);
}
