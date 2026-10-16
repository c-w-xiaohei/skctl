/** @jsxImportSource @opentui/solid */
import { BoxRenderable, LayoutEvents, ScrollBoxRenderable, type Renderable } from "@opentui/core";
import type { BoxOptions } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import {
  batch,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { FocusRegistry } from "../focus";
import { isPlainNavKey, parseNavKey, type NavKey } from "../navigation";
import type { CommandRecord, CommandRegistration, DispatchResult } from "../types";
import { Button } from "./button";
import {
  layoutTableColumns,
  truncateTableText,
  type DataTableCell,
  type DataTableColumn,
} from "./data-table-layout";
import { useTheme } from "./use-theme";

export type { DataTableCell, DataTableColumn } from "./data-table-layout";

export interface DataTableAction {
  /** Same action meaning across rows; command IDs still identify exact targets. */
  readonly key: string;
  readonly record: CommandRecord;
  readonly execute: () => void;
}

export interface DataTableProps<T> extends Pick<
  BoxOptions,
  "width" | "height" | "flexGrow" | "flexShrink"
> {
  readonly id?: string;
  readonly rows: readonly T[];
  readonly columns: readonly DataTableColumn<T>[];
  readonly rowKey: (row: T) => string;
  readonly currentKey: string | undefined;
  readonly onCurrentChange: (key: string | undefined) => void;
  readonly onActivate?: (row: T) => void;
  /** Required rightmost native-control column; only the current row enters Actions discovery. */
  readonly actions?: {
    readonly width: number;
    readonly compactWidth: number;
    readonly items: (row: T, compact: boolean) => readonly DataTableAction[];
    readonly registerCommand?: CommandRegistration;
  };
  /** Page-owned commands run before ordinary table navigation. */
  readonly onKey?: (key: NavKey) => DispatchResult;
  readonly onBoundary?: (direction: "up" | "down") => void;
  readonly initialScrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
  readonly selection?: {
    readonly keys: ReadonlySet<string>;
    readonly partialKeys?: ReadonlySet<string>;
    readonly showIndicators?: boolean;
    readonly canSelect?: (row: T) => boolean;
    readonly onToggle: (row: T) => void;
  };
  readonly emptyText?: string;
  readonly focusRegistry?: FocusRegistry;
  readonly ref?: (target: BoxRenderable) => void;
}

/** Controlled data and selection; one native focus target and scroll viewport. */
export function DataTable<T>(props: DataTableProps<T>) {
  const id = props.id ?? `data-table-${createUniqueId()}`;
  const renderer = useRenderer();
  const tokens = useTheme();
  const [focused, setFocused] = createSignal(false);
  const [width, setWidth] = createSignal(0);
  const [height, setHeight] = createSignal(0);

  // Cache prop getters once. Membership and eligibility have independent consumers.
  const selection = createMemo(() => props.selection);
  const selecting = createMemo(() => selection() !== undefined);
  const showIndicators = createMemo(() => selecting() && selection()?.showIndicators !== false);
  const selectionPredicate = createMemo(() => selection()?.canSelect);
  const isChecked = createSelector(
    () => selection()?.keys,
    (key: string, keys) => keys?.has(key) ?? false,
  );
  const isPartial = createSelector(
    () => selection()?.partialKeys,
    (key: string, keys) => keys?.has(key) ?? false,
  );
  const data = createMemo(() => {
    const keys: string[] = [];
    const rows = new Map<string, T>();
    const indices = new Map<string, number>();
    for (const row of props.rows) {
      const key = props.rowKey(row);
      if (rows.has(key)) throw new Error(`Duplicate row key: ${key}`);
      indices.set(key, keys.length);
      keys.push(key);
      rows.set(key, row);
    }
    return { keys, rows, indices };
  });
  const cursor = createMemo((previous?: { key: string | undefined; index: number }) => {
    const { keys, indices } = data();
    const requested = props.currentKey;
    const index =
      (requested === undefined ? undefined : indices.get(requested)) ??
      Math.min(Math.max(0, previous?.index ?? 0), keys.length - 1);
    const key = keys[index];
    return previous && previous.key === key && previous.index === index ? previous : { key, index };
  });
  const isCurrent = createSelector(() => props.currentKey);

  // Definition identity does not depend on width. For receives stable IDs, not layouts.
  const definitions = createMemo(() => new Map(props.columns.map((column) => [column.id, column])));
  const gutter = createMemo(() => (showIndicators() ? 6 : 2));
  const compactActions = createMemo(() => width() < 80);
  const actionWidth = createMemo(() =>
    props.actions ? (compactActions() ? props.actions.compactWidth : props.actions.width) : 0,
  );
  const layout = createMemo(() =>
    layoutTableColumns(props.columns, width() - gutter() - (props.actions ? actionWidth() + 2 : 0)),
  );
  const columnKeys = createMemo(() => layout().map(({ column }) => column.id));
  const columnWidths = createMemo(
    () => new Map(layout().map(({ column, width }) => [column.id, width])),
  );
  const fits = createMemo(() => height() >= 2 && columnKeys().length > 0);
  const rowId = (key: string) => `${id}-row-${encodeURIComponent(key)}`;

  let root: BoxRenderable | undefined;
  let body: ScrollBoxRenderable | undefined;
  let unregister: (() => void) | undefined;
  let measurePending = true;
  let revealPending = true;
  const initialScrollTop = props.initialScrollTop;
  let restorePending = initialScrollTop !== undefined;
  let reportedScroll: number | undefined;
  const actionTargets = new Map<string, Map<string, Renderable>>();
  let pendingAction: { row: string; action?: string } | undefined;
  const enterActions = (row: string | undefined, action?: string) => {
    if (!row || !props.actions || !fits()) return;
    pendingAction = { row, action };
    reveal();
  };
  const actionButtons = (key: string) => {
    const row = data().rows.get(key);
    const targets = actionTargets.get(key);
    return row === undefined
      ? []
      : (props.actions?.items(row, compactActions()) ?? []).flatMap((item) => {
          const target = targets?.get(item.record.id);
          return target && !target.isDestroyed && target.focusable ? [{ item, target }] : [];
        });
  };
  const reveal = () => {
    revealPending = true;
    renderer.requestRender();
  };
  const resize = () => {
    measurePending = true;
    reveal();
  };

  // on() keeps parent callback reads outside these explicitly owned dependencies.
  createEffect(
    on([cursor, () => props.currentKey], ([current, requested]) => {
      if (current.key !== requested) props.onCurrentChange(current.key);
    }),
  );
  createEffect(on(cursor, reveal));

  const reportScroll = () => {
    if (!body || body.isDestroyed || restorePending || !fits()) return;
    if (body.scrollTop === reportedScroll) return;
    reportedScroll = body.scrollTop;
    props.onScroll?.(reportedScroll);
  };
  const frame = () => {
    if (!root || !body || root.isDestroyed || body.isDestroyed) return;
    if (measurePending) {
      measurePending = false;
      const viewportWidth = body.viewport.width;
      const tableHeight = root.height;
      batch(() => {
        setWidth(viewportWidth);
        setHeight(tableHeight);
      });
    }
    // Rows mount after measurement; scrolling waits for their native layout.
    if (fits() && body.scrollHeight >= data().keys.length) {
      if (restorePending) {
        body.scrollTo(initialScrollTop ?? 0);
        restorePending = false;
        revealPending = false;
      } else if (revealPending) {
        revealPending = false;
        const { key, index } = cursor();
        if (key !== undefined) {
          // Each row is one terminal cell high. An exclusive lower edge also
          // reveals the next row in a one-line viewport; native child reveal
          // treats that edge as visible and can leave the cursor behind a border.
          const first = body.scrollTop;
          const rows = body.viewport.height;
          if (index < first) body.scrollTo(index);
          else if (rows > 0 && index >= first + rows) body.scrollTo(index - rows + 1);
        }
      }
    }
    reportScroll();
    if (pendingAction && !revealPending) {
      const next = pendingAction;
      pendingAction = undefined;
      const buttons = actionButtons(next.row);
      (
        buttons.find(({ item }) => item.key === next.action) ??
        buttons.find(({ item }) => !item.record.danger) ??
        buttons[0]
      )?.target.focus();
    }
  };
  const focus = () => setFocused(true);
  const blur = () => setFocused(false);
  renderer.on("frame", frame);
  onCleanup(() => {
    reportScroll();
    renderer.off("frame", frame);
    root?.off("focused", focus);
    root?.off("blurred", blur);
    body?.viewport.off(LayoutEvents.RESIZED, resize);
    unregister?.();
  });

  const locate = (index: number) => {
    if (!fits()) return;
    const keys = data().keys;
    const key = keys[Math.max(0, Math.min(index, keys.length - 1))];
    if (key !== undefined && key !== props.currentKey) props.onCurrentChange(key);
    reveal();
  };
  const toggle = (row: T) => {
    if (selecting() && (selectionPredicate()?.(row) ?? true)) selection()?.onToggle(row);
  };
  const navigate = (key: NavKey): DispatchResult => {
    if (!isPlainNavKey(key)) return "declined";
    const index = cursor().index;
    const page = Math.max(1, body?.viewport.height ?? 1);
    switch (key.name) {
      case "up":
        if (fits() && index <= 0 && props.onBoundary) props.onBoundary("up");
        else locate(index - 1);
        break;
      case "down":
        if (fits() && index >= data().keys.length - 1 && props.onBoundary) props.onBoundary("down");
        else locate(index + 1);
        break;
      case "page-up":
        locate(index - page);
        break;
      case "page-down":
        locate(index + page);
        break;
      case "home":
        locate(0);
        break;
      case "end":
        locate(data().keys.length - 1);
        break;
      case "right":
        if (!props.actions) return "declined";
        enterActions(cursor().key);
        break;
      case "left":
        if (!props.actions) return "declined";
        break;
      case "enter":
      case "character": {
        if (key.name === "character" && (key.char !== " " || !selecting())) return "declined";
        const current = cursor().key;
        if (current !== undefined && fits() && (body?.viewport.height ?? 0) > 0) {
          const row = data().rows.get(current)!;
          if (key.name === "enter") {
            reportScroll();
            props.onActivate?.(row);
          } else toggle(row);
        }
        break;
      }
      default:
        return "declined";
    }
    return "consumed";
  };
  const handleKey = (key: NavKey): DispatchResult => {
    const result = props.onKey?.(key);
    return result && result !== "declined" ? result : navigate(key);
  };
  const ActionCell = (cellProps: { rowKey: string; row: T }) => {
    const items = createMemo(() => props.actions?.items(cellProps.row, compactActions()) ?? []);
    const byId = createMemo(() => new Map(items().map((item) => [item.record.id, item])));
    return (
      <box
        id={`${rowId(cellProps.rowKey)}:actions`}
        width={actionWidth()}
        height={1}
        flexShrink={0}
        flexDirection="row"
        gap={1}
        overflow="hidden"
      >
        <For each={items().map((item) => item.record.id)}>
          {(actionId) => {
            const item = createMemo<DataTableAction>(
              (previous) => byId().get(actionId) ?? previous,
              byId().get(actionId)!,
            );
            let target: Renderable | undefined;
            const execute = () => {
              if (!item().record.enabled || !data().rows.has(cellProps.rowKey)) return;
              props.onCurrentChange(cellProps.rowKey);
              reportScroll();
              item().execute();
            };
            createEffect(() => {
              const record = item().record;
              if (props.currentKey !== cellProps.rowKey || !target || !root) return;
              const owner = props.focusRegistry?.ownerOf(root);
              if (owner)
                onCleanup(
                  props.actions?.registerCommand?.(record, owner, target.id, execute) ?? (() => {}),
                );
            });
            const mode = (key: NavKey): DispatchResult => {
              if (!isPlainNavKey(key)) return "declined";
              const buttons = actionButtons(cellProps.rowKey);
              const index = buttons.findIndex((button) => button.target === target);
              if (key.name === "escape" || (key.name === "left" && index <= 0)) root?.focus();
              else if (key.name === "left" || key.name === "right")
                buttons[
                  Math.max(0, Math.min(buttons.length - 1, index + (key.name === "left" ? -1 : 1)))
                ]?.target.focus();
              else if (key.name === "up" || key.name === "down") {
                locate(cursor().index + (key.name === "up" ? -1 : 1));
                enterActions(cursor().key, item().key);
              } else return "declined";
              return "consumed";
            };
            return (
              <Button
                id={`${rowId(cellProps.rowKey)}:action-${encodeURIComponent(actionId)}`}
                label={item().record.verb}
                intent={item().record.danger ? "danger" : "neutral"}
                disabled={!item().record.enabled}
                ref={(value: Renderable) => {
                  target = value;
                  const targets = actionTargets.get(cellProps.rowKey) ?? new Map();
                  targets.set(actionId, value);
                  actionTargets.set(cellProps.rowKey, targets);
                  const owner = root && props.focusRegistry?.ownerOf(root);
                  const releaseMember =
                    owner && root
                      ? props.focusRegistry?.registerMember(owner, value, root)
                      : undefined;
                  const releaseMode = props.focusRegistry?.registerModeHandler(value, mode);
                  onCleanup(() => {
                    if (renderer.currentFocusedRenderable === value && !root?.isDestroyed)
                      root?.focus();
                    releaseMode?.();
                    releaseMember?.();
                    targets.delete(actionId);
                    if (!targets.size) actionTargets.delete(cellProps.rowKey);
                  });
                }}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  if (item().record.enabled) {
                    props.onCurrentChange(cellProps.rowKey);
                    target?.focus();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.defaultPrevented || mode(parseNavKey(event)) !== "consumed") return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPress={execute}
              />
            );
          }}
        </For>
      </box>
    );
  };
  const cellColor = (tone: Exclude<DataTableCell, string>["tone"], highlighted: boolean) => {
    const colors = tokens().colors;
    if (highlighted) return colors.primaryForeground;
    switch (tone) {
      case "muted":
        return colors.mutedForeground;
      case "success":
        return colors.success;
      case "warning":
        return colors.warning;
      case "danger":
        return colors.destructive;
      default:
        return colors.foreground;
    }
  };

  return (
    <box
      id={id}
      width={props.width ?? "100%"}
      height={props.height}
      flexGrow={props.flexGrow ?? (props.height === undefined ? 1 : 0)}
      flexShrink={props.flexShrink}
      flexDirection="column"
      minWidth={0}
      minHeight={0}
      overflow="hidden"
      focusable
      onSizeChange={resize}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          renderer.currentFocusedRenderable !== root ||
          handleKey(parseNavKey(event)) !== "consumed"
        )
          return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.button === 0) root?.focus();
      }}
      ref={(target: BoxRenderable) => {
        root = target;
        setFocused(target.focused);
        target.on("focused", focus);
        target.on("blurred", blur);
        unregister = props.focusRegistry?.registerModeHandler(target, handleKey);
        props.ref?.(target);
      }}
    >
      <Show when={fits()}>
        <box id={`${id}-header`} height={1} flexShrink={0} flexDirection="row">
          <box width={gutter()} height={1} flexShrink={0} />
          <box flexDirection="row" gap={2}>
            <For each={columnKeys()}>
              {(key) => {
                // Retain removed items only until For disposes their owner.
                const column = createMemo<DataTableColumn<T>>(
                  (previous) => definitions().get(key) ?? previous,
                  definitions().get(key)!,
                );
                const cellWidth = createMemo(() => columnWidths().get(key) ?? 0);
                const content = createMemo(() => truncateTableText(column().header, cellWidth()));
                return (
                  <text
                    id={`${id}-header-${key}`}
                    width={cellWidth()}
                    height={1}
                    flexShrink={0}
                    wrapMode="none"
                    textAlign={column().align ?? "left"}
                    fg={tokens().colors.mutedForeground}
                    content={content()}
                  />
                );
              }}
            </For>
            <Show when={props.actions}>
              <text
                id={`${id}-header-actions`}
                width={actionWidth()}
                height={1}
                flexShrink={0}
                fg={tokens().colors.mutedForeground}
              >
                Actions
              </text>
            </Show>
          </box>
        </box>
      </Show>
      <scrollbox
        id={`${id}-body`}
        flexGrow={1}
        minHeight={0}
        minWidth={0}
        focusable={false}
        scrollX={false}
        scrollY
        viewportCulling
        verticalScrollbarOptions={{
          showArrows: false,
          trackOptions: {
            foregroundColor: tokens().colors.border,
            backgroundColor: tokens().colors.background,
          },
        }}
        horizontalScrollbarOptions={{ visible: false }}
        contentOptions={{ flexDirection: "column", flexGrow: 0, flexShrink: 0 }}
        onSizeChange={resize}
        ref={(target: ScrollBoxRenderable) => {
          body = target;
          target.viewport.on(LayoutEvents.RESIZED, resize);
          target.verticalScrollBar.focusable = false;
          target.verticalScrollBar.slider.focusable = false;
        }}
      >
        <Show
          when={fits()}
          fallback={
            <text
              id={`${id}-size-warning`}
              height={1}
              wrapMode="none"
              fg={tokens().colors.mutedForeground}
              content={truncateTableText(
                height() < 2 ? "More height needed" : "More width needed",
                width(),
              )}
            />
          }
        >
          <Show
            when={data().keys.length}
            fallback={
              <text
                id={`${id}-empty`}
                height={1}
                wrapMode="none"
                fg={tokens().colors.mutedForeground}
                content={truncateTableText(props.emptyText ?? "No rows", width())}
              />
            }
          >
            <For each={data().keys}>
              {(key, index) => {
                // Return the row, not an index wrapper: reordering cannot invalidate cells.
                const row = createMemo<T>(
                  (previous) => data().rows.get(key) ?? previous,
                  data().rows.get(key)!,
                );
                const current = () => isCurrent(key);
                const highlighted = createMemo(() => current() && focused());
                const selectable = createMemo(
                  () => selecting() && (selectionPredicate()?.(row()) ?? true),
                );
                return (
                  <box
                    id={rowId(key)}
                    height={1}
                    flexShrink={0}
                    flexDirection="row"
                    backgroundColor={
                      highlighted()
                        ? tokens().colors.primary
                        : current()
                          ? tokens().colors.surface
                          : "transparent"
                    }
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      root?.focus();
                      locate(index());
                    }}
                  >
                    <box width={gutter()} flexShrink={0} flexDirection="row">
                      <text
                        width={2}
                        height={1}
                        flexShrink={0}
                        selectable={false}
                        content={highlighted() ? "› " : "  "}
                        fg={
                          highlighted()
                            ? tokens().colors.primaryForeground
                            : tokens().colors.foreground
                        }
                      />
                      <Show when={showIndicators()}>
                        <text
                          id={`${rowId(key)}:check`}
                          width={2}
                          height={1}
                          flexShrink={0}
                          selectable={false}
                          fg={
                            highlighted()
                              ? tokens().colors.primaryForeground
                              : selectable()
                                ? tokens().colors.foreground
                                : tokens().colors.disabledForeground
                          }
                          content={
                            isChecked(key)
                              ? `${tokens().glyphs.check} `
                              : isPartial(key)
                                ? "− "
                                : selectable()
                                  ? "□ "
                                  : "— "
                          }
                          onMouseDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.stopPropagation();
                            root?.focus();
                            locate(index());
                            toggle(row());
                          }}
                        />
                      </Show>
                    </box>
                    <box flexDirection="row" gap={2}>
                      <For each={columnKeys()}>
                        {(columnKey) => {
                          const column = createMemo<DataTableColumn<T>>(
                            (previous) => definitions().get(columnKey) ?? previous,
                            definitions().get(columnKey)!,
                          );
                          const cellWidth = createMemo(() => columnWidths().get(columnKey) ?? 0);
                          const readCell = createMemo(() => column().cell);
                          const cell = createMemo(() => readCell()(row()));
                          const text = createMemo(() => {
                            const value = cell();
                            return typeof value === "string" ? value : value.text;
                          });
                          const tone = createMemo(() => {
                            const value = cell();
                            return typeof value === "string" ? undefined : value.tone;
                          });
                          const content = createMemo(() => truncateTableText(text(), cellWidth()));
                          return (
                            <text
                              id={`${rowId(key)}:cell-${encodeURIComponent(columnKey)}`}
                              width={cellWidth()}
                              height={1}
                              flexShrink={0}
                              wrapMode="none"
                              textAlign={column().align ?? "left"}
                              selectable={false}
                              fg={cellColor(tone(), highlighted())}
                              content={content()}
                            />
                          );
                        }}
                      </For>
                      <Show when={props.actions}>
                        <ActionCell rowKey={key} row={row()} />
                      </Show>
                    </box>
                  </box>
                );
              }}
            </For>
          </Show>
        </Show>
      </scrollbox>
    </box>
  );
}
