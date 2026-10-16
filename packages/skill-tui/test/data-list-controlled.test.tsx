/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { DataList } from "../src/ui/data-list";

const guide = { name: "guide", description: "Guide", value: "guide" };
const reference = { name: "reference", description: "Reference", value: "reference" };

test("DataList applies a controlled index after its replacement options without losing semantic selection", async () => {
  const [expanded, setExpanded] = createSignal(false);
  const setup = await testRender(
    () => (
      <DataList
        id="controlled-list"
        options={expanded() ? [guide, reference] : [reference]}
        selectedIndex={expanded() ? 1 : 0}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("controlled-list") as SelectRenderable;
    expect(list.getSelectedOption()?.value).toBe("reference");
    setExpanded(true);
    await setup.flush();
    expect(list.getSelectedIndex()).toBe(1);
    expect(list.getSelectedOption()?.value).toBe("reference");
    setExpanded(false);
    await setup.flush();
    expect(list.getSelectedOption()?.value).toBe("reference");
    setExpanded(true);
    await setup.flush();
    expect(list.getSelectedOption()?.value).toBe("reference");
  } finally {
    setup.renderer.destroy();
  }
});

test("DataList without a controlled index retains native selection across a width repaint", async () => {
  const setup = await testRender(() => <DataList id="native-list" options={[guide, reference]} />, {
    width: 80,
    height: 24,
  });
  try {
    await setup.flush();
    const list = setup.renderer.root.findDescendantById("native-list") as SelectRenderable;
    list.focus();
    setup.mockInput.pressArrow("down");
    await setup.flush();
    expect(list.getSelectedOption()?.value).toBe("reference");
    setup.resize(100, 24);
    await setup.flush();
    expect(list.getSelectedOption()?.value).toBe("reference");
  } finally {
    setup.renderer.destroy();
  }
});
