import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerResources,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
import {
  focusLive,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  readerTab,
  selectedReaderTab,
} from "./reader-test-controls";

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
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  await setup.renderOnce();
  await Promise.resolve();
  await openReaderFromInspector(setup);
  await setup.waitForFrame((frame) => frame.includes("Reader · guide"));
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

async function openFromInspector(setup: Setup) {
  const control = setup.renderer.root.findDescendantById("skill-inspector-open-reader")!;
  await focusLive(setup, control.id);
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-find"));
}

test("RENDER Reader tabs own Left/Right, forward Tab enters content, Shift+Tab returns to browser", async () => {
  const setup = await boot();
  try {
    await openReaderTab(setup, 1);
    const resourcesTab = readerTab(setup, 1);
    expect(selectedReaderTab(setup)).toBe(1);
    expect(setup.renderer.currentFocusedRenderable).toBe(resourcesTab);
    await focusLive(setup, "resource-browser");
    expectFocused(setup, "resource-browser");
    await openReaderTab(setup, 2);
    const detailsTab = readerTab(setup, 2);
    expect(selectedReaderTab(setup)).toBe(2);
    expect(setup.renderer.currentFocusedRenderable).toBe(detailsTab);
    await focusLive(setup, "reader-details");
    expectFocused(setup, "reader-details");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "reader-details-action-skill-open-source",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader find input owns printable, slash, and cursor keys", async () => {
  const setup = await boot();
  try {
    await focusLive(setup, "reader-find");
    await setup.mockInput.pressKeys(["a", "/"]);
    setup.mockInput.pressKey("ARROW_LEFT");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.renderOnce();
    expect(findInput(setup).value).toBe("a/");
    await parsedEnter(setup);
    await setup.renderOnce();
    expectFocused(setup, "reader-find");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader find draft commits on focus exit and survives a Skill switch round trip", async () => {
  const setup = await boot();
  try {
    await focusLive(setup, "reader-find");
    await setup.mockInput.pressKeys(["a", "b", "c"]);
    await setup.renderOnce();
    await parsedEscape(setup);
    expectFocused(setup, "reader-scrollbox");
    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await openFromInspector(setup);
    expect(findInput(setup).value).toBe("");
    await parsedEscape(setup);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await openFromInspector(setup);
    expect(findInput(setup).value).toBe("abc");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader Escape returns through Inspector before Work Area", async () => {
  const setup = await boot();
  try {
    await focusLive(setup, "reader-scrollbox");
    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader stays mounted across narrow resize and preserves draft and focus", async () => {
  const setup = await boot();
  try {
    await focusLive(setup, "reader-find");
    await setup.mockInput.pressKeys(["x", "y"]);
    await setup.renderOnce();
    setup.resize(79, 40);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeDefined();
    expect(setup.captureCharFrame()).toContain("Reader · guide");
    setup.resize(120, 40);
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    const input = (await focusLive(setup, "reader-find")) as InputRenderable;
    expect(input.value).toBe("xy");
    expect(setup.renderer.currentFocusedRenderable).toBe(input);
    expect(input.focused).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
