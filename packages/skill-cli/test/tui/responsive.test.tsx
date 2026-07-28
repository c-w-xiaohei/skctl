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
  if (setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser") {
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser");
  } else expect(setup.renderer.currentFocusedRenderable?.id).toBe("workspace-section-browser");
  setup.mockInput.pressKeys(["ARROW_DOWN", "ARROW_DOWN"]);
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-actions");
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
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-actions");
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
      setup.mockInput.pressEnter();
      await setup.waitForFrame((frame) => frame.includes("Add Skills"));
      setup.mockInput.pressEnter();
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
      setup.mockInput.pressEnter();
      await setup.waitForFrame((frame) => frame.includes("Add Skills"));
      setup.mockInput.pressEnter();
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
