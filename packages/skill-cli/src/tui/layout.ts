import { batch, createMemo, createSignal, type Accessor } from "solid-js";

export interface Layout {
  readonly width: Accessor<number>;
  readonly height: Accessor<number>;
  readonly wide: Accessor<boolean>;
  readonly narrow: Accessor<boolean>;
  readonly tooSmall: Accessor<boolean>;
  resize(width: number, height: number, reconcileNarrow: (wasNarrow: boolean) => void): void;
}

export function createLayout(): Layout {
  const [width, setWidth] = createSignal(80);
  const [height, setHeight] = createSignal(12);
  const wide = createMemo(() => width() >= 100);
  const narrow = createMemo(() => width() < 80);
  const tooSmall = createMemo(
    () => width() < 43 || height() < 12 || (width() === 43 && height() === 12),
  );
  return {
    width,
    height,
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
