/** @jsxImportSource @opentui/solid */
import { BoxRenderable, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import type { FocusRegistry, FocusTarget } from "../focus";
import { isPlainNavKey, type NavKey } from "../navigation";
import type { CommandRecord, DispatchResult, FocusOwner } from "../types";
import { useTheme } from "../ui/use-theme";

export interface SectionTabOption<Value extends string> {
  readonly label: string;
  readonly compactLabel?: string;
  readonly value: Value;
}

/**
 * A native, controlled tab strip. Each physical tab is a focusable Box; the
 * focus registry is rebound to whichever one physically owns focus so the
 * strip remains one semantic Tab stop.
 */
export function SectionTabs<Value extends string>(props: {
  readonly id: string;
  readonly options: readonly SectionTabOption<Value>[];
  readonly value: Value;
  readonly owner: FocusOwner;
  readonly focusRegistry?: FocusRegistry;
  readonly compact?: boolean;
  readonly label?: string;
  readonly panelId?: string;
  readonly onPrimaryPointerEntry?: (value: Value) => void;
  readonly onFocusOwner?: () => void;
  readonly commandForDirection?: (direction: "previous" | "next") => CommandRecord;
  readonly onNavigate: (value: Value, record?: CommandRecord) => void;
  readonly activationMode?: "automatic" | "manual";
  readonly onActivate?: (value: Value) => void;
}) {
  const renderer = useRenderer();
  const tokens = useTheme();
  const [focusedValue, setFocusedValue] = createSignal<Value>();
  const tabs = new Map<Value, BoxRenderable>();
  let viewport: ScrollBoxRenderable | undefined;
  let registered: FocusTarget | undefined;
  let unregisterFocus: (() => void) | undefined;
  let unregisterMode: (() => void) | undefined;
  let pendingReveal: (() => void) | undefined;
  let revealQueued = false;
  let revealValue: Value | undefined;
  let disposed = false;

  const labelFor = (option: SectionTabOption<Value>) =>
    props.compact ? (option.compactLabel ?? option.label) : option.label;
  const tabText = (option: SectionTabOption<Value>) =>
    props.value === option.value ? `[ ${labelFor(option)} ]` : `  ${labelFor(option)}  `;
  const rowWidth = () =>
    props.options.reduce((width, option) => width + Bun.stringWidth(tabText(option)), 0);
  const selectedTab = () => tabs.get(props.value);

  const directionTo = (next: Value, current: Value) =>
    props.options.findIndex((option) => option.value === next) <
    props.options.findIndex((option) => option.value === current)
      ? "previous"
      : "next";

  // One queued frame is enough for a controlled parent to mount its next tab;
  // coalescing prevents resize bursts from accumulating stale callbacks.
  const revealSelected = (value = focusedValue() ?? props.value) => {
    revealValue = value;
    if (revealQueued) return;
    revealQueued = true;
    queueMicrotask(() => {
      if (disposed || renderer.isDestroyed) return;
      const reveal = () => {
        pendingReveal = undefined;
        revealQueued = false;
        if (!viewport || viewport.isDestroyed) return;
        viewport.scrollChildIntoView(`${props.id}-tab-${revealValue ?? props.value}`);
      };
      pendingReveal = reveal;
      renderer.once("frame", reveal);
      renderer.requestRender();
    });
  };

  const bindOwner = (target: BoxRenderable) => {
    if (registered === target) return;
    unregisterFocus?.();
    unregisterMode?.();
    registered = target;
    unregisterFocus = props.focusRegistry?.register(props.owner, target);
    unregisterMode = props.focusRegistry?.registerModeHandler(target, handleModeKey);
  };

  const focusTab = (value: Value) => {
    const target = tabs.get(value);
    if (!target || target.isDestroyed) return;
    target.focus();
    revealSelected(value);
  };

  const focusAfterNavigation = (value: Value) => {
    queueMicrotask(() => {
      if (disposed || renderer.isDestroyed) return;
      const current = renderer.currentFocusedRenderable;
      if (!current || [...tabs.values()].some((tab) => tab === current)) focusTab(value);
    });
  };

  const moveFocus = (current: Value, key: "left" | "right" | "home" | "end") => {
    const currentIndex = props.options.findIndex((option) => option.value === current);
    if (currentIndex < 0 || props.options.length === 0) return false;
    const nextIndex =
      key === "home"
        ? 0
        : key === "end"
          ? props.options.length - 1
          : Math.max(
              0,
              Math.min(props.options.length - 1, currentIndex + (key === "left" ? -1 : 1)),
            );
    const next = props.options[nextIndex]?.value;
    if (!next) return false;
    if (props.owner === "local-nav" && key === "left" && currentIndex === 0) return false;
    focusTab(next);
    if ((props.activationMode ?? "automatic") === "automatic" && next !== props.value) {
      props.onNavigate(next, props.commandForDirection?.(directionTo(next, props.value)));
      focusAfterNavigation(next);
    }
    return true;
  };

  const activateFocused = (value: Value) => {
    if (value !== props.value) {
      props.onNavigate(value, props.commandForDirection?.(directionTo(value, props.value)));
      focusAfterNavigation(value);
    }
    props.onActivate?.(value);
  };

  const handleModeKey = (key: NavKey): DispatchResult => {
    if (!isPlainNavKey(key)) return "declined" as const;
    const value = focusedValue() ?? props.value;
    if (key.name === "left" || key.name === "right" || key.name === "home" || key.name === "end")
      return moveFocus(value, key.name) ? ("consumed" as const) : ("declined" as const);
    if (
      (key.name === "enter" || key.name === "down") &&
      (props.activationMode === "manual" || props.onActivate)
    ) {
      activateFocused(value);
      return "consumed" as const;
    }
    return "declined" as const;
  };

  const handleStandaloneKey = (value: Value, event: KeyEvent) => {
    if (event.defaultPrevented || !isPlainNavKey(event)) return;
    const name = event.name.toLowerCase();
    if (name === "left" || name === "right" || name === "home" || name === "end") {
      if (!moveFocus(value, name)) return;
    } else if (
      (name === "enter" || name === "return" || name === "down") &&
      (props.activationMode === "manual" || props.onActivate)
    )
      activateFocused(value);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const mountTab = (value: Value, target: BoxRenderable | undefined) => {
    if (!target) {
      tabs.delete(value);
      if (focusedValue() === value) setFocusedValue();
      return;
    }
    tabs.set(value, target);
    if (value === props.value) bindOwner(target);
    const focused = () => {
      setFocusedValue(() => value);
      bindOwner(target);
      props.onFocusOwner?.();
      revealSelected();
    };
    const blurred = () => {
      if (focusedValue() === value) setFocusedValue();
    };
    target.on("focused", focused);
    target.on("blurred", blurred);
    target.once("destroyed", () => {
      target.off("focused", focused);
      target.off("blurred", blurred);
      if (tabs.get(value) === target) tabs.delete(value);
      if (registered === target) {
        unregisterFocus?.();
        unregisterMode?.();
        registered = undefined;
        unregisterFocus = undefined;
        unregisterMode = undefined;
      }
    });
  };

  createEffect(() => {
    rowWidth();
    const physical = renderer.currentFocusedRenderable;
    const focused = [...tabs.values()].find((tab) => tab === physical);
    if (focused) bindOwner(focused);
    else {
      const selected = selectedTab();
      if (selected) bindOwner(selected);
    }
    revealSelected();
  });
  onMount(() => {
    const current = renderer.currentFocusedRenderable;
    if (current instanceof BoxRenderable) {
      const value = [...tabs.entries()].find(([, tab]) => tab === current)?.[0];
      if (value) {
        setFocusedValue(() => value);
        bindOwner(current);
      }
    }
  });
  onCleanup(() => {
    disposed = true;
    if (pendingReveal) renderer.off("frame", pendingReveal);
    unregisterFocus?.();
    unregisterMode?.();
  });

  return (
    <box
      id={props.panelId}
      flexDirection="row"
      width="100%"
      height={1}
      flexShrink={0}
      minWidth={0}
      gap={props.label ? 1 : 0}
    >
      {props.label && (
        <text
          selectable={false}
          flexShrink={0}
          fg={focusedValue() ? tokens().colors.primary : tokens().colors.foreground}
        >
          {props.label}
        </text>
      )}
      <scrollbox
        id={`${props.id}-viewport`}
        ref={(value: ScrollBoxRenderable) => {
          viewport = value;
          const reveal = () => revealSelected();
          value.viewport.on("resize", reveal);
          onCleanup(() => value.viewport.off("resize", reveal));
        }}
        scrollX
        scrollY={false}
        width="100%"
        height={1}
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
        focusable={false}
        contentOptions={{ width: rowWidth(), maxWidth: rowWidth(), flexDirection: "row" }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <For each={props.options.map((option) => option.value)}>
          {(value) => {
            const option = () => props.options.find((option) => option.value === value)!;
            return (
              <box
                id={`${props.id}-tab-${value}`}
                ref={(target: BoxRenderable) => mountTab(value, target)}
                width={Bun.stringWidth(tabText(option()))}
                height={1}
                flexShrink={0}
                focusable
                backgroundColor={
                  focusedValue() === value
                    ? tokens().colors.primary
                    : props.value === value
                      ? tokens().colors.surface
                      : "transparent"
                }
                onKeyDown={(event) => handleStandaloneKey(value, event)}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  props.onPrimaryPointerEntry?.(value);
                  focusTab(value);
                  if (value === props.value) props.onActivate?.(value);
                  else {
                    props.onNavigate(
                      value,
                      props.commandForDirection?.(directionTo(value, props.value)),
                    );
                    focusAfterNavigation(value);
                  }
                }}
              >
                <text
                  content={tabText(option())}
                  selectable={false}
                  fg={
                    focusedValue() === value
                      ? tokens().colors.primaryForeground
                      : tokens().colors.foreground
                  }
                />
              </box>
            );
          }}
        </For>
      </scrollbox>
    </box>
  );
}
