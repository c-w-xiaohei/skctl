import { ScrollBoxRenderable } from "@opentui/core";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { CommandControl } from "../src/command-control";

test("focused commands reveal themselves without stealing arrows or resetting visible scroll", async () => {
  let executions = 0;
  const setup = await testRender(
    () => (
      <scrollbox id="commands" height={5}>
        <box flexDirection="column">
          {Array.from({ length: 12 }, (_, index) => (
            <text>{`preceding line ${index}`}</text>
          ))}
          <CommandControl
            id="target-command"
            record={{
              id: "target-command",
              keys: ["enter"],
              verb: "Open",
              destination: "Open selected item",
              scope: "page",
              enabled: true,
              danger: false,
            }}
            execute={() => executions++}
          />
          {Array.from({ length: 5 }, (_, index) => (
            <text>{`following line ${index}`}</text>
          ))}
        </box>
      </scrollbox>
    ),
    { width: 60, height: 6, kittyKeyboard: true },
  );

  try {
    await setup.renderOnce();
    const target = setup.renderer.root.findDescendantById("target-command");
    const scrollbox = setup.renderer.root.findDescendantById("commands");
    expect(target).toBeDefined();
    expect(scrollbox).toBeInstanceOf(ScrollBoxRenderable);
    const viewport = (scrollbox as ScrollBoxRenderable).viewport;

    target!.focus();
    await setup.waitFor(
      () =>
        target!.screenY >= viewport.screenY &&
        target!.screenY + target!.height <= viewport.screenY + viewport.height,
    );
    expect((scrollbox as ScrollBoxRenderable).scrollTop).toBeGreaterThan(0);

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(executions).toBe(0);

    setup.mockInput.pressEnter({ ctrl: true });
    await setup.renderOnce();
    expect(executions).toBe(0);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(executions).toBe(1);

    const scroll = scrollbox as ScrollBoxRenderable;
    const before = scroll.scrollTop;
    scroll.scrollTop = before + 1;
    await setup.renderOnce();
    const userScroll = scroll.scrollTop;
    expect(
      target!.screenY >= viewport.screenY &&
        target!.screenY + target!.height <= viewport.screenY + viewport.height,
    ).toBe(true);
    target!.focus();
    await setup.renderOnce();
    expect(scroll.scrollTop).toBe(userScroll);
  } finally {
    setup.renderer.destroy();
  }
});
