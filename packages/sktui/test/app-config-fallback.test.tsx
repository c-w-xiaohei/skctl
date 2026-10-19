/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

test("RENDER App mounts only the destination surface without an orphan Config fallback", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.flush();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
    );
    expect(setup.renderer.root.findDescendantById("config-work-area")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("config-source-browser")).toBeUndefined();
    expect(setup.captureCharFrame()).not.toContain("Read-only Config");

    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    workspace.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === workspace);
    while (setup.renderer.currentFocusedRenderable?.id !== "top-navigation-tab-project") {
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
    }
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-work-area"));
    expect(setup.renderer.root.findDescendantById("config-source-browser")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
