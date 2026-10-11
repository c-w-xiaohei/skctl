import { batch, createMemo, createSignal, type Accessor } from "solid-js";
import type { LayoutMode } from "./types";

export interface Layout {
  readonly width: Accessor<number>;
  readonly height: Accessor<number>;
  readonly mode: Accessor<LayoutMode>;
  readonly wide: Accessor<boolean>;
  readonly narrow: Accessor<boolean>;
  readonly tooSmall: Accessor<boolean>;
  resize(width: number, height: number, reconcileNarrow: (wasNarrow: boolean) => void): void;
}

export function createLayout(): Layout {
  const [width, setWidth] = createSignal(80);
  const [height, setHeight] = createSignal(12);
  const tooSmall = createMemo(
    () => width() < 43 || height() < 12 || (width() === 43 && height() === 12),
  );
  const mode = createMemo<LayoutMode>(() =>
    tooSmall() ? "too-small" : width() >= 100 ? "wide" : width() >= 64 ? "medium" : "narrow",
  );
  const wide = createMemo(() => mode() === "wide");
  const narrow = createMemo(() => mode() === "narrow");
  return {
    width,
    height,
    mode,
    wide,
    narrow,
    tooSmall,
    resize(nextWidth, nextHeight, reconcileNarrow) {
      const wasNarrow = narrow();
      batch(() => {
        setWidth(nextWidth);
        setHeight(nextHeight);
        reconcileNarrow(wasNarrow);
      });
    },
  };
}
