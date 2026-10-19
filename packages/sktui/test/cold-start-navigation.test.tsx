import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SelectRenderable } from "@opentui/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEscape } from "./reader-test-controls";

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
  "cold startup at %i columns operates Skill list without Tab or imperative focus",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      {
        width,
        height: 40,
      },
    );
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      const list = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      const initial = list.getSelectedIndex();
      await press(setup, "ARROW_DOWN");
      await setup.waitFor(() => list.getSelectedIndex() === initial + 1);
      await press(setup, "ENTER");
      await expectFocus(setup, "skill-inspector-open-reader", `cold startup ${width} Enter`);
      await parsedEscape(setup);
      await expectFocus(setup, "installed-skill-browser", `cold startup ${width} Escape`);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("page and context navigation are reachable from cold startup without mouse or Tab", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await press(setup, "ARROW_LEFT");
    await expectFocus(
      setup,
      "shell-section-navigation",
      "cold navigation after Left from All Skills",
    );
    await press(setup, "ARROW_LEFT");
    await expectFocus(
      setup,
      "top-navigation-tab-workspace",
      "cold navigation after Left from sections",
    );
    await press(setup, "ARROW_RIGHT");
    await expectFocus(setup, "top-navigation-tab-global", "cold navigation after Right to Global");
    expect(setup.captureCharFrame()).toContain("Global Config / Sources");
    await press(setup, "ARROW_DOWN");
    await expectFocus(setup, "shell-section-navigation", "cold navigation after Down from Global");
    await press(setup, "ENTER");
    await setup.waitFor(() => !!setup.renderer.currentFocusedRenderable?.parent);
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("shell-section-navigation");
    // This fixture has no Global Source; empty entry uses its mounted work area.
    expect(setup.captureCharFrame()).toContain("No Source");
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
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await press(setup, "ARROW_LEFT");
    await press(setup, "ARROW_LEFT");
    setup.mockInput.pressArrow("up");
    await expectFocus(setup, "shell-more-actions", "Context Up reaches More actions");
    await press(setup, "ENTER");
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
