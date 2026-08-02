import { expect, test } from "bun:test";
import { InputRenderable, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function boot() {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => ({
            value:
              request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  await setup.renderOnce();
  await Promise.resolve();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
  return setup;
}

function expectFocused(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeDefined();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
  expect(setup.renderer.currentFocusedRenderable).toBe(target!);
  expect(target!.focused).toBe(true);
}

function findInput(setup: Setup) {
  const input = setup.renderer.root.findDescendantById("reader-find");
  expect(input).toBeInstanceOf(InputRenderable);
  return input as InputRenderable;
}

async function focusReaderFind(setup: Setup) {
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  expectFocused(setup, "reader-tabs");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  expectFocused(setup, "reader-scrollbox");
  setup.mockInput.pressKey("/");
  await setup.renderOnce();
  expectFocused(setup, "reader-find");
}

test("RENDER Reader tabs own Left/Right, forward Tab enters content, Shift+Tab returns to browser", async () => {
  const setup = await boot();
  try {
    expectFocused(setup, "installed-skill-browser");

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "reader-tabs");

    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expectFocused(setup, "installed-skill-browser");
    expect(setup.renderer.root.findDescendantById("reader-tabs")!.focused).toBe(false);

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "reader-scrollbox");

    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expectFocused(setup, "installed-skill-browser");

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "reader-tabs");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expectFocused(setup, "reader-tabs");
    expect(
      (
        setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
      ).getSelectedIndex(),
    ).toBe(1);
    expect(setup.renderer.root.findDescendantById("resource-browser")).toBeDefined();

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "resource-browser");

    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expectFocused(setup, "installed-skill-browser");

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "reader-tabs");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expectFocused(setup, "reader-tabs");
    expect(
      (
        setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
      ).getSelectedIndex(),
    ).toBe(2);
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "reader-details");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expectFocused(setup, "reader-details-actions");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader find input owns printable, slash, and cursor keys", async () => {
  const setup = await boot();
  try {
    await focusReaderFind(setup);
    await setup.mockInput.pressKeys(["a", "/"]);
    setup.mockInput.pressKey("ARROW_LEFT");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expect(findInput(setup).value).toBe("a/");
    expectFocused(setup, "reader-find");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expectFocused(setup, "reader-find");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader find draft commits on focus exit and survives a Skill switch round trip", async () => {
  const setup = await boot();
  try {
    await focusReaderFind(setup);
    await setup.mockInput.pressKeys(["a", "b", "c"]);
    await setup.renderOnce();

    for (let index = 0; index < 5; index++) {
      setup.mockInput.pressKey("TAB");
      await setup.renderOnce();
    }
    expectFocused(setup, "top-navigation-tab-workspace");

    await new Promise<void>((resolve) => {
      const onKeypress = (event: { readonly name: string }) => {
        if (event.name === "escape" || event.name === "esc") {
          setup.renderer.keyInput.off("keypress", onKeypress);
          resolve();
        }
      };
      setup.renderer.keyInput.prependListener("keypress", onKeypress);
      setup.mockInput.pressKey("ESCAPE");
    });
    await setup.renderOnce();
    expectFocused(setup, "installed-skill-browser");

    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    expect(findInput(setup).value).toBe("");

    setup.mockInput.pressKey("ARROW_UP");
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    expect(findInput(setup).value).toBe("abc");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader find draft survives destination route away and back", async () => {
  const setup = await boot();
  try {
    await focusReaderFind(setup);
    await setup.mockInput.pressKeys(["r", "t"]);
    await setup.renderOnce();

    for (let index = 0; index < 5; index++) {
      setup.mockInput.pressKey("TAB");
      await setup.renderOnce();
    }
    expectFocused(setup, "top-navigation-tab-workspace");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("reader-find")).toBeUndefined();
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    expect(findInput(setup).value).toBe("rt");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader unmount on narrow resize commits the draft and remount replays focus once", async () => {
  const setup = await boot();
  try {
    await focusReaderFind(setup);
    await setup.mockInput.pressKeys(["x", "y"]);
    await setup.renderOnce();

    setup.resize(79, 40);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("reader-find")).toBeUndefined();

    setup.resize(120, 40);
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    const input = findInput(setup);
    expect(input.value).toBe("xy");
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(input.focused).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
