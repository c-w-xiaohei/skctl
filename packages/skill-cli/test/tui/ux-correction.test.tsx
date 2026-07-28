import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

const emptyProjection = () =>
  workspaceProjection({ includeDirect: false, includeContribution: false });

test("RENDER empty Workspace explains the first step and Enter opens Source registration", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Add your first Skill");
    expect(setup.captureCharFrame()).not.toContain("No Installed Skill Selected");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Add Source"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Workspace section navigation switches Skills, Collections, and Sources", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Add your first Skill");
    setup.renderer.root.findDescendantById("workspace-section-browser")?.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Collections");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Sources");
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Collections");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER top destinations traverse with Left and Right after Tab focuses the tabs", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Add your first Skill");
    setup.renderer.root.findDescendantById("top-navigation")?.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Global");
    setup.renderer.root.findDescendantById("top-navigation")?.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Project");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Local");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty config sections expose readable actions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Add your first Skill");
    setup.renderer.root.findDescendantById("top-navigation")?.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    setup.renderer.root.findDescendantById("config-section-browser")?.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Sources");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Config Sources");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Collections");
    expect(setup.captureCharFrame()).not.toContain(
      "Sources Config Sources Collections For agents Integrations",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER width 43 keeps empty navigation and help readable", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 43, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Add your first Skill");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("←/→");
    expect(frame).not.toContain("SkillsCollectionsSources");
  } finally {
    setup.renderer.destroy();
  }
});
