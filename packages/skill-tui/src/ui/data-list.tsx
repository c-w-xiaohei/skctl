import { SelectRenderable } from "@opentui/core";
import { useRenderer, type SelectProps } from "@opentui/solid";
import { createSignal, onCleanup, onMount, splitProps } from "solid-js";
import { selectScrollOffset } from "../select-scroll";
import { selectColors } from "./theme";
import { useTheme } from "./use-theme";
import { fitColumn, formatColumns, inlineNameColumnWidth } from "./list-text";

export interface DataListProps extends Omit<SelectProps, "ref"> {
  readonly ref?: (target: SelectRenderable) => void;
  readonly inlineDescription?: boolean;
  /** Lets a composite claim a rendered row press before ordinary row selection. */
  readonly onRowPress?: (
    event: Parameters<NonNullable<SelectProps["onMouseDown"]>>[0],
    row: { readonly index: number; readonly x: number; readonly y: number },
  ) => boolean;
}

/** Selection keeps a fixed gutter; only its color changes with physical focus. */
export function DataList(props: DataListProps) {
  const [callbacks, options] = splitProps(props, [
    "ref",
    "options",
    "onMouseDown",
    "onChange",
    "onSelect",
    "onRowPress",
    "inlineDescription",
  ]);
  const renderer = useRenderer();
  const tokens = useTheme();
  const [focused, setFocused] = createSignal(false);
  const [width, setWidth] = createSignal(0);
  let target: SelectRenderable | undefined;
  const focus = () => setFocused(true);
  const blur = () => setFocused(false);
  // Native Select overrides onResize without emitting the base resize event.
  // Observe computed geometry after frames; unchanged widths do not update Solid.
  const measureWidth = () => setWidth(target?.width ?? 0);
  renderer.on("frame", measureWidth);
  onMount(() => {
    setFocused(renderer.currentFocusedRenderable === target);
    measureWidth();
  });
  onCleanup(() => {
    target?.off("focused", focus);
    target?.off("blurred", blur);
    renderer.off("frame", measureWidth);
  });
  return (
    <select
      {...options}
      onChange={callbacks.onChange}
      onSelect={callbacks.onSelect}
      wrapSelection={false}
      options={callbacks.options?.map((option) =>
        width() > 5
          ? {
              ...option,
              name: callbacks.inlineDescription
                ? formatColumns(
                    option.name,
                    option.description,
                    width(),
                    inlineNameColumnWidth(width()),
                  )
                : fitColumn(option.name, width() - 5),
              description: callbacks.inlineDescription
                ? option.description
                : fitColumn(option.description, width() - 5),
            }
          : option,
      )}
      {...selectColors(tokens())}
      selectedBackgroundColor={focused() ? tokens().colors.primary : tokens().colors.surface}
      selectedTextColor={focused() ? tokens().colors.primaryForeground : tokens().colors.foreground}
      selectedDescriptionColor={
        focused() ? tokens().colors.primaryForeground : tokens().colors.mutedForeground
      }
      showSelectionIndicator
      onMouseDown={(event) => {
        if (event.button !== 0 || !target) {
          if (target) callbacks.onMouseDown?.call(target, event);
          return;
        }

        // Select uses one text row plus its optional description and configured gap.
        // `scrollOffset` has no public OpenTUI accessor in 0.5.14; use the existing
        // compatibility facade rather than reaching into SelectRenderable here.
        const linesPerItem = (target.showDescription ? 2 : 1) + (options.itemSpacing ?? 0);
        const localY = event.y - target.screenY;
        const visibleRow = Math.floor(localY / linesPerItem);
        const index = selectScrollOffset(target) + visibleRow;
        if (
          localY < 0 ||
          localY >= target.height ||
          visibleRow * linesPerItem + (target.showDescription ? 2 : 1) > target.height ||
          localY % linesPerItem >= (target.showDescription ? 2 : 1) ||
          index < 0 ||
          index >= target.options.length
        ) {
          callbacks.onMouseDown?.call(target, event);
          return;
        }

        if (callbacks.onRowPress?.(event, { index, x: event.x - target.screenX, y: localY })) {
          event.preventDefault();
          event.stopPropagation();
          target.focus();
          return;
        }

        // A pointer row press always selects but never opens an object. Composite
        // lists can additionally claim a narrow sub-target (such as a tree
        // disclosure glyph) through onRowPress above; all other lists retain
        // this same select-only contract.
        if (!callbacks.onRowPress) {
          event.preventDefault();
          event.stopPropagation();
          target.focus();
          target.setSelectedIndex(index);
          return;
        }

        // A composite row press selects but never opens its object. Enter
        // remains the explicit open action.
        event.preventDefault();
        event.stopPropagation();
        target.focus();
        target.setSelectedIndex(index);
      }}
      ref={(value: SelectRenderable) => {
        target = value;
        value.on("focused", focus);
        value.on("blurred", blur);
        measureWidth();
        callbacks.ref?.(value);
      }}
    />
  );
}
