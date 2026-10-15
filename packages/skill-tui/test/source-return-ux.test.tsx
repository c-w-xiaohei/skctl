import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";

test("RENDER Source Skills and details return restore the selected Source and list viewport", async () => {
  const projection = workspaceProjection();
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...projection.effective.sources[0]!,
    id: `source-${index}`,
  }));
  const acquisitions: string[] = [];
  const mutations: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          {
            ...projection,
            effective: { ...projection.effective, sources },
          },
          {
            discover: async ({ source }) => {
              acquisitions.push(source);
              throw new Error("Source navigation must not discover Skills");
            },
            install: async ({ source }) => {
              mutations.push(`install:${source}`);
              throw new Error("Source navigation must not install Skills");
            },
            update: async ({ source }) => {
              mutations.push(`update:${source}`);
              throw new Error("Source navigation must not update Skills");
            },
          },
        )}
        exit={() => {}}
      />
    ),
    { width: 80, height: 16 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
    await focusLive(setup, "shell-section-tab-skills");
    for (const section of ["collections", "sources"]) {
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(`shell-section-tab-${section}`);
    }
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    const browser = (await focusLive(setup, "source-browser")) as SelectRenderable;
    for (let index = 1; index < 8; index++) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === index);
    }
    expect(browser.getSelectedOption()?.value).toBe("source-7");
    const savedOffset = selectScrollOffset(browser);
    expect(savedOffset).toBeGreaterThan(0);

    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
    await setup.waitForFrame((frame) => frame.includes("source-7"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-browser");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const details = choices.options.findIndex(
      (option) => option.value.id === "source-updates.source-details",
    );
    expect(details).toBeGreaterThanOrEqual(0);
    expect(choices.options[details]!.value.destination).toBe("source-7");
    for (let index = 0; index < details; index++) setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-metadata"));
    await setup.waitForFrame((frame) => frame.includes("source-7"));
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-browser");
    await parsedEscape(setup);
    await setup.waitFor(() => {
      const returned = setup.renderer.root.findDescendantById("source-browser");
      return (
        returned instanceof SelectRenderable && returned.getSelectedOption()?.value === "source-7"
      );
    });

    const returned = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(returned).not.toBe(browser);
    expect(returned.getSelectedOption()?.value).toBe("source-7");
    expect(selectScrollOffset(returned)).toBe(savedOffset);
    expect(setup.renderer.currentFocusedRenderable).toBe(returned);
    expect(acquisitions).toEqual([]);
    expect(mutations).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
