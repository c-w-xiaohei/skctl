import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ModalCommand } from "../src/operations";
import { focusLive, parsedEnter } from "./reader-test-controls";

test("a command's physical focus cue follows focus and preserves its danger label", async () => {
  let executions = 0;
  const setup = await testRender(
    () => (
      <box flexDirection="column">
        <ModalCommand
          id="cancel"
          record={{
            id: "cancel",
            keys: ["enter"],
            verb: "Cancel",
            destination: "Keep content",
            scope: "modal",
            enabled: true,
            danger: false,
          }}
          initialFocus
          execute={() => {}}
        />
        <ModalCommand
          id="remove"
          record={{
            id: "remove",
            keys: ["enter"],
            verb: "Remove",
            destination: "Apply reviewed removal",
            scope: "modal",
            enabled: true,
            danger: true,
          }}
          execute={() => executions++}
        />
      </box>
    ),
    { width: 80, height: 12 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes(">Cancel -> Keep content<"));
    await focusLive(setup, "remove");
    await setup.waitForFrame((frame) =>
      frame.includes(">DANGER Remove -> Apply reviewed removal<"),
    );
    expect(setup.captureCharFrame()).not.toContain(">Cancel");
    await parsedEnter(setup);
    expect(executions).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
