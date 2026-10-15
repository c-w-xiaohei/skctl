/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { InputRenderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { Badge } from "../../src/ui/badge";
import { Button } from "../../src/ui/button";
import { CheckboxGroup, CheckboxGroupItem } from "../../src/ui/checkbox-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../src/ui/dialog";
import { Input } from "../../src/ui/input";
import { RadioGroup, RadioGroupItem } from "../../src/ui/radio-group";
import { createThemeStore, terminal } from "../../src/ui/theme";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

test("W1 recipe mount: Input, Button, Radio, Checkbox, Badge, and Theme", async () => {
  const [radio, setRadio] = createSignal<string | null>("one");
  const [checked, setChecked] = createSignal<readonly string[]>(["one"]);
  setup = await testRender(
    () => (
      <box flexDirection="column">
        <Input id="input" value="" />
        <Button id="button" label="Run" onPress={() => {}} />
        <RadioGroup value={radio()} onValueChange={setRadio}>
          <RadioGroupItem id="radio-one" value="one" label="One" />
          <RadioGroupItem id="radio-two" value="two" label="Two" />
        </RadioGroup>
        <CheckboxGroup value={checked()} onValueChange={setChecked}>
          <CheckboxGroupItem id="check-one" value="one" label="One" />
          <CheckboxGroupItem id="check-two" value="two" label="Two" />
        </CheckboxGroup>
        <Badge id="badge" label="Ready" />
      </box>
    ),
    { width: 60, height: 16 },
  );
  expect(setup.renderer.root.findDescendantById("input")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("button")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("radio-one")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("check-one")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("badge")).toBeDefined();
  const store = createThemeStore({ base: terminal });
  expect(store.get().colors.foreground).toBe(terminal.colors.foreground);
});

test("W1 Input edits and submits, Button activates once per Enter, Space, and mouse press while disabled is inert", async () => {
  const inputs: string[] = [];
  const submits: string[] = [];
  let presses = 0;
  setup = await testRender(
    () => (
      <box>
        <Input
          id="input"
          value="A"
          onInput={(value) => inputs.push(value)}
          onSubmit={(value) => submits.push(value)}
        />
        <Button id="button" label="Run" onPress={() => presses++} />
        <Button id="disabled" label="Disabled" disabled onPress={() => presses++} />
      </box>
    ),
    { width: 50, height: 6 },
  );
  setup.renderer.root.findDescendantById("input")?.focus();
  await setup.mockInput.typeText("B");
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(inputs).toEqual(["AB"]);
  expect(submits).toEqual(["AB"]);
  setup.renderer.root.findDescendantById("button")?.focus();
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(presses).toBe(1);
  setup.mockInput.pressKey(" ");
  await setup.renderOnce();
  expect(presses).toBe(2);
  const button = setup.renderer.root.findDescendantById("button");
  await setup.mockMouse.click(button!.screenX + 1, button!.screenY);
  await setup.renderOnce();
  expect(presses).toBe(3);
  const disabled = setup.renderer.root.findDescendantById("disabled") as
    | { press(): void }
    | undefined;
  disabled?.press();
  expect(presses).toBe(3);
});

test("W1 Radio and Checkbox recipes use keyboard selection", async () => {
  const [radio, setRadio] = createSignal<string | null>("one");
  const [checked, setChecked] = createSignal<readonly string[]>([]);
  setup = await testRender(
    () => (
      <box>
        <RadioGroup value={radio()} onValueChange={setRadio}>
          <RadioGroupItem id="radio-one" value="one" label="One" />
          <RadioGroupItem id="radio-two" value="two" label="Two" />
        </RadioGroup>
        <CheckboxGroup value={checked()} onValueChange={setChecked}>
          <CheckboxGroupItem id="check-one" value="one" label="One" />
          <CheckboxGroupItem id="check-two" value="two" label="Two" />
        </CheckboxGroup>
      </box>
    ),
    { width: 50, height: 8 },
  );
  setup.renderer.root.findDescendantById("radio-one")?.focus();
  setup.mockInput.pressArrow("down");
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("radio-two");
  setup.mockInput.pressKey(" ");
  await setup.renderOnce();
  expect(radio()).toBe("two");
  setup.renderer.root.findDescendantById("check-one")?.focus();
  setup.mockInput.pressKey(" ");
  await setup.renderOnce();
  expect(checked()).toEqual(["one"]);
});

test("W1 Dialog is controlled, contains focus, and requests Escape dismissal", async () => {
  const changes: string[] = [];
  const [open, setOpen] = createSignal(true);
  setup = await testRender(
    () => (
      <Dialog
        open={open()}
        onOpenChange={(next, details) => {
          changes.push(`${next}:${details.reason}`);
          setOpen(next);
        }}
      >
        <DialogTrigger id="trigger" />
        <DialogContent id="dialog-content">
          <DialogTitle content="Dialog" />
          <DialogDescription content="Description" />
          <DialogClose id="close">
            <text content="Close" />
          </DialogClose>
        </DialogContent>
      </Dialog>
    ),
    { width: 50, height: 10 },
  );
  const dialogSetup = setup;
  await dialogSetup.waitFor(
    () => dialogSetup.renderer.root.findDescendantById("close") !== undefined,
  );
  expect(dialogSetup.renderer.currentFocusedRenderable?.id).toBe("dialog-content");
  dialogSetup.mockInput.pressTab();
  await dialogSetup.renderOnce();
  expect(dialogSetup.renderer.currentFocusedRenderable?.id).toBe("close");
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name === "tab") {
        dialogSetup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    dialogSetup.renderer.keyInput.prependListener("keypress", listener);
    dialogSetup.mockInput.pressTab();
  });
  await dialogSetup.renderOnce();
  expect(dialogSetup.renderer.currentFocusedRenderable?.id).toBe("close");
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        dialogSetup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    dialogSetup.renderer.keyInput.prependListener("keypress", listener);
    dialogSetup.mockInput.pressKey("ESCAPE");
  });
  await dialogSetup.renderOnce();
  expect(changes).toEqual(["false:escape"]);
  expect(open()).toBe(false);
});

test("Dialog geometry updates retain the same child, editing draft and focus", async () => {
  const [width, setWidth] = createSignal(44);
  setup = await testRender(
    () => (
      <Dialog open>
        <DialogContent width={width()}>
          <Input id="dialog-draft" value="Draft" />
        </DialogContent>
      </Dialog>
    ),
    { width: 70, height: 18 },
  );
  const input = setup.renderer.root.findDescendantById("dialog-draft")!;
  input.focus();
  await setup.mockInput.typeText(" changed");
  const before = setup.renderer.currentFocusedRenderable;
  setWidth(36);
  await setup.renderOnce();
  expect(setup.renderer.root.findDescendantById("dialog-draft") === input).toBe(true);
  expect(setup.renderer.currentFocusedRenderable === before).toBe(true);
  expect((input as InputRenderable).value).toBe("Draft changed");
});
