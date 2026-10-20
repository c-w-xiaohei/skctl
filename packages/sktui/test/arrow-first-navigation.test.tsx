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
import {
  focusLive,
  openAllInstalledSkills,
  parsedEscape,
  parsedEnter as rawParsedEnter,
  waitForReaderBody,
} from "./reader-test-controls";
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
test("arrow-first browser selection reads directly, cycles Reader views, and returns to the same Skill", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) => {
            loads.push(request.address.path);
            return request.address.path === readerSecondAddress.path
              ? readerSecondContent
              : readerContent;
          },
          listInstalledResources: async () => readerResources,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await waitForReaderBody(setup, "const needle = true");
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    expect(browser).toBeInstanceOf(SelectRenderable);
    const list = browser as SelectRenderable;
    const first = list.getSelectedOption()?.value;
    await parsedArrow(setup, "down");
    await setup.waitFor(() => list.getSelectedOption()?.value !== first);
    await checkpoint(setup, "installed-skill-browser", "Installed browser Down");
    const selectedAddress = list.getSelectedOption()?.value;
    await waitForReaderBody(setup, "reference needle");
    expect(loads).toEqual(["guide", "reference"]);
    expect(setup.renderer.root.findDescendantById("skill-inspector-open-reader")).toBeUndefined();
    await parsedEnter(setup);
    await checkpoint(setup, "reader-scrollbox", "Read Enter");
    expect(JSON.parse(selectedAddress!)).toEqual(["team-main", "reference"]);
    expect(loads).toHaveLength(2);
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
    await parsedArrow(setup, "up");
    await checkpoint(setup, "reader-tabs-tab-resources", "Resources Up to tabs");
    await parsedArrow(setup, "right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-tabs-tab-details",
    );
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    await parsedArrow(setup, "right");
    const control = setup.renderer.currentFocusedRenderable;
    expect(control?.id).not.toBe("reader-details");
    expect(control?.id).not.toBe("reader-action-skill-check-updates");
    // Details arrows stay in its local controls; the persistent Update action
    // does not intercept content navigation.
    await parsedArrow(setup, "left");
    await checkpoint(setup, "reader-details", "Details Left returns to body");
    await parsedEscape(setup);
    await setup.waitFor(() => {
      const restored = setup.renderer.root.findDescendantById("installed-skill-browser");
      return (
        restored instanceof SelectRenderable &&
        restored.getSelectedOption()?.value === selectedAddress
      );
    });
    expect(setup.renderer.currentFocusedRenderable).toBe(list);
    expect(loads).toEqual(["guide", "reference"]);
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
          getUpdateBaseline: async () => ({ value: "baseline:test", diagnostics: [] }),
          checkUpdate: async (_environment: import("@skctl/core").CoreOptions, request) => {
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
          updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
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
      observations.every(
        (request) =>
          (
            request as {
              source: string;
            }
          ).source === "team-main",
      ),
    ).toBe(true);
    expect(updates).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
