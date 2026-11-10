import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Renderable } from "@opentui/core";
import type { Preferences } from "./preferences";
import type { FocusRegistry } from "./focus";
import type { CommandRegistration } from "./types";
import { Input } from "./ui/input";
import { Pane } from "./ui/pane";
import { CommandControl } from "./command-control";

export function InterfaceSettings(props: {
  preferences: Preferences;
  actualWidth: number;
  wide: boolean;
  focusRegistry: FocusRegistry;
  registerCommand: CommandRegistration;
  onBack?: () => void;
}) {
  const [draft, setDraft] = createSignal(String(props.preferences.width()));
  let editing = false;
  createEffect(() => {
    const width = props.preferences.width();
    if (!editing) setDraft(String(width));
  });
  const valid = () => Number.isSafeInteger(Number(draft())) && Number(draft()) >= 30;
  const reset = (width: number) => {
    editing = false;
    setDraft(String(width));
    props.preferences.preview(width);
  };
  const actions = [
    { id: "save", label: "Save", run: () => void props.preferences.save() },
    {
      id: "cancel",
      label: "Cancel",
      run: () => {
        props.preferences.cancel();
        editing = false;
        setDraft(String(props.preferences.width()));
      },
    },
    { id: "reset", label: "Reset", run: () => reset(38) },
  ];
  onCleanup(() => props.preferences.cancel());
  return (
    <Pane id="interface-settings" title="Interface">
      <text height={1}>User preferences</text>
      <box id="interface-fields-pane" flexGrow={1} minHeight={0} flexDirection="column">
        <text>Browser width (columns)</text>
        <Input
          id="interface-browser-width"
          value={draft()}
          onInput={(value) => {
            editing = true;
            setDraft(value);
            if (valid()) props.preferences.preview(Number(value));
          }}
          ref={(target: Renderable) => {
            const release = props.focusRegistry.register("work-area", target);
            const releaseMode = props.focusRegistry.registerModeHandler(target, (key) => {
              if (key.name !== "escape" || key.ctrl || key.alt || key.meta) return "declined";
              props.preferences.cancel();
              props.onBack?.();
              return "consumed";
            });
            target.once("destroyed", () => {
              release();
              releaseMode();
            });
            queueMicrotask(() => {
              if (!target.isDestroyed) target.focus();
            });
          }}
        />
        <text>
          {props.wide
            ? `Current width: ${props.actualWidth} columns`
            : "Used in the two-pane layout at 100 columns or wider."}
        </text>
        <Show when={!valid()}>
          <text>Enter a whole number of at least 30.</text>
        </Show>
        <Show when={props.preferences.dirty()}>
          <text>Unsaved changes</text>
        </Show>
        <Show when={props.preferences.problem()}>
          <text wrapMode="word">{props.preferences.problem()}</text>
        </Show>
      </box>
      <box id="interface-actions-pane" flexDirection="row" gap={1} flexShrink={0}>
        <For each={actions}>
          {(action) => {
            const record = () => ({
              id: `interface.${action.id}`,
              verb: action.label,
              destination: "User interface preferences",
              scope: "page" as const,
              keys: ["enter"],
              enabled: !props.preferences.saving() && (action.id !== "save" || valid()),
              danger: false,
            });
            return (
              <CommandControl
                id={`interface-${action.id}`}
                record={record()}
                execute={action.run}
                register={(target) => {
                  const owner = `command:interface.${action.id}` as const;
                  const releaseFocus = props.focusRegistry.register(owner, target);
                  const releaseCommand = props.registerCommand(
                    record(),
                    owner,
                    target.id,
                    action.run,
                  );
                  return () => {
                    releaseFocus();
                    releaseCommand();
                  };
                }}
              />
            );
          }}
        </For>
      </box>
    </Pane>
  );
}
