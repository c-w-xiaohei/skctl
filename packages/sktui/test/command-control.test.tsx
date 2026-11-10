import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { createSignal } from "solid-js";
import { CommandControl } from "../src/command-control";
import type { CommandRecord } from "../src/types";

const command: CommandRecord = {
  id: "open",
  verb: "Open Skill",
  destination: "team/guide",
  keys: ["enter"],
  scope: "page",
  enabled: true,
  danger: false,
};

test("command controls are native buttons, with one activation per native press and live disabled state", async () => {
  const [record, setRecord] = createSignal(command);
  let executions = 0;
  const setup = await testRender(
    () => (
      <CommandControl id="open" record={record()} execute={() => executions++} intent="primary" />
    ),
    { width: 50, height: 8, kittyKeyboard: true },
  );
  try {
    const target = setup.renderer.root.findDescendantById("open")!;
    expect(target).toBeInstanceOf(ButtonRenderable);
    target.focus();
    for (const direction of ["left", "right", "up", "down"] as const) {
      setup.mockInput.pressArrow(direction);
      await setup.renderOnce();
    }
    expect(executions).toBe(0);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(executions).toBe(1);
    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    expect(executions).toBe(2);
    await setup.mockMouse.click(target.screenX + 1, target.screenY);
    await setup.renderOnce();
    expect(executions).toBe(3);
    setRecord({ ...command, enabled: false, disabledReason: "An update is running" });
    await setup.renderOnce();
    expect((target as ButtonRenderable).getState().disabled).toBe(true);
    await setup.mockMouse.click(target.screenX + 1, target.screenY);
    await setup.renderOnce();
    expect(executions).toBe(3);
  } finally {
    setup.renderer.destroy();
  }
});

test("App-owned bindings do not also invoke a native button's keyboard handler", async () => {
  let executions = 0;
  const setup = await testRender(
    () => (
      <CommandControl id="open" record={command} execute={() => executions++} keyboard={false} />
    ),
    { width: 50, height: 8, kittyKeyboard: true },
  );
  try {
    const target = setup.renderer.root.findDescendantById("open")!;
    target.focus();
    setup.mockInput.pressEnter();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(executions).toBe(0);
    await setup.mockMouse.click(target.screenX + 1, target.screenY);
    await setup.renderOnce();
    expect(executions).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("focusing a toolbar command does not schedule scroll work without a scroll ancestor", async () => {
  const setup = await testRender(
    () => <CommandControl id="toolbar-command" record={command} execute={() => {}} />,
    { width: 60, height: 13 },
  );
  try {
    await setup.flush();
    const before = setup.renderer.listenerCount("frame");
    setup.renderer.root.findDescendantById("toolbar-command")!.focus();
    await Promise.resolve();
    expect(setup.renderer.listenerCount("frame")).toBe(before);
  } finally {
    setup.renderer.destroy();
  }
});
