/** @jsxImportSource @opentui/solid */
import { type MouseEvent, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, type JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { FocusRegistry } from "../focus";
import type { NavKey } from "../navigation";
import type { DispatchResult, FocusOwner } from "../types";
import { Button } from "./button";
import { fitColumn } from "./list-text";
import { useTheme } from "./use-theme";

export interface TreeRow {
  readonly key: string;
  readonly parentKey?: string;
  readonly depth: number;
  readonly kind: "collection" | "reference" | "skill" | "entry";
  readonly name: string;
  readonly expandable: boolean;
  readonly issue?: string;
}

export interface TreeProps {
  readonly id: string;
  /** Visible preorder rows. Projection and expansion policy stay with the caller. */
  readonly rows: readonly TreeRow[];
  readonly selectedKey?: string;
  readonly expandedKeys: ReadonlySet<string>;
  readonly onSelect: (key: string, reason: "keyboard" | "pointer" | "collapse") => void;
  readonly onExpandedChange: (key: string, expanded: boolean) => void;
  readonly onActivate: (key: string) => void;
  readonly focusOwner: FocusOwner;
  readonly focusRegistry: FocusRegistry;
  /** The caller must deactivate panes that remain mounted but are hidden. */
  readonly active?: boolean;
  readonly ref?: (target: ScrollBoxRenderable) => void;
  /** One-shot restoration, not a controlled scroll offset. */
  readonly initialScrollTop?: number;
  readonly onScrollChange?: (offset: number) => void;
  readonly empty?: JSX.Element;
}

const sameKeys = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

const contains = (root: Renderable, target: Renderable | null | undefined): boolean => {
  for (let current = target; current; current = current.parent) if (current === root) return true;
  return false;
};

const usableAncestors = (target: Renderable) => {
  for (let current: Renderable | null = target; current; current = current.parent)
    // Native public dimensions are normalized to at least one after layout.
    // These checks handle pre-layout geometry; active/visible own pane collapse.
    if (!current.visible || current.isDestroyed || current.width <= 0 || current.height <= 0)
      return false;
  return true;
};

/** A single focus region with controlled selection and native disclosure/scroll transport. */
export function Tree(props: TreeProps) {
  const renderer = useRenderer();
  const tokens = useTheme();
  const keys = createMemo(() => props.rows.map((row) => row.key), [], { equals: sameKeys });
  const rowMap = createMemo(() => new Map(props.rows.map((row) => [row.key, row])));
  const indices = createMemo(() => new Map(keys().map((key, index) => [key, index])));
  const [root, setRoot] = createSignal<ScrollBoxRenderable>();
  const [binding, setBinding] = createSignal<{
    readonly root: ScrollBoxRenderable;
    readonly registry: FocusRegistry;
    readonly owner: FocusOwner;
  }>();
  const [enabled, setEnabled] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [width, setWidth] = createSignal(0);
  let disposed = false;
  let layoutKeys: readonly string[] = [];
  let anchor: { readonly key: string; readonly offset: number } | undefined;
  let anchorCaptured = false;
  let restorePending = true;
  let restored = false;
  let rememberedScroll = untrack(() => props.initialScrollTop);
  let reportedScroll: number | undefined;
  let revealKey: string | undefined;
  let previousSelection = untrack(() => props.selectedKey);
  let inputEpoch = 0;

  const rowId = (key: string) => `${props.id}-row-${encodeURIComponent(key)}`;
  const usable = (target = root()) =>
    !disposed &&
    props.active !== false &&
    !!target &&
    !target.isDestroyed &&
    !!target.parent &&
    usableAncestors(target) &&
    target.viewport.width > 0 &&
    target.viewport.height > 0;
  const currentBinding = () => {
    const value = binding();
    return value && value.registry.target(value.owner) === value.root ? value : undefined;
  };
  const ownsPhysicalFocus = () => {
    const target = root();
    return !!target && contains(target, renderer.currentFocusedRenderable);
  };
  const inputAllowed = () => enabled() && usable() && !!currentBinding();
  const requestFrame = () => {
    if (!disposed && props.active !== false) renderer.requestRender();
  };
  const scheduleReveal = (key: string) => {
    if (!inputAllowed()) return;
    revealKey = key;
    requestFrame();
  };
  const select = (key: string, reason: "keyboard" | "pointer" | "collapse") => {
    if (!inputAllowed() || !rowMap().has(key)) return;
    scheduleReveal(key);
    props.onSelect(key, reason);
  };
  const isDescendant = (key: string, ancestor: string) => {
    const visited = new Set<string>();
    for (
      let parent = rowMap().get(key)?.parentKey;
      parent;
      parent = rowMap().get(parent)?.parentKey
    ) {
      if (parent === ancestor) return true;
      if (visited.has(parent)) break;
      visited.add(parent);
    }
    return false;
  };
  const toggle = (key: string, expanded = !props.expandedKeys.has(key)) => {
    const row = rowMap().get(key);
    if (!inputAllowed() || !row?.expandable) return;
    if (!expanded && props.selectedKey && isDescendant(props.selectedKey, key))
      select(key, "collapse");
    // Selection callbacks may open a modal or deactivate this pane.
    if (inputAllowed()) props.onExpandedChange(key, expanded);
  };
  const handleKey = (key: NavKey): DispatchResult => {
    if (!inputAllowed() || !ownsPhysicalFocus()) return "declined";
    if (key.name === "character" && key.char === " ") return "consumed";
    const navigation = [
      "up",
      "down",
      "left",
      "right",
      "enter",
      "home",
      "end",
      "page-up",
      "page-down",
    ];
    if (!navigation.includes(key.name)) return "declined";
    const selected = props.selectedKey && rowMap().get(props.selectedKey);
    // Never activate a fallback object for an invalid controlled key.
    if (!selected) return "consumed";
    const index = indices().get(selected.key)!;
    const page = Math.max(1, (root()?.viewport.height ?? 1) - 1);
    const step =
      key.name === "up"
        ? -1
        : key.name === "down"
          ? 1
          : key.name === "page-up"
            ? -page
            : key.name === "page-down"
              ? page
              : 0;
    if (step || key.name === "home" || key.name === "end") {
      const next =
        key.name === "home"
          ? 0
          : key.name === "end"
            ? keys().length - 1
            : Math.max(0, Math.min(keys().length - 1, index + step));
      if (next !== index) select(keys()[next]!, "keyboard");
      return "consumed";
    }
    const expanded = props.expandedKeys.has(selected.key);
    if (key.name === "enter") {
      if (selected.kind === "collection" || selected.kind === "reference") toggle(selected.key);
      else props.onActivate(selected.key);
    } else if (key.name === "right") {
      if (selected.expandable && !expanded) toggle(selected.key, true);
      else if (selected.expandable) {
        const child = props.rows.find((row) => row.parentKey === selected.key);
        if (child) select(child.key, "keyboard");
      }
    } else if (key.name === "left") {
      if (selected.expandable && expanded) toggle(selected.key, false);
      else if (selected.parentKey) select(selected.parentKey, "keyboard");
    }
    return "consumed";
  };

  const updateFocus = () => {
    const target = root();
    setFocused(!!target && usable(target) && contains(target, renderer.currentFocusedRenderable));
  };
  const deactivate = (target: ScrollBoxRenderable) => {
    const physical = renderer.currentFocusedRenderable;
    // Core blur refuses a nonfocusable target: blur before changing focusability.
    if (contains(target, physical)) physical?.blur();
    target.focusable = false;
    target.stopAutoScroll();
    if (enabled()) inputEpoch++;
    setEnabled(false);
    setFocused(false);
    restorePending = true;
    revealKey = undefined;
  };

  /** Guard the public dispatch seam; native Slider ignores defaultPrevented on captured drags. */
  const gateMouse = (target: Renderable, focusTarget?: Renderable, pointerSession = true) => {
    const original = target.processMouseEvent;
    let pointerEpoch: number | undefined;
    const guarded: typeof original = function (event) {
      const continuation =
        event.type === "up" || event.type === "drag" || event.type === "drag-end";
      if (!inputAllowed() || (pointerSession && continuation && pointerEpoch !== inputEpoch)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.type === "down") pointerEpoch = inputEpoch;
      if (focusTarget && event.type === "down" && event.button === 0) focusTarget.focus();
      original.call(target, event);
    };
    target.processMouseEvent = guarded;
    onCleanup(() => {
      if (target.processMouseEvent === guarded) target.processMouseEvent = original;
    });
  };
  const guardNativeKey: NonNullable<Renderable["onKeyDown"]> = (event) => {
    if (!inputAllowed() || event.name === "space") {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const member = (target: Renderable) => {
    target.on("focused", updateFocus);
    target.on("blurred", updateFocus);
    createEffect(() => {
      const value = binding();
      if (!value) return;
      const release = untrack(() => value.registry.registerMember(value.owner, target, value.root));
      onCleanup(release);
    });
    onCleanup(() => {
      target.off("focused", updateFocus);
      target.off("blurred", updateFocus);
    });
  };

  createEffect(() => {
    const target = root();
    if (!target || !enabled()) return;
    const registry = props.focusRegistry;
    const owner = props.focusOwner;
    const release = untrack(() => registry.register(owner, target));
    const releaseMode = registry.registerModeHandler(target, handleKey);
    setBinding({ root: target, registry, owner });
    onCleanup(() => {
      releaseMode();
      release();
      setBinding(undefined);
    });
  });
  createEffect(() => {
    const target = root();
    if (!target) return;
    if (props.active === false) deactivate(target);
    else requestFrame();
  });
  createEffect(() => {
    const selected = props.selectedKey;
    if (selected !== previousSelection && restored && props.active !== false) {
      revealKey = selected;
      requestFrame();
    }
    previousSelection = selected;
  });
  const captureAnchor = (target: ScrollBoxRenderable) => {
    const index = Math.floor(target.scrollTop);
    const key = layoutKeys[index];
    anchor = key ? { key, offset: target.scrollTop - index } : undefined;
  };
  createEffect(() => {
    const next = keys();
    const target = root();
    if (target && usable(target) && restored && !sameKeys(next, layoutKeys) && !anchorCaptured) {
      captureAnchor(target);
      anchorCaptured = true;
    }
    requestFrame();
  });

  const frame = () => {
    const target = root();
    if (!target || disposed) return;
    if (!usable(target)) {
      deactivate(target);
      return;
    }
    target.focusable = true;
    setEnabled(true);
    setWidth(target.viewport.width);
    updateFocus();
    const nextKeys = keys();
    const maximum = Math.max(0, target.scrollHeight - target.viewport.height);
    const changedRows = !sameKeys(nextKeys, layoutKeys);
    let positionChanged = false;
    if (restorePending) {
      const saved = rememberedScroll;
      const valid = saved !== undefined && Number.isFinite(saved) && saved >= 0;
      const position = valid ? Math.min(saved, maximum) : 0;
      positionChanged = position !== target.scrollTop;
      target.scrollTo(position);
      if (!restored && !valid) revealKey = props.selectedKey;
      restorePending = false;
      restored = true;
    }
    if (changedRows && anchor) {
      const index = indices().get(anchor.key);
      const position = Math.min(
        maximum,
        Math.max(
          0,
          index === undefined ? (rememberedScroll ?? target.scrollTop) : index + anchor.offset,
        ),
      );
      positionChanged = positionChanged || position !== target.scrollTop;
      target.scrollTo(position);
    }
    layoutKeys = nextKeys;
    anchorCaptured = false;
    if (revealKey && !positionChanged) {
      const key = revealKey;
      revealKey = undefined;
      const before = target.scrollTop;
      if (key === props.selectedKey && rowMap().has(key) && inputAllowed())
        target.scrollChildIntoView(rowId(key));
      positionChanged = before !== target.scrollTop;
    }
    rememberedScroll = target.scrollTop;
    captureAnchor(target);
    if (reportedScroll !== rememberedScroll && inputAllowed()) {
      reportedScroll = rememberedScroll;
      props.onScrollChange?.(rememberedScroll);
    }
    if (usable(target) && (positionChanged || revealKey)) requestFrame();
  };
  renderer.on("frame", frame);
  onCleanup(() => {
    const target = root();
    if (target && !target.isDestroyed) deactivate(target);
    disposed = true;
    revealKey = undefined;
    renderer.off("frame", frame);
  });

  const Row = (rowProps: { readonly rowKey: string }) => {
    const row = createMemo(() => rowMap().get(rowProps.rowKey));
    const selected = () => props.selectedKey === rowProps.rowKey;
    const indentation = () =>
      Math.min(Math.max(0, row()?.depth ?? 0) * 2, Math.max(0, Math.floor((width() - 15) / 2) * 2));
    const prefix = () => {
      const depth = Math.max(0, row()?.depth ?? 0);
      const columns = indentation();
      if (!columns) return "";
      return depth * 2 > columns ? `${" ".repeat(columns - 1)}…` : " ".repeat(columns);
    };
    const foreground = () =>
      selected() && focused() ? tokens().colors.primaryForeground : tokens().colors.foreground;
    let disclosure: Renderable | undefined;
    return (
      <box
        id={rowId(rowProps.rowKey)}
        height={1}
        width="100%"
        flexShrink={0}
        flexDirection="row"
        overflow="hidden"
        backgroundColor={
          selected()
            ? focused()
              ? tokens().colors.primary
              : tokens().colors.surface
            : "transparent"
        }
        onMouseDown={(event) => {
          if (
            event.button !== 0 ||
            !inputAllowed() ||
            (disclosure && contains(disclosure, event.target))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          root()?.focus();
          select(rowProps.rowKey, "pointer");
        }}
      >
        <text
          width={indentation()}
          flexShrink={0}
          content={prefix()}
          wrapMode="none"
          fg={tokens().colors.mutedForeground}
        />
        <Show when={row()?.expandable} fallback={<box width={3} height={1} flexShrink={0} />}>
          <Button
            id={`${rowId(rowProps.rowKey)}-disclosure`}
            intent="quiet"
            size="compact"
            width={3}
            height={1}
            flexShrink={0}
            showFocusIndicator={false}
            label={props.expandedKeys.has(rowProps.rowKey) ? "▾" : "▸"}
            disabled={!enabled() || props.active === false}
            onKeyDown={guardNativeKey}
            onMouse={(event: MouseEvent) => {
              // Let the primitive own down/up press; keep it out of ordinary row selection.
              if (event.type === "down" || event.type === "up") event.stopPropagation();
            }}
            onPress={() => {
              if (!inputAllowed()) return;
              toggle(rowProps.rowKey);
              const target = root();
              const physical = renderer.currentFocusedRenderable;
              if (target && inputAllowed() && (physical === disclosure || physical === target))
                target.focus();
            }}
            ref={(target) => {
              disclosure = target;
              member(target);
              gateMouse(target);
              onCleanup(() => {
                disclosure = undefined;
              });
            }}
          />
        </Show>
        <text
          id={`${rowId(rowProps.rowKey)}-kind`}
          width={2}
          flexShrink={0}
          wrapMode="none"
          fg={selected() && focused() ? foreground() : tokens().colors.mutedForeground}
          content={row()?.kind === "skill" ? "S " : row()?.kind === "entry" ? "  " : "C "}
        />
        <text
          id={`${rowId(rowProps.rowKey)}-name`}
          flexGrow={1}
          minWidth={0}
          wrapMode="none"
          fg={foreground()}
          content={fitColumn(
            row()?.name ?? "",
            Math.max(1, width() - indentation() - 5 - (row()?.issue ? 2 : 0)),
          )}
        />
        <Show when={row()?.issue}>
          <text
            width={2}
            flexShrink={0}
            wrapMode="none"
            fg={selected() && focused() ? foreground() : tokens().colors.warning}
            content=" !"
          />
        </Show>
      </box>
    );
  };

  return (
    <scrollbox
      id={props.id}
      width="100%"
      flexGrow={1}
      flexShrink={1}
      minWidth={0}
      minHeight={0}
      scrollX={false}
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: "column" }}
      onKeyDown={guardNativeKey}
      onPaste={(event) => {
        if (!inputAllowed()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      ref={(target: ScrollBoxRenderable) => {
        setRoot(target);
        target.focusable = false;
        target.on("focused", updateFocus);
        target.on("blurred", updateFocus);
        onCleanup(() => {
          target.off("focused", updateFocus);
          target.off("blurred", updateFocus);
        });
        gateMouse(target, undefined, false);
        for (const bar of [target.verticalScrollBar, target.horizontalScrollBar]) {
          const targets = [bar, bar.slider, bar.startArrow, bar.endArrow];
          for (const child of targets) {
            member(child);
            gateMouse(child, bar);
            child.onKeyDown = guardNativeKey;
          }
          createEffect(() => {
            if (!enabled() || props.active === false) {
              for (const child of targets) {
                if (child.focused) child.blur();
                child.focusable = false;
              }
              bar.visible = false;
            } else {
              bar.focusable = true;
              bar.resetVisibilityControl();
            }
          });
        }
        props.ref?.(target);
        requestFrame();
      }}
    >
      <Show when={keys().length} fallback={props.empty}>
        <For each={keys()}>{(key) => <Row rowKey={key} />}</For>
      </Show>
    </scrollbox>
  );
}
