import { expect, test } from "bun:test";
async function checkpoint(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: string,
  label: string,
) {
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  } catch (cause) {
    throw new Error(
      `${label}: ${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
      { cause },
    );
  }
}
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerResources,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
import { focusLive, parsedEscape, parsedEnter as rawParsedEnter } from "./reader-test-controls";

async function parsedArrow(
  setup: Awaited<ReturnType<typeof testRender>>,
  direction: "up" | "down" | "left" | "right",
) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name !== direction) return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressArrow(direction);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

async function parsedEnter(setup: Awaited<ReturnType<typeof testRender>>) {
  await rawParsedEnter(setup);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

test("arrow-first browser selection enters Details, reads, cycles panes, and returns to its skill", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          installed: {
            load: async (request) => {
              loads.push(request.address.path);
              return request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent;
            },
            listResources: async () => readerResources,
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    expect(browser).toBeInstanceOf(SelectRenderable);
    const list = browser as SelectRenderable;
    const first = list.getSelectedOption()?.value;
    await parsedArrow(setup, "down");
    await setup.waitFor(() => list.getSelectedOption()?.value !== first);
    await checkpoint(setup, "installed-skill-browser", "Installed browser Down");
    const selectedAddress = list.getSelectedOption()?.value;
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await parsedArrow(setup, "down");
    await checkpoint(setup, "workspace-action-skill-check-updates", "Skill action Down");
    await parsedArrow(setup, "up");
    await checkpoint(setup, "skill-inspector-open-reader", "Skill action Up");

    await parsedEnter(setup);
    await checkpoint(setup, "reader-scrollbox", "Read Enter");
    expect(JSON.parse(selectedAddress!)).toEqual(["team-main", "reference"]);
    await setup.waitForFrame((frame) => frame.includes("Reader · reference"));

    // Reader body Up reaches tabs; horizontal arrows switch Reader sections.
    await parsedArrow(setup, "up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-skill",
    );
    await parsedArrow(setup, "right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-resources",
    );
    await parsedEnter(setup);
    await checkpoint(setup, "resource-browser", "Enter populated Resources");
    await setup.waitForFrame((frame) => frame.includes("Reader / Resources"));
    await parsedArrow(setup, "up");
    await checkpoint(setup, "reader-tabs-tab-resources", "Resources Up to tabs");
    await parsedArrow(setup, "right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-details",
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Reader / Details"));
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    await parsedArrow(setup, "right");
    await checkpoint(
      setup,
      "reader-details-action-skill-check-updates",
      "Details Right enters actions",
    );
    await parsedArrow(setup, "down");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-action-skill-rebind",
    );
    expect(loads).toHaveLength(1);

    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skill-inspector-open-reader");
    expect(setup.captureCharFrame()).toContain(JSON.parse(selectedAddress!)[1]);
    await parsedEscape(setup);
    await setup.waitFor(() => {
      const restored = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        restored instanceof SelectRenderable &&
        restored.getSelectedOption()?.value === selectedAddress
      );
    });
    expect(loads).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("update workbench arrows preserve selection and Escape leaves without applying", async () => {
  const observations: unknown[] = [];
  const updates: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          installed: {
            checkUpdate: async (request) => {
              observations.push(request);
              return {
                value: {
                  source: request.source,
                  kind: "github",
                  exactRevision: "arrow-review",
                  changed: [{ path: "guide", name: "guide", description: "Changed guide" }],
                  added: [],
                  removed: [],
                  unchanged: [],
                  baseline: "baseline:test",
                },
                diagnostics: [],
              };
            },
            update: async (request) => {
              updates.push(request);
              return { value: undefined, diagnostics: [] };
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 140, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    await focusLive(setup, "shell-section-tab-skills");
    await parsedArrow(setup, "right");
    await parsedArrow(setup, "right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await focusLive(setup, "workspace-action-check-updates");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    await focusLive(setup, "updates-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
    const selection = await focusLive(setup, "source-updates-browser");
    await parsedArrow(setup, "down");
    await parsedArrow(setup, "up");
    expect(setup.renderer.currentFocusedRenderable).toBe(selection);
    expect(updates).toEqual([]);
    // Space marks the current installed root; navigation and checking never publish.
    setup.mockInput.pressKey(" ");
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Update selected 1"));
    expect(updates).toEqual([]);
    await parsedEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Ctrl+U Update all"));
    expect(setup.renderer.root.findDescendantById("source-updates-browser")).toBe(selection);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    expect(observations.length).toBeGreaterThan(0);
    expect(
      observations.every((request) => (request as { source: string }).source === "team-main"),
    ).toBe(true);
    expect(updates).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
