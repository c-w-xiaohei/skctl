import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import type { CommandRecord } from "./types";
import { CommandButton } from "./ui/command-button";
import { hasModalKeyModifier } from "./modal-controls";

/** One physical command control; pages and modals retain their own dispatch policy. */
export function CommandControl(props: {
  readonly id: string;
  readonly record: CommandRecord;
  readonly register?: (target: Renderable) => void | (() => void);
  readonly execute: () => void;
  readonly keyboard?: boolean;
  readonly initialFocus?: boolean;
}) {
  const renderer = useRenderer();
  const [focused, setFocused] = createSignal(false);
  let target: Renderable | undefined;
  let unregister: void | (() => void);
  let disposed = false;
  let pendingReveal: (() => void) | undefined;
  const onFocused = () => {
    setFocused(true);
    cancelReveal();
    queueMicrotask(() => {
      if (
        disposed ||
        target?.isDestroyed ||
        renderer.isDestroyed ||
        renderer.currentFocusedRenderable !== target ||
        !target?.parent
      )
        return;
      const reveal = () => {
        pendingReveal = undefined;
        if (
          disposed ||
          target?.isDestroyed ||
          renderer.isDestroyed ||
          renderer.currentFocusedRenderable !== target
        )
          return;
        for (let ancestor = target.parent; ancestor; ancestor = ancestor.parent) {
          if (ancestor instanceof ScrollBoxRenderable && !ancestor.isDestroyed)
            ancestor.scrollChildIntoView(target.id);
        }
      };
      pendingReveal = reveal;
      renderer.once("frame", reveal);
      renderer.requestRender();
    });
  };
  const cancelReveal = () => {
    if (!pendingReveal) return;
    renderer.off("frame", pendingReveal);
    pendingReveal = undefined;
  };
  const onBlurred = () => {
    setFocused(false);
    cancelReveal();
  };
  onCleanup(() => {
    disposed = true;
    cancelReveal();
    target?.off("focused", onFocused);
    target?.off("blurred", onBlurred);
    unregister?.();
  });
  onMount(() => {
    setFocused(renderer.currentFocusedRenderable === target);
    if (!props.initialFocus) return;
    const previous = renderer.currentFocusedRenderable;
    queueMicrotask(() => {
      if (!target?.isDestroyed && renderer.currentFocusedRenderable === previous) target?.focus();
    });
  });
  return (
    <box
      id={props.id}
      focusable={props.record.enabled}
      flexShrink={0}
      ref={(value: Renderable) => {
        target = value;
        value.on("focused", onFocused);
        value.on("blurred", onBlurred);
        unregister = props.register?.(value);
      }}
      onMouseDown={(event) => {
        if (event.button !== 0 || !props.record.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        target?.focus();
        props.execute();
      }}
      onKeyDown={(event) => {
        const key = event.name.toLowerCase() === "return" ? "enter" : event.name.toLowerCase();
        if (
          props.keyboard === false ||
          event.defaultPrevented ||
          !props.record.enabled ||
          hasModalKeyModifier(event) ||
          (key !== "enter" && key !== "right") ||
          !props.record.keys.includes("enter")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        props.execute();
      }}
    >
      <CommandButton
        label={props.record.verb}
        destination={props.record.destination}
        disabledReason={props.record.disabledReason}
        danger={props.record.danger}
        state={
          !props.record.enabled
            ? "disabled"
            : focused()
              ? "focused"
              : props.record.danger
                ? "danger"
                : "idle"
        }
      />
    </box>
  );
}
