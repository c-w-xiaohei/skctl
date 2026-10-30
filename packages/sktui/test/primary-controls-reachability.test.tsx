import { expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
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

async function tabTo(setup: Setup, id: string) {
  const visited: string[] = [];
  for (let step = 0; step < 24 && setup.renderer.currentFocusedRenderable?.id !== id; step++) {
    setup.mockInput.pressTab();
    await setup.flush();
    visited.push(setup.renderer.currentFocusedRenderable?.id ?? "none");
  }
  await expectFocus(setup, id, `Tab reaches panel through ${visited.join(", ")}`);
}

async function openInventory(setup: Setup) {
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary");
  await tabTo(setup, "skills-view-tab-current-exposure");
  await press(setup, "right");
  await press(setup, "enter");
  await expectFocus(setup, "installed-skill-browser", "All Skills opens inventory");
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
  test(`query / Filter / views are keyboard reachable from cold startup at ${width} columns`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(projection())} exit={() => {}} />,
      { width, height: 32 },
    );
    try {
      await openInventory(setup);
      await press(setup, "up");
      await expectFocus(setup, "installed-skill-browser", "Up stays in inventory");
      await tabTo(setup, "skills-query");
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
      await tabTo(setup, "skills-query");
      await tabTo(setup, "open-skills-filter");
      await press(setup, "enter");
      await expectFocus(setup, "skills-filter-dimensions", "Filter Enter opens dimensions");
      await press(setup, "escape");
      await expectFocus(setup, "open-skills-filter", "Filter Escape restores initiating control");
      await tabTo(setup, "skills-view-tab-all-installed-skills");
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
      await openInventory(setup);
      await tabTo(setup, "shell-section-tab-skills");
      await press(setup, "right");
      await press(setup, "enter");
      await expectFocus(
        setup,
        "collection-browser",
        "page selector Down / Enter enters Collections",
      );
      await press(setup, "enter");
      await tabTo(setup, "collection-relationships");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
      await press(setup, "right");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id.endsWith(".manage") === true,
      );
      await press(setup, "enter");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-membership-inspector"),
      );
      await press(setup, "escape");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}
