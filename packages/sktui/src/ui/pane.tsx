/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, onMount, Show, type JSXElement } from "solid-js";
import { useRenderer } from "@opentui/solid";
import type { BaseRenderable } from "@opentui/core";
import { useTheme } from "./use-theme";

export interface PaneProps {
  readonly id: string;
  readonly title?: string;
  readonly borderTitle?: string;
  readonly borderBottomTitle?: string;
  readonly active?: boolean;
  readonly border?: boolean;
  readonly width?: number | `${number}%`;
  readonly children: JSXElement;
}

export function Pane(props: PaneProps) {
  const tokens = useTheme();
  const renderer = useRenderer();
  const [focused, setFocused] = createSignal(false);
  const updateFocus = (target: BaseRenderable | null) => {
    let current = target;
    while (current && current.id !== props.id) current = current.parent;
    setFocused(!!current);
  };
  renderer.on("focused_renderable", updateFocus);
  onMount(() => updateFocus(renderer.currentFocusedRenderable));
  onCleanup(() => renderer.off("focused_renderable", updateFocus));
  // An empty side list stays borderless when OpenTUI updates borderColor;
  // its boolean false is otherwise re-enabled by initializeBorder().
  return (
    <box
      id={props.id}
      width={props.width ?? "100%"}
      maxWidth="100%"
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      minWidth={0}
      overflow="hidden"
      border={props.border === false ? [] : true}
      title={props.borderTitle}
      bottomTitle={props.borderBottomTitle}
      borderColor={
        props.border === false
          ? undefined
          : (props.active ?? focused())
            ? tokens().colors.focus
            : tokens().colors.border
      }
      paddingX={1}
    >
      <Show when={props.title}>
        <box height={2} flexShrink={0} paddingBottom={1}>
          <text fg={tokens().colors.foreground}>
            <strong>{props.title}</strong>
          </text>
        </box>
      </Show>
      {props.children}
    </box>
  );
}
