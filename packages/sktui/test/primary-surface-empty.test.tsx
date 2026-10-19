import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

test("empty cold startup has a real enabled primary control and no phantom Browser focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 100,
      height: 30,
    },
  );
  try {
    await setup.flush();
    await setup.renderOnce();
    const focused = setup.renderer.currentFocusedRenderable;
    expect(focused?.parent).toBeDefined();
    expect(focused?.isDestroyed).toBe(false);
    expect(focused?.id).not.toBe("skills-view-tab-all-installed-skills");
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.parent).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.isDestroyed).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});
