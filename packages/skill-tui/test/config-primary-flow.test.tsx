import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ManagementProjection } from "@skill-cli/core";
import { App } from "../src/app";
import { createConfigState } from "../src/config/state";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

function focusSnapshot(setup: Setup) {
  return `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}\n${setup.captureCharFrame()}`;
}

async function expectFocus(setup: Setup, id: string, source: string) {
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  } catch (error) {
    throw new Error(`${source}: expected focus ${id}; ${focusSnapshot(setup)}`, { cause: error });
  }
}

function projection(): ManagementProjection {
  const base = workspaceProjection({ includeContribution: false });
  const owner = { ...directOwner, pointer: "/agents/opencode" };
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level !== "project"
        ? config
        : {
            ...config,
            direct: {
              ...config.direct,
              collections: [
                { id: "team", owner: { ...directOwner, pointer: "/collections/team" } },
              ],
              configSources: [
                {
                  id: "shared",
                  owner: { ...directOwner, pointer: "/configSources/shared" },
                  binding: {
                    kind: "github",
                    origin: "https://github.com/acme/config",
                    root: ".",
                    ref: "main",
                  },
                  adoption: { status: "adopted", commit: "a".repeat(40) },
                  contributed: { sources: [base.effective.sources[0]!], collections: [] },
                },
              ],
              integrations: [{ kind: "opencode", owner }],
            },
          },
    ),
    effective: {
      ...base.effective,
      agent: {
        status: "available",
        integration: [owner],
        use: [],
        reasons: [],
        catalog: ["team/alpha", "team/beta"].map((selector) => ({
          selector,
          name: selector,
          description: "Read-only catalog entry",
          aliases: [],
        })),
      },
    },
  };
}

async function press(setup: Setup, key: string) {
  const parsed = new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      const expected =
        key === "ENTER"
          ? ["enter", "return"]
          : key === "ESCAPE"
            ? ["escape", "esc"]
            : [key.replace("ARROW_", "").toLowerCase()];
      if (!expected.includes(event.name)) return;
      setup.renderer.keyInput.off("keypress", listener);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
  });
  if (key.startsWith("ARROW_"))
    setup.mockInput.pressArrow(key.slice(6).toLowerCase() as "up" | "down" | "left" | "right");
  else if (key === "ENTER") setup.mockInput.pressEnter();
  else setup.mockInput.pressKey(key);
  await parsed;
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

// Navigate the production shell from its real mounted startup focus. No focus(),
// focusLive(), injected route frame, or direct page-state transitions are used.
async function openProject(setup: Setup, width: number) {
  try {
    await setup.waitFor(() => !!setup.renderer.currentFocusedRenderable);
  } catch (error) {
    throw new Error(`openProject startup: no focused renderable; ${focusSnapshot(setup)}`, {
      cause: error,
    });
  }
  for (
    let step = 0;
    step < 5 && setup.renderer.currentFocusedRenderable?.id !== "top-navigation-tab-workspace";
    step++
  ) {
    setup.mockInput.pressTab();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await setup.renderOnce();
  }
  await expectFocus(
    setup,
    "top-navigation-tab-workspace",
    "openProject after Left from navigation",
  );
  await press(setup, "ARROW_RIGHT");
  await expectFocus(setup, "top-navigation-tab-global", "openProject after Right to Global");
  await press(setup, "ARROW_RIGHT");
  await expectFocus(setup, "top-navigation-tab-project", "openProject after Right to Project");
  await press(setup, "ENTER");
  await expectFocus(
    setup,
    width >= 100 ? "shell-section-navigation" : "shell-section-tab-sources",
    "openProject after Enter on Project",
  );
  await press(setup, "ENTER");
  await expectFocus(setup, "config-source-browser", "openProject after Enter on Sources");
  expect(setup.renderer.currentFocusedRenderable!.height).toBeGreaterThan(0);
}

async function openSection(setup: Setup, index: number, width: number) {
  await press(setup, "ARROW_LEFT");
  const wide = width >= 100;
  await expectFocus(
    setup,
    wide ? "shell-section-navigation" : "shell-section-tab-sources",
    `openSection(${index}) after Left`,
  );
  for (let step = 0; step < index; step++) await press(setup, wide ? "ARROW_DOWN" : "ARROW_RIGHT");
  await press(setup, "ENTER");
}

for (const width of [120, 80, 60]) {
  test(`RENDER Config Source and Collection Enter focus existing actions at ${width} columns`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(projection())} exit={() => {}} />,
      { width, height: 30 },
    );
    try {
      await openProject(setup, width);
      const sourceBrowser = setup.renderer.currentFocusedRenderable as SelectRenderable;
      const source = sourceBrowser.options[sourceBrowser.getSelectedIndex()]?.value;
      await press(setup, "ENTER");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-check-updates");
      expect(sourceBrowser.options[sourceBrowser.getSelectedIndex()]?.value).toBe(source);
      await press(setup, "ARROW_RIGHT");
      const metadata = setup.renderer.currentFocusedRenderable;
      expect(metadata?.parent).toBeDefined();
      expect(metadata?.id).not.toBe("config-command-check-updates");
      await press(setup, "ARROW_RIGHT");
      await expectFocus(
        setup,
        "config-command-check-updates",
        "metadata Right returns to Source actions",
      );
      await press(setup, "ARROW_UP");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-check-updates");
      await press(setup, "ESCAPE");
      await expectFocus(setup, "config-source-browser", "source inspector Escape");
      await openSection(setup, 2, width);
      await expectFocus(setup, "config-collection-browser", "collections section Enter");
      expect(setup.renderer.currentFocusedRenderable!.height).toBeGreaterThan(0);
      await press(setup, "ENTER");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-set-collection-use");
      expect(setup.captureCharFrame()).toContain("team");
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("RENDER reachable integration inspector saves row movement and entry Back restores that inspector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openProject(setup, 120);
    await openSection(setup, 3, 120);
    await expectFocus(setup, "config-integrations-browser", "integrations section Enter");
    await press(setup, "ENTER");
    await expectFocus(setup, "config-integration-catalog", "integration list Enter");
    await press(setup, "ARROW_DOWN");
    const catalog = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      catalog.options[catalog.getSelectedIndex()]?.value,
      "catalog Down selects second row",
    ).toBe("team/beta");
    await press(setup, "ENTER");
    await expectFocus(setup, "config-catalog-entry-inspector", "catalog entry Enter");
    await press(setup, "ESCAPE");
    await expectFocus(setup, "config-integration-catalog", "catalog entry Escape");
    const restored = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      restored.options[restored.getSelectedIndex()]?.value,
      "entry Back restores second row",
    ).toBe("team/beta");
    await press(setup, "ESCAPE");
    await expectFocus(setup, "config-integrations-browser", "integration inspector Escape");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config Source inspector exposes one update entrance and a Right path to contributions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 80, height: 30 },
  );
  try {
    await openProject(setup, 80);
    await openSection(setup, 1, 80);
    await expectFocus(setup, "config-config-source-browser", "config sources section Enter");
    await press(setup, "ENTER");
    await expectFocus(setup, "config-command-config-observe", "config source Enter");
    expect(setup.renderer.root.findDescendantById("config-command-config-adopt")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Check / review Config update");
    await press(setup, "ARROW_RIGHT");
    await expectFocus(setup, "config-source-contributions", "config source Right");
    expect((setup.renderer.currentFocusedRenderable as SelectRenderable).options).toHaveLength(1);
    await press(setup, "ESCAPE");
    await expectFocus(setup, "config-config-source-browser", "contributions Escape");
  } finally {
    setup.renderer.destroy();
  }
});

test("Config state unit: catalog selection belongs to inspector and entry Back has no catalog level", () => {
  const state = createConfigState();
  state.selectSection("project", "integrations");
  state.openIntegrationInspector("project");
  state.selectIntegrationCatalogEntry("project", "team/beta");
  expect(state.integrationCatalogSelection("project")).toBe("team/beta");
  state.openIntegrationCatalogEntry("project", "team/beta");
  state.backIntegrationSurface("project");
  expect(state.integrationSurface("project")).toBe("inspector");
  expect(state.integrationCatalogSelection("project")).toBe("team/beta");
  state.backIntegrationSurface("project");
  expect(state.integrationSurface("project")).toBe("list");
});
