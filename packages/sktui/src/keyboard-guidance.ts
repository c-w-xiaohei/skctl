import type { CommandRecord } from "./types";
import { fitColumn } from "./ui/list-text";

export type InteractionMode = "browse" | "horizontal" | "scroll" | "edit" | "command";

/** One bounded hint row. Keep key meanings stable without printing a manual. */
export function keyboardGuidance(input: {
  readonly mode: InteractionMode;
  readonly width: number;
  readonly command?: CommandRecord;
  readonly commands?: readonly CommandRecord[];
  readonly modal?: boolean;
  readonly modalBack?: "close" | "options";
  readonly browseHint?: { readonly full: string; readonly short: string };
}) {
  const modes: Record<InteractionMode, string> = {
    browse: "Enter open",
    horizontal: "←→ move  Enter open",
    scroll: "↑↓ scroll  PgUp/PgDn",
    edit: input.command ? `Enter ${input.command.verb}` : "Type text",
    command: input.command
      ? `${input.command.enabled ? "Enter" : "Unavailable:"} ${input.command.enabled ? input.command.verb : (input.command.disabledReason ?? input.command.verb)}`
      : "Enter run",
  };
  const bindings = new Set(
    input.commands?.filter((command) => command.enabled).map((command) => command.shortcut),
  );
  const local =
    input.mode === "browse" && input.browseHint
      ? input.browseHint.full
      : modes[input.mode] + (input.mode === "browse" && bindings.has("/") ? "  / filter" : "");
  const global = input.modal
    ? `Tab controls  Esc ${input.modalBack ?? "close"}`
    : input.mode === "edit"
      ? "Tab panels  Esc cancel"
      : "Tab panels  Esc back  Ctrl+P Actions";
  const shortGlobal = input.modal
    ? `Tab  Esc ${input.modalBack ?? "close"}`
    : input.mode === "edit"
      ? "Esc cancel"
      : "Tab  Esc  Ctrl+P Actions";
  const shortLocal =
    input.mode === "browse"
      ? (input.browseHint?.short ?? "Enter open")
      : input.mode === "scroll"
        ? "↑↓ scroll"
        : modes[input.mode];
  const minimumGlobal = input.modal
    ? `Esc ${input.modalBack ?? "close"}`
    : input.mode === "edit"
      ? "Esc cancel"
      : "^P Actions";
  const compactGlobal = input.modal || input.mode === "edit" ? minimumGlobal : "Esc  ^P Actions";
  const candidates: readonly (readonly [string, string])[] = [
    [local, global],
    ...(input.mode === "browse" && input.browseHint ? ([[local, shortGlobal]] as const) : []),
    [shortLocal, shortGlobal],
    [shortLocal, compactGlobal],
    [shortLocal, minimumGlobal],
  ];
  for (const [control, navigation] of candidates) {
    if (Bun.stringWidth(control) + (control ? 3 : 0) + Bun.stringWidth(navigation) <= input.width)
      return { local: control, global: navigation };
  }
  const localWidth = input.width - Bun.stringWidth(minimumGlobal) - 3;
  if (localWidth >= 8)
    return { local: fitColumn(shortLocal, localWidth).trimEnd(), global: minimumGlobal };
  return { local: "", global: fitColumn(minimumGlobal, input.width).trimEnd() };
}
