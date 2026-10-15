/** @jsxImportSource @opentui/solid */
import { type KeyEvent, type ScrollBoxRenderable } from "@opentui/core";
import { Tabs } from "@tuiparts/solid/tabs";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
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
 * A controlled TuiParts tab strip. Each physical trigger is a native Tab; the
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
  /** A view strip may keep pointer selection separate from entering its content. */
  readonly activateOnReselect?: boolean;
  readonly onActivate?: (value: Value) => void;
}) {
  const renderer = useRenderer();
  const tokens = useTheme();
  const [focusedValue, setFocusedValue] = createSignal<Value>();
  const tabs = new Map<Value, TabsTabRenderable>();
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
  const tabText = (option: SectionTabOption<Value>) => `  ${labelFor(option)}  `;
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
    // Native Tabs adds a List ancestor. Apply known scroll geometry before the
    // next frame so its nested triggers do not remain clipped for one key turn.
    if (viewport && !viewport.isDestroyed) viewport.scrollChildIntoView(`${props.id}-tab-${value}`);
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

  const bindOwner = (target: TabsTabRenderable) => {
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
    // OpenTUI cannot blur a trigger after the roving store has made it
    // non-focusable. Release the previous focus before moving the tab stop.
    const current = renderer.currentFocusedRenderable;
    if (current && current !== target) current.blur();
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
    const tab = tabs.get(current);
    if (!tab) return false;
    const next = tab.store.getNavigationTarget(
      tab.key,
      key === "home" ? "first" : key === "end" ? "last" : key === "left" ? "previous" : "next",
    );
    if (!next || (props.owner === "local-nav" && key === "left" && next.key === tab.key))
      return false;
    if (next.key !== tab.key) renderer.currentFocusedRenderable?.blur();
    next.focus();
    if ((props.activationMode ?? "automatic") === "automatic") {
      const state = tab.store.getItemState(next.key);
      if (state) tab.store.select(state.value, { source: "focus" });
    }
    revealSelected();
    return true;
  };

  const activateFocused = (value: Value) => {
    if (value !== props.value) {
      tabs.get(value)?.select();
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

  const mountTab = (value: Value, target: TabsTabRenderable | undefined) => {
    if (!target) {
      tabs.delete(value);
      if (focusedValue() === value) setFocusedValue();
      return;
    }
    tabs.set(value, target);
    const nativeFocus = target.focus;
    const focusTab = () => {
      const previous = renderer.currentFocusedRenderable;
      // TuiParts changes the roving stop before Core blurs the previous target.
      // Core refuses to blur a now-nonfocusable tab, leaving a live key listener.
      const state = target.getState();
      if (
        state.available &&
        !state.disabled &&
        previous !== target &&
        previous instanceof TabsTabRenderable &&
        [...tabs.values()].includes(previous)
      )
        previous.blur();
      nativeFocus.call(target);
    };
    target.focus = focusTab;
    onCleanup(() => {
      if (target.focus === focusTab) target.focus = nativeFocus;
    });
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
    if (current instanceof TabsTabRenderable) {
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
    <Tabs.Root
      id={props.panelId}
      value={props.value}
      activationMode={props.activationMode ?? "automatic"}
      loopFocus={false}
      onValueChange={(value) => {
        const next = props.options.find((option) => option.value === value)?.value;
        if (!next || next === props.value) return;
        props.onNavigate(next, props.commandForDirection?.(directionTo(next, props.value)));
        focusAfterNavigation(next);
      }}
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
        <Tabs.List width={rowWidth()} height={1} flexDirection="row">
          <For each={props.options.map((option) => option.value)}>
            {(value) => {
              const option = () => props.options.find((option) => option.value === value)!;
              let pointerWasSelected = false;
              return (
                <Tabs.Tab
                  id={`${props.id}-tab-${value}`}
                  value={value}
                  ref={(target) => mountTab(value, target)}
                  width={Bun.stringWidth(tabText(option()))}
                  height={1}
                  flexShrink={0}
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
                    event.stopPropagation();
                    pointerWasSelected = value === props.value;
                    props.onPrimaryPointerEntry?.(value);
                    focusTab(value);
                  }}
                  onMouseUp={(event) => {
                    if (
                      event.button === 0 &&
                      !event.defaultPrevented &&
                      pointerWasSelected &&
                      props.activateOnReselect !== false
                    )
                      props.onActivate?.(value);
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
                </Tabs.Tab>
              );
            }}
          </For>
        </Tabs.List>
      </scrollbox>
    </Tabs.Root>
  );
}
