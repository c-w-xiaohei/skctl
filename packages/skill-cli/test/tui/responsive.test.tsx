import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

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

async function navigateToSources(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitForFrame((frame) => frame.includes("Workspace › Skills"));
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
  await setup.waitForFrame((frame) => frame.includes("Workspace › Collections"));
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-collections",
  );
  setup.mockInput.pressArrow("right");
  await setup.waitForFrame((frame) => frame.includes("Workspace › Sources"));
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-sources",
  );
  setup.mockInput.pressEnter();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
}

test("RENDER Sources replaces the Collection browser native target", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
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
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(workspaceProjection(), {
            discover: () => new Promise(() => {}),
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
