import { expect, test } from "bun:test";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextBufferRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkctlError } from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
function textIn(renderable: { getChildren(): readonly unknown[] }): string {
  return (
    renderable.getChildren() as {
      getChildren?: () => readonly unknown[];
      plainText?: string;
    }[]
  )
    .flatMap((child) =>
      child instanceof TextBufferRenderable
        ? [child.plainText]
        : child.getChildren
          ? [
              textIn(
                child as {
                  getChildren(): readonly unknown[];
                },
              ),
            ]
          : [],
    )
    .join("\n");
}
async function navigateToSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await openMainPage(setup, "sources");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
  await focusLive(setup, "source-browser");
}
async function navigateToAllInstalledSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  await openAllInstalledSkills(setup);
}
async function navigateToCollections(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.flush();
  await openMainPage(setup, "collections");
  await setup.waitFor(
    () => setup.renderer.root.findDescendantById("collection-browser") !== undefined,
  );
  setup.renderer.root.findDescendantById("collection-browser")!.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
}
test("RENDER Scope ArrowDown/Enter selects Sources and focuses its browser", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await navigateToSources(setup);
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Scope ArrowDown/Enter selects All Installed Skills and focuses its browser", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await navigateToAllInstalledSkills(setup);
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Sources replaces the Collection browser native target", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await navigateToCollections(setup);
    const collections = setup.renderer.root.findDescendantById("collection-browser")!;
    await focusLive(setup, "shell-section-tab-collections");
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await focusLive(setup, "source-browser");
    expect(setup.renderer.root.findDescendantById("source-browser") === collections).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Workspace Sources keeps source identity primary and origin secondary", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await navigateToSources(setup);
    const browser = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(browser.options[0]?.name.trimEnd()).toBe("team-main");
    expect(browser.options[0]?.description.trimEnd()).toBe("github (Direct)");
    expect(browser.options[0]?.value).toBe("team-main");
    expect(browser.showDescription).toBe(false);
    expect(browser.showSelectionIndicator).toBe(true);
    expect(browser.showScrollIndicator).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER wide Workspace owns bounded Sections and Content panels", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 80 },
  );
  try {
    await setup.renderOnce();
    const scope = setup.renderer.root.findDescendantById("section-nav")!;
    const workArea = setup.renderer.root.findDescendantById("route-content") as BoxRenderable;
    for (const panel of [scope, workArea]) {
      expect(panel.screenX).toBeGreaterThanOrEqual(0);
      expect(panel.screenY).toBeGreaterThanOrEqual(0);
      expect(panel.screenX + panel.width).toBeLessThanOrEqual(120);
      expect(panel.screenY + panel.height).toBeLessThanOrEqual(80);
    }
    expect(scope.screenY + scope.height).toBeLessThanOrEqual(workArea.screenY);
    expect(setup.renderer.root.findDescendantById("workspace-navigation-panel")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("workspace-reader-panel")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Current Exposure collection detail is a vertical Work Area document", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/root",
  };
  const projection = {
    ...base,
    configs: [
      base.configs[0]!,
      {
        ...base.configs[1]!,
        direct: {
          ...base.configs[1]!.direct,
          collectionUse: [{ collection: "root", owner }],
        },
      },
    ],
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["root"],
      collectionsView: [
        {
          id: "root",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            {
              name: "guide",
              address: { source: "team-main", path: "guide" },
              paths: [
                {
                  kind: "direct" as const,
                  collection: "root",
                  entryName: "guide",
                  owner,
                },
              ],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openMainPage(setup, "agent");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    await enterLive(setup, "agent-access-collection-details");
    await setup.waitForFrame((frame) => frame.includes("root") && frame.includes("Contents"));
    await setup.renderOnce();
    const frame = setup.captureCharFrame().split("\n");
    const line = (text: string) => frame.findIndex((value) => value.includes(text));
    expect(line("root")).toBeGreaterThanOrEqual(0);
    const tabs = setup.renderer.root.findDescendantById("collection-tabs-tab-members")!;
    const rows = setup.renderer.root.findDescendantById(
      "collection-relationships",
    ) as SelectRenderable;
    const workArea = setup.renderer.root.findDescendantById("route-content")!;
    expect(tabs.screenY).toBeGreaterThan(workArea.screenY);
    expect(rows.screenY).toBeGreaterThan(tabs.screenY);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Current Exposure keeps deep Reference paths bounded while retaining endpoints", async () => {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/root",
  };
  const collectionsView = Array.from({ length: 8 }, (_, index) => ({
    id: index === 0 ? "root" : `node-${index}`,
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [],
    references:
      index < 7
        ? [
            {
              name: `branch-${index}`,
              collection: index === 0 ? "node-1" : `node-${index + 1}`,
              description: "",
              owner,
            },
          ]
        : [],
    links: [],
  }));
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["root"],
      collectionsView,
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    await focusLive(setup, "current-exposure-browser");
    const exposure = setup.renderer.root.findDescendantById(
      "current-exposure-browser",
    ) as ScrollBoxRenderable;
    for (let index = 0; index < 7; index++) {
      setup.mockInput.pressArrow("right");
      await setup.flush();
      setup.mockInput.pressArrow("down");
      await setup.flush();
    }
    expect(textIn(exposure)).toContain("branch-6");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("branch-6"));
    expect(textIn(setup.renderer.root.findDescendantById("agent-node-pane")!)).toContain(
      "branch-6",
    );
    await enterLive(setup, "agent-access-collection-details");
    await setup.waitForFrame((frame) => frame.includes("node-7"));
    expect(exposure.screenX + exposure.width).toBeLessThanOrEqual(80);
    expect(exposure.screenY + exposure.height).toBeLessThanOrEqual(24);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER unconfigured Agent access owns a usable setup action", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openMainPage(setup, "agent");
    await setup.waitForFrame((frame) => frame.includes("Organize Skills into a Collection"));
    await focusLive(setup, "skills-setup-primary");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-setup-primary");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER medium keeps Sections and Content without a navigation rail", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("workspace-navigation-panel")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("workspace-browser-panel")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("workspace-reader-panel")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("section-nav")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("route-content")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER App follows the layout too-small boundaries", async () => {
  for (const [width, height, tooSmall] of [
    [42, 12, true],
    [43, 11, true],
    [43, 12, true],
    [43, 13, false],
    [44, 12, false],
  ] as const) {
    const setup = await testRender(
      () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
      { width, height },
    );
    try {
      if (tooSmall) await setup.waitForFrame((frame) => frame.includes("More room needed"));
      else
        await setup.waitFor(
          () =>
            !!setup.renderer.root.findDescendantById("shell-section-tab-skills") ||
            !!setup.renderer.root.findDescendantById("shell-pages-select"),
        );
      expect(setup.captureCharFrame().includes("More room needed")).toBe(tooSmall);
    } finally {
      setup.renderer.destroy();
    }
  }
});
async function openPaletteAddSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  await enterLive(setup, "workspace-action-add-skills");
}
test("RENDER narrow Source browser shows one level and preserves selection through resize", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    {
      width: 79,
      height: 24,
    },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    setup.resize(78, 24);
    await setup.renderOnce();
    await navigateToSources(setup);
    await setup.waitForFrame((frame) => frame.includes("team-main"));
    const browser = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    browser.setSelectedIndex(0);
    const selectedIndex = browser.getSelectedIndex();
    const scroll = selectScrollOffset(browser);
    expect(setup.renderer.currentFocusedRenderable === browser).toBe(true);
    await parsedEnter(setup);
    await enterLive(setup, "source-view-tab-settings");
    await setup.waitForFrame((frame) => frame.includes("https://github.com/acme/main"));
    expect(setup.renderer.root.findDescendantById("route-back")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-view-tab-settings");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const restoredBrowser = setup.renderer.root.findDescendantById(
      "source-browser",
    ) as SelectRenderable;
    expect(setup.renderer.currentFocusedRenderable === restoredBrowser).toBe(true);
    expect(restoredBrowser.getSelectedIndex()).toBe(selectedIndex);
    expect(selectScrollOffset(restoredBrowser)).toBe(scroll);
    expect(setup.captureCharFrame()).toContain("team-main");
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-pages-select");
    expect(setup.renderer.root.findDescendantById("shell-pages-select")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER 43x30 narrow detail returns to the retained Source browser on Escape", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    setup.resize(43, 30);
    await navigateToSources(setup);
    await setup.waitForFrame((frame) => frame.includes("team-main"));
    const browser = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    const selectedIndex = browser.getSelectedIndex();
    const scroll = selectScrollOffset(browser);
    expect(setup.renderer.currentFocusedRenderable === browser).toBe(true);
    await parsedEnter(setup);
    await enterLive(setup, "source-view-tab-settings");
    await setup.waitForFrame(
      (frame) => frame.includes("https://github.com/") && frame.includes("acme/main"),
    );
    expect(setup.renderer.root.findDescendantById("route-back")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const restoredBrowser = setup.renderer.root.findDescendantById(
      "source-browser",
    ) as SelectRenderable;
    expect(setup.renderer.currentFocusedRenderable === restoredBrowser).toBe(true);
    expect(restoredBrowser.getSelectedIndex()).toBe(selectedIndex);
    expect(selectScrollOffset(restoredBrowser)).toBe(scroll);
    expect(setup.captureCharFrame()).toContain("team-main");
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-pages-select");
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER 43x30 keeps Source actions and Back visible in its compact workspace", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await navigateToSources(setup);
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-view-tab-installed"),
    );
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Back");
    expect(frame).toContain("Installed");
    expect(frame).toContain("Install Skills");
    expect(frame).not.toMatch(/\bW G P L\b/);
    expect(frame).not.toContain("Scop Sou Con Co I");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Source inventory opens Reader and Escape restores the inventory and Source", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 79, height: 24 },
  );
  try {
    await navigateToSources(setup);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-installed-skills"));
    const guide = `source-installed-skills-row-${encodeURIComponent('["team-main","guide"]')}`;
    const reference = `source-installed-skills-row-${encodeURIComponent('["team-main","reference"]')}`;
    expect(setup.renderer.root.findDescendantById(guide)).toBeDefined();
    expect(setup.renderer.root.findDescendantById(reference)).toBeDefined();
    await focusLive(setup, "source-installed-skills");
    await parsedEnter(setup);
    await waitForReaderBody(setup, "guide");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-installed-skills",
    );
    expect(setup.renderer.root.findDescendantById(guide)).toBeDefined();
    await parsedEnter(setup);
    await waitForReaderBody(setup, "guide");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-installed-skills",
    );
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const source = setup.renderer.root.findDescendantById("source-browser") as SelectRenderable;
    expect(source.getSelectedOption()?.value).toBe("team-main");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER narrow observation progress remains bounded at 79x24 and 43x30", async () => {
  for (const [width, height] of [
    [79, 24],
    [43, 30],
  ] as const) {
    let aborts = 0;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(workspaceProjection(), {
            discoverSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
              new Promise((_, reject) =>
                options?.signal?.addEventListener("abort", () => {
                  aborts++;
                  reject(new SkctlError("CANCELLED", "cancelled"));
                }),
              ),
          })}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await setup.renderOnce();
      await Promise.resolve();
      await navigateToSources(setup);
      await setup.waitForFrame((frame) => frame.includes("team-main"));
      await parsedEnter(setup);
      await openPaletteAddSkills(setup);
      await setup.waitForFrame((frame) => frame.includes("Discovering Skills"));
      if (width === 79) {
        const frame = setup.captureCharFrame();
        expect(frame).toContain("Cancel");
        await parsedEscape(setup);
        await setup.waitFor(() => aborts === 1);
        await setup.waitFor(
          () => setup.renderer.root.findDescendantById("source-observation-progress") === undefined,
        );
      }
    } finally {
      setup.renderer.destroy();
    }
  }
});
test("RENDER narrow selection remains bounded through resize at 79x24 and 43x30", async () => {
  for (const [width, height] of [
    [79, 24],
    [43, 30],
  ] as const) {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(
            {
              ...workspaceProjection(),
              installedSkills: [],
            },
            {
              discoverSkills: async (_environment: import("@skctl/core").CoreOptions, request) => ({
                value: {
                  source: request.source,
                  kind: "github",
                  exactRevision: "narrow",
                  candidates: [
                    {
                      path: "installed",
                      name: "installed",
                      description: "Installed",
                    },
                    { path: "review", name: "review", description: "Review" },
                  ],
                },
                diagnostics: [],
              }),
              installSkills: (_environment: import("@skctl/core").CoreOptions, _request, options) =>
                new Promise((_, reject) =>
                  options?.signal?.addEventListener("abort", () =>
                    reject(new Error("apply stopped")),
                  ),
                ),
            },
          )}
          exit={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await setup.renderOnce();
      await Promise.resolve();
      await navigateToSources(setup);
      await setup.waitForFrame((frame) => frame.includes("team-main"));
      await parsedEnter(setup);
      await openPaletteAddSkills(setup);
      await setup.waitForFrame((frame) => frame.includes("[ ] Available review"));
      const selection = setup.renderer.root.findDescendantById("source-operation-selection");
      expect(selection).toBeDefined();
      expect(selection!.screenX).toBeGreaterThanOrEqual(0);
      expect(selection!.screenY).toBeGreaterThanOrEqual(0);
      expect(selection!.screenX + selection!.width).toBeLessThanOrEqual(width);
      expect(selection!.screenY + selection!.height).toBeLessThanOrEqual(height);
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-operation-selection");
      setup.resize(width === 79 ? 43 : 79, height);
      await setup.waitForFrame((frame) => frame.includes("[ ] Available review"));
    } finally {
      setup.renderer.destroy();
    }
  }
});
