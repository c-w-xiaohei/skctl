import { expect, test } from "bun:test";
import { CliRenderEvents, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

async function openReaderRaw(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
}

test("RENDER initial Workspace projection applies once and defers reader focus until its target registers", async () => {
  let loads = 0;
  let initialSignal: AbortSignal | undefined;
  let resolveWorkspace:
    | ((value: {
        readonly value: ReturnType<typeof readerProjection>;
        readonly diagnostics: [];
      }) => void)
    | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          get: (options) =>
            new Promise((resolve) => {
              loads += 1;
              initialSignal = options?.signal;
              resolveWorkspace = resolve;
            }),
          loadInstalled: async () => ({
            value: readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(loads).toBe(1);
    expect(setup.captureCharFrame()).toContain("Loading");

    setup.resize(100, 30);
    await setup.renderOnce();
    expect(loads).toBe(1);
    expect(initialSignal?.aborted).toBe(false);

    resolveWorkspace!({ value: readerProjection(), diagnostics: [] });
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER App aborts its unresolved initial Workspace request when unmounted", async () => {
  let loads = 0;
  let initialSignal: AbortSignal | undefined;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          get: (options) =>
            new Promise(() => {
              loads += 1;
              initialSignal = options?.signal;
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );

  await setup.renderOnce();
  expect(loads).toBe(1);
  expect(initialSignal?.aborted).toBe(false);

  setup.renderer.destroy();
  expect(initialSignal?.aborted).toBe(true);
});

test("RENDER App keeps the second native Markdown Reader visible after Details returns to the browser", async () => {
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
  try {
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );

    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressKey("ARROW_RIGHT");
    setup.mockInput.pressKey("ARROW_RIGHT");
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
        ).getSelectedIndex() === 2,
    );

    setup.mockInput.pressKey("ESCAPE");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressArrow("down");

    await setup.waitForFrame((frame) => frame.includes("Reference"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER App ignores a queued reader owner after resize replaces it before microtasks drain", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({
            value: readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openReaderRaw(setup);
    const focused: string[] = [];
    const observe = (target: { readonly id?: string }) => focused.push(target.id ?? "");
    setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, observe);

    setup.resize(79, 24);
    setup.resize(120, 24);
    await Promise.resolve();
    await setup.renderOnce();

    expect(focused).not.toContain("installed-skill-browser");
    expect(focused.filter((id) => id === "reader-scrollbox")).toHaveLength(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    setup.renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, observe);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER App teardown rejects a queued focus reconciliation", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({
            value: readerContent,
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  await openReaderRaw(setup);
  const focused: string[] = [];
  const observe = (target: { readonly id?: string }) => focused.push(target.id ?? "");
  setup.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, observe);

  setup.resize(79, 24);
  setup.renderer.destroy();
  await Promise.resolve();

  expect(focused).toEqual([]);
  setup.renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, observe);
});

test("RENDER closing the palette settles focus back on the originating browser, never the task surface", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    setup.mockInput.pressKey("ESCAPE");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("task");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER nested palette close restores the original browser focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    setup.mockInput.pressKey("p", { ctrl: true });
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("palette-menu");
    setup.mockInput.pressKey("ESCAPE");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
  } finally {
    setup.renderer.destroy();
  }
});
