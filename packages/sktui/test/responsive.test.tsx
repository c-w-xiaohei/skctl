import { expect, test } from "bun:test";
import { BoxRenderable, SelectRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkctlError } from "@skctl/core";
import { App } from "../src/app";
import { selectScrollOffset } from "../src/select-scroll";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
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
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
  await focusLive(setup, "shell-section-tab-skills");
  for (const section of ["collections", "sources"]) {
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === `shell-section-tab-${section}`,
    );
  }
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
  await focusLive(setup, "source-browser");
}
async function navigateToAllInstalledSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills"),
  );
  await openAllInstalledSkills(setup);
}
async function navigateToCollections(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-skills"));
  await focusLive(setup, "shell-section-tab-skills");
  setup.mockInput.pressArrow("right");
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
    expect(setup.renderer.root.findDescendantById("source-browser")).not.toBe(collections);
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
    expect(browser.options[0]).toEqual({
      name: "team-main · github -> Source details",
      description: "https://github.com/acme/main · skills · Direct",
      value: "team-main",
    });
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
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    await enterLive(setup, "current-exposure-browser");
    await setup.waitForFrame((frame) => frame.includes("root") && frame.includes("Entries"));
    await setup.renderOnce();
    const frame = setup.captureCharFrame().split("\n");
    const line = (text: string) => frame.findIndex((value) => value.includes(text));
    expect(line("root")).toBeGreaterThanOrEqual(0);
    const tabs = setup.renderer.root.findDescendantById("collection-tabs-tab-entries")!;
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
      use: ["root"],
      collectionsView,
    },
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    await focusLive(setup, "current-exposure-browser");
    const exposure = setup.renderer.root.findDescendantById(
      "current-exposure-browser",
    ) as SelectRenderable;
    await setup.renderOnce();
    expect(exposure.options).toHaveLength(2);
    expect(
      exposure.options.every((option) => Bun.stringWidth(option.name) <= exposure.width - 3),
    ).toBe(true);
    expect(exposure.options.at(-1)?.name).toContain("branch-0");
    expect(exposure.options.at(-1)?.value).toBe("root/branch-0");
    expect(exposure.options.at(-1)?.name).toContain("node-1");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER unavailable Current Exposure owns the separated Work Area focus target", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("workspace-content"));
    const workArea = setup.renderer.root.findDescendantById("workspace-content") as BoxRenderable;
    expect(workArea.border).toEqual(["left"]);
    await focusLive(setup, "current-exposure-unavailable");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-unavailable");
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
      if (tooSmall) await setup.waitForFrame((frame) => frame.includes("Terminal is too small."));
      else await setup.waitForFrame((frame) => frame.includes("Workspace / Skills"));
      expect(setup.captureCharFrame().includes("Terminal is too small.")).toBe(tooSmall);
    } finally {
      setup.renderer.destroy();
    }
  }
});
async function openPaletteAddSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  setup.mockInput.pressKey("P", { ctrl: true });
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
  );
  await enterLive(setup, "palette-add-skills");
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
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    await parsedEnter(setup);
    await setup.waitFor(() =>
      textIn(setup.renderer.root).includes("Canonical Origin  https://github.com/acme/main"),
    );
    expect(setup.renderer.root.findDescendantById("shell-section-tab-sources")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-command-config");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const restoredBrowser = setup.renderer.root.findDescendantById(
      "source-browser",
    ) as SelectRenderable;
    expect(restoredBrowser).not.toBe(browser);
    expect(setup.renderer.currentFocusedRenderable).toBe(restoredBrowser);
    expect(restoredBrowser.getSelectedIndex()).toBe(selectedIndex);
    expect(selectScrollOffset(restoredBrowser)).toBe(scroll);
    expect(setup.captureCharFrame()).toContain("team-main");
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(setup.renderer.root.findDescendantById("shell-section-tab-sources")).toBeDefined();
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
    expect(setup.renderer.currentFocusedRenderable).toBe(browser);
    await parsedEnter(setup);
    await setup.waitFor(() =>
      textIn(setup.renderer.root).includes("Canonical Origin  https://github.com/acme/main"),
    );
    expect(setup.renderer.root.findDescendantById("shell-section-tab-sources")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    const restoredBrowser = setup.renderer.root.findDescendantById(
      "source-browser",
    ) as SelectRenderable;
    expect(restoredBrowser).not.toBe(browser);
    expect(setup.renderer.currentFocusedRenderable).toBe(restoredBrowser);
    expect(restoredBrowser.getSelectedIndex()).toBe(selectedIndex);
    expect(selectScrollOffset(restoredBrowser)).toBe(scroll);
    expect(setup.captureCharFrame()).toContain("team-main");
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(setup.renderer.root.findDescendantById("source-browser")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER 43x30 keeps human Context and Section controls above a Source Inspector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 43, height: 30 },
  );
  try {
    await navigateToSources(setup);
    await parsedEnter(setup);
    await setup.waitFor(() =>
      textIn(setup.renderer.root).includes("Canonical Origin  https://github.com/acme/main"),
    );
    await setup.waitForFrame((frame) => frame.includes("Workspace / Sources / Details"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Workspace / Sources / Details");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-command-config");
    expect(frame).toContain("Open owning Config");
    expect(frame).toContain("View Installed Skills");
    expect(frame).not.toContain("Actions");
    expect(frame).not.toMatch(/\bW G P L\b/);
    expect(frame).not.toContain("Scop Sou Con Co I");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Source View Skills opens a Skill Inspector and Escape restores both retained frames", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 79, height: 24 },
  );
  try {
    await navigateToSources(setup);
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-command-config",
    );
    await enterLive(setup, "source-command-skills");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.options).toHaveLength(2);
    expect(browser.options[0]?.value).toBe('["team-main","guide"]');
    expect(browser.getSelectedOption()?.value).toBe('["team-main","guide"]');
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
    await parsedEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Installed Skills from team-main"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    expect(setup.captureCharFrame()).toContain("Installed Skills from team-main");
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe('["team-main","guide"]');
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-command-skills",
    );
    expect(setup.renderer.root.findDescendantById("source-command-skills")).toBeDefined();
    expect(setup.captureCharFrame()).toContain("team-main");
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
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
      setup.mockInput.pressEnter();
      await setup.waitFor(() =>
        textIn(setup.renderer.root).includes("Canonical Origin  https://github.com/acme/main"),
      );
      await openPaletteAddSkills(setup);
      await setup.waitForFrame(
        (frame) => frame.includes("Discovering Skills") && frame.includes("Observing"),
      );
      if (width === 79) {
        const frame = setup.captureCharFrame();
        expect(frame).toContain("Escape Cancel");
        expect(textIn(setup.renderer.root)).toContain("Esc cancel");
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
      setup.mockInput.pressEnter();
      await setup.waitFor(() =>
        textIn(setup.renderer.root).includes("Canonical Origin  https://github.com/acme/main"),
      );
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
