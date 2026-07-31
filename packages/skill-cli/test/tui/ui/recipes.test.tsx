/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { Badge } from "../../../src/tui/ui/badge";
import { Button } from "../../../src/tui/ui/button";
import { CheckboxGroup, CheckboxGroupItem } from "../../../src/tui/ui/checkbox-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../../src/tui/ui/dialog";
import { Input } from "../../../src/tui/ui/input";
import { RadioGroup, RadioGroupItem } from "../../../src/tui/ui/radio-group";
import { Tabs, TabsList, TabsTrigger } from "../../../src/tui/ui/tabs";
import { createThemeStore, terminal } from "../../../src/tui/ui/theme";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

test("W1 recipe mount: Tabs list-only, Input, Button, Radio, Checkbox, Badge, and Theme", async () => {
  const [tab, setTab] = createSignal("one");
  const [radio, setRadio] = createSignal<string | null>("one");
  const [checked, setChecked] = createSignal<readonly string[]>(["one"]);
  setup = await testRender(
    () => (
      <box flexDirection="column">
        <Tabs value={tab()} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger id="tab-one" value="one" label="One" />
            <TabsTrigger id="tab-two" value="two" label="Two" />
          </TabsList>
        </Tabs>
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
  expect(setup.renderer.root.findDescendantById("tab-one")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("input")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("button")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("radio-one")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("check-one")).toBeDefined();
  expect(setup.renderer.root.findDescendantById("badge")).toBeDefined();
  const store = createThemeStore({ base: terminal });
  expect(store.get().colors.foreground).toBe(terminal.colors.foreground);
});

test("W1 Tabs controlled selection responds to arrows, Home, and End", async () => {
  const [value, setValue] = createSignal("one");
  setup = await testRender(
    () => (
      <Tabs value={value()} onValueChange={setValue}>
        <TabsList>
          <TabsTrigger id="tab-one" value="one" label="One" />
          <TabsTrigger id="tab-two" value="two" label="Two" />
          <TabsTrigger id="tab-three" value="three" label="Three" />
        </TabsList>
      </Tabs>
    ),
    { width: 50, height: 4 },
  );
  setup.renderer.root.findDescendantById("tab-one")?.focus();
  setup.mockInput.pressArrow("right");
  await setup.renderOnce();
  expect(value()).toBe("two");
  setup.mockInput.pressKey("END");
  await setup.renderOnce();
  expect(value()).toBe("three");
  setup.mockInput.pressKey("HOME");
  await setup.renderOnce();
  expect(value()).toBe("one");
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
