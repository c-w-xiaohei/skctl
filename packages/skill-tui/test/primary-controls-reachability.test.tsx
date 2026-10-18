import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skill-cli/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

// Only renderer input is used: no injected focus or page-local state transitions.
async function press(setup: Setup, key: "up" | "down" | "left" | "right" | "enter" | "escape") {
  await new Promise<void>((resolve) => {
    const receive = (event: { readonly name: string }) => {
      if (event.name !== key && !(key === "enter" && event.name === "return")) return;
      setup.renderer.keyInput.off("keypress", receive);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", receive);
    if (key === "enter") setup.mockInput.pressEnter();
    else if (key === "escape") setup.mockInput.pressKey("ESCAPE");
    else setup.mockInput.pressArrow(key);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

async function expectFocus(setup: Setup, id: string, checkpoint: string) {
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  } catch (error) {
    throw new Error(
      `${checkpoint}: expected ${id}, actual ${setup.renderer.currentFocusedRenderable?.id ?? "none"}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
}

function projection(): WorkspaceView {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  return {
    ...base,
    effective: {
      ...base.effective,
      collections: ["team"],
      collectionsView: [
        {
          id: "team",
          declared: [],
          repository: { derived: false, producers: [] },
          members: [{ name: "guide", address: { source: "team-main", path: "guide" }, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
  };
}

for (const width of [140, 80, 60]) {
  test(`cold startup query / Filter / scope are reachable without Tab at ${width} columns`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(projection())} exit={() => {}} />,
      { width, height: 32 },
    );
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      await setup.renderOnce();
      await expectFocus(setup, "installed-skill-browser", "cold startup");
      await press(setup, "up");
      await expectFocus(setup, "skills-query", "Browser Up enters query");
      setup.mockInput.pressKey("g");
      await setup.waitFor(
        () =>
          (setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value === "g",
      );
      await expectFocus(setup, "skills-query", "typing retains the same editor");
      await press(setup, "escape");
      await expectFocus(setup, "installed-skill-browser", "query Escape returns Browser");
      expect(
        (setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value,
      ).toBe("g");
      await press(setup, "up");
      await expectFocus(setup, "skills-query", "return to committed query");
      await press(setup, "enter");
      await expectFocus(
        setup,
        "open-skills-filter",
        "query Enter reaches Filter control, not overlay",
      );
      await press(setup, "enter");
      await expectFocus(setup, "skills-filter-search", "Filter Enter opens its editor");
      await press(setup, "escape");
      await expectFocus(setup, "open-skills-filter", "Filter Escape restores initiating control");
      for (
        let step = 0;
        step < 6 && !setup.renderer.currentFocusedRenderable?.id.startsWith("skills-view-tab-");
        step++
      ) {
        await press(setup, "down");
      }
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        "skills-view-tab-all-installed-skills",
      );
      await press(setup, "enter");
      await expectFocus(setup, "installed-skill-browser", "scope Enter returns Browser");
    } finally {
      setup.renderer.destroy();
    }
  });

  test(`Collections open into rows and ownership has a safe Back at ${width} columns`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(projection())} exit={() => {}} />,
      { width, height: 32 },
    );
    try {
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      await setup.renderOnce();
      await expectFocus(setup, "installed-skill-browser", "cold startup");
      await press(setup, "left");
      await expectFocus(
        setup,
        width >= 100 ? "shell-section-navigation" : "shell-section-tab-skills",
        "Browser Back enters page selector",
      );
      await press(setup, width >= 100 ? "down" : "right");
      await press(setup, "enter");
      await expectFocus(
        setup,
        "collection-browser",
        "page selector Down / Enter enters Collections",
      );
      await press(setup, "enter");
      await expectFocus(setup, "collection-relationships", "Collection Enter enters rows");
      await press(setup, "up");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-entries",
      );
      await press(setup, "enter");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      await press(setup, "enter");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-membership-origin",
      );
      await press(setup, "right");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection.inspector-back",
      );
      await press(setup, "enter");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}
