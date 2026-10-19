import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ModalControlScope, useModalControl } from "../src/modal-controls";
import { ModalCommand } from "../src/operations";
import type { CommandRecord } from "../src/types";

const cancel: CommandRecord = {
  id: "cancel",
  keys: ["enter"],
  verb: "Cancel",
  destination: "Close",
  scope: "modal",
  enabled: true,
  danger: false,
};

test("Tab and Shift+Tab traverse modal controls without escaping or activating them", async () => {
  let cancelled = 0;
  function Field() {
    const register = useModalControl("field");
    return <input id="field" ref={register} focused value="abc" />;
  }
  const setup = await testRender(
    () => (
      <ModalControlScope>
        <box flexDirection="column">
          <Field />
          <ModalCommand id="cancel" record={cancel} execute={() => cancelled++} />
        </box>
      </ModalControlScope>
    ),
    { width: 40, height: 8, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "field");
    await setup.mockInput.pressTab();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("cancel");
    await setup.mockInput.pressTab({ shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("field");
    expect(cancelled).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
