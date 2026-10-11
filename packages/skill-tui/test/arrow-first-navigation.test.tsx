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
import { parsedEscape, parsedEnter as rawParsedEnter } from "./reader-test-controls";

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
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return {
              value:
                request.address.path === readerSecondAddress.path
                  ? readerSecondContent
                  : readerContent,
              diagnostics: [],
            };
          },
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
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

test("update review arrows preserve selection policy and Escape cancels without applying", async () => {
  const observations: unknown[] = [];
  const updates: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
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
              },
              diagnostics: [],
            };
          },
          update: async (request) => {
            updates.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 140, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    // Move from the initial Skills browser to the page-navigation sidebar, then
    // choose Sources and enter its content with arrows and Enter only.
    await setup.renderOnce();
    await parsedArrow(setup, "left");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-navigation",
    );
    await parsedArrow(setup, "down");
    await parsedArrow(setup, "down");
    await parsedEnter(setup);
    await checkpoint(setup, "source-browser", "Sources page enter");
    await parsedEnter(setup);
    await checkpoint(setup, "workspace-action-check-updates", "Source inspector Enter");
    await parsedEnter(setup);
    await checkpoint(setup, "source-operation-selection", "Source update Enter");
    const selection = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    ) as SelectRenderable;
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(selection.id);
    expect(selection.getSelectedOption()?.value).toBe("guide");
    expect(updates).toEqual([]);

    // Enter marks a candidate without committing; Down at the last row reaches Cancel.
    await parsedEnter(setup);
    await parsedArrow(setup, "down");
    await checkpoint(setup, "source-operation-cancel", "Review boundary enters commands");
    await parsedArrow(setup, "down");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-operation-submit",
    );
    await parsedArrow(setup, "up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-operation-cancel",
    );
    expect(updates).toEqual([]);
    expect(selection.getSelectedOption()?.value).toBe("guide");

    await parsedEscape(setup);
    await setup.waitFor(
      () => !setup.renderer.root.findDescendantById("source-operation-selection"),
    );
    expect(observations).toEqual([{ source: "team-main" }]);
    expect(updates).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
