import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SourceRegistrationOverlay } from "../src/operations";

test("Source form stays one Tab panel and fields remain reachable with arrows", async () => {
  const writes: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        pending={false}
        onSubmit={(value) => writes.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 80, height: 25 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-level",
    );
    for (let step = 0; step < 6; step++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-register-id");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-id");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("source-register-id");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-id");
    expect(writes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
