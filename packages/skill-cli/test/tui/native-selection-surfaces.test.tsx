import { expect, test } from "bun:test";
import { MarkdownRenderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkillCliError } from "../../src/core/api";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

function selectionText(setup: Setup) {
  return setup.renderer.getSelection()?.getSelectedText() ?? "";
}

async function pressParsedEscape(setup: Setup) {
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
}

async function openReader(setup: Setup) {
  await setup.renderOnce();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
}

async function chooseReaderTab(setup: Setup, stepsRight: number) {
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs");
  for (let index = 0; index < stepsRight; index++) setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
}

async function openResources(setup: Setup) {
  await openReader(setup);
  await chooseReaderTab(setup, 1);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
}

async function openDetails(setup: Setup) {
  await openReader(setup);
  await chooseReaderTab(setup, 2);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
}

async function dragFirstLine(setup: Setup, id: string, width: number) {
  const surface = setup.renderer.root.findDescendantById(id);
  expect(surface).toBeInstanceOf(ScrollBoxRenderable);
  const scrollbox = surface as ScrollBoxRenderable;
  const child = scrollbox.getChildren()[0];
  expect(child).toBeDefined();
  await setup.mockMouse.drag(
    child!.screenX + 1,
    child!.screenY,
    child!.screenX + width,
    child!.screenY,
  );
  await setup.flush();
}

function readerApp(overrides: Parameters<typeof directSourceCore>[1] = {}) {
  return (
    <App
      core={directSourceCore(readerProjection(), {
        loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
        ...overrides,
      })}
      exit={() => {}}
    />
  );
}

test("RENDER native Details selection exposes Source provenance through the renderer", async () => {
  const setup = await testRender(() => readerApp(), { width: 120, height: 40 });
  try {
    await openDetails(setup);
    const details = setup.renderer.root.findDescendantById("reader-details");
    expect(details).toBeDefined();
    await setup.mockMouse.drag(
      details!.screenX,
      details!.screenY + 3,
      details!.screenX + 19,
      details!.screenY + 3,
    );
    await setup.flush();
    expect(selectionText(setup)).toBe("Binding  github");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER native text resource selection exposes file content through the renderer", async () => {
  const setup = await testRender(
    () =>
      readerApp({
        readInstalled: async (request) => ({
          value: {
            kind: "text" as const,
            path: request.path,
            text: "selectable resource text",
            format: "text" as const,
          },
          diagnostics: [],
        }),
      }),
    { width: 120, height: 40 },
  );
  try {
    await openResources(setup);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("selectable resource text"));
    await dragFirstLine(setup, "resource-content", 20);
    expect(selectionText(setup)).toBe("electable resource ");
    await pressParsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER native unsupported-resource selection exposes descriptor metadata", async () => {
  const setup = await testRender(
    () =>
      readerApp({
        readInstalled: async (request) => ({
          value: {
            kind: "not-text" as const,
            path: request.path,
            reason: "binary",
            metadata: { path: request.path, kind: "file" as const, size: 8 },
          },
          diagnostics: [],
        }),
      }),
    { width: 120, height: 40 },
  );
  try {
    await openResources(setup);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Cannot preview binary resource"));
    const surface = setup.renderer.root.findDescendantById("resource-content");
    expect(surface).toBeInstanceOf(ScrollBoxRenderable);
    const content = surface as ScrollBoxRenderable;
    const metadata = content.getChildren()[0];
    expect(metadata).toBeDefined();
    await setup.mockMouse.drag(
      metadata!.screenX,
      metadata!.screenY + 1,
      metadata!.screenX + 22,
      metadata!.screenY + 1,
    );
    await setup.flush();
    expect(selectionText(setup)).toBe("blob.bin  file 8 bytes");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER native resource read errors expose their typed code and message", async () => {
  const setup = await testRender(
    () =>
      readerApp({
        readInstalled: async () => {
          throw new SkillCliError("RESOURCE_NOT_FOUND", "resource moved");
        },
      }),
    { width: 120, height: 40 },
  );
  try {
    await openResources(setup);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: resource moved"));
    const retry = setup.renderer.root.findDescendantById("resource-retry");
    expect(retry).toBeDefined();
    await setup.mockMouse.drag(
      retry!.screenX,
      retry!.screenY - 1,
      retry!.screenX + 35,
      retry!.screenY - 1,
    );
    await setup.flush();
    expect(selectionText(setup)).toBe("RESOURCE_NOT_FOUND: resource moved");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER native Markdown resource selection records the memory-renderer boundary", async () => {
  const setup = await testRender(
    () =>
      readerApp({
        readInstalled: async (request) => ({
          value: {
            kind: "text" as const,
            path: request.path,
            text: "# Resource heading\n\nstable prose for native selection",
            format: "markdown" as const,
          },
          diagnostics: [],
        }),
      }),
    { width: 120, height: 40 },
  );
  try {
    await openResources(setup);
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.waitFor(() => {
      const content = setup.renderer.root.findDescendantById("resource-content");
      return content?.getChildren().some((child) => child instanceof MarkdownRenderable) ?? false;
    });
    const surface = setup.renderer.root.findDescendantById("resource-content");
    expect(surface).toBeInstanceOf(ScrollBoxRenderable);
    const scrollbox = surface as ScrollBoxRenderable;
    const markdown = scrollbox.getChildren()[0];
    expect(markdown).toBeDefined();
    await setup.mockMouse.drag(
      markdown!.screenX + 1,
      markdown!.screenY + 2,
      markdown!.screenX + 18,
      markdown!.screenY + 2,
    );
    await setup.flush();
    expect(selectionText(setup)).toBe("");
  } finally {
    setup.renderer.destroy();
  }
});
