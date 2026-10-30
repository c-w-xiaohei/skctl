import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SourceRegistrationOverlay } from "../src/operations";

test("Source form uses Tab between fields and arrows stay within controls", async () => {
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
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    for (let step = 0; step < 6; step++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-origin");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-id");
    setup.mockInput.pressTab({ shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-origin");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-origin");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-origin");
    expect(writes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
