import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { selectScrollOffset } from "../src/select-scroll";
import { DataList } from "../src/ui/data-list";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { openAllInstalledSkills, parsedEnter } from "./reader-test-controls";

const options = Array.from({ length: 12 }, (_, index) => ({
  name: `community-launch-runner-${index}`,
  description: `Community launch runner ${index}`,
  value: `core@0.5.${index + 14}`,
}));

test("DataList pointer selection uses the visible row after keyboard scrolling", async () => {
  const changes: string[] = [];
  let activations = 0;
  const setup = await testRender(
    () => {
      const [selected, setSelected] = createSignal(0);
      return (
        <box flexDirection="column">
          <DataList
            id="installed-skill-browser"
            height={6}
            options={options}
            selectedIndex={selected()}
            onChange={(index, option) => {
              changes.push(option?.value);
              setSelected(index);
            }}
            onMouseDown={() => activations++}
          />
          <box id="details" focusable height={1} />
        </box>
      );
    },
    { width: 60, height: 8 },
  );
  try {
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    setup.renderer.root.findDescendantById("details")!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable !== list);

    list.focus();
    for (let index = 0; index < 8; index++) setup.mockInput.pressArrow("down");
    await setup.waitFor(() => list.getSelectedIndex() === 8 && selectScrollOffset(list) > 0);

    changes.length = 0;
    const scrollBase = selectScrollOffset(list);
    await setup.mockMouse.click(list.screenX + 2, list.screenY + 2);
    await setup.waitFor(
      () =>
        list.getSelectedIndex() === scrollBase + 1 &&
        setup.renderer.currentFocusedRenderable === list,
    );
    expect(changes).toEqual([options[scrollBase + 1]!.value]);
    expect(activations).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("production Skill list click selects the exact scrolled row from query focus without opening it", async () => {
  const initial = readerProjection();
  const projection = {
    ...initial,
    installedSkills: Array.from({ length: 45 }, (_, index) => ({
      ...initial.installedSkills[0]!,
      name: `skill-${index}`,
      address: { source: "team-main", path: `skill-${index}` },
    })),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    const list = setup.renderer.currentFocusedRenderable as SelectRenderable;
    for (let index = 0; index < 30; index++) setup.mockInput.pressArrow("down");
    await setup.waitFor(() => list.getSelectedIndex() === 30);
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-query");
    await setup.renderOnce();
    const wanted = selectScrollOffset(list) + 2;
    await setup.mockMouse.click(list.screenX + 3, list.screenY + 2);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    expect(list.getSelectedIndex()).toBe(wanted);
    expect(setup.captureCharFrame()).toContain(`skill-${wanted}`);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBe(list);
  } finally {
    setup.renderer.destroy();
  }
});

test("DataList ignores pointer presses outside rendered rows", async () => {
  const setup = await testRender(
    () => (
      <box flexDirection="column">
        <DataList id="installed-skill-browser" height={5} options={options} selectedIndex={3} />
        <box id="details" focusable height={1} />
      </box>
    ),
    { width: 60, height: 8 },
  );
  try {
    await setup.renderOnce();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    const selected = list.getSelectedIndex();

    await setup.mockMouse.click(list.screenX + 2, list.screenY - 1);
    await setup.mockMouse.click(list.screenX + 2, list.screenY + list.height - 1);
    await setup.flush();

    expect(list.getSelectedIndex()).toBe(selected);
  } finally {
    setup.renderer.destroy();
  }
});
