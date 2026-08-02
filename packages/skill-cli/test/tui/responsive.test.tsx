import { expect, test } from "bun:test";
import { SelectRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { SkillCliError } from "../../src/core/api";
import { App } from "../../src/tui/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

async function awaitParsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
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
}

function textIn(renderable: { getChildren(): readonly unknown[] }): string {
  return (
    renderable.getChildren() as { getChildren?: () => readonly unknown[]; plainText?: string }[]
  )
    .flatMap((child) =>
      child instanceof TextBufferRenderable
        ? [child.plainText]
        : child.getChildren
          ? [textIn(child as { getChildren(): readonly unknown[] })]
          : [],
    )
    .join("\n");
}

async function navigateToSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Skills"));
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
  );
  const skills = setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills");
  if (!skills) throw new Error("Workspace Skills trigger disappeared before it could be focused");
  skills.focus();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
  );
  setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Collections"));
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-collections",
  );
  setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Browse · Workspace > Sources"));
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-sources",
  );
  setup.mockInput.pressEnter();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
}

test("RENDER Sources replaces the Collection browser native target", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
    );
    setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!.focus();
    setup.mockInput.pressArrow("right");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
    const collections = setup.renderer.root.findDescendantById("collection-browser")!;
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-sources",
    );
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
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
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
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
      name: "team-main · github",
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

test("RENDER wide Workspace owns bounded Navigation, Browser, and Reader panels", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    const navigation = setup.renderer.root.findDescendantById("workspace-navigation-panel")!;
    const browser = setup.renderer.root.findDescendantById("workspace-browser-panel")!;
    const reader = setup.renderer.root.findDescendantById("workspace-reader-panel")!;
    const skills = setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!;
    const collections = setup.renderer.root.findDescendantById(
      "workspace-section-browser-tab-collections",
    )!;
    for (const panel of [navigation, browser, reader]) {
      expect(panel.screenX).toBeGreaterThanOrEqual(0);
      expect(panel.screenY).toBeGreaterThanOrEqual(0);
      expect(panel.screenX + panel.width).toBeLessThanOrEqual(120);
      expect(panel.screenY + panel.height).toBeLessThanOrEqual(40);
    }
    expect(navigation.screenX + navigation.width).toBeLessThanOrEqual(browser.screenX);
    expect(browser.screenX + browser.width).toBeLessThanOrEqual(reader.screenX);
    expect(skills.screenY).toBeLessThan(collections.screenY);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER medium keeps the horizontal Section row and two content surfaces without wide navigation", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
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
    const skills = setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!;
    const collections = setup.renderer.root.findDescendantById(
      "workspace-section-browser-tab-collections",
    )!;
    expect(skills.screenY).toBe(collections.screenY);
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
    const reader = setup.renderer.root.findDescendantById("reader-scrollbox")!;
    expect(browser.screenX + browser.width).toBeLessThanOrEqual(reader.screenX);
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
      else await setup.waitForFrame((frame) => frame.includes("Skills"));
      expect(setup.captureCharFrame().includes("Terminal is too small.")).toBe(tooSmall);
    } finally {
      setup.renderer.destroy();
    }
  }
});

async function openPaletteAddSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  setup.mockInput.pressKey("P", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
  setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN"]);
  setup.mockInput.pressEnter();
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Origin  https://github.com/acme/main"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(
      "workspace-section-browser-tab-sources",
    );
    await awaitParsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(setup.captureCharFrame()).toContain("team-main");
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Origin  https://github.com/acme/main"));
    await awaitParsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    expect(setup.captureCharFrame()).toContain("team-main");
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
            discover: (_request, options) =>
              new Promise((_, reject) =>
                options?.signal?.addEventListener("abort", () => {
                  aborts++;
                  reject(new SkillCliError("CANCELLED", "cancelled"));
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
      await setup.waitForFrame((frame) => frame.includes("Origin  https://github.com/acme/main"));
      await openPaletteAddSkills(setup);
      await setup.waitForFrame(
        (frame) => frame.includes("Discovering Skills") && frame.includes("Observing"),
      );
      if (width === 79) {
        const frame = setup.captureCharFrame();
        expect(frame).toContain("Escape Cancel");
        expect(textIn(setup.renderer.root)).toContain("F:Task Tab/Shift+Tab Ent Esc cancel");
        await awaitParsedEscape(setup);
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
              discover: async (request) => ({
                value: {
                  source: request.source,
                  kind: "github",
                  exactRevision: "narrow",
                  candidates: [
                    { path: "installed", name: "installed", description: "Installed" },
                    { path: "review", name: "review", description: "Review" },
                  ],
                },
                diagnostics: [],
              }),
              install: (_request, options) =>
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
      await setup.waitForFrame((frame) => frame.includes("Origin  https://github.com/acme/main"));
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
