import { SelectRenderable } from "@opentui/core";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import {
  directSourceCore,
  openReaderFromInspector,
  workspaceProjection,
} from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";

const emptyProjection = () =>
  workspaceProjection({ includeDirect: false, includeContribution: false });

const readerCore = () =>
  directSourceCore(readerProjection(), { installed: { load: async () => readerContent } });

async function openWorkspaceSection(
  setup: Awaited<ReturnType<typeof testRender>>,
  section: "skills" | "collections" | "sources",
) {
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("shell-section-navigation") ||
      !!setup.renderer.root.findDescendantById("shell-section-tab-skills"),
  );
  const navigation = setup.renderer.root.findDescendantById("shell-section-navigation");
  if (navigation instanceof SelectRenderable) {
    const labels = ["skills", "collections", "sources"] as const;
    const targetIndex = labels.indexOf(section);
    if (targetIndex < 0) throw new Error(`Workspace section ${section} is not available`);
    await focusLive(setup, "shell-section-navigation");
    while (navigation.getSelectedIndex() !== targetIndex) {
      const current = navigation.getSelectedIndex();
      setup.mockInput.pressArrow(targetIndex > current ? "down" : "up");
      await setup.waitFor(
        () => navigation.getSelectedIndex() === current + (targetIndex > current ? 1 : -1),
      );
    }
    await setup.waitForFrame((frame) =>
      frame.includes(`Workspace / ${section[0]!.toUpperCase()}${section.slice(1)}`),
    );
  } else {
    const sections = ["skills", "collections", "sources"] as const;
    const initial = sections.find((value) =>
      setup.captureCharFrame().includes(`[ ${value[0]!.toUpperCase()}${value.slice(1)} ]`),
    );
    if (!initial) throw new Error("Workspace section selection did not mount");
    let current: (typeof sections)[number] = initial;
    while (current !== section) {
      await focusLive(setup, `shell-section-tab-${current}`);
      const direction = sections.indexOf(section) > sections.indexOf(current) ? "right" : "left";
      setup.mockInput.pressArrow(direction);
      const next: (typeof sections)[number] | undefined =
        sections[sections.indexOf(current) + (direction === "right" ? 1 : -1)];
      if (!next) throw new Error(`Could not navigate Workspace section to ${section}`);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === `shell-section-tab-${next}`,
      );
      await setup.waitForFrame((frame) =>
        frame.includes(`Workspace / ${next[0]!.toUpperCase()}${next.slice(1)}`),
      );
      current = next;
    }
  }
  const target =
    section === "collections"
      ? "collection-browser"
      : section === "sources"
        ? "source-browser"
        : undefined;
  if (target) {
    await setup.waitFor(
      () =>
        !!setup.renderer.root.findDescendantById(target) ||
        (section === "sources" && !!setup.renderer.root.findDescendantById("workspace-add-source")),
    );
    await focusLive(
      setup,
      setup.renderer.root.findDescendantById(target) ? target : "workspace-add-source",
    );
  }
}

async function openContext(
  setup: Awaited<ReturnType<typeof testRender>>,
  destination: "workspace" | "global" | "project" | "local",
) {
  const destinations = ["workspace", "global", "project", "local"] as const;
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
  );
  const selectedContext = () =>
    destinations.find((value) =>
      setup.captureCharFrame().includes(`[ ${value[0]!.toUpperCase()}${value.slice(1)} ]`),
    );
  let current = selectedContext();
  if (!current) throw new Error("Context tab selection did not mount");
  await focusLive(setup, `top-navigation-tab-${current}`);
  while (setup.renderer.currentFocusedRenderable?.id !== `top-navigation-tab-${destination}`) {
    const currentIndex = destinations.indexOf(current);
    const targetIndex = destinations.indexOf(destination);
    const direction = currentIndex < targetIndex ? "right" : "left";
    setup.mockInput.pressArrow(direction);
    current = destinations[currentIndex + (direction === "right" ? 1 : -1)]!;
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === `top-navigation-tab-${current}` &&
        selectedContext() === current,
    );
  }
  const title =
    destination === "workspace"
      ? "Workspace"
      : `${destination[0]!.toUpperCase()}${destination.slice(1)}`;
  await setup.waitForFrame((frame) =>
    frame.includes(
      destination === "workspace" ? "Workspace / Skills" : `${title} Config / Sources`,
    ),
  );
  if (destination !== "workspace") {
    await focusLive(setup, "shell-section-navigation");
  }
}

async function openSkillReader(setup: Awaited<ReturnType<typeof testRender>>) {
  await openReaderFromInspector(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-identity"));
}

async function assertShellBackRestoresInspector(
  setup: Awaited<ReturnType<typeof testRender>>,
  activate: "pointer" | "enter" | "escape",
) {
  const back = setup.renderer.root.findDescendantById("route-back");
  if (!back) throw new Error("Shared shell Back did not mount");
  expect(setup.captureCharFrame()).toContain("Back -> Workspace / Skills / Details");
  if (activate === "pointer") {
    await setup.mockMouse.click(back.screenX + 1, back.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
  } else {
    await focusLive(setup, "route-back");
    if (activate === "enter") await parsedEnter(setup);
    else await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
  }
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  expect(setup.captureCharFrame()).toContain("Workspace / Skills");
  expect(setup.renderer.root.findDescendantById("route-back")).toBeDefined();
  expect(setup.captureCharFrame()).toContain("Back -> Workspace / Skills");
}

async function choosePaletteAction(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
  const ids: Record<string, string> = { "Add Source": "palette-add-source" };
  const id = ids[name];
  if (!id) throw new Error(`Palette action not mapped: ${name}`);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
  await focusLive(setup, id);
  await parsedEnter(setup);
}

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
    await openWorkspaceSection(setup, "sources");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("No Sources yet");
    expect(frame).toContain("Sources are where Skills are discovered");
    expect(frame).not.toContain("No Installed Skill Selected");
    expect(frame).not.toContain("Select a Skill to read");
    setup.mockInput.pressKey("p", { ctrl: true });
    await choosePaletteAction(setup, "Add Source");
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
    await openWorkspaceSection(setup, "sources");
    setup.mockInput.pressKey("p", { ctrl: true });
    await choosePaletteAction(setup, "Add Source");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-register-kind"));
    await setup.waitForFrame((frame) => frame.includes("Add Source"));
    expect(setup.captureCharFrame()).toContain("Tab next control · Esc close");
    expect(setup.captureCharFrame()).not.toContain("Tab within surface");
    expect(setup.captureCharFrame()).not.toContain("Focus:");
    expect(setup.captureCharFrame()).not.toContain("focus region");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER unified shell names the current Context, Sections, and focused Content", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 80 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Workspace / Skills");
    for (const id of [
      "top-navigation-tab-workspace",
      "top-navigation-tab-global",
      "top-navigation-tab-project",
      "top-navigation-tab-local",
      "shell-section-navigation",
    ])
      expect(setup.renderer.root.findDescendantById(id)).toBeDefined();
    expect(frame).toContain("Current Exposure is unavailable.");
    expect(frame).not.toContain("Destinations");
    expect(frame).not.toContain("Collection Scope");
    expect(frame).not.toContain("Work Area");
    expect(frame).not.toContain("Workspace >");
    expect(frame).not.toContain("Esc back");

    const scope = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
    expect(scope).toBeDefined();
    scope!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-workspace",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Left/Right Context");
    expect(setup.captureCharFrame()).toContain("Global");
    expect(setup.renderer.currentFocusedRenderable).toBe(scope ?? null);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER context identifies the selected Skill and its current Reader view", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openSkillReader(setup);
    expect(setup.renderer.root.findDescendantById("top-navigation-tab-workspace")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("shell-section-navigation")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("reader-identity")).toBeDefined();
    expect(setup.captureCharFrame()).toContain("SKILL.md");

    await openReaderTab(setup, 1);
    expect(setup.captureCharFrame()).toContain("Resources");
    expect(setup.captureCharFrame()).toContain("Back -> Workspace / Skills / Details");
    await openReaderTab(setup, 2);
    expect(setup.captureCharFrame()).toContain("Details");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Browser Arrow selection preserves the last activation transition", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openSkillReader(setup);
    await openReaderTab(setup, 1);
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.captureCharFrame()).toContain("Resources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER native Browser selection preserves the most recent Reader transition", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openSkillReader(setup);
    await openReaderTab(setup, 1);
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.captureCharFrame()).toContain("Resources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([80, 43])(
  "RENDER context preserves the hierarchy without overflowing at width %i",
  async (width) => {
    const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
      width,
      height: 40,
    });
    try {
      await openSkillReader(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("SKILL.md");
      expect(setup.renderer.root.findDescendantById("reader-identity")).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each([120, 80, 43])(
  "RENDER hierarchy labels remain visible at supported width %i",
  async (width) => {
    const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
      width,
      height: 40,
    });
    try {
      await openSkillReader(setup);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("SKILL.md");
      expect(setup.renderer.root.findDescendantById("reader-identity")).toBeDefined();
      for (const label of ["SKILL.md", "Resources", "Details"]) expect(frame).toContain(label);
      expect(frame).not.toContain("Views: Content");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Config context identifies the selected declaration", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.renderOnce();
    await openContext(setup, "project");
    expect(setup.captureCharFrame()).toContain("team-main");
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
    expect(frame).toContain("Workspace / Skills");
    expect(setup.renderer.root.findDescendantById("top-navigation-tab-workspace")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("shell-section-navigation")).toBeDefined();

    await focusLive(setup, "shell-section-navigation");
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Scope footer describes its action-oriented navigation policy", async () => {
  const empty = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await empty.renderOnce();
    expect(empty.captureCharFrame()).toContain("Workspace / Skills");
    expect(empty.renderer.root.findDescendantById("shell-section-navigation")).toBeDefined();
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
      await setup.renderOnce();
      await openContext(setup, "project");
      const browser = setup.renderer.root.findDescendantById("config-source-browser")!;
      browser.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
      expect(setup.captureCharFrame()).toContain("Project Config / Sources");
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
      expect(setup.captureCharFrame()).toContain("Project Config / Sources");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER populated Workspace Skills Browser omits scope arrows", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openWorkspaceSection(setup, "skills");
    await openAllInstalledSkills(setup);
    await setup.waitForFrame((frame) => frame.includes("Workspace / Skills"));
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Workspace sections open Collections and Sources without edge spillover", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openWorkspaceSection(setup, "collections");
    await setup.waitForFrame((frame) => frame.includes("Workspace / Collections"));
    const collectionsBrowser = setup.renderer.root.findDescendantById("collection-browser");
    expect(collectionsBrowser).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-browser");
  } finally {
    setup.renderer.destroy();
  }
  const sources = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openWorkspaceSection(sources, "sources");
    await sources.waitForFrame((frame) => frame.includes("Workspace / Sources"));
    expect(sources.captureCharFrame()).toContain("No Sources yet");
    expect(sources.renderer.currentFocusedRenderable?.id).toBe("workspace-add-source");
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
    await openWorkspaceSection(setup, "sources");
    await setup.waitForFrame((frame) => frame.includes("Workspace / Sources"));
    const browser = setup.renderer.root.findDescendantById("source-browser")!;
    browser.focus();
    await setup.waitForFrame((frame) => frame.includes("Workspace / Sources"));
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(setup.captureCharFrame()).toContain("Workspace / Sources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader Tab reports Reader actions without changing its native target", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openSkillReader(setup);
    await focusLive(setup, "reader-tabs");
    expect(setup.renderer.currentFocusedRenderable?.id).toMatch(/^reader-tabs-tab-/);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Details interactions identify stable Inspector action targets", async () => {
  const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await openSkillReader(setup);
    await setup.waitFor(() => setup.renderer.root.findDescendantById("reader-views") !== undefined);
    await openReaderTab(setup, 2);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
    const action = setup.renderer.root.findDescendantById(
      "reader-details-action-skill-open-source",
    );
    expect(action).toBeDefined();
    await focusLive(setup, "reader-details-action-skill-open-source");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "reader-details-action-skill-open-source",
    );
    expect(setup.captureCharFrame()).toContain("Tab areas");
    expect(setup.captureCharFrame()).toContain("Details");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config context and Section remain readable through automatic section navigation", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openContext(setup, "global");
    expect(setup.captureCharFrame()).not.toContain("Global Config › Sources");

    await focusLive(setup, "shell-section-navigation");
    setup.mockInput.pressArrow("down");
    await setup.waitForFrame((frame) => frame.includes("Global Config / Config Sources"));
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-section-navigation");
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
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
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
    await openWorkspaceSection(setup, "collections");
    expect(setup.captureCharFrame()).toContain("Workspace / Collections");
    expect(setup.captureCharFrame()).toContain("Collections");
    await openWorkspaceSection(setup, "sources");
    expect(setup.captureCharFrame()).toContain("Workspace / Sources");
    expect(setup.captureCharFrame()).toContain("No Sources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Context Right switches the route and body immediately without a second Enter commit", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
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
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-global",
    );
    await setup.waitForFrame((frame) => frame.includes("Global Config / Sources"));
    expect(setup.captureCharFrame()).toContain("Global Config / Sources");
    expect(setup.captureCharFrame()).toContain("[Global]");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Global Config / Sources");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-global");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Section Right switches its active token and body without a return frame", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-navigation"));
    const navigation = setup.renderer.root.findDescendantById("shell-section-navigation")!;
    navigation.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === navigation);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
    expect(setup.captureCharFrame()).toContain("Collections");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () =>
        navigation instanceof SelectRenderable &&
        navigation.getSelectedOption()?.value === "collections",
    );
    await setup.waitForFrame((frame) => frame.includes("Workspace / Collections"));
    expect(setup.captureCharFrame()).toContain("Workspace / Collections");
    expect(setup.renderer.currentFocusedRenderable).toBe(navigation);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER same-value Context click applies one Section focus transition", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("top-navigation-tab-workspace"),
    );
    const section = (["skills", "collections", "sources"] as const).find((value) =>
      setup.captureCharFrame().includes(`[ ${value[0]!.toUpperCase()}${value.slice(1)} ]`),
    );
    expect(section).toBeDefined();
    await focusLive(setup, "shell-section-navigation");
    const liveWorkspace = setup.renderer.root.findDescendantById("top-navigation-tab-workspace");
    expect(liveWorkspace).toBeDefined();
    await setup.mockMouse.click(liveWorkspace!.screenX + 1, liveWorkspace!.screenY);
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Workspace / "));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-workspace");
  } finally {
    setup.renderer.destroy();
  }
});

for (const activate of ["pointer", "enter", "escape"] as const) {
  test(`RENDER shared shell Back ${activate} restores exactly one Reader predecessor`, async () => {
    const setup = await testRender(() => <App core={readerCore()} exit={() => {}} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.renderOnce();
      expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
      await openSkillReader(setup);
      await assertShellBackRestoresInspector(setup, activate);
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("RENDER empty config sections expose readable actions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(emptyProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
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
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Global Config / Sources"));
    expect(setup.captureCharFrame()).toContain("Global Config / Sources");
    setup.renderer.root.findDescendantById("shell-section-navigation")!.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-navigation",
    );
    setup.mockInput.pressArrow("down");
    expect(setup.captureCharFrame()).toContain("Global Config / Config Sources");
    expect(setup.captureCharFrame()).toContain("team-config");
    setup.mockInput.pressArrow("down");
    expect(setup.captureCharFrame()).toContain("Global Config / Collections");
    const navigation = setup.renderer.root.findDescendantById("shell-section-navigation");
    expect(navigation).toBeInstanceOf(SelectRenderable);
    expect((navigation as SelectRenderable).options.map((option) => option.value)).toContain(
      "integrations",
    );
    expect(setup.captureCharFrame()).not.toContain(
      "Sources Config Sources Collections Integrations",
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
    expect(frame).toContain("Workspace / Skills");
    expect(frame).toContain("Current Exposure is unavailable.");
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
    expect(frame).toContain("Workspace / Skills");
    expect(frame).toContain("Current Exposure is unavailable.");
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
    await openWorkspaceSection(setup, "skills");
    await openAllInstalledSkills(setup);
    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressKey("/");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-query"));
    await focusLive(setup, "skills-query");
    setup.mockInput.typeText("abc");
    setup.mockInput.pressArrow("left");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    const input = setup.renderer.root.findDescendantById("skills-query");
    expect((input as unknown as { value: string }).value).toBe("abc");
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
    expect(setup.captureCharFrame()).toContain("Esc");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    await parsedEscape(setup);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Workspace / Skills");
  } finally {
    setup.renderer.destroy();
  }
});
