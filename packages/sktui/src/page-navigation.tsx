/** @jsxImportSource @opentui/solid */
import type { Renderable } from "@opentui/core";
import { createContext, createEffect, onCleanup, useContext, type Accessor } from "solid-js";
import type { ExecutableCommand } from "./commands";
import type { CommandRecord } from "./types";

/** Local state stays with the page; App presents its active parent's return. */
export interface PageReturn {
  readonly layer?: "menu";
  readonly record: CommandRecord;
  readonly anchor: () => Renderable | undefined;
  readonly execute: () => void;
}
export interface PageNavigation {
  readonly view?: {
    readonly expanded: Accessor<boolean>;
    readonly available: Accessor<boolean>;
    readonly toggle: () => void;
  };
  readonly registerReturn: (value: PageReturn) => () => void;
  readonly registerCommands: (value: readonly ExecutableCommand[]) => () => void;
}
const context = createContext<PageNavigation>();
export const PageNavigationProvider = context.Provider;
export const usePageView = () => useContext(context)?.view;

/** Standalone pages without App navigation retain their own visible return. */
export function usePageReturn(value: Accessor<PageReturn | undefined>): boolean {
  const navigation = useContext(context);
  createEffect(() => {
    const current = value();
    if (current && navigation) onCleanup(navigation.registerReturn(current));
  });
  return navigation !== undefined;
}

/** Semantic command discovery does not depend on a native Button being mounted. */
export function usePageCommands(value: Accessor<readonly ExecutableCommand[]>): boolean {
  const navigation = useContext(context);
  createEffect(() => {
    const commands = value();
    if (navigation && commands.length) onCleanup(navigation.registerCommands(commands));
  });
  return navigation !== undefined;
}
