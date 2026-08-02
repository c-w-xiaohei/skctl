import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ManagementProjection } from "../../src/core/api";
import { createSignal } from "solid-js";
import { App } from "../../src/tui/app";
import { ConfigPage } from "../../src/tui/config-page";
import { createConfigState } from "../../src/tui/config/state";
import { SourceRegistrationOverlay } from "../../src/tui/operations";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

async function pressEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const listener = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", listener);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", listener);
    setup.mockInput.pressKey("ESCAPE");
  });
}

function configProjection(): ManagementProjection {
  const base = workspaceProjection();
  const global = base.configs[0]!;
  const project = base.configs[1]!;
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/team",
  };
  const configOwner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/configSources/team",
  };
  const contributedSource = {
    id: "team/lark",
    kind: "github" as const,
    origin: "https://github.com/acme/skills",
    root: "skills",
    ref: "main",
    provenance: {
      level: "project" as const,
      pointer: "/sources/lark",
      namespace: "team@commit",
    },
    contribution: {
      configSource: configOwner,
      declaration: {
        level: "project" as const,
        pointer: "/sources/lark",
        namespace: "team@commit",
      },
    },
    selectors: [],
  };
  return {
    ...base,
    configs: [
      {
        ...global,
        direct: {
          ...global.direct,
          collections: [
            {
              id: "global-team",
              owner: { ...owner, level: "global", file: global.file.file },
            },
          ],
        },
      },
      {
        ...project,
        direct: {
          ...project.direct,
          configSources: [
            {
              id: "team",
              owner: configOwner,
              binding: {
                kind: "github" as const,
                origin: "https://github.com/acme/config",
                root: "",
                ref: "main",
              },
              adoption: { status: "adopted" as const, commit: "a".repeat(40) },
              contributed: {
                sources: [contributedSource],
                collections: [
                  {
                    id: "team/docs",
                    owner: {
                      level: "project" as const,
                      file: configOwner.file,
                      pointer: "/configSources/team/collections/docs",
                      contribution: {
                        configSource: configOwner,
                        declaration: {
                          level: "project" as const,
                          pointer: "/collections/docs",
                          namespace: "team@commit",
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
          collections: [{ id: "team", owner }],
          collectionUse: [{ collection: "team", owner: { ...owner, pointer: "/use/0" } }],
          integrations: [
            {
              kind: "opencode",
              owner: { ...owner, pointer: "/agents/opencode" },
            },
          ],
        },
        contributed: {
          ...project.contributed,
          sources: [contributedSource],
          collections: ["contributed-team", "team/docs"],
        },
      },
      {
        level: "project",
        file: {
          status: "missing",
          file: "/workspace/skill-cli/.skill-cli.jsonc",
        },
        direct: {
          sources: [],
          configSources: [],
          collections: [],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: [] },
      },
    ],
  };
}

async function openDestination(
  setup: Awaited<ReturnType<typeof testRender>>,
  destination: "global" | "project" | "local",
) {
  setup.mockInput.pressKey("P", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
  const index = ["global", "project", "local"].indexOf(destination) + 1;
  for (let value = 0; value < index; value++) {
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
  }
  setup.mockInput.pressEnter();
  await setup.waitForFrame((frame) =>
    frame.includes(`Configure · ${destination[0]!.toUpperCase()}${destination.slice(1)} > Sources`),
  );
  const sections = setup.renderer.root.findDescendantById("config-section-browser-tab-sources");
  expect(sections).toBeDefined();
  sections!.focus();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "config-section-browser-tab-sources",
  );
}

function interceptFrameListeners(setup: Awaited<ReturnType<typeof testRender>>) {
  const renderer = setup.renderer as typeof setup.renderer & {
    once: (event: string, listener: () => void) => unknown;
    off: (event: string, listener: () => void) => unknown;
  };
  const listeners = new Set<() => void>();
  const observed: (() => void)[] = [];
  const once = renderer.once.bind(renderer);
  const off = renderer.off.bind(renderer);
  renderer.once = (event: string, listener: () => void) => {
    if (event !== "frame") return once(event, listener);
    listeners.add(listener);
    observed.push(listener);
    return renderer;
  };
  renderer.off = (event: string, listener: () => void) => {
    if (event !== "frame") return off(event, listener);
    listeners.delete(listener);
    return renderer;
  };
  return { listeners, observed };
}

test("RENDER palette reaches Global, Project, and Local Config through physical keyboard input", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    for (const destination of ["global", "project", "local"] as const) {
      await openDestination(setup, destination);
      const title = destination[0]!.toUpperCase() + destination.slice(1);
      expect(setup.captureCharFrame()).toContain(`Configure · ${title} > Sources`);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER wide Config owns bounded Navigation and Browser panels with a growing primary list", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const navigation = setup.renderer.root.findDescendantById("config-navigation-panel")!;
    const browser = setup.renderer.root.findDescendantById("config-browser-panel")!;
    const sources = setup.renderer.root.findDescendantById(
      "config-source-browser",
    ) as import("@opentui/core").SelectRenderable;
    for (const panel of [navigation, browser]) {
      expect(panel.screenX).toBeGreaterThanOrEqual(0);
      expect(panel.screenY).toBeGreaterThanOrEqual(0);
      expect(panel.screenX + panel.width).toBeLessThanOrEqual(120);
      expect(panel.screenY + panel.height).toBeLessThanOrEqual(40);
    }
    expect(navigation.screenX + navigation.width).toBeLessThanOrEqual(browser.screenX);
    expect(sources.height).toBeGreaterThan(10);
    expect(sources.height).toBeLessThanOrEqual(browser.height);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER selected Config Source exposes its contributed source and collection", async () => {
  const projection = configProjection();
  const state = createConfigState();
  state.land("project", "config-sources", "/configSources/team");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => projection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onActions={() => {}}
        onAction={() => {}}
        onSection={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Source  team/lark");
    expect(setup.captureCharFrame()).toContain("Collection  team/docs");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER selected Config declarations expose binding and owner facts", async () => {
  const projection = configProjection();
  const state = createConfigState();
  const render = async (section: "sources" | "collections" | "for-agents", selection: string) => {
    state.land("project", section, selection);
    const setup = await testRender(
      () => (
        <ConfigPage
          config={state}
          projection={() => projection}
          destination="project"
          actions={[]}
          onSelect={() => {}}
          onActions={() => {}}
          onAction={() => {}}
          onSection={() => {}}
          onContribution={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    await setup.renderOnce();
    return setup;
  };
  const sources = await render("sources", "team-main");
  try {
    const frame = sources.captureCharFrame();
    expect(frame).toContain("Selected Source  team-main");
    expect(frame).toContain("Canonical Origin  https://github.com/acme/main");
    expect(frame).toContain("Source Root  skills");
    expect(frame).toContain("Binding kind  github");
    expect(frame).toContain("Tracked ref  team-main");
    expect(frame).toContain("Provenance  Direct");
  } finally {
    sources.renderer.destroy();
  }
  const contributed = await render("sources", "team/lark");
  try {
    const frame = contributed.captureCharFrame();
    expect(frame).toContain("Selected Source  team/lark");
    expect(frame).toContain("Binding kind  github");
    expect(frame).toContain("Canonical Origin  https://github.com/acme/skills");
    expect(frame).toContain("Source Root  skills");
    expect(frame).toContain("Tracked ref  main");
    expect(frame).toContain("Provenance  Config Source");
    expect(frame).toContain(
      "Config Source owner  project /workspace/skill-cli/skill-cli.jsonc /configSources/team",
    );
  } finally {
    contributed.renderer.destroy();
  }
  const collections = await render("collections", "team");
  try {
    expect(collections.captureCharFrame()).toContain("Selected Collection  team");
    expect(collections.captureCharFrame()).toContain(
      "Owner  /workspace/skill-cli/skill-cli.jsonc /collections/team",
    );
  } finally {
    collections.renderer.destroy();
  }
  const use = await render("for-agents", "team");
  try {
    expect(use.captureCharFrame()).toContain("Selected Collection Use  team");
    expect(use.captureCharFrame()).toContain("Owner  /workspace/skill-cli/skill-cli.jsonc /use/0");
  } finally {
    use.renderer.destroy();
  }
});

test("RENDER projection removal clears the Config Source browser into its empty action", async () => {
  const before = configProjection();
  const project = before.configs.find((item) => item.level === "project")!;
  const after = {
    ...before,
    configs: before.configs.map((config) =>
      config.level === "project"
        ? {
            ...project,
            direct: { ...project.direct, configSources: [] },
          }
        : config,
    ),
  };
  const state = createConfigState();
  state.land("project", "config-sources", "/configSources/team");
  const [projection, setProjection] = createSignal<ManagementProjection>(before);
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={projection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onActions={() => {}}
        onAction={() => {}}
        onSection={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Config Source  team");
    state.reconcile(before, after);
    setProjection(after);
    await setup.renderOnce();
    expect(state.selection("project", "config-sources")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("No Config Sources yet");
    const action = setup.renderer.root.findDescendantById("config-empty-add-config-source");
    expect(action).toBeDefined();
    action!.focus();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-empty-add-config-source");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config Source contributions return to their originating Config Source on Escape", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("up");
    await setup.waitFor(() =>
      Boolean(setup.renderer.root.findDescendantById("config-source-contributions")),
    );
    const contributions = setup.renderer.root.findDescendantById("config-source-contributions")!;
    contributions.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-contributions",
    );

    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Sources"));
    expect(setup.captureCharFrame()).toContain("Contributed Source  team/lark");
    await pressEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    expect(setup.captureCharFrame()).toContain("Config Source  team");

    const returnedContributions = setup.renderer.root.findDescendantById(
      "config-source-contributions",
    )!;
    returnedContributions.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-contributions",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Collections"));
    expect(setup.captureCharFrame()).toContain("team/docs");
    await pressEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    expect(setup.captureCharFrame()).toContain("Config Source  team");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config section selector physically navigates sources, collections, agents, and integrations", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    expect(
      setup.renderer.root.findDescendantById("config-section-browser-tab-sources"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-section-browser-tab-config-sources"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-section-browser-tab-collections"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-section-browser-tab-for-agents"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-section-browser-tab-integrations"),
    ).toBeDefined();
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Configure · Project > Collections");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("team (project)");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config browsers keep declaration identities primary and owner evidence secondary", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const sources = setup.renderer.root.findDescendantById(
      "config-source-browser",
    ) as import("@opentui/core").SelectRenderable;
    expect(sources.options[0]).toMatchObject({
      name: "team-main · github",
      description: "https://github.com/acme/main · skills · Direct",
      value: "team-main",
    });
    expect(sources.showDescription).toBe(false);
    expect(sources.showSelectionIndicator).toBe(true);
    expect(sources.showScrollIndicator).toBe(true);
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-config-source-browser"),
    );
    const configs = setup.renderer.root.findDescendantById(
      "config-config-source-browser",
    ) as import("@opentui/core").SelectRenderable;
    expect(configs.options[0]).toMatchObject({
      name: "team · github",
      description: "/workspace/skill-cli/skill-cli.jsonc /configSources/team",
      value: "/configSources/team",
    });
    expect(configs.showDescription).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 43])(
  "RENDER Config section label remains visible with stable structural tabs at width %i",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
      await openDestination(setup, "project");
      const frame = setup.captureCharFrame();
      expect(frame).toContain(width >= 100 ? "Navigation:" : "Section:");
      expect(frame).toContain("Configure · Project > Sources");
      expect(frame).not.toContain(" Proj ");
      for (const value of [
        "sources",
        "config-sources",
        "collections",
        "for-agents",
        "integrations",
      ])
        expect(
          setup.renderer.root.findDescendantById(`config-section-browser-tab-${value}`),
        ).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER same-value primary Config tab click restores local navigation ownership", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const sources = setup.renderer.root.findDescendantById("config-section-browser-tab-sources")!;
    await setup.mockMouse.click(sources.screenX + 1, sources.screenY);
    sources.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-section-browser-tab-sources",
    );
    expect(setup.captureCharFrame()).toContain("Configure · Project > Sources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config does not reclaim top navigation after Tab leaves its section selector", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "top-navigation-tab-project",
    );
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Local > Sources"));
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("top-navigation-tab-local");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER secondary Config tab clicks preserve selection and focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const sources = setup.renderer.root.findDescendantById("config-section-browser-tab-sources")!;
    await setup.mockMouse.click(sources.screenX + 1, sources.screenY, 2);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-section-browser-tab-sources");
    expect(setup.captureCharFrame()).toContain("Configure · Project > Sources");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Config frame-focus handoff is removed when the App tears down", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const frameListeners = interceptFrameListeners(setup);
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    expect(frameListeners.listeners.size).toBe(1);
    setup.renderer.destroy();
    expect(frameListeners.listeners.size).toBe(0);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});

test("RENDER Config frame-focus handoff replaces same-frame ABA requests", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const frameListeners = interceptFrameListeners(setup);
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Collections"));
    setup.mockInput.pressArrow("left");
    await setup.waitForFrame((frame) => frame.includes("Configure · Project > Config Sources"));
    expect(frameListeners.listeners.size).toBe(1);

    const tab = setup.renderer.root.findDescendantById(
      "config-section-browser-tab-config-sources",
    )!;
    const focus = tab.focus.bind(tab);
    let focusCalls = 0;
    tab.focus = () => {
      focusCalls += 1;
      focus();
    };
    frameListeners.observed[0]!();
    frameListeners.observed.at(-1)!();
    frameListeners.observed.at(-1)!();
    expect(focusCalls).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Config actions are reachable by Enter and mouse with the browser owner", async () => {
  const emptyActionOwner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/available",
  };
  const cases = [
    ["sources", "config-empty-add-source", "Add Source", "source-register-kind"],
    [
      "config-sources",
      "config-empty-add-config-source",
      "Add Config Source",
      "source-register-kind",
    ],
    ["collections", "config-empty-new-collection", "New Collection", "collection-create-id"],
    [
      "for-agents",
      "config-empty-set-collection-use",
      "Set Collection Use",
      "collection-use-values",
    ],
  ] as const;
  for (const [section, id, _actionTitle, operationId] of cases) {
    for (const input of ["keyboard", "mouse"] as const) {
      const projection = configProjection();
      const project = projection.configs.find((item) => item.level === "project")!;
      const adjustedProjection = {
        ...projection,
        configs: projection.configs.map((config) =>
          config.level === "project"
            ? {
                ...project,
                direct: {
                  ...project.direct,
                  sources: [],
                  configSources: [],
                  collections:
                    section === "for-agents" ? [{ id: "available", owner: emptyActionOwner }] : [],
                  collectionUse: [],
                  integrations: [],
                },
                contributed: { sources: [], collections: [] },
              }
            : config,
        ),
      };
      const setup = await testRender(
        () => <App core={directSourceCore(adjustedProjection)} exit={() => {}} />,
        { width: 120, height: 40 },
      );
      try {
        await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
        await openDestination(setup, "project");
        const sections = ["sources", "config-sources", "collections", "for-agents"] as const;
        const sectionIndex = sections.indexOf(section);
        for (let value = 0; value < sectionIndex; value++) {
          setup.mockInput.pressArrow("right");
          const current = sections[value + 1]!;
          const title =
            current === "config-sources"
              ? "Config Sources"
              : current === "for-agents"
                ? "For agents"
                : current[0]!.toUpperCase() + current.slice(1);
          await setup.waitForFrame((frame) => frame.includes(`Configure · Project > ${title}`));
        }
        expect(setup.captureCharFrame()).toContain(
          `Configure · Project > ${
            section === "config-sources"
              ? "Config Sources"
              : section === "for-agents"
                ? "For agents"
                : section[0]!.toUpperCase() + section.slice(1)
          }`,
        );
        const action = setup.renderer.root.findDescendantById(id);
        expect(action).toBeDefined();
        if (input === "keyboard") {
          action!.focus();
          setup.mockInput.pressEnter();
        } else {
          await setup.mockMouse.click(action!.screenX + 1, action!.screenY);
        }
        await setup.waitFor(
          () => setup.renderer.root.findDescendantById(operationId) !== undefined,
        );
        expect(setup.renderer.root.findDescendantById(operationId)).toBeDefined();
      } finally {
        setup.renderer.destroy();
      }
    }
  }
});

test("RENDER Project direct Source actions retain Add Source", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Add your first Skill"));
    await openDestination(setup, "project");
    const browser = setup.renderer.root.findDescendantById("config-source-browser")!;
    browser.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-browser",
    );
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Open Config") && frame.includes("Add Source"),
    );
    expect(setup.renderer.root.findDescendantById("source-action-menu")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER empty Collection Use state does not advertise an unavailable action without collections", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  const adjustedProjection = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? {
            ...project,
            direct: {
              ...project.direct,
              sources: [],
              configSources: [],
              collections: [],
              collectionUse: [],
              integrations: [],
            },
            contributed: { sources: [], collections: [] },
          }
        : config,
    ),
  };
  const state = createConfigState();
  state.selectSection("project", "for-agents");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjustedProjection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onActions={() => {}}
        onAction={() => {}}
        onSection={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Create a Collection first");
    expect(
      setup.renderer.root.findDescendantById("config-empty-set-collection-use"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source registration validates and submits a fixed-level local binding through physical keyboard input", async () => {
  const submitted: unknown[] = [];
  let cancelled = 0;
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="local"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {
          cancelled++;
        }}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    expect(setup.captureCharFrame()).toContain(
      "Enter an ID, configured local path, and source root.",
    );
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["/", "s", "h", "a", "r", "e", "d"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-register-choice");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      {
        level: "local",
        id: "team",
        binding: { kind: "local", path: "/shared", root: "skills" },
      },
    ]);
    await pressEscape(setup);
    expect(cancelled).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER workspace Config Source registration selects its owner and submits a credential-free remote binding", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="config-source"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-level",
    );
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys([
      "h",
      "t",
      "t",
      "p",
      "s",
      ":",
      "/",
      "/",
      "g",
      "i",
      "t",
      "h",
      "u",
      "b",
      ".",
      "c",
      "o",
      "m",
      "/",
      "a",
      "c",
      "m",
      "e",
      "/",
      "c",
      "o",
      "n",
      "f",
      "i",
      "g",
    ]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["x"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "git",
          origin: "https://github.com/acme/config",
          ref: "mainx",
          root: "skills",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER GitHub registration traverses owner and repository in both directions and submits structured fields", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="project"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-github-owner",
    );
    await setup.mockInput.pressKeys(["a", "c", "m", "e"]);
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-github-repository",
    );
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["v", "1"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["a", "g", "e", "n", "t", "s"]);
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-ref",
    );
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "github",
          owner: "acme",
          repository: "skills",
          origin: "https://github.com/acme/skills",
          ref: "mainv1",
          root: "agents",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Source registration repeatedly replaces dynamic controls without retaining destroyed inputs", async () => {
  const submitted: unknown[] = [];
  const setup = await testRender(
    () => (
      <SourceRegistrationOverlay
        kind="source"
        level="project"
        pending={false}
        onSubmit={(value) => submitted.push(value)}
        onCancel={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["t", "e", "a", "m"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["a", "c", "m", "e"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["s", "k", "i", "l", "l", "s"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["v", "1"]);
    setup.mockInput.pressKey("TAB");
    await setup.mockInput.pressKeys(["a", "g", "e", "n", "t", "s"]);

    for (let index = 0; index < 5; index++) setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.pressKeys(["h", "t", "t", "p", "s", ":", "/", "/", "g", "i", "t"]);

    setup.mockInput.pressKey("TAB", { shift: true });
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.pressKeys(["/", "l", "o", "c", "a", "l"]);

    setup.mockInput.pressKey("TAB", { shift: true });
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-github-owner",
    );
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-choice",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();

    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "github",
          owner: "acme",
          repository: "skills",
          origin: "https://github.com/acme/skills",
          ref: "mainv1",
          root: "agents",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
