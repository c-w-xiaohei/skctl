import { SelectRenderable } from "@opentui/core";
import { createEffect, onCleanup } from "solid-js";
import type { FocusRegistry } from "../focus";
import type { CommandRecord } from "../types";
import type { SectionTabOption } from "./section-tabs";
import { DataList } from "../ui/data-list";
import { isPlainNavKey } from "../navigation";

/** Persistent navigation, not a data list or an Enter-to-commit form. */
export function NavigationList<Value extends string>(props: {
  readonly options: readonly SectionTabOption<Value>[];
  readonly value: Value;
  readonly focusRegistry: FocusRegistry;
  readonly owner?: "top-nav" | "local-nav" | "skills-views";
  readonly height?: number;
  readonly id?: string;
  readonly commandForDirection: (direction: "previous" | "next") => CommandRecord;
  readonly onNavigate: (value: Value, record: CommandRecord) => void;
  readonly onActivate?: (value: Value) => void;
}) {
  let target: SelectRenderable | undefined;
  let unregister: (() => void) | undefined;
  const navigate = (index: number) => {
    const next = props.options[index];
    if (!next || next.value === props.value) return;
    const current = props.options.findIndex((option) => option.value === props.value);
    props.onNavigate(next.value, props.commandForDirection(index < current ? "previous" : "next"));
  };
  createEffect(() => {
    const index = props.options.findIndex((option) => option.value === props.value);
    if (index >= 0) target?.setSelectedIndex(index);
  });
  onCleanup(() => unregister?.());
  return (
    <DataList
      id={props.id ?? "shell-section-navigation"}
      ref={(value: SelectRenderable) => {
        target = value;
        unregister?.();
        const unregisterFocus = props.focusRegistry.register(props.owner ?? "local-nav", value);
        const dispose = props.focusRegistry.registerModeHandler(value, (key) => {
          if (!isPlainNavKey(key)) return "declined";
          const index = value.getSelectedIndex();
          if (key.name === "up" || key.name === "down") {
            if (props.owner === "top-nav" && key.name === "up" && index === 0) return "declined";
            value.setSelectedIndex(
              Math.max(0, Math.min(props.options.length - 1, index + (key.name === "up" ? -1 : 1))),
            );
            return "consumed";
          }
          if (key.name !== "right" && key.name !== "enter") return "declined";
          const option = props.options[index];
          if (!option || !props.onActivate) return "declined";
          props.onActivate(option.value);
          return "consumed";
        });
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          value.off("destroyed", release);
          unregisterFocus();
          dispose();
        };
        unregister = release;
        value.once("destroyed", release);
      }}
      options={props.options.map((option) => ({
        name: option.label,
        description: "",
        value: option.value,
      }))}
      selectedIndex={Math.max(
        0,
        props.options.findIndex((option) => option.value === props.value),
      )}
      height={props.height ?? props.options.length}
      width="100%"
      flexGrow={props.height === 1 ? 1 : 0}
      flexShrink={1}
      minWidth={0}
      showDescription={false}
      showSelectionIndicator
      onChange={navigate}
      onSelect={(index) => {
        const option = props.options[index];
        if (option) props.onActivate?.(option.value);
      }}
    />
  );
}
