import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import type { TuiCore } from "../src/effects";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerAddress,
  readerProjection,
  readerContent,
  readerResources,
} from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
} from "./reader-test-controls";
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
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await openReaderTab(setup, 1);
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-resources-status",
    );
    await setup.waitForFrame((frame) => frame.includes("Loading resources"));
    for (const [key, id] of [
      ["ARROW_LEFT", "reader-resources-status"],
      ["ARROW_RIGHT", "reader-resources-status"],
      ["ARROW_DOWN", "reader-resources-status"],
      ["ARROW_UP", "reader-tabs-tab-resources"],
      ["ARROW_LEFT", "reader-tabs-tab-skill"],
      ["ARROW_RIGHT", "reader-tabs-tab-resources"],
    ] as const) {
      setup.mockInput.pressKey(key);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
      expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
    }
    await parsedEnter(setup);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-skills",
    );
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-resources-status",
    );
    complete({ value: [], diagnostics: [] });
    await setup.waitFor(() => setup.captureCharFrame().includes("No supporting resources"));
    setup.mockInput.pressArrow("down");
    await setup.flush();
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
  const requests: unknown[] = [];
  let delivered = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          readInstalled: async (request) => {
            requests.push(request);
            const result = await new Promise<
              Awaited<ReturnType<TuiCore["content"]["readInstalled"]>>
            >((resolve) => (finishRead = resolve));
            delivered++;
            return result;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await openReaderTab(setup, 1);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    const select = live(setup, "resource-browser") as SelectRenderable;
    const fileIndex = select.options.findIndex((option) => option.value === "docs/guide.md");
    expect(fileIndex).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < fileIndex; i++) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => select.getSelectedIndex() === i + 1);
    }
    expect(select.getSelectedOption()?.value).toBe("docs/guide.md");
    await parsedEnter(setup);
    await setup.waitFor(() => requests.length === 1);
    await setup.waitForFrame((frame) => frame.includes("Loading resource content"));
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    finishRead({
      value: { kind: "text", path: "docs/guide.md", text: "late", format: "text" },
      diagnostics: [],
    });
    await setup.waitFor(() => delivered === 1);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("resource-browser");
    expect(setup.renderer.root.findDescendantById("resource-content")).toBeUndefined();
    expect((live(setup, "resource-browser") as SelectRenderable).getSelectedOption()?.value).toBe(
      "docs/guide.md",
    );
    await parsedEnter(setup);
    await setup.waitFor(() => requests.length === 2);
    finishRead({
      value: { kind: "text", path: "docs/guide.md", text: "current", format: "text" },
      diagnostics: [],
    });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
    await setup.waitForFrame((frame) => frame.includes("current"));
    setup.mockInput.pressArrow("left");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
    expect(requests).toEqual([
      { address: readerAddress, path: "docs/guide.md" },
      { address: readerAddress, path: "docs/guide.md" },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
