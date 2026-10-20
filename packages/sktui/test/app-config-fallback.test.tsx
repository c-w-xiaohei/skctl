/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { SelectRenderable } from "@opentui/core";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter } from "./reader-test-controls";

test("RENDER App mounts only the destination surface without an orphan Config fallback", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-scope-select"));
    expect(setup.renderer.root.findDescendantById("config-work-area")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("config-source-browser")).toBeUndefined();
    expect(setup.captureCharFrame()).not.toContain("Read-only Config");

    await enterLive(setup, "shell-scope-select");
    const choices = await focusLive(setup, "scope-choices");
    expect(choices).toBeInstanceOf(SelectRenderable);
    const list = choices as SelectRenderable;
    const project = list.options.findIndex((option) => option.value === "project");
    expect(project).toBeGreaterThanOrEqual(0);
    for (let step = 0; step < project; step++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-work-area"));
    expect(setup.renderer.root.findDescendantById("config-source-browser")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
