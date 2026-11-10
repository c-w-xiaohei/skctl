import type { CliRenderer } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, type Accessor } from "solid-js";

const sizes = new WeakMap<
  CliRenderer,
  {
    value: Accessor<{ width: number; height: number }>;
    resize: (width: number, height: number) => void;
    users: number;
  }
>();

/** One live size source per renderer, released with its last consumer. */
export function useTerminalSize() {
  const renderer = useRenderer();
  let size = sizes.get(renderer);
  if (!size) {
    const [value, setValue] = createSignal({ width: renderer.width, height: renderer.height });
    size = { value, resize: (width, height) => setValue({ width, height }), users: 0 };
    sizes.set(renderer, size);
    renderer.on("resize", size.resize);
  }
  const shared = size;
  shared.users++;
  onCleanup(() => {
    if (--shared.users === 0) {
      renderer.off("resize", shared.resize);
      sizes.delete(renderer);
    }
  });
  return shared.value;
}
