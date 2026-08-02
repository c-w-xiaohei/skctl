import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

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
    expect(frame).toContain("Browse · Workspace > Skills");
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

test("RENDER registration dialog replaces Browser help", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "empty-workspace-action",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-register-kind"));
    await setup.waitForFrame((frame) => frame.includes("Dialog"));
    expect(setup.captureCharFrame()).toContain("Enter select · Tab within surface · Esc close");
    expect(setup.captureCharFrame()).not.toContain("Focus: Browser ·");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER existing chrome describes hierarchy and Tab focus regions without changing stable targets", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Scope:");
    expect(setup.captureCharFrame()).toContain("Navigation:");
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Skills");
    expect(setup.captureCharFrame()).toContain("Focus: Browser");
    expect(setup.captureCharFrame()).toContain("Tab/Shift+Tab focus region");
    expect(setup.captureCharFrame()).toContain("Ctrl+P actions");

    const scope = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
    expect(scope).toBeDefined();
    scope!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "workspace-section-browser-tab-skills",
    );
    expect(setup.captureCharFrame()).toContain("Focus: Section");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER context identifies the selected Skill and its current Reader view", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.captureCharFrame()).toContain("View:");
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Skills · guide · SKILL.md");

    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) =>
      frame.includes("Browse · Workspace > Skills · guide · Resources"),
    );
    expect(setup.captureCharFrame()).toContain("Reader view: Resources");
    expect(setup.captureCharFrame()).toContain("Esc back to Browser");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) =>
      frame.includes("Browse · Workspace > Skills · guide · Details"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Browser Arrow selection preserves the last activation transition", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Reader view: Resources"));
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("reference · SKILL.md"));
    expect(setup.captureCharFrame()).toContain("Reader view: Resources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER native Browser selection preserves the most recent Reader transition", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Reader view: Resources"));

    const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
    browser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();

    expect(setup.captureCharFrame()).toContain("Reader view: Resources");
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([80, 43])(
  "RENDER context preserves the hierarchy without overflowing at width %i",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Browse · Workspace > Skills");
      if (width === 80) expect(frame).toContain("guide · SKILL.md");
      else expect(frame).not.toContain("guide · SKILL.md");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each([120, 80, 43])(
  "RENDER hierarchy labels remain visible at supported width %i",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Scope:");
      expect(frame).toContain(width >= 100 ? "Navigation:" : "Section:");
      if (width !== 43) expect(frame).toContain("View:");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Config context identifies the selected declaration", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    workspace.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-global",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) =>
      frame.includes("Configure · Project > Sources · team-main"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER narrow chrome keeps the active region and essential actions within one row", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 43, height: 24 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("F:Browser Tab/Shift+Tab L/R Ent Ctrl+P Esc");
    expect(frame).not.toContain("←/→ scope");

    const scope = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    await setup.mockMouse.click(scope.screenX + 1, scope.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    expect(setup.captureCharFrame()).toContain("F:Scope Tab/Shift+Tab L/R Ent Ctrl+P Esc");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Browser arrow hint follows the existing scope-navigation policy", async () => {
  const empty = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await empty.waitFor(
      () => empty.renderer.currentFocusedRenderable?.id === "empty-workspace-action",
    );
    expect(empty.captureCharFrame()).toContain(
      "Focus: Browser · Tab/Shift+Tab focus region · ←/→ change scope",
    );
  } finally {
    empty.renderer.destroy();
  }
});

test.each([120, 43])(
  "RENDER Config Browser focus does not advertise scope arrows consumed by native Select at width %i",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
      await setup.mockMouse.click(workspace.screenX + 1, workspace.screenY);
      setup.mockInput.pressArrow("right");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-global",
      );
      setup.mockInput.pressArrow("right");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-project",
      );
      const section = setup.renderer.root.findDescendantById("config-section-browser-tab-sources")!;
      await setup.mockMouse.click(section.screenX + 1, section.screenY);
      const browser = setup.renderer.root.findDescendantById("config-source-browser")!;
      browser.focus();
      const hint =
        width === 43
          ? "F:Browser Tab/Shift+Tab Ent Ctrl+P Esc"
          : "Focus: Browser · Tab/Shift+Tab focus region · Enter open";
      await setup.waitForFrame((frame) => frame.includes(hint));
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable).toBe(browser);
      expect(setup.captureCharFrame()).toContain("Configure · Project > Sources");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER populated Workspace Skills Browser omits scope arrows", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    await setup.waitForFrame((frame) => !frame.includes("←/→ change scope"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Browser scope arrows follow the focused target across empty Workspace sections", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "empty-workspace-action",
    );
    expect(setup.captureCharFrame()).toContain("←/→ change scope");

    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    await setup.mockMouse.click(workspace.screenX + 1, workspace.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
    const collectionsTab = setup.renderer.root.findDescendantById(
      "workspace-section-browser-tab-collections",
    )!;
    await setup.mockMouse.click(collectionsTab.screenX + 1, collectionsTab.screenY);
    await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Collections"));
    const collectionsBrowser = setup.renderer.root.findDescendantById("collection-browser");
    expect(collectionsBrowser).toBeDefined();
    collectionsBrowser!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === collectionsBrowser);
    await setup.waitForFrame((frame) => !frame.includes("←/→ change scope"));
  } finally {
    setup.renderer.destroy();
  }
  const sources = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    const workspace = sources.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    workspace.focus();
    await sources.waitFor(
      () => sources.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    sources.mockInput.pressKey("TAB");
    await sources.waitFor(
      () =>
        sources.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
    sources.mockInput.pressArrow("right");
    sources.mockInput.pressArrow("right");
    await sources.waitForFrame((frame) => frame.includes("Browse · Workspace > Sources"));
    expect(sources.captureCharFrame()).toContain("No Sources yet");
    expect(sources.captureCharFrame()).not.toContain("←/→ change scope");
  } finally {
    sources.renderer.destroy();
  }
});

test("RENDER populated Sources Browser omits scope arrows and retains native Right", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspaceProjection({ includeContribution: false }))}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    const workspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!;
    workspace.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
    );
    setup.mockInput.pressArrow("right");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Sources"));
    const browser = setup.renderer.root.findDescendantById("source-browser")!;
    browser.focus();
    await setup.waitForFrame((frame) => frame.includes("Focus: Browser"));
    expect(setup.captureCharFrame()).not.toContain("←/→ change scope");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Sources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader Tab reports Reader views without changing its native target", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Focus: Reader views");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details interactions identify stable Inspector action targets", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    expect(setup.captureCharFrame()).toContain("Focus: Inspector actions");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-relationships",
    );
    expect(setup.captureCharFrame()).toContain("Focus: Inspector actions");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Configure context remains canonical through section navigation", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    setup.renderer.root.findDescendantById("top-navigation-tab-workspace")!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Global > Sources"));
    expect(setup.captureCharFrame()).not.toContain("Global Config › Sources");

    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-section-browser-tab-sources",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Global > Config Sources"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "config-section-browser-tab-config-sources",
    );
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
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Collections");
    expect(setup.captureCharFrame()).toContain("Opened Workspace > Collections");
    expect(setup.captureCharFrame()).toContain("No Collections");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "workspace-section-browser-tab-collections",
    );
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Sources");
    expect(setup.captureCharFrame()).toContain("No Sources");
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Collections");
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
    await setup.waitForFrame((frame) => frame.includes("Configure · Global > Sources"));
    expect(setup.captureCharFrame()).toContain("Configure · Global > Sources");
    expect(setup.captureCharFrame()).toContain("Opened Global Config");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-global");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Sources"));
    expect(setup.captureCharFrame()).toContain("Configure · Project > Sources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-project");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Local > Sources"));
    expect(setup.captureCharFrame()).toContain("Configure · Local > Sources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-local");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Skills"));
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Skills");
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
    await setup.waitForFrame((frame) => frame.includes("Configure · Global > Sources"));
    expect(setup.captureCharFrame()).toContain("Configure · Global > Sources");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-section-browser-tab-sources",
    );
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Configure · Global > Config Sources");
    expect(setup.captureCharFrame()).toContain("team-config");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Configure · Global > Collections");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Configure · Global > For agents");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Configure · Global > Integrations");
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
    expect(frame).toContain("Browse · Workspace > Skills");
    expect(frame).toContain("Ctrl+P actions");
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
    expect(frame).toContain("Browse · Workspace > Skills");
    expect(frame).toContain("F:Browser Tab/Shift+Tab L/R Ent Ctrl+P Esc");
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
    expect(setup.captureCharFrame()).toContain("Browse · Workspace > Skills");
    expect(setup.captureCharFrame()).toContain("Esc back to Browser");
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
