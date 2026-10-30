import {
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextareaRenderable,
  type KeyEvent,
  type Renderable,
} from "@opentui/core";
import { createContext, onCleanup, useContext, type JSX } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";

export interface ModalControlRegistry {
  intercept(handler: (event: KeyEvent, current: Renderable | null) => boolean): () => void;
  handleKey(event: KeyEvent, current: Renderable | null): boolean;
  register(id: string, target: Renderable, order?: number, isFocusable?: () => boolean): () => void;
  unregister(id: string, target: Renderable): void;
  focusNext(
    current: Renderable | null,
    reverse: boolean,
    allowUnregistered?: boolean,
    wrap?: boolean,
  ): boolean;
}

export function createModalControlRegistry(): ModalControlRegistry {
  let interceptor: ((event: KeyEvent, current: Renderable | null) => boolean) | undefined;
  const controls: {
    id: string;
    target: Renderable;
    order?: number;
    sequence: number;
    token: object;
    isFocusable: () => boolean;
    attached: boolean;
  }[] = [];
  let sequence = 0;
  const sortControls = () => {
    controls.sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined)
        return left.order - right.order || left.sequence - right.sequence;
      if (left.order !== undefined) return -1;
      if (right.order !== undefined) return 1;
      return left.sequence - right.sequence;
    });
  };
  const isDestroyed = (target: Renderable) => target.isDestroyed === true;
  const pruneUnavailable = () => {
    for (let index = controls.length - 1; index >= 0; index--) {
      const control = controls[index]!;
      if (control.target.parent !== undefined && control.target.parent !== null)
        control.attached = true;
      if (isDestroyed(control.target) || (control.attached && control.target.parent === null))
        controls.splice(index, 1);
    }
  };
  return {
    intercept(handler) {
      interceptor = handler;
      return () => {
        if (interceptor === handler) interceptor = undefined;
      };
    },
    handleKey: (event, current) => interceptor?.(event, current) ?? false,
    register(id, target, order, isFocusable = () => true) {
      const existing = controls.findIndex((control) => control.id === id);
      const token = {};
      if (existing >= 0) {
        const control = controls[existing]!;
        control.target = target;
        control.token = token;
        control.isFocusable = isFocusable;
        if (order !== undefined) control.order = order;
        control.attached = target.parent !== undefined && target.parent !== null;
        sortControls();
        return () => {
          const current = controls.findIndex(
            (candidate) => candidate.id === id && candidate.token === token,
          );
          if (current >= 0) controls.splice(current, 1);
        };
      }
      controls.push({
        id,
        target,
        ...(order === undefined ? {} : { order }),
        sequence: sequence++,
        token,
        isFocusable,
        attached: target.parent !== undefined && target.parent !== null,
      });
      sortControls();
      return () => {
        const current = controls.findIndex(
          (candidate) => candidate.id === id && candidate.token === token,
        );
        if (current >= 0) controls.splice(current, 1);
      };
    },
    unregister(id, target) {
      const index = controls.findIndex((control) => control.id === id && control.target === target);
      if (index >= 0) controls.splice(index, 1);
    },
    focusNext(current, reverse, allowUnregistered = false, wrap = true) {
      pruneUnavailable();
      const focusable = controls.filter((control) => control.isFocusable());
      if (!focusable.length) return false;
      const index = focusable.findIndex(
        (control) =>
          control.target === current ||
          control.target.id === current?.id ||
          control.id === current?.id,
      );
      if (index < 0 && current && !allowUnregistered) return false;
      const proposed =
        index < 0 ? (reverse ? focusable.length - 1 : 0) : index + (reverse ? -1 : 1);
      const nextIndex = wrap
        ? (proposed + focusable.length) % focusable.length
        : Math.max(0, Math.min(focusable.length - 1, proposed));
      const next = focusable[nextIndex]!;
      next.target.focus();
      return true;
    },
  };
}

const ModalControlsContext = createContext<ModalControlRegistry>();

export const ModalControlsProvider = ModalControlsContext.Provider;

export const useModalControls = () => useContext(ModalControlsContext);

/** A standalone owner for controls that do not already have an overlay-local registry. */
export function ModalControlScope(props: { readonly children: JSX.Element }) {
  const registry = createModalControlRegistry();
  useModalControlTraversal(registry);
  return <ModalControlsProvider value={registry}>{props.children}</ModalControlsProvider>;
}

/** Registers one mounted control in the current overlay's physical Tab order. */
export function useModalControl(
  id: string,
  local?: ModalControlRegistry,
  order?: number,
  isFocusable?: () => boolean,
) {
  const registry = local ?? useContext(ModalControlsContext);
  const renderer = useRenderer();
  return (target: Renderable) => {
    let unregister: (() => void) | undefined;
    const reveal = () => {
      if (target.isDestroyed || renderer.currentFocusedRenderable !== target) return;
      for (let ancestor = target.parent; ancestor; ancestor = ancestor.parent)
        if (ancestor instanceof ScrollBoxRenderable) ancestor.scrollChildIntoView(target.id);
    };
    const focused = () => {
      renderer.off("frame", reveal);
      renderer.once("frame", reveal);
      renderer.requestRender();
    };
    if (target instanceof InputRenderable || target instanceof SelectRenderable)
      target.on("focused", focused);
    queueMicrotask(() => {
      if (target.isDestroyed) return;
      unregister = registry?.register(id, target, order, isFocusable);
    });
    onCleanup(() => {
      unregister?.();
      target.off("focused", focused);
      renderer.off("frame", reveal);
    });
  };
}

/** OpenTUI 0.5 exposes Alt as meta/option, not an `alt` field. */
export function hasModalKeyModifier(event: KeyEvent, allowShift = false) {
  return (
    event.ctrl ||
    event.meta ||
    event.option ||
    event.super ||
    event.hyper ||
    (!allowShift && event.shift)
  );
}

/** Single traversal policy shared by local overlays and App's inline-form fallback. */
export function traverseModalControls(
  registry: ModalControlRegistry,
  current: Renderable | null,
  event: KeyEvent,
  allowUnregistered = false,
) {
  const key = event.name.toLowerCase().replace(/^arrow[_-]?/, "");
  if (event.defaultPrevented) return false;
  if (
    (key === "return" || key === "enter") &&
    current instanceof SelectRenderable &&
    hasModalKeyModifier(event)
  ) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (hasModalKeyModifier(event, key === "tab")) return false;
  if (key === "right" && current instanceof SelectRenderable) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (key === "tab") {
    if (!registry.focusNext(current, event.shift, allowUnregistered)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (key !== "up" && key !== "down") return false;
  if (current instanceof InputRenderable || current instanceof TextareaRenderable) return false;
  if (current instanceof SelectRenderable || current instanceof ScrollBoxRenderable) return false;
  if (!registry.focusNext(current, key === "up", allowUnregistered, false)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** App owns cancellation precedence; standalone overlays use the same safe callback. */
export function useModalControlTraversal(
  local?: ModalControlRegistry,
  onEscape?: () => void,
  allowUnregistered = !!local,
) {
  const registry = local ?? useContext(ModalControlsContext);
  const renderer = useRenderer();
  useKeyboard((event) => {
    const key = event.name.toLowerCase().replace(/^arrow[_-]?/, "");
    const current = renderer.currentFocusedRenderable;
    if (!event.defaultPrevented && registry?.handleKey(event, current)) return;
    if (!event.defaultPrevented && !hasModalKeyModifier(event) && onEscape && key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (registry) traverseModalControls(registry, current, event, allowUnregistered);
  });
}
