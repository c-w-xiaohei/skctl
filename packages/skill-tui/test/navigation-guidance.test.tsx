import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { parsedEnter, parsedEscape } from "./reader-test-controls";

test("the persistent footer distinguishes Tab panel traversal from row selection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Tab/Shift+Tab panels");
    expect(setup.captureCharFrame()).toContain("↑↓ select Skill");
  } finally {
    setup.renderer.destroy();
  }
});

test("context tabs advertise their actual horizontal navigation", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressArrow("left");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-navigation",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("↑↓ change page");
    setup.mockInput.pressArrow("left");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("←→ change context");
    expect(setup.captureCharFrame()).not.toContain("↑↓ change context");
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader's return hint names Skill details rather than claiming Pages", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await parsedEnter(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    expect(setup.captureCharFrame()).toContain("Esc Skills details");
    await parsedEscape(setup);
    expect(setup.captureCharFrame()).toContain("Tab/Shift+Tab panels");
  } finally {
    setup.renderer.destroy();
  }
});
