import { InputRenderable, ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { CommandRecord } from "./types";
import {
  createModalControlRegistry,
  useModalControl,
  useModalControlTraversal,
} from "./modal-controls";
import { isPlainNavKey, parseNavKey } from "./navigation";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { CommandControl } from "./command-control";
import { DataList } from "./ui/data-list";
import { Input } from "./ui/input";
import { useTheme } from "./ui/use-theme";
import { fitColumn } from "./ui/list-text";

export const paletteCloseCommand: CommandRecord = {
  id: "palette.close",
  verb: "Close",
  destination: "Return to the previous surface",
  keys: ["enter"],
  scope: "modal",
  enabled: true,
  danger: false,
};
export const paletteSearchCommand: CommandRecord = {
  id: "palette.search",
  verb: "results",
  destination: "Choose a matching command",
  keys: ["enter"],
  scope: "widget",
  enabled: true,
  danger: false,
};

function commandGroup(record: CommandRecord): { label: string; order: number } {
  if (record.scope === "task") return { label: "Task", order: 1 };
  if (record.scope === "route") return { label: "Go to", order: 2 };
  if (record.scope === "shell" || record.scope === "lifecycle") return { label: "App", order: 3 };
  return { label: "This page", order: 0 };
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly actions: readonly CommandRecord[];
  readonly onSelect: (record: CommandRecord) => void;
  readonly onClose: () => void;
}

/** The persistent Dialog owns opening/closing; each opening gets a fresh search draft. */
export function CommandPalette(props: CommandPaletteProps) {
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  return (
    <Dialog
      id="command-palette"
      position="absolute"
      width={0}
      height={0}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        id="command-palette-popup"
        width={Math.max(1, Math.min(72, terminal().width - 4))}
        maxWidth={72}
        height={Math.max(
          1,
          Math.min(7 + Math.max(3, Math.min(10, props.actions.length)), terminal().height - 2),
        )}
        backdropColor="transparent"
        backgroundColor={tokens().colors.background}
        minHeight={0}
        paddingTop={0}
        paddingBottom={0}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <Show when={props.open}>
          <CommandPaletteContents
            actions={props.actions}
            onSelect={props.onSelect}
            onClose={props.onClose}
          />
        </Show>
      </DialogContent>
    </Dialog>
  );
}

/** Local search/selection only; App supplies the authoritative contextual commands. */
function CommandPaletteContents(props: Omit<CommandPaletteProps, "open">) {
  const controls = createModalControlRegistry();
  const renderer = useRenderer();
  const tokens = useTheme();
  const [query, setQuery] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string>();
  const [listWidth, setListWidth] = createSignal(0);
  const [detailsOverflow, setDetailsOverflow] = createSignal(false);
  const [readingDetails, setReadingDetails] = createSignal(false);
  let search: InputRenderable | undefined;
  let choices: SelectRenderable | undefined;
  let details: ScrollBoxRenderable | undefined;
  let disposed = false;
  const canReadDetails = () =>
    !!details &&
    !details.isDestroyed &&
    details.viewport.width > 0 &&
    details.viewport.height > 0 &&
    details.scrollHeight > details.viewport.height;
  const measure = () => {
    setListWidth(choices?.width ?? 0);
    const overflow = canReadDetails();
    if (!overflow && renderer.currentFocusedRenderable === details) choices?.focus();
    setDetailsOverflow(overflow);
    setReadingDetails(overflow && renderer.currentFocusedRenderable === details);
  };
  renderer.on("frame", measure);
  onCleanup(() => {
    disposed = true;
    renderer.off("frame", measure);
  });
  onMount(() =>
    queueMicrotask(() => {
      // Controlled Dialog opening can happen after its child refs are attached.
      if (!disposed && !choices?.isDestroyed) choices?.focus();
      measure();
    }),
  );
  const registerSearch = useModalControl("palette-query", controls, 0);
  const registerChoices = useModalControl("palette-choices", controls, 1);
  const registerDetails = useModalControl("palette-command-details", controls, 2, canReadDetails);
  const registerClose = useModalControl("palette-close", controls, 3);
  const actions = createMemo(() =>
    props.actions
      .filter((record) =>
        `${record.verb} ${record.destination}`
          .toLocaleLowerCase()
          .includes(query().trim().toLocaleLowerCase()),
      )
      .sort(
        (left, right) =>
          commandGroup(left).order - commandGroup(right).order ||
          (left.priority ?? 100) - (right.priority ?? 100),
      ),
  );
  const columns = createMemo(() => {
    const width = Math.max(1, listWidth() - 5);
    const group = width >= 50 ? 10 : 0;
    const key = Math.min(11, Math.max(0, width - 12));
    return { name: Math.max(1, width - group - key - (group ? 2 : 1)), group, key };
  });
  const row = (name: string, group: string, key: string) => {
    const widths = columns();
    return `${fitColumn(name, widths.name)}${widths.group ? ` ${fitColumn(group, widths.group)}` : ""}${widths.key ? ` ${fitColumn(key, widths.key)}` : ""}`;
  };
  const selectedIndex = createMemo(() =>
    Math.max(
      0,
      actions().findIndex((record) => record.id === selectedId()),
    ),
  );
  const selected = createMemo(() => actions()[selectedIndex()]);
  createEffect(() => {
    selected();
    if (details && !details.isDestroyed) details.scrollTo(0);
  });
  // Dialog owns Tab, Escape and the overlay. Keep the existing list-boundary
  // arrow policy (including modified-Enter isolation) instead of duplicating it.
  useModalControlTraversal(controls, () => props.onClose());
  useKeyboard((event) => {
    if (event.defaultPrevented || renderer.currentFocusedRenderable !== choices) return;
    const key = parseNavKey(event);
    if (key.name !== "slash" || !isPlainNavKey(key)) return;
    event.preventDefault();
    event.stopPropagation();
    search?.focus();
  });
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" height={1} flexShrink={0} gap={1}>
        <DialogTitle height={1} flexGrow={1}>
          <strong>Actions</strong>
        </DialogTitle>
        <text fg={tokens().colors.mutedForeground}>
          {actions().length} {actions().length === 1 ? "command" : "commands"}
        </text>
        <CommandControl
          id="palette-close"
          register={registerClose}
          record={paletteCloseCommand}
          execute={() => props.onClose()}
        />
      </box>
      <box height={1} flexShrink={0} flexDirection="row">
        <text fg={tokens().colors.mutedForeground}>Search / </text>
        <Input
          id="palette-query"
          flexGrow={1}
          value={query()}
          placeholder="Find an action…"
          onInput={(value) => {
            setQuery(value);
            setSelectedId(undefined);
          }}
          onSubmit={() => choices?.focus()}
          ref={(target) => {
            search = target;
            registerSearch(target);
          }}
        />
      </box>
      <text height={1} flexShrink={0} fg={tokens().colors.mutedForeground}>
        {`   ${row("Action", "Scope", "Key")}`}
      </text>
      <DataList
        id="palette-choices"
        ref={(target) => {
          choices = target;
          registerChoices(target);
        }}
        flexGrow={1}
        minHeight={1}
        showDescription={false}
        showScrollIndicator
        wrapSelection={false}
        options={actions().map((record) => ({
          name: row(
            `${record.danger ? "! " : ""}${record.verb}`,
            commandGroup(record).label,
            record.enabled ? (record.shortcut ?? "") : "Unavailable",
          ),
          description: record.disabledReason ?? record.destination,
          value: record,
        }))}
        selectedIndex={selectedIndex()}
        onChange={(_index, option) => setSelectedId(option?.value.id)}
        onSelect={(_index, option) => {
          const record = props.actions.find((record) => record.id === option?.value.id);
          if (record?.enabled) props.onSelect(record);
        }}
      />
      <scrollbox
        id="palette-command-details"
        ref={(target: ScrollBoxRenderable) => {
          details = target;
          registerDetails(target);
        }}
        height={2}
        flexShrink={0}
        minHeight={0}
        scrollX={false}
        horizontalScrollbarOptions={{ visible: false }}
        focusable={detailsOverflow()}
        backgroundColor={readingDetails() ? tokens().colors.control : "transparent"}
      >
        <text
          id="palette-action-detail"
          flexShrink={0}
          selectable
          wrapMode="word"
          fg={
            readingDetails()
              ? tokens().colors.controlForeground
              : selected()?.enabled
                ? tokens().colors.mutedForeground
                : tokens().colors.warning
          }
        >
          {selected()
            ? `Target: ${selected()!.destination || "Current page"}`
            : "No matching commands"}
        </text>
        <text
          id="palette-action-reason"
          flexShrink={0}
          selectable
          wrapMode="word"
          fg={
            readingDetails()
              ? tokens().colors.controlForeground
              : selected()?.enabled
                ? tokens().colors.mutedForeground
                : tokens().colors.warning
          }
        >
          {selected()
            ? selected()!.enabled
              ? selected()!.verb
              : (selected()!.disabledReason ?? "Unavailable")
            : "Try another search or clear it."}
        </text>
      </scrollbox>
    </box>
  );
}
