import { expect, test } from "bun:test";
import { createEffect, createRoot } from "solid-js";
import { createLayout } from "../../src/tui/layout";

test("layout derives wide, narrow and too-small facts at the locked boundaries", () => {
  const layout = createLayout();
  layout.resize(100, 12, () => {});
  expect(layout.wide()).toBe(true);
  layout.resize(80, 12, () => {});
  expect(layout.width()).toBe(80);
  expect(layout.height()).toBe(12);
  expect(layout.narrow()).toBe(false);
  expect(layout.wide()).toBe(false);
  expect(layout.tooSmall()).toBe(false);

  layout.resize(79, 12, () => {});
  expect(layout.narrow()).toBe(true);
  expect(layout.tooSmall()).toBe(false);

  for (const [width, height, expected] of [
    [42, 12, true],
    [43, 11, true],
    [43, 12, true],
    [43, 13, false],
    [44, 12, false],
  ] as const) {
    layout.resize(width, height, () => {});
    expect(layout.tooSmall(), `${width}x${height}`).toBe(expected);
  }
});

test("resize publishes dimensions before synchronously reconciling the narrow transition", () => {
  const layout = createLayout();
  const seen: string[] = [];
  layout.resize(120, 24, () => seen.push(`${layout.narrow()}:${layout.tooSmall()}`));
  layout.resize(79, 24, (wasNarrow) => {
    seen.push(`${wasNarrow}:${layout.narrow()}:${layout.width()}`);
  });
  expect(seen).toEqual(["false:false", "false:true:79"]);
});

test("resize publishes only coherent dimension and layout facts", async () => {
  await new Promise<void>((resolve) =>
    createRoot((dispose) => {
      const layout = createLayout();
      const seen: string[] = [];
      createEffect(() =>
        seen.push(`${layout.width()}x${layout.height()}:${layout.narrow()}:${layout.tooSmall()}`),
      );

      queueMicrotask(() => {
        layout.resize(42, 24, () => seen.push(`reconcile:${layout.width()}x${layout.height()}`));
        queueMicrotask(() => {
          layout.resize(120, 11, () => seen.push(`reconcile:${layout.width()}x${layout.height()}`));
          queueMicrotask(() => {
            expect(seen).toEqual([
              "80x12:false:false",
              "reconcile:42x24",
              "42x24:true:true",
              "reconcile:120x11",
              "120x11:false:true",
            ]);
            dispose();
            resolve();
          });
        });
      });
    }),
  );
});
