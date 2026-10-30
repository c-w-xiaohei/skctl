import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions, type BoxProps } from "@opentui/solid";
import { createEffect, onCleanup, type JSX } from "solid-js";
import { CommandControl } from "../command-control";
import { createModalControlRegistry, useModalControl } from "../modal-controls";
import type { CommandRecord } from "../types";
import type { ButtonProps } from "../ui/button";
import { useTheme } from "../ui/use-theme";

/** Shared canvas only; each overlay retains its own controls, draft and scroll body. */
export function ModalShell(props: {
  readonly children: JSX.Element;
  readonly id?: string;
  readonly onMouseDown?: BoxProps["onMouseDown"];
}) {
  const tokens = useTheme();
  return (
    <box
      id={props.id}
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor={tokens().colors.background}
      onMouseDown={props.onMouseDown}
    >
      {props.children}
    </box>
  );
}

/** Keep the actual form/review content within the terminal's native scroll viewport. */
export function ModalBody(props: {
  readonly header?: JSX.Element;
  readonly footer?: JSX.Element;
  readonly children: JSX.Element;
  readonly controls?: ReturnType<typeof createModalControlRegistry>;
}) {
  const terminal = useTerminalDimensions();
  const tokens = useTheme();
  const renderer = useRenderer();
  const register = useModalControl("modal-impact-content", props.controls);
  let body: ScrollBoxRenderable | undefined;
  const revealFocus = () => {
    const focused = renderer.currentFocusedRenderable;
    if (!body || body.isDestroyed || !focused || focused.isDestroyed) return;
    for (let ancestor = focused.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor !== body) continue;
      if (focused.height > body.viewport.height) {
        body.scrollChildIntoView(focused.id);
        break;
      }
      const top = body.viewport.screenY;
      const bottom = top + body.viewport.height;
      if (focused.screenY < top) body.scrollBy(focused.screenY - top);
      else if (focused.screenY + focused.height > bottom)
        body.scrollBy(focused.screenY + focused.height - bottom);
      break;
    }
  };
  const revealAfterLayout = () => {
    revealFocus();
    // A focus/resize can coincide with changing form content. Recheck once
    // after that layout, not continuously while the user scrolls the body.
    renderer.once("frame", revealFocus);
    renderer.requestRender();
  };
  const scheduleReveal = () => {
    renderer.off("frame", revealFocus);
    renderer.off("frame", revealAfterLayout);
    renderer.once("frame", revealAfterLayout);
    renderer.requestRender();
  };
  if (props.controls) renderer.on("focused_renderable", scheduleReveal);
  onCleanup(() => {
    renderer.off("focused_renderable", scheduleReveal);
    renderer.off("frame", revealFocus);
    renderer.off("frame", revealAfterLayout);
  });
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={tokens().colors.border}
      backgroundColor={tokens().colors.background}
      margin={1}
      padding={1}
      height={Math.max(1, terminal().height - 2)}
      minHeight={0}
      flexDirection="column"
    >
      {props.header && (
        <box flexDirection="column" flexShrink={0}>
          {props.header}
        </box>
      )}
      <scrollbox
        flexGrow={1}
        minHeight={0}
        scrollX={false}
        ref={(target: ScrollBoxRenderable) => {
          body = target;
          if (props.controls) register(target);
        }}
        onSizeChange={scheduleReveal}
        contentOptions={{ flexDirection: "column", flexShrink: 0 }}
      >
        {props.children}
      </scrollbox>
      {props.footer && (
        <box flexDirection="column" flexShrink={0}>
          {props.footer}
        </box>
      )}
    </box>
  );
}

/** A modal command is a real focus target, never an option in a data Select. */
export function ModalCommand(props: {
  readonly id: string;
  readonly record: CommandRecord;
  readonly initialFocus?: boolean;
  readonly intent?: ButtonProps["intent"];
  readonly order?: number;
  readonly execute: () => void;
  readonly controls?: ReturnType<typeof createModalControlRegistry>;
}) {
  const register = useModalControl(
    props.id,
    props.controls,
    props.order,
    () => props.record.enabled,
  );
  let target: Renderable | undefined;
  let wasEnabled = props.record.enabled;
  createEffect(() => {
    const enabled = props.record.enabled;
    if (enabled && !wasEnabled && target) register(target);
    wasEnabled = enabled;
  });
  return (
    <CommandControl
      id={props.id}
      record={props.record}
      initialFocus={props.initialFocus}
      intent={props.intent}
      register={(value) => {
        target = value;
        if (props.record.enabled) register(value);
      }}
      execute={props.execute}
    />
  );
}

export const modalCommand = (
  id: string,
  verb: string,
  destination: string,
  enabled = true,
  danger = false,
  disabledReason?: string,
): CommandRecord => ({
  id,
  keys: ["enter"],
  verb,
  destination,
  scope: "modal",
  enabled,
  danger,
  ...(disabledReason ? { disabledReason } : {}),
});
