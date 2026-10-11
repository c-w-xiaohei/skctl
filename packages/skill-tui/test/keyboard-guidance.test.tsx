import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { focusLive, parsedEnter } from "./reader-test-controls";

test("Skill controls expose their actual Enter action and Tab moves without executing", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    {
      width: 100,
      height: 30,
    },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await focusLive(setup, "skill-inspector-open-reader");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Enter Read SKILL.md");
    expect(setup.captureCharFrame()).toContain("Tab/Shift+Tab panels");
    setup.mockInput.pressTab();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("←→ change context");
    expect(setup.renderer.root.findDescendantById("reader-tabs-tab-skill")).toBeUndefined();
    setup.mockInput.pressTab({ shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-tabs-tab-skill"));
    await focusLive(setup, "reader-tabs-tab-skill");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("←→ change Reader view");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Reader / Resources"));
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
    await focusLive(setup, "reader-details-action-skill-check-updates");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Enter Check / update Skill");
  } finally {
    setup.renderer.destroy();
  }
});

test("narrow Skill details retains specific Enter guidance and arrow selection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    {
      width: 43,
      height: 30,
    },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await focusLive(setup, "installed-skill-browser");
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await focusLive(setup, "workspace-action-skill-check-updates");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Enter Check / update Skill");
    expect(setup.captureCharFrame()).toContain("Tab/Shift+Tab panels");
    expect(setup.captureCharFrame()).not.toContain("Enter details");
  } finally {
    setup.renderer.destroy();
  }
});
