import { createEffect, createSignal, on, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { useTerminalSize } from "./ui/terminal-size";
import { CommandControl } from "./command-control";
import { usePageCommands, usePageReturn, usePageView } from "./page-navigation";
import { CommandMenuBody } from "./command-menu-body";
import { Dialog, DialogContent } from "./ui/dialog";
import type { CommandRegistration } from "./types";
import type { FocusRegistry } from "./focus";
import type { ExecutableCommand } from "./commands";

/** Secondary object commands and explicit view control share one menu. */
export function ObjectMenu(props: {
  id: string;
  label?: string;
  intent?: "neutral" | "menu";
  viewControl?: boolean;
  target?: string;
  commands?: readonly ExecutableCommand[];
  focusRegistry?: FocusRegistry;
  registerCommand?: CommandRegistration;
}) {
  const renderer = useRenderer();
  const terminal = useTerminalSize();
  const view = usePageView();
  const [open, setOpen] = createSignal(false);
  createEffect(
    on(
      () => props.target,
      () => setOpen(false),
      { defer: true },
    ),
  );
  const canToggleView = () => props.viewControl !== false && !!view?.available();
  const available = () => canToggleView() || !!props.commands?.length;
  createEffect(() => {
    if (!available()) setOpen(false);
  });
  const close = () => {
    setOpen(false);
    queueMicrotask(() => renderer.root.findDescendantById(props.id)?.focus());
  };
  const toggle = () => {
    close();
    view?.toggle();
  };
  const moreRecord = () => ({
    id: `${props.id}.open`,
    verb: props.label ?? "More…",
    destination: "Current workspace",
    scope: "page" as const,
    keys: ["enter"],
    enabled: true,
    danger: false,
  });
  const record = () => ({
    id: "workspace.toggle-view",
    verb: view?.expanded() ? "Restore split" : "Expand view",
    destination: "Current workspace",
    scope: "page" as const,
    keys: ["enter"],
    enabled: true,
    danger: false,
  });
  const commands = (): readonly ExecutableCommand[] => [
    ...(props.commands ?? []),
    ...(canToggleView() ? [{ record: record(), execute: toggle }] : []),
  ];
  const commandId = (command: ExecutableCommand) =>
    `${props.id}-${command.record.id === "workspace.toggle-view" ? "view" : command.record.id}`;
  usePageCommands(commands);
  usePageReturn(() =>
    open()
      ? {
          layer: "menu",
          record: { ...moreRecord(), id: `${props.id}.close`, verb: "Close menu" },
          anchor: () => renderer.root.findDescendantById(props.id),
          execute: close,
        }
      : undefined,
  );
  return (
    <Show when={available()}>
      <CommandControl
        id={props.id}
        intent={props.intent}
        record={moreRecord()}
        execute={() => setOpen(true)}
        register={(target) => {
          const owner = `command:${props.id}.open` as const;
          const releaseFocus = props.focusRegistry?.register(owner, target);
          const releaseCommand = props.registerCommand?.(moreRecord(), owner, props.id, () =>
            setOpen(true),
          );
          return () => {
            releaseFocus?.();
            releaseCommand?.();
          };
        }}
      />
      <Show when={open()}>
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) close();
          }}
        >
          <DialogContent
            id={`${props.id}-dialog`}
            anchor={() => renderer.root.findDescendantById(props.id)}
            width={30}
            maxHeight={terminal().height - 2}
            backdropColor="transparent"
          >
            <CommandMenuBody
              id={`${props.id}-body`}
              items={commands().map((command) => ({ ...command, id: commandId(command) }))}
              onExecute={(command) => {
                setOpen(false);
                command.execute();
              }}
            />
          </DialogContent>
        </Dialog>
      </Show>
    </Show>
  );
}
