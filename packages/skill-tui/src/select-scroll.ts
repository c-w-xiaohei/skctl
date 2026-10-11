import type { SelectRenderable } from "@opentui/core";

type NativeSelect = { scrollOffset: number };
const pending = new WeakMap<SelectRenderable, () => void>();

type Renderer = {
  once(event: "frame", listener: () => void): unknown;
  off(event: "frame", listener: () => void): unknown;
  requestRender(): void;
};

export type SelectStateRestore = (() => void) & {
  readonly cancel: () => void;
  readonly isApplyingSelection: () => boolean;
};

export type SelectScrollRestore = () => void;

const native = (target: SelectRenderable): NativeSelect => {
  const value = target as unknown as Partial<NativeSelect>;
  if (typeof value.scrollOffset !== "number")
    throw new Error(
      "OpenTUI SelectRenderable.scrollOffset is unavailable in the installed runtime",
    );
  return value as NativeSelect;
};

export const selectScrollOffset = (target: SelectRenderable): number => native(target).scrollOffset;
export const setSelectScrollOffset = (target: SelectRenderable, offset: number): void => {
  native(target).scrollOffset = offset;
};

// TUI lists use the native text font with no item spacing; descriptions add a row.
const maximumScrollOffset = (target: SelectRenderable): number => {
  const visibleItems = Math.max(1, Math.floor(target.height / (target.showDescription ? 2 : 1)));
  return Math.max(0, target.options.length - visibleItems);
};

/** OpenTUI updates its native viewport before this public selection event. */
export const trackSelectScroll = (target: SelectRenderable, save: (offset: number) => void) => {
  const listener = () => save(selectScrollOffset(target));
  const release = () => {
    target.off("selectionChanged", listener);
    target.off("destroyed", release);
  };
  target.on("selectionChanged", listener);
  target.once("destroyed", release);
  return release;
};

export const restoreSelectScroll = (
  renderer: Renderer,
  target: SelectRenderable,
  saved: number,
  options: { readonly clampToOptions?: boolean } = {},
): SelectScrollRestore => {
  if (saved <= 0) return () => {};
  pending.get(target)?.();
  const restore = () =>
    queueMicrotask(() => {
      if (pending.get(target) !== cancel) return;
      pending.delete(target);
      if (!target.parent) return;
      const maximum = maximumScrollOffset(target);
      native(target).scrollOffset =
        options.clampToOptions === false
          ? Math.max(0, saved)
          : Math.max(0, Math.min(saved, maximum));
      target.requestRender();
    });
  const cancel = () => {
    if (pending.get(target) === cancel) pending.delete(target);
    renderer.off("frame", restore);
  };
  pending.set(target, cancel);
  queueMicrotask(() => {
    if (pending.get(target) !== cancel || !target.parent) return;
    renderer.once("frame", restore);
    renderer.requestRender();
  });
  target.once("destroyed", cancel);
  return cancel;
};

/**
 * Restores the semantic row before restoring the physical viewport that native
 * selection visibility updates. The validity check prevents stale mounts from
 * applying a saved offset after a Collection or tab replacement.
 */
export const restoreSelectState = (
  renderer: Renderer,
  target: SelectRenderable,
  selectedIndex: number,
  savedScroll: number,
  saveScroll: (offset: number) => void,
  isCurrent: () => boolean,
) => {
  let cancelled = false;
  let applyingSelection = false;
  let selectionRestored = false;
  let scrollTelemetryPending = false;
  const clearReplay = () => {
    renderer.off("frame", restoreViewport);
  };
  const telemetry = () => {
    if (cancelled || applyingSelection || !isCurrent()) return;
    clearReplay();
    if (scrollTelemetryPending) return;
    scrollTelemetryPending = true;
    // Let Solid's onChange persist the semantic row before persisting its viewport.
    queueMicrotask(() => {
      scrollTelemetryPending = false;
      if (!cancelled && selectionRestored && isCurrent()) saveScroll(selectScrollOffset(target));
    });
  };
  target.on("selectionChanged", telemetry);
  const restoreViewport = () => {
    if (cancelled || !isCurrent()) return cancel();
    const maximum = maximumScrollOffset(target);
    if (savedScroll >= 0 && savedScroll <= maximum) setSelectScrollOffset(target, savedScroll);
    target.requestRender();
  };
  const cancel = () => {
    cancelled = true;
    clearReplay();
    target.off("selectionChanged", telemetry);
    renderer.off("frame", restoreViewport);
  };
  // A Solid ref runs before native Select properties and parent attachment.
  queueMicrotask(() => {
    if (cancelled || !isCurrent() || !target.parent) return cancel();
    applyingSelection = true;
    if (selectedIndex >= 0 && selectedIndex < target.options.length)
      target.setSelectedIndex(selectedIndex);
    applyingSelection = false;
    selectionRestored = true;
    if (cancelled || !isCurrent()) return cancel();
    renderer.once("frame", restoreViewport);
    renderer.requestRender();
  });
  target.once("destroyed", cancel);
  return Object.assign(cancel, { cancel, isApplyingSelection: () => applyingSelection });
};
