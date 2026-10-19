import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

let leakedDestroyCalls = 0;
let explicitDestroyCalls = 0;
let repeatedDestroyCalls = 0;

test.failing("test renderer cleanup runs when a test throws before local cleanup", async () => {
  await testRender(() => undefined as never, {
    height: 1,
    onDestroy: () => leakedDestroyCalls++,
    width: 1,
  });
  throw new Error("interrupted test");
});

test("global cleanup destroyed the renderer from the interrupted test", () => {
  expect(leakedDestroyCalls).toBe(1);
});

test("explicit renderer destruction is not repeated by cleanup", async () => {
  const setup = await testRender(() => undefined as never, {
    height: 1,
    onDestroy: () => explicitDestroyCalls++,
    width: 1,
  });

  setup.renderer.destroy();
  expect(explicitDestroyCalls).toBe(1);
});

test("cleanup does not double-destroy an explicitly released renderer", () => {
  expect(explicitDestroyCalls).toBe(1);
});

for (let index = 0; index < 64; index++) {
  test(`renderer cycle ${index + 1} releases the preceding renderer`, async () => {
    expect(repeatedDestroyCalls).toBe(index);
    await testRender(() => undefined as never, {
      height: 1,
      onDestroy: () => repeatedDestroyCalls++,
      width: 1,
    });
  });
}

test("repeated renderer cycles release every native renderer", () => {
  expect(repeatedDestroyCalls).toBe(64);
});
