import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ModalControlScope, useModalControl } from "../src/modal-controls";
import { ModalCommand } from "../src/operations";
import { ModalBody, ModalShell } from "../src/operations/modal";
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

test("modal fields outside scroll containers do not schedule focus reveal frames", async () => {
  const setup = await testRender(
    () => {
      const register = useModalControl("field");
      return <input id="field" ref={register} />;
    },
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const baseline = setup.renderer.listenerCount("frame");
    setup.renderer.root.findDescendantById("field")!.focus();
    expect(setup.renderer.listenerCount("frame")).toBe(baseline);
  } finally {
    setup.renderer.destroy();
  }
});

test("modal focus reveal discards blurred fields and reveals the current field", async () => {
  const setup = await testRender(
    () => {
      const first = useModalControl("first");
      const last = useModalControl("last");
      return (
        <scrollbox id="fields" height={4} contentOptions={{ flexDirection: "column" }}>
          <input id="first" ref={first} />
          <text height={12}>Long form</text>
          <input id="last" ref={last} />
        </scrollbox>
      );
    },
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const baseline = setup.renderer.listenerCount("frame");
    setup.renderer.root.findDescendantById("first")!.focus();
    setup.renderer.root.findDescendantById("last")!.focus();
    expect(setup.renderer.listenerCount("frame") - baseline).toBe(1);
    await setup.flush();
    const body = setup.renderer.root.findDescendantById("fields") as ScrollBoxRenderable;
    const last = setup.renderer.root.findDescendantById("last")!;
    expect(last.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
    expect(last.screenY + last.height).toBeLessThanOrEqual(
      body.viewport.screenY + body.viewport.height,
    );
    expect(setup.renderer.listenerCount("frame")).toBe(baseline);
  } finally {
    setup.renderer.destroy();
  }
});

test("short task canvas preserves six body rows and fixed submission controls at 43x13", async () => {
  const setup = await testRender(
    () => (
      <ModalShell>
        <ModalBody
          header={
            <>
              <text height={1}>Review Collection changes</text>
              <text height={1}>Project: team</text>
              <text height={1}>3 entries</text>
            </>
          }
          footer={
            <text id="task-submit" height={1}>
              Save / Cancel
            </text>
          }
        >
          <text id="task-content" wrapMode="word">
            {Array.from({ length: 30 }, (_, i) => `Change ${i}`).join("\n")}
          </text>
        </ModalBody>
      </ModalShell>
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const content = setup.renderer.root.findDescendantById("task-content")!;
    let parent = content.parent;
    while (parent && !(parent instanceof ScrollBoxRenderable)) parent = parent.parent;
    expect(parent instanceof ScrollBoxRenderable).toBe(true);
    const body = parent as ScrollBoxRenderable;
    expect(body.viewport.height).toBeGreaterThanOrEqual(6);
    const footer = setup.renderer.root.findDescendantById("task-submit")!;
    const y = footer.screenY;
    body.scrollTo(20);
    await setup.flush();
    expect(footer.screenY).toBe(y);
    expect(y + footer.height).toBeLessThanOrEqual(12);
  } finally {
    setup.renderer.destroy();
  }
});

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
