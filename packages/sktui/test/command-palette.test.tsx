/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { InputRenderable, SelectRenderable, TextRenderable } from "@opentui/core";
import { DialogPopupRenderable } from "@tuiparts/core/dialog";
import { createSignal } from "solid-js";
import { CommandPalette } from "../src/command-palette";
import { Button } from "../src/ui/button";
import type { CommandRecord } from "../src/types";

const records = (count: number): CommandRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `action-${index}`,
    verb: `Action ${index}`,
    destination: `Source ${index}`,
    keys: ["enter"],
    scope: "page",
    enabled: true,
    danger: false,
  }));

test.each([
  [80, 24],
  [43, 13],
])(
  "Actions uses the shared popup with contained traversal and restores its origin at %ix%i",
  async (width, height) => {
    const [open, setOpen] = createSignal(false);
    let invoked = 0;
    const setup = await testRender(
      () => (
        <>
          <text>Workspace / Skills</text>
          <input id="origin" focused value="draft" />
          <CommandPalette
            open={open()}
            actions={records(20)}
            onSelect={() => invoked++}
            onClose={() => setOpen(false)}
          />
        </>
      ),
      { width, height, kittyKeyboard: true },
    );
    try {
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "origin");
      setOpen(true);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      const popup = setup.renderer.root.findDescendantById("command-palette-popup");
      expect(popup).toBeInstanceOf(DialogPopupRenderable);
      expect(popup!.width).toBeLessThan(width);
      expect(popup!.height).toBeLessThan(height);
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Workspace / Skills");
      for (const id of ["palette-close", "palette-query", "palette-choices"]) {
        setup.mockInput.pressTab();
        await setup.renderOnce();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
      }
      setup.mockInput.pressTab({ shift: true });
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-query");
      await setup.mockInput.typeText("update");
      expect(invoked).toBe(0);
      setup.mockInput.pressEscape();
      await setup.renderOnce();
      expect(open()).toBe(false);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("origin");
      setOpen(true);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      expect(
        (setup.renderer.root.findDescendantById("palette-query") as InputRenderable).value,
      ).toBe("");
      expect(
        (setup.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.value.id,
      ).toBe("action-0");
      setup.mockInput.pressTab();
      await setup.renderOnce();
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      expect(open()).toBe(false);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("origin");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("live command changes preserve selected identity and execute only the latest eligible record", async () => {
  const initial = records(3);
  const [actions, setActions] = createSignal(initial);
  const invoked: CommandRecord[] = [];
  const setup = await testRender(
    () => (
      <CommandPalette
        open
        actions={actions()}
        onSelect={(record) => invoked.push(record)}
        onClose={() => {}}
      />
    ),
    { width: 70, height: 18, kittyKeyboard: true },
  );
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    const replacement = {
      ...initial[1]!,
      destination: "New target",
      enabled: false,
      disabledReason: "Task is stopping",
    };
    setActions([replacement, initial[2]!]);
    await setup.renderOnce();
    expect(choices.getSelectedOption()?.value).toBe(replacement);
    setup.resize(43, 13);
    await setup.renderOnce();
    expect(choices.getSelectedOption()?.value).toBe(replacement);
    expect(setup.renderer.currentFocusedRenderable === choices).toBe(true);
    expect(
      (setup.renderer.root.findDescendantById("palette-action-reason") as TextRenderable).plainText,
    ).toBe("Task is stopping");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(invoked).toEqual([]);
    const enabled = { ...replacement, enabled: true };
    setActions([enabled, initial[2]!]);
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(invoked).toEqual([enabled]);
    setActions([]);
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(invoked).toEqual([enabled]);
  } finally {
    setup.renderer.destroy();
  }
});

test("popup backdrop and Close dismiss without pressing an underlying control", async () => {
  const [open, setOpen] = createSignal(false);
  let backgroundPresses = 0;
  const setup = await testRender(
    () => (
      <>
        <Button
          id="background-action"
          label="Underlying action"
          onPress={() => backgroundPresses++}
        />
        <CommandPalette
          open={open()}
          actions={records(3)}
          onSelect={() => {}}
          onClose={() => setOpen(false)}
        />
      </>
    ),
    { width: 70, height: 18, kittyKeyboard: true },
  );
  try {
    const origin = setup.renderer.root.findDescendantById("background-action")!;
    origin.focus();
    setOpen(true);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    await setup.renderOnce();
    await setup.mockMouse.click(0, 0);
    await setup.renderOnce();
    expect({
      stage: "backdrop",
      open: open(),
      focused: setup.renderer.currentFocusedRenderable?.id,
    }).toEqual({ stage: "backdrop", open: false, focused: "background-action" });
    expect(backgroundPresses).toBe(0);
    expect(setup.renderer.currentFocusedRenderable === origin).toBe(true);
    setOpen(true);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    await setup.renderOnce();
    const close = setup.renderer.root.findDescendantById("palette-close")!;
    await setup.mockMouse.click(close.screenX + 1, close.screenY);
    await setup.renderOnce();
    expect({ stage: "close", open: open() }).toEqual({ stage: "close", open: false });
    expect(backgroundPresses).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
