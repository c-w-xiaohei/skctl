import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ModalControlScope } from "../src/modal-controls";
import { ModalCommand } from "../src/operations";
import { CommandPalette } from "../src/command-palette";
import type { CommandRecord } from "../src/types";

const records = (count: number): CommandRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `choice-${index}`,
    keys: ["enter"],
    verb: `Command ${index}`,
    destination: `Object ${index}`,
    scope: "modal",
    enabled: true,
    danger: index === count - 1,
  }));

test("mounted ModalControlScope clamps eight commands without activating the boundary", async () => {
  const commands = records(8);
  const activated: CommandRecord[] = [];
  const setup = await testRender(
    () => (
      <ModalControlScope>
        <scrollbox id="long-controls" height={8} contentOptions={{ flexDirection: "column" }}>
          {commands.map((record, index) => (
            <ModalCommand
              id={record.id}
              record={record}
              initialFocus={index === 0}
              execute={() => activated.push(record)}
            />
          ))}
        </scrollbox>
      </ModalControlScope>
    ),
    { width: 60, height: 12, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === commands[0]!.id);
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(commands[0]!.id);
    for (let index = 1; index < commands.length; index++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(commands[index]!.id);
    }
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(commands[7]!.id);
    const scroll = setup.renderer.root.findDescendantById("long-controls");
    expect(scroll).toBeInstanceOf(ScrollBoxRenderable);
    if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Missing native scroll viewport");
    const focused = setup.renderer.currentFocusedRenderable!;
    await setup.waitFor(
      () =>
        focused.screenY >= scroll.viewport.screenY &&
        focused.screenY + focused.height <= scroll.viewport.screenY + scroll.viewport.height,
    );
    expect(activated).toEqual([]);
    for (const modifiers of [
      { ctrl: true },
      { meta: true },
      { shift: true },
      { super: true },
      { hyper: true },
    ]) {
      setup.mockInput.pressEnter(modifiers);
      await setup.renderOnce();
    }
    expect(activated).toEqual([]);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(activated).toEqual([commands[7]!]);
  } finally {
    setup.renderer.destroy();
  }
});

test("reverse Tab from an unregistered field enters the last live modal control", async () => {
  const commands = records(3);
  const setup = await testRender(
    () => (
      <ModalControlScope>
        <box flexDirection="column">
          <input id="unregistered-field" focused />
          {commands.map((record) => (
            <ModalCommand id={record.id} record={record} execute={() => {}} />
          ))}
        </box>
      </ModalControlScope>
    ),
    { width: 60, height: 12, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "unregistered-field");
    setup.mockInput.pressTab({ shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("choice-2");
  } finally {
    setup.renderer.destroy();
  }
});

test("short palette scrolls one native list and invokes exactly the selected authoritative record", async () => {
  const commands = records(20);
  commands[1] = { ...commands[1]!, enabled: false };
  const activated: CommandRecord[] = [];
  let closed = 0;
  const setup = await testRender(
    () => (
      <CommandPalette
        open
        actions={commands}
        onSelect={(record) => activated.push(record)}
        onClose={() => closed++}
      />
    ),
    { width: 60, height: 12, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable;
    expect(choices).toBeInstanceOf(SelectRenderable);
    if (!(choices instanceof SelectRenderable))
      throw new Error("Palette must mount its native Select");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    // Arrow keys stay within the list; Tab changes regions.
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-choices");
    expect(choices.getSelectedOption()?.value).toBe(commands[0]);
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(activated).toEqual([]);
    for (let index = 1; index < commands.length - 1; index++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    expect(choices.getSelectedOption()?.value).toBe(commands.at(-1));
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-choices");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-choices");
    expect(activated).toEqual([]);
    for (const modifiers of [
      { ctrl: true },
      { meta: true },
      { shift: true },
      { super: true },
      { hyper: true },
    ]) {
      setup.mockInput.pressEnter(modifiers);
      await setup.renderOnce();
    }
    expect(activated).toEqual([]);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(activated).toEqual([commands.at(-1)!]);
    expect(choices.height).toBeLessThan(commands.length);
    setup.mockInput.pressKey("ESCAPE");
    await setup.renderOnce();
    expect(closed).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
