import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import type { TuiCore } from "../src/effects";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, readerContent, readerResources } from "./installed-reader.fixture";
import { parsedEnter } from "./reader-test-controls";
import type { ResourceDescriptor } from "@skill-cli/core";

test("Reader arrows navigate loading and empty Resources without phantom selections", async () => {
  let complete!: (value: { value: readonly ResourceDescriptor[]; diagnostics: [] }) => void;
  const resources = new Promise<{ value: readonly ResourceDescriptor[]; diagnostics: [] }>(
    (resolve) => (complete = resolve),
  );
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          listInstalledResources: async () => resources,
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await setup.renderOnce();
    await parsedEnter(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-skill",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-resources-status",
    );
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    setup.mockInput.pressArrow("left");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-skill",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-resources-status",
    );
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-resources-status");
    setup.mockInput.pressArrow("left");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-resources-status",
    );
    complete({ value: [], diagnostics: [] });
    await setup.waitFor(() => setup.captureCharFrame().includes("No supporting resources"));
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-resources-status");
    expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    expect(setup.captureCharFrame()).toContain("Resources");
  } finally {
    complete({ value: [], diagnostics: [] });
    setup.renderer.destroy();
  }
});

test("late resource completion cannot steal focus after returning to the list", async () => {
  let finishRead!: (value: Awaited<ReturnType<TuiCore["content"]["readInstalled"]>>) => void;
  let reads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          readInstalled: async () => {
            reads++;
            return new Promise((resolve) => (finishRead = resolve));
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await setup.renderOnce();
    await parsedEnter(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-skill",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    let list = setup.renderer.currentFocusedRenderable;
    expect(list).toBeInstanceOf(SelectRenderable);
    const select = list as SelectRenderable;
    const fileIndex = select.options.findIndex((option) => option.value === "docs/guide.md");
    expect(fileIndex).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < fileIndex; i++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      list = setup.renderer.currentFocusedRenderable;
    }
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!finishRead);
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    finishRead({
      value: { kind: "text", path: "docs/guide.md", text: "late", format: "text" },
      diagnostics: [],
    });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("resource-browser");
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("resource-content");
    const selected = (
      setup.renderer.root.findDescendantById("resource-browser") as SelectRenderable
    ).getSelectedOption()?.value;
    expect(selected).toBe("docs/guide.md");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => reads === 2);
    finishRead({
      value: { kind: "text", path: "docs/guide.md", text: "current", format: "text" },
      diagnostics: [],
    });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
    expect(reads).toBe(2);
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
    expect(reads).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});
