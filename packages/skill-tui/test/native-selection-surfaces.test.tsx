import { expect, test } from "bun:test";
import { MarkdownRenderable, ScrollBoxRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkillCliError } from "@skill-cli/core";
import { App } from "../src/app";
import {
  enterLive,
  focusLive,
  openReaderTab,
  parsedEnter,
  readerTab,
  selectedReaderTab,
} from "./reader-test-controls";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerResources } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function openReaderFromInspector(setup: Setup) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
  );
  const currentExposure = setup.renderer.root.findDescendantById(
    "skills-view-tab-current-exposure",
  )!;
  currentExposure.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === currentExposure);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.waitFor(
    () =>
      setup.captureCharFrame().includes("[ All Skills ]") &&
      !!setup.renderer.root.findDescendantById("installed-skill-browser"),
  );
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
  setup.mockInput.pressEnter();
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  const control = setup.renderer.root.findDescendantById("skill-inspector-open-reader")!;
  control.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === control);
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
}

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
  await openReaderFromInspector(setup);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
}

async function chooseReaderTab(setup: Setup, stepsRight: number) {
  const index = stepsRight === 0 || stepsRight === 1 || stepsRight === 2 ? stepsRight : null;
  if (index === null) throw new Error(`Invalid Reader tab index: ${stepsRight}`);
  await openReaderTab(setup, index);
  const selected = readerTab(setup, index);
  expect(selectedReaderTab(setup)).toBe(index);
  expect(setup.renderer.currentFocusedRenderable).toBe(selected);
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
        ...overrides,
        installed: {
          load: async () => readerContent,
          listResources: async () => readerResources,
          ...overrides.installed,
        },
      })}
      exit={() => {}}
    />
  );
}

test("RENDER native Details selection exposes Source provenance through the renderer", async () => {
  const setup = await testRender(() => readerApp(), { width: 120, height: 40 });
  try {
    await openDetails(setup);
    await enterLive(setup, "reader-details-metadata");
    const details = setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable;
    const binding = (node: {
      getChildren(): readonly unknown[];
    }): TextBufferRenderable | undefined =>
      node
        .getChildren()
        .find(
          (child): child is TextBufferRenderable =>
            child instanceof TextBufferRenderable && child.plainText.includes("Binding  github"),
        ) ??
      node
        .getChildren()
        .filter(
          (child): child is { getChildren(): readonly unknown[] } =>
            !!child && typeof child === "object" && "getChildren" in child,
        )
        .map(binding)
        .find(Boolean);
    const provenance = binding(details);
    expect(provenance).toBeDefined();
    await setup.mockMouse.drag(
      provenance!.screenX,
      provenance!.screenY + 2,
      provenance!.screenX + 19,
      provenance!.screenY + 2,
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
        installed: {
          read: async (request) => ({
            kind: "text" as const,
            path: request.path,
            text: "selectable resource text",
            format: "text" as const,
          }),
        },
      }),
    { width: 120, height: 40 },
  );
  try {
    await openResources(setup);
    await focusLive(setup, "resource-browser");
    setup.mockInput.pressKey("ARROW_DOWN");
    await setup.renderOnce();
    await parsedEnter(setup);
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
        installed: {
          read: async (request) => ({
            kind: "not-text" as const,
            path: request.path,
            reason: "binary",
            metadata: { path: request.path, kind: "file" as const, size: 8 },
          }),
        },
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
        installed: {
          read: async () => {
            throw new SkillCliError("RESOURCE_NOT_FOUND", "resource moved");
          },
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
        installed: {
          read: async (request) => ({
            kind: "text" as const,
            path: request.path,
            text: "# Resource heading\n\nstable prose for native selection",
            format: "markdown" as const,
          }),
        },
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
      markdown!.screenY + 1,
      markdown!.screenX + 18,
      markdown!.screenY + 1,
    );
    await setup.flush();
    expect(selectionText(setup)).toBe("");
  } finally {
    setup.renderer.destroy();
  }
});
