import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SelectRenderable } from "@opentui/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEscape, waitForReaderBody } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

function focusSnapshot(setup: Setup) {
  return `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}\n${setup.captureCharFrame()}`;
}

async function expectFocus(setup: Setup, id: string, source: string) {
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  } catch (error) {
    throw new Error(`${source}: expected focus ${id}; ${focusSnapshot(setup)}`, { cause: error });
  }
}

async function tabTo(setup: Setup, id: string) {
  for (let step = 0; step < 40; step++) {
    if (setup.renderer.currentFocusedRenderable?.id === id) return;
    setup.mockInput.pressTab();
    await setup.flush();
  }
  throw new Error(`Tab could not reach ${id}; ${focusSnapshot(setup)}`);
}

async function openSkills(setup: Setup) {
  await setup.flush();
  await tabTo(setup, "installed-skill-browser");
}

async function press(setup: Setup, key: "ARROW_LEFT" | "ARROW_RIGHT" | "ARROW_DOWN" | "ENTER") {
  const expected =
    key === "ENTER" ? ["enter", "return"] : [key.replace("ARROW_", "").toLowerCase()];
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (!expected.includes(event.name)) return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    if (key === "ENTER") setup.mockInput.pressEnter();
    else setup.mockInput.pressArrow(key.slice(6).toLowerCase() as "down" | "left" | "right");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

test.each([120, 80, 43])(
  "cold startup at %i columns reaches All Skills by keyboard and reads the selected Skill",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      {
        width,
        height: 40,
      },
    );
    try {
      await openSkills(setup);
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      const list = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      const initial = list.getSelectedIndex();
      await press(setup, "ARROW_DOWN");
      await setup.waitFor(() => list.getSelectedIndex() === initial + 1);
      await press(setup, "ENTER");
      await waitForReaderBody(setup, "reference");
      await parsedEscape(setup);
      await expectFocus(setup, "installed-skill-browser", `cold startup ${width} Escape`);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("page and Scope navigation are reachable from cold startup by keyboard", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.flush();
    await tabTo(setup, "shell-section-tab-skills");
    for (let index = 0; index < 5; index++) await press(setup, "ARROW_RIGHT");
    await tabTo(setup, "shell-scope-select");
    await press(setup, "ENTER");
    await expectFocus(setup, "scope-choices", "Scope opened");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    for (
      let step = 0;
      step < choices.options.length && choices.getSelectedOption()?.value !== "global";
      step++
    )
      await press(setup, "ARROW_DOWN");
    expect(choices.getSelectedOption()?.value).toBe("global");
    await press(setup, "ENTER");
    await tabTo(setup, "settings-categories");
    await press(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Sources"));
  } finally {
    setup.renderer.destroy();
  }
});

test("More actions is reachable and activates from its real shell control", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.flush();
    const actions = setup.renderer.root.findDescendantById("shell-more-actions")!;
    await setup.mockMouse.click(actions.screenX + 1, actions.screenY);
    await expectFocus(setup, "palette-choices", "More actions Enter opens palette");
    await parsedEscape(setup);
    await expectFocus(
      setup,
      "shell-more-actions",
      "Palette Escape restores initiating shell command",
    );
  } finally {
    setup.renderer.destroy();
  }
});
