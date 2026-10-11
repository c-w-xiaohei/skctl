import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { Reader } from "../src/reader";
import { App } from "../src/app";
import { activeReader, createReaderState, reduceReaderState } from "../src/reader/state";
import type { CommandRecord, ReaderState } from "../src/types";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

function readerState(tab: ReaderState["tab"], resources: ReaderState["resources"] = []) {
  const state = reduceReaderState(createReaderState(), {
    type: "select",
    address: { source: "team-main", path: "guide" },
  });
  return {
    ...activeReader(state)!,
    tab,
    resources,
    resourcesLoaded: resources.length > 0,
  };
}

test("RENDER Reader registers exact Enter records and describes only mounted resource controls", async () => {
  const [state] = createSignal(readerState("skill"));
  const commands: CommandRecord[] = [];
  const setup = await testRender(
    () => (
      <Reader
        reader={state}
        projection={() => undefined}
        mode="wide"
        registerCommand={(record) => {
          commands.push(record);
          return () => {};
        }}
        actions={[]}
        onPatch={() => {}}
        onCommitFind={() => {}}
        onResources={() => {}}
        onReadResource={() => {}}
        onRetryResource={() => {}}
        onResourceBack={() => {}}
        onDetailsAction={() => {}}
        onDetailsRelationship={() => {}}
        onDetailsScroll={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(commands).toEqual([
      expect.objectContaining({
        id: "reader.raw",
        keys: ["enter", "return"],
        verb: "Raw",
        destination: "SKILL.md",
      }),
    ]);
    expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader mounts the resource Select only when resources are available", async () => {
  for (const state of [
    { ...readerState("resources"), resourceLoading: true },
    { ...readerState("resources"), resourcesLoaded: true },
    readerState("resources", [{ path: "guide.md", kind: "file" }]),
  ]) {
    const [reader] = createSignal(state);
    const setup = await testRender(
      () => (
        <Reader
          reader={reader}
          projection={() => undefined}
          mode="wide"
          actions={[]}
          onPatch={() => {}}
          onCommitFind={() => {}}
          onResources={() => {}}
          onReadResource={() => {}}
          onRetryResource={() => {}}
          onResourceBack={() => {}}
          onDetailsAction={() => {}}
          onDetailsRelationship={() => {}}
          onDetailsScroll={() => {}}
        />
      ),
      { width: 120, height: 24 },
    );
    try {
      await setup.renderOnce();
      const resourceBrowser = setup.renderer.root.findDescendantById("resource-browser");
      expect(resourceBrowser !== undefined).toBe(state.resources.length > 0);
    } finally {
      setup.renderer.destroy();
    }
  }
});

test("RENDER Reader executes one command once through Enter and pointer without leaving Reader", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openReaderFromInspector(setup);
    const raw = setup.renderer.root.findDescendantById("reader-raw")!;
    raw.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === raw);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Enter Prose"));
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();

    const prose = setup.renderer.root.findDescendantById("reader-raw")!;
    await setup.mockMouse.click(prose.screenX, prose.screenY);
    await setup.waitForFrame((frame) => frame.includes("Enter Raw"));
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
