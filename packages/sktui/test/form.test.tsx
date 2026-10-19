/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import {
  InputRenderable,
  parseColor,
  Renderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { createSignal, onMount, Show } from "solid-js";
import { Button } from "../src/ui/button";
import { DataList } from "../src/ui/data-list";
import { Form, FormField } from "../src/ui/form";
import { Input } from "../src/ui/input";
import { theme } from "../src/ui/theme";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
interface Presentation {
  help?: string;
  error?: string;
  disabled?: boolean;
  disabledReason?: string;
}
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

function find(id: string): Renderable {
  const target = setup!.renderer.root.findDescendantById(id);
  if (!target) throw new Error(`Missing ${id}`);
  return target;
}

function texts(root: Renderable): TextRenderable[] {
  return root
    .getChildren()
    .flatMap((child) =>
      child instanceof TextRenderable ? [child] : child instanceof Renderable ? texts(child) : [],
    );
}

function expectWithin(target: Renderable, owner: Renderable) {
  expect(target.width).toBeGreaterThan(0);
  expect(target.height).toBeGreaterThan(0);
  expect(target.screenX).toBeGreaterThanOrEqual(owner.screenX);
  expect(target.screenY).toBeGreaterThanOrEqual(owner.screenY);
  expect(target.screenX + target.width).toBeLessThanOrEqual(owner.screenX + owner.width);
  expect(target.screenY + target.height).toBeLessThanOrEqual(owner.screenY + owner.height);
}

test("optional Form slots reserve no rows and do not remount body controls", async () => {
  let showSlots!: (value: boolean) => void;
  let input!: InputRenderable;
  let action!: ButtonRenderable;
  setup = await testRender(
    () => {
      const [visible, setVisible] = createSignal(false);
      showSlots = setVisible;
      return (
        <Form
          id="form"
          width="100%"
          height="100%"
          header={
            <Show when={visible()}>
              <text id="header">Edit filters</text>
            </Show>
          }
          error={visible() ? "Choose an available value" : undefined}
          actions={
            <Show when={visible()}>
              <Button id="action" label="Clear" ref={(target) => (action = target)} />
            </Show>
          }
        >
          <Input id="input" ref={(target) => (input = target)} />
        </Form>
      );
    },
    { width: 43, height: 13 },
  );
  await setup.renderOnce();
  const form = find("form");
  const originalInput = input;
  // Universal JSX may retain zero-size anchors; verify usable rows, not internal child count.
  expect(input.parent?.height).toBe(form.height);
  expect(input.screenY).toBe(form.screenY);
  input.focus();
  setup.mockInput.pressKey("x");
  await setup.renderOnce();
  expect(input.value).toBe("x");

  showSlots(true);
  await setup.renderOnce();
  const header = find("header");
  const error = texts(form).find((text) => text.plainText.startsWith("Error:"))!;
  expect(header.screenY).toBe(form.screenY);
  expect(input.screenY).toBe(header.screenY + header.height);
  expect(error.screenY + error.height).toBe(action.screenY);
  expect(action.screenY + action.height).toBe(form.screenY + form.height);
  expect(find("input")).toBe(originalInput);
  expect(input.value).toBe("x");
  expect(setup.renderer.currentFocusedRenderable).toBe(input);
  const originalAction = action;
  action.focus();
  setup.resize(80, 24);
  await setup.renderOnce();
  expect(find("action")).toBe(originalAction);
  expect(setup.renderer.currentFocusedRenderable).toBe(originalAction);
  expectWithin(action, form);

  input.focus();
  showSlots(false);
  await setup.renderOnce();
  expect(input.parent?.height).toBe(form.height);
  expect(input.screenY).toBe(form.screenY);
  expect(find("input")).toBe(originalInput);
  expect(input.value).toBe("x");
  expect(setup.renderer.currentFocusedRenderable).toBe(input);
});

test("Field messages preserve real controls, editor state and focus across all required sizes", async () => {
  let setPresentation!: (value: Presentation) => void;
  let input!: InputRenderable;
  let list!: SelectRenderable;
  let button!: ButtonRenderable;
  let mounts = 0;
  let applied: string | undefined;
  let presses = 0;
  let submitted: string | undefined;
  function Controls() {
    const [value, setValue] = createSignal("");
    onMount(() => mounts++);
    return (
      <>
        <Input
          id="input"
          ref={(target) => (input = target)}
          value={value()}
          onInput={setValue}
          onSubmit={(value) => {
            submitted = value;
          }}
        />
        <DataList
          id="list"
          ref={(target) => (list = target)}
          flexGrow={1}
          minHeight={1}
          showDescription={false}
          options={[
            { name: "All Collections", description: "", value: "" },
            { name: "Team", description: "", value: "team" },
          ]}
          onSelect={(_index, option) => {
            applied = option?.value;
          }}
        />
        <Button
          id="button"
          label="Clear"
          ref={(target) => (button = target)}
          onPress={() => presses++}
        />
      </>
    );
  }
  setup = await testRender(
    () => {
      const [presentation, set] = createSignal<Presentation>({});
      setPresentation = set;
      return (
        <Form width="100%" height="100%">
          <FormField id="field" label="Collections" flexGrow={1} {...presentation()}>
            <Controls />
          </FormField>
        </Form>
      );
    },
    { width: 144, height: 40 },
  );
  await setup.renderOnce();
  expect(input).toBeInstanceOf(InputRenderable);
  expect(list).toBeInstanceOf(SelectRenderable);
  expect(button).toBeInstanceOf(ButtonRenderable);
  const originals = [input, list, button];
  input.focus();
  setup.mockInput.pressKey("t");
  await setup.renderOnce();
  expect(input.value).toBe("t");
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(submitted).toBe("t");
  expect(presses).toBe(0);
  expect(applied).toBeUndefined();
  list.setSelectedIndex(1);

  const presentations: Presentation[] = [
    { help: "Search values in this dimension" },
    { help: "Search values", disabled: true, disabledReason: "The source is unavailable" },
    {
      help: "Search values",
      disabled: true,
      disabledReason: "Unavailable source",
      error: "Choose another source",
    },
    { help: "Search values", disabled: true },
    { disabled: true },
    { help: "", error: "", disabled: true, disabledReason: "" },
    {},
  ];
  for (const [index, presentation] of presentations.entries()) {
    const focused = originals[index % originals.length]!;
    focused.focus();
    setPresentation(presentation);
    for (const [width, height] of [
      [144, 40],
      [100, 24],
      [80, 24],
      [43, 13],
    ] as const) {
      setup.resize(width, height);
      await setup.renderOnce();
      expect(find("input")).toBe(originals[0]);
      expect(find("list")).toBe(originals[1]);
      expect(find("button")).toBe(originals[2]);
      expect(mounts).toBe(1);
      expect(input.value).toBe("t");
      expect(setup.renderer.currentFocusedRenderable).toBe(focused);
      expect(list.getSelectedOption()?.value).toBe("team");
      for (const target of originals) expectWithin(target, find("field"));
      const messages = texts(find("field")).filter(
        (text) =>
          text.plainText.startsWith("Error:") ||
          text.plainText.startsWith("Unavailable:") ||
          text.plainText.startsWith("Search values"),
      );
      const expected = presentation.error
        ? `Error: ${presentation.error}`
        : presentation.disabled && presentation.disabledReason
          ? `Unavailable: ${presentation.disabledReason}`
          : presentation.help;
      expect(messages.map((text) => text.plainText)).toEqual(expected ? [expected] : []);
      if (messages[0]) {
        const colors = theme.get().colors;
        const color = presentation.error
          ? colors.destructive
          : presentation.disabled && presentation.disabledReason
            ? colors.disabledForeground
            : colors.mutedForeground;
        expect(messages[0].fg.equals(parseColor(color))).toBe(true);
        expectWithin(messages[0], find("field"));
        expect(messages[0].screenY).toBe(button.screenY + button.height);
      }
    }
  }

  // Presentation-only disablement must not masquerade as native activation gating.
  setPresentation({ disabled: true, disabledReason: "Presentation only" });
  await setup.renderOnce();
  list.focus();
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(applied).toBe("team");
  expect(list.getSelectedOption()?.value).toBe("team");
  button.focus();
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(button.getState().disabled).toBe(false);
  expect(presses).toBe(1);
});

test("consumer-owned native disabled state blocks editing and Button activation without replacement", async () => {
  let setBusy!: (value: boolean) => void;
  let input!: InputRenderable;
  let button!: ButtonRenderable;
  let presses = 0;
  setup = await testRender(
    () => {
      const [busy, set] = createSignal(false);
      const [value, setValue] = createSignal("");
      setBusy = set;
      return (
        <Form width="100%">
          <FormField id="field" disabled={busy()} disabledReason="Operation is running">
            <Input
              id="input"
              ref={(target) => (input = target)}
              value={value()}
              onInput={setValue}
              disabled={busy()}
            />
            <Button
              id="button"
              label="Create"
              ref={(target) => (button = target)}
              disabled={busy()}
              onPress={() => presses++}
            />
          </FormField>
        </Form>
      );
    },
    { width: 43, height: 13 },
  );
  await setup.renderOnce();
  const originalInput = input;
  const originalButton = button;
  expect(input.screenY).toBe(find("field").screenY);
  expect(input.screenY).toBe(button.screenY - input.height);
  input.focus();
  setup.mockInput.pressKey("a");
  await setup.renderOnce();
  button.focus();
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(presses).toBe(1);
  setBusy(true);
  await setup.renderOnce();
  expect(button.getState().disabled).toBe(true);
  input.focus();
  setup.mockInput.pressKey("b");
  await setup.mockMouse.click(button.screenX + 1, button.screenY);
  await setup.renderOnce();
  expect(input.value).toBe("a");
  expect(presses).toBe(1);
  setBusy(false);
  await setup.renderOnce();
  expect(input).toBe(originalInput);
  expect(button).toBe(originalButton);
  button.focus();
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(presses).toBe(2);
});

test("long labels and messages wrap above or beside controls without compact-layout overlap", async () => {
  let setBeside!: (value: boolean) => void;
  let input!: InputRenderable;
  const label = "Collection name used for the current workspace disclosure path";
  const help =
    "Choose the collection to disclose. Existing installed Skills and Source ownership are preserved.";
  setup = await testRender(
    () => {
      const [beside, set] = createSignal(false);
      setBeside = set;
      return (
        <Form id="form" width="100%" height="100%">
          <FormField
            id="field"
            label={label}
            labelPosition={beside() ? "beside" : "above"}
            labelWidth={18}
            help={help}
          >
            <Input id="input" ref={(target) => (input = target)} />
          </FormField>
        </Form>
      );
    },
    { width: 43, height: 13 },
  );
  await setup.renderOnce();
  const originalInput = input;
  const labelText = () => texts(find("field")).find((text) => text.plainText === label)!;
  const helpText = () => texts(find("field")).find((text) => text.plainText === help)!;
  expect(labelText().height).toBeGreaterThan(1);
  expect(helpText().height).toBeGreaterThan(1);
  expect(labelText().focusable).toBe(false);
  expect(input.screenY).toBe(labelText().screenY + labelText().height);
  expect(helpText().screenY).toBeGreaterThanOrEqual(input.screenY + input.height);
  input.focus();

  setBeside(true);
  for (const [width, height] of [
    [80, 24],
    [43, 13],
  ] as const) {
    setup.resize(width, height);
    await setup.renderOnce();
    expect(labelText().width).toBe(18);
    expect(input.screenY).toBe(labelText().screenY);
    expect(input.screenX).toBe(labelText().screenX + labelText().width + 1);
    expect(helpText().screenX).toBe(input.screenX);
    expect(helpText().screenY).toBeGreaterThanOrEqual(input.screenY + input.height);
    expect(find("input")).toBe(originalInput);
    expect(setup.renderer.currentFocusedRenderable).toBe(originalInput);
    for (const target of [labelText(), input, helpText()]) expectWithin(target, find("form"));
  }

  setBeside(false);
  setup.resize(43, 13);
  await setup.renderOnce();
  expect(find("input")).toBe(originalInput);
  expect(setup.renderer.currentFocusedRenderable).toBe(originalInput);
  for (const target of [labelText(), input, helpText()]) expectWithin(target, find("form"));
});
