import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup, onMount, Show } from "solid-js";
import type { CommandRecord } from "./types";
import { Button, type ButtonProps } from "./ui/button";
import { useTheme } from "./ui/use-theme";
import { hasModalKeyModifier } from "./modal-controls";

/** One physical command control; pages and modals retain their own dispatch policy. */
export function CommandControl(props: {
  readonly id: string;
  readonly record: CommandRecord;
  /** Bounded inline caption; command discovery retains the full verb and target. */
  readonly label?: string;
  readonly shortcutHint?: string;
  readonly register?: (target: Renderable) => void | (() => void);
  readonly execute: () => void;
  readonly keyboard?: boolean;
  readonly initialFocus?: boolean;
  readonly intent?: ButtonProps["intent"];
  readonly showDisabledReason?: boolean;
}) {
  const renderer = useRenderer();
  const tokens = useTheme();
  let target: Renderable | undefined;
  let unregister: void | (() => void);
  let disposed = false;
  let pendingReveal: (() => void) | undefined;
  const onFocused = () => {
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
      const reveal = (retry = false) => {
        pendingReveal = undefined;
        if (
          disposed ||
          target?.isDestroyed ||
          renderer.isDestroyed ||
          renderer.currentFocusedRenderable !== target
        )
          return;
        for (let ancestor = target.parent; ancestor; ancestor = ancestor.parent) {
          if (!(ancestor instanceof ScrollBoxRenderable) || ancestor.isDestroyed) continue;
          ancestor.scrollChildIntoView(target.id);
          // OpenTUI considers an element whose final row equals viewportBottom
          // visible. In a bordered pane that row is the border, so leave one
          // physical row of clearance. All values here are public renderable
          // geometry; ScrollBox clamps the requested movement itself.
          const viewportTop = ancestor.viewport.y;
          const viewportBottom = viewportTop + ancestor.viewport.height;
          const targetTop = target.y;
          const targetBottom = targetTop + target.height;
          if (targetBottom >= viewportBottom) ancestor.scrollBy(targetBottom - viewportBottom + 1);
          else if (targetTop < viewportTop) ancestor.scrollBy(targetTop - viewportTop);
        }
        // A command may become focusable in the same reconciliation that
        // changes a nested ScrollBox's content height. Re-evaluate once after
        // that layout frame so the public descendant lookup sees final bounds.
        if (!retry) {
          pendingReveal = () => reveal(true);
          renderer.once("frame", pendingReveal);
          renderer.requestRender();
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
    if (!props.initialFocus) return;
    const previous = renderer.currentFocusedRenderable;
    queueMicrotask(() => {
      if (!target?.isDestroyed && renderer.currentFocusedRenderable === previous) target?.focus();
    });
  });
  return (
    <box flexDirection="column" flexShrink={0}>
      <Button
        id={props.id}
        label={props.label ?? props.record.verb}
        shortcutHint={props.shortcutHint}
        intent={props.record.danger ? "danger" : (props.intent ?? "neutral")}
        disabled={!props.record.enabled}
        alignSelf="flex-start"
        ref={(value: Renderable) => {
          target = value;
          value.on("focused", onFocused);
          value.on("blurred", onBlurred);
          unregister = props.register?.(value);
        }}
        onMouseDown={(event) => {
          if (event.button !== 0 || !props.record.enabled) return;
          event.stopPropagation();
          target?.focus();
        }}
        onPress={(details) => {
          if (!props.record.enabled || (details.source === "keyboard" && props.keyboard === false))
            return;
          props.execute();
        }}
        onKeyDown={(event) => {
          const key = event.name.toLowerCase() === "return" ? "enter" : event.name.toLowerCase();
          if (
            props.keyboard === false ||
            event.defaultPrevented ||
            !props.record.enabled ||
            hasModalKeyModifier(event) ||
            key !== "right" ||
            !props.record.keys.includes("enter")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          props.execute();
        }}
      />
      <Show
        when={
          props.showDisabledReason !== false && !props.record.enabled && props.record.disabledReason
        }
      >
        <text paddingLeft={1} wrapMode="word" fg={tokens().colors.mutedForeground}>
          {props.record.disabledReason}
        </text>
      </Show>
    </box>
  );
}
