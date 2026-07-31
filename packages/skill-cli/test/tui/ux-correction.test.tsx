import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

const emptyProjection = () =>
  workspaceProjection({ includeDirect: false, includeContribution: false });

function WorkspaceContentFragment() {
  return (
    <>
      <box id="workspace-fragment-child" />
    </>
  );
}

function WorkspaceOptionalContent(props: { readonly visible: boolean }) {
  return props.visible ? <box id="workspace-inactive-child" /> : null;
}

test("RENDER Workspace content component has a renderable root", async () => {
  const setup = await testRender(
    () => (
      <box>
        <WorkspaceContentFragment />
      </box>
    ),
    { width: 20, height: 5 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("workspace-fragment-child")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER inactive Workspace content branch omits its renderable", async () => {
  const setup = await testRender(
    () => (
      <box>
        <WorkspaceOptionalContent visible={false} />
      </box>
    ),
    { width: 20, height: 5 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("workspace-inactive-child")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Workspace explains the first step and Enter opens Source registration", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Add your first Skill");
    expect(frame).toContain("1. Add a Source  2. Discover  3. Install");
    expect(frame).toContain("Workspace › Skills");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "empty-workspace-action",
    );
    expect(frame).not.toContain("No Installed Skill Selected");
    expect(frame).not.toContain("Select a Skill to read");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Add Source"));
    expect(setup.renderer.root.findDescendantById("source-register-kind")).toBeDefined();
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
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
    );
    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
    if (!workspace)
      throw new Error("Workspace top-navigation trigger disappeared before it could be focused");
    workspace.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace › Collections");
    expect(setup.captureCharFrame()).toContain("No Collections");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "workspace-section-browser-tab-collections",
    );
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace › Sources");
    expect(setup.captureCharFrame()).toContain("No Sources");
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace › Collections");
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
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
    );
    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
    if (!workspace)
      throw new Error("Workspace top-navigation trigger disappeared before it could be focused");
    workspace.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Global Config › Sources"));
    expect(setup.captureCharFrame()).toContain("Global Config › Sources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-global");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Project Config › Sources"));
    expect(setup.captureCharFrame()).toContain("Project Config › Sources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-project");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Local Config › Sources"));
    expect(setup.captureCharFrame()).toContain("Local Config › Sources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-local");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Workspace › Skills"));
    expect(setup.captureCharFrame()).toContain("Workspace › Skills");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-workspace");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER same-value primary top-nav click restores top-nav Tab traversal", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
    );
    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    await setup.mockMouse.click(workspace.screenX + 1, workspace.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
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
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
    );
    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
    if (!workspace)
      throw new Error("Workspace top-navigation trigger disappeared before it could be focused");
    workspace.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Global Config › Sources"));
    expect(setup.captureCharFrame()).toContain("Global Config › Sources");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-section-browser-tab-sources",
    );
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Global Config › Config Sources");
    expect(setup.captureCharFrame()).toContain("team-config");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Global Config › Collections");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Global Config › For agents");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Global Config › Integrations");
    expect(setup.captureCharFrame()).toContain("No integrations yet");
    expect(setup.captureCharFrame()).not.toContain(
      "Sources Config Sources Collections For agents Integrations",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER width 80 keeps chrome, section tabs, and help readable", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Add your first Skill");
    expect(frame).toContain("Workspace › Skills");
    expect(frame).toContain("←/→");
    expect(frame).not.toContain("SkillsCollectionsSources");
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
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Add your first Skill");
    expect(frame).toContain("Workspace › Skills");
    expect(frame).toContain("←/→");
    expect(frame).not.toContain("SkillsCollectionsSources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER focused search Input owns typing and arrows", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...workspaceProjection(),
          installedSkills: [
            {
              address: { source: "team-main", path: "installed" },
              name: "installed",
              description: "Installed",
              owner: { source: "team-main", health: "healthy" as const },
              collections: [],
              selectors: [],
              selectorViews: { status: "unavailable" as const },
              aliases: [],
              problems: [],
            },
          ],
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("SKILL.md"));
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-query");
    setup.mockInput.typeText("abc");
    setup.mockInput.pressArrow("left");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    const input = setup.renderer.root.findDescendantById("skills-query");
    expect((input as unknown as { value: string }).value).toBe("abc");
    expect(setup.captureCharFrame()).toContain("Workspace › Skills");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    await new Promise<void>((resolve) => {
      const onKeypress = (event: { readonly name: string }) => {
        if (event.name === "escape" || event.name === "esc") {
          setup.renderer.keyInput.off("keypress", onKeypress);
          resolve();
        }
      };
      setup.renderer.keyInput.prependListener("keypress", onKeypress);
      setup.mockInput.pressKey("ESCAPE");
    });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
  } finally {
    setup.renderer.destroy();
  }
});
