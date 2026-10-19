import { expect, test } from "bun:test";
import { SelectRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import type { WorkspaceView } from "@skctl/core";
import { createSignal } from "solid-js";
import { App } from "../src/app";
import { ConfigPage } from "../src/config-page";
import { configDeclarationOwnerKey, createConfigState } from "../src/config/state";
import { SourceRegistrationOverlay } from "../src/operations";
import type { ActionRecord } from "../src/actions";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
function configProjection(): WorkspaceView {
  const base = workspaceProjection();
  const global = base.configs[0]!;
  const project = base.configs[1]!;
  const owner = {
    level: "project" as const,
    file: "/workspace/skctl/skctl.jsonc",
    pointer: "/collections/team",
  };
  const configOwner = {
    level: "project" as const,
    file: "/workspace/skctl/skctl.jsonc",
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
          sources: [
            ...project.direct.sources,
            {
              id: "team-skills",
              kind: "local" as const,
              origin: "/workspace/skctl/skills",
              root: "",
              provenance: { level: "project" as const },
              selectors: [],
              ref: {
                id: "team-skills",
                owner: {
                  level: "project" as const,
                  file: project.file.file,
                  pointer: "/sources/team-skills",
                },
              },
            },
          ],
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
          file: "/workspace/skctl/.skctl.jsonc",
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
function renderableText(renderable: BaseRenderable | undefined): string {
  if (!renderable) return "";
  const text = (
    renderable as BaseRenderable & {
      readonly plainText?: string;
    }
  ).plainText;
  return [text ?? "", ...renderable.getChildren().map((child) => renderableText(child))].join("\n");
}
function configAction(
  id: ActionRecord["id"],
  verb: string,
  destination: string,
  danger = false,
): ActionRecord {
  return {
    id,
    keys: ["enter", "return"],
    verb,
    destination,
    scope: "page",
    enabled: true,
    disabledReason: undefined,
    danger,
  };
}
async function openDestination(
  setup: Awaited<ReturnType<typeof testRender>>,
  destination: "global" | "project" | "local",
) {
  await waitForShell(setup);
  await focusLive(setup, "shell-scope-select");
  await parsedEnter(setup);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
  const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
  expect(choices).toBeInstanceOf(SelectRenderable);
  const targetIndex = choices.options.findIndex((option) => option.value === destination);
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < choices.options.length; step++) {
    const currentIndex = choices.getSelectedIndex();
    if (currentIndex === targetIndex) break;
    const nextIndex = currentIndex + (currentIndex < targetIndex ? 1 : -1);
    setup.mockInput.pressArrow(currentIndex < targetIndex ? "down" : "up");
    await setup.renderOnce();
    await setup.waitFor(() => choices.getSelectedIndex() === nextIndex);
  }
  expect(choices.getSelectedOption()?.value).toBe(destination);
  await parsedEnter(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById(`shell-section-${destination}-tab-sources`),
  );
  const tab = (await focusLive(
    setup,
    `shell-section-${destination}-tab-sources`,
  )) as TabsTabRenderable;
  expect(tab.getState().selected).toBe(true);
}
async function waitForShell(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => {
    const scope = setup.renderer.root.findDescendantById("shell-scope-select");
    return !!scope && !scope.isDestroyed && !!scope.parent;
  });
}
async function openSection(
  setup: Awaited<ReturnType<typeof testRender>>,
  section: "sources" | "config-sources" | "collections" | "integrations",
) {
  const sections = ["sources", "config-sources", "collections", "integrations"] as const;
  const targetIndex = sections.indexOf(section);
  const currentIndex = sections.findIndex((value) => {
    const tab = setup.renderer.root.findDescendantById(`shell-section-project-tab-${value}`);
    return tab instanceof TabsTabRenderable && tab.getState().selected;
  });
  if (currentIndex < 0) throw new Error("Shell section selection did not mount");
  const current = setup.renderer.root.findDescendantById(
    `shell-section-project-tab-${sections[currentIndex]}`,
  )!;
  current.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === current.id);
  for (let index = currentIndex; index < targetIndex; index++) {
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    const next = sections[index + 1]!;
    const title =
      next === "config-sources" ? "Config Sources" : next[0]!.toUpperCase() + next.slice(1);
    await setup.waitForFrame((frame) => frame.includes(title));
    const tab = setup.renderer.currentFocusedRenderable as TabsTabRenderable;
    expect(tab.id).toBe(`shell-section-project-tab-${next}`);
    expect(tab.getState().selected).toBe(true);
  }
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
    await waitForShell(setup);
    for (const destination of ["global", "project", "local"] as const) {
      await openDestination(setup, destination);
      const title = destination[0]!.toUpperCase() + destination.slice(1);
      expect(
        renderableText(setup.renderer.root.findDescendantById("shell-scope-select")),
      ).toContain(title);
    }
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER wide Config owns bounded Sections and Content panels with a growing primary list", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const browser = setup.renderer.root.findDescendantById("config-work-area")!;
    const sources = setup.renderer.root.findDescendantById(
      "config-source-browser",
    ) as import("@opentui/core").SelectRenderable;
    for (const panel of [browser]) {
      expect(panel.screenX).toBeGreaterThanOrEqual(0);
      expect(panel.screenY).toBeGreaterThanOrEqual(0);
      expect(panel.screenX + panel.width).toBeLessThanOrEqual(120);
      expect(panel.screenY + panel.height).toBeLessThanOrEqual(40);
    }
    expect(sources.height).toBeGreaterThan(10);
    expect(sources.height).toBeLessThanOrEqual(browser.height);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config uses the shared Sections and Content shell without a standalone agent route", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const frame = setup.captureCharFrame();
    expect(setup.renderer.root.findDescendantById("shell-scope-select")).toBeDefined();
    for (const value of ["sources", "config-sources", "collections", "integrations"])
      expect(
        setup.renderer.root.findDescendantById(`shell-section-project-tab-${value}`),
      ).toBeDefined();
    for (const label of ["Sources", "Configs", "Cols", "Agents"]) expect(frame).toContain(label);
    expect(setup.renderer.root.findDescendantById("config-section-browser")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("config-scope-panel")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config keeps the same shell geometry at medium width", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const section = setup.renderer.root.findDescendantById("shell-section-project-tab-sources")!;
    const workArea = setup.renderer.root.findDescendantById("config-work-area")!;
    expect(section).toBeDefined();
    expect(workArea).toBeDefined();
    expect(setup.captureCharFrame()).toContain("Cols");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER selected Config Source exposes its contributed source and collection", async () => {
  const projection = configProjection();
  const state = createConfigState();
  state.land("project", "config-sources", "/configSources/team");
  state.openConfigSourceInspector("project");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => projection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onAction={() => {}}
        onOpenConfigSourceInspector={() => state.openConfigSourceInspector("project")}
        onBackConfigSourceInspector={() => state.backConfigSourceSurface("project")}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Source  team/lark");
    expect(setup.captureCharFrame()).toContain("Collection  team/docs");
    expect(setup.renderer.root.findDescendantById("config-source-contributions")).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.source.back"),
    ).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER selected Config declarations expose binding and owner facts", async () => {
  const projection = configProjection();
  const state = createConfigState();
  const render = async (section: "sources" | "collections", selection: string) => {
    state.land("project", section, selection);
    const setup = await testRender(
      () => (
        <ConfigPage
          config={state}
          projection={() => projection}
          destination="project"
          actions={[]}
          onSelect={() => {}}
          onAction={() => {}}
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
    expect(frame).toContain("Tracked ref  main");
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
    expect(renderableText(contributed.renderer.root)).toContain(
      "Config Source owner  project /workspace/skctl/skctl.jsonc /configSources/team",
    );
  } finally {
    contributed.renderer.destroy();
  }
  const collections = await render("collections", "team");
  try {
    expect(collections.captureCharFrame()).toContain("Selected Collection  team");
    expect(renderableText(collections.renderer.root)).toContain(
      "Owner  /workspace/skctl/skctl.jsonc /collections/team",
    );
  } finally {
    collections.renderer.destroy();
  }
});
test("RENDER Config ignores an invalid selected Collection without an action surface", async () => {
  const projection = configProjection();
  const state = createConfigState();
  state.land("project", "collections", "missing");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => projection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(
      setup.renderer.root.findDescendantById("config-command-set-collection-use"),
    ).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.collection.open-owner"),
    ).toBeUndefined();
    expect(setup.captureCharFrame()).not.toContain("Set Collection Use");
    expect(setup.captureCharFrame()).not.toContain("Edit Collection Use");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config keeps an empty selected Collection from creating an orphan text node", async () => {
  const projection = configProjection();
  const state = createConfigState();
  state.land("project", "collections", "");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => projection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(
      setup.renderer.root.findDescendantById("config-command-set-collection-use"),
    ).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.collection.open-owner"),
    ).toBeUndefined();
    expect(setup.captureCharFrame()).not.toContain("Set Collection Use");
    expect(setup.captureCharFrame()).not.toContain("Edit Collection Use");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER direct Source tracked refs distinguish local bindings from declaration ownership at 120 80 and 43", async () => {
  const projection = configProjection();
  for (const [width, height] of [
    [120, 40],
    [80, 40],
    [43, 40],
  ] as const) {
    const state = createConfigState();
    state.land("project", "sources", "team-skills");
    const setup = await testRender(
      () => (
        <ConfigPage
          config={state}
          projection={() => projection}
          destination="project"
          actions={[]}
          onSelect={() => {}}
          onAction={() => {}}
          onContribution={() => {}}
        />
      ),
      { width, height },
    );
    try {
      await setup.renderOnce();
      expect(renderableText(setup.renderer.root)).toContain("Tracked ref  None");
      expect(setup.renderer.root.findDescendantById("config-source-browser")).toBeDefined();
      state.land("project", "sources", "team-main");
      await setup.waitFor(() => renderableText(setup.renderer.root).includes("Tracked ref  main"));
      expect(renderableText(setup.renderer.root)).not.toContain("Tracked ref  team-main");
    } finally {
      setup.renderer.destroy();
    }
  }
});
test("RENDER projection removal clears the Config Source browser into its empty command", async () => {
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
  const [projection, setProjection] = createSignal<WorkspaceView>(before);
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={projection}
        destination="project"
        actions={[
          configAction("add-config-source", "Add Config Source", "Register a Config Source"),
        ]}
        onSelect={() => {}}
        onAction={() => {}}
        onOpenConfigSourceInspector={() => state.openConfigSourceInspector("project")}
        onBackConfigSourceInspector={() => state.backConfigSourceSurface("project")}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Config Source  team");
    state.backConfigSourceSurface("project");
    state.reconcile(before, after);
    setProjection(after);
    await setup.waitForFrame((frame) => frame.includes("No Config Sources yet"));
    expect(state.selection("project", "config-sources")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("No Config Sources yet");
    await focusLive(setup, "config-command-add-config-source");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-add-config-source");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config Source inspector returns to its Config Source row on Escape", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    setup.renderer.root.findDescendantById("shell-section-project-tab-sources")!.focus();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    const tab = setup.renderer.currentFocusedRenderable as TabsTabRenderable;
    expect(tab.id).toBe("shell-section-project-tab-config-sources");
    expect(tab.getState().selected).toBe(true);
    await focusLive(setup, "config-config-source-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    expect(setup.renderer.root.findDescendantById("config-source-inspector")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-source-contributions")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    expect(setup.captureCharFrame()).toContain("Config Sources");
    expect(setup.renderer.root.findDescendantById("config-source-inspector")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config Source Inspector exposes exact commands without a local action menu or Back", async () => {
  const projection = configProjection();
  const state = createConfigState();
  state.land("project", "config-sources", "/configSources/team");
  const dispatched: string[] = [];
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => projection}
        destination="project"
        actions={[
          configAction("config-observe", "Check / review Config update…", "Review Config update"),
          configAction("config-remove", "Remove Config Source", "Review Config removal", true),
        ]}
        onSelect={(value) => state.select("project", value)}
        onAction={(id) => dispatched.push(id)}
        onOpenConfigSourceInspector={() => state.openConfigSourceInspector("project")}
        onBackConfigSourceInspector={() => state.backConfigSourceSurface("project")}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await focusLive(setup, "config-config-source-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    expect(setup.captureCharFrame()).toContain("Owner");
    expect(setup.captureCharFrame()).toContain("Binding kind");
    expect(setup.captureCharFrame()).toContain("Applied commit");
    expect(setup.renderer.root.findDescendantById("config-source-actions")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("config-source-contributions")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-command-config-observe")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-command-config-adopt")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Check / review Config update");
    expect(
      setup.renderer.root.findDescendantById("config-command-config.source.back"),
    ).toBeDefined();
    const command = setup.renderer.root.findDescendantById("config-command-config-remove");
    expect(command).toBeDefined();
    command!.focus();
    await parsedEnter(setup);
    await setup.waitFor(() => dispatched.length === 1);
    expect(dispatched).toEqual(["config-remove"]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER shell Section navigation owns Config section transitions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    {
      width: 120,
      height: 40,
    },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const values = ["sources", "config-sources", "collections", "integrations"] as const;
    for (const value of values)
      expect(
        setup.renderer.root.findDescendantById(`shell-section-project-tab-${value}`),
      ).toBeDefined();
    await openSection(setup, "integrations");
    const integrationBrowser = setup.renderer.root.findDescendantById(
      "config-integrations-browser",
    )!;
    integrationBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === integrationBrowser);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Managed OpenCode");
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
    await waitForShell(setup);
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
      description: "/workspace/skctl/skctl.jsonc /configSources/team",
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
      await waitForShell(setup);
      await openDestination(setup, "project");
      const frame = setup.captureCharFrame();
      expect(
        renderableText(setup.renderer.root.findDescendantById("shell-scope-select")),
      ).toContain("Project");
      expect(frame).not.toContain(" Proj ");
      for (const value of ["sources", "config-sources", "collections", "integrations"])
        expect(
          setup.renderer.root.findDescendantById(`shell-section-project-tab-${value}`),
        ).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);
test.each(["invalid", "unreadable"] as const)(
  "RED Config pages show the concrete %s file problem without declarations or mutations at 120, 80, and 43",
  async (status) => {
    for (const destination of ["global", "project", "local"] as const) {
      const base = configProjection();
      const selected =
        base.configs.find((config) => config.level === destination) ?? base.configs.at(-1)!;
      const projection: WorkspaceView = {
        ...base,
        configs: base.configs.map((config) =>
          config === selected
            ? {
                ...config,
                level: destination,
                file: {
                  status,
                  file: `/broken/${destination}.jsonc`,
                  problem: {
                    code: status === "invalid" ? "CONFIG_INVALID" : "CONFIG_SYMLINK",
                    severity: "warning",
                    message: `${destination} Config cannot be read`,
                    location: {
                      file: `/broken/${destination}.jsonc`,
                      pointer: "/sources/bad",
                    },
                    suggestion: "Repair the Config file",
                  },
                },
                direct: {
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
      for (const width of [120, 80, 43]) {
        const state = createConfigState();
        const setup = await testRender(
          () => (
            <ConfigPage
              config={state}
              projection={() => projection}
              destination={destination}
              actions={[]}
              onSelect={() => {}}
              onAction={() => {}}
              onContribution={() => {}}
            />
          ),
          { width, height: 40 },
        );
        try {
          await setup.renderOnce();
          const frame = setup.captureCharFrame();
          const text = renderableText(setup.renderer.root);
          const compact = text.replaceAll(/\s/g, "");
          expect(frame).not.toContain("Section: Sources");
          expect(text).toContain(`File  /broken/${destination}.jsonc`);
          expect(text).toContain(`Status  ${status}`);
          expect(text).toContain(
            `Code  ${status === "invalid" ? "CONFIG_INVALID" : "CONFIG_SYMLINK"}`,
          );
          expect(compact).toContain(`${destination}Configcannotberead`);
          expect(compact).toContain("Pointer/sources/bad");
          expect(compact).toContain("SuggestionRepairtheConfigfile");
          expect(compact).toContain("Read-only");
          expect(compact).toContain("Mutationsdisabled");
          expect(setup.renderer.root.findDescendantById("config-file-problem")).toBeDefined();
          expect(frame).not.toContain("No Sources yet");
          expect(frame).not.toContain("Add Source");
          expect(frame).not.toContain("New Collection");
        } finally {
          setup.renderer.destroy();
        }
      }
    }
  },
);
test("RENDER same-value primary Config tab click restores local navigation ownership", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const sources = setup.renderer.root.findDescendantById("shell-section-project-tab-sources")!;
    await setup.mockMouse.click(sources.screenX + 1, sources.screenY);
    sources.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "shell-section-project-tab-sources",
    );
    expect((sources as TabsTabRenderable).getState().selected).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Tab traverses Scope and Sections without changing Config content", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const section = setup.renderer.root.findDescendantById("shell-section-project-tab-sources")!;
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "shell-scope-select");
    expect(setup.captureCharFrame()).toContain("Sources");
    const focused = setup.renderer.currentFocusedRenderable;
    expect(focused?.isDestroyed).toBe(false);
    expect(focused?.parent).toBeDefined();
    expect(renderableText(focused ?? undefined)).toContain("Project");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
    expect((section as TabsTabRenderable).getState().selected).toBe(true);
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
    await waitForShell(setup);
    await openDestination(setup, "project");
    const sources = setup.renderer.root.findDescendantById("shell-section-project-tab-sources")!;
    await setup.mockMouse.click(sources.screenX + 1, sources.screenY);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("shell-section-project-tab-sources");
    expect((sources as TabsTabRenderable).getState().selected).toBe(true);
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
    await waitForShell(setup);
    await openDestination(setup, "project");
    const frameListeners = interceptFrameListeners(setup);
    setup.mockInput.pressArrow("right");
    await setup.waitForFrame((frame) => frame.includes("Config Sources"));
    expect(frameListeners.listeners.size).toBe(1);
    setup.renderer.destroy();
    expect(frameListeners.listeners.size).toBe(0);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});
test("RENDER shell section focus survives repeated Config transitions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    for (const [direction, title, id] of [
      ["right", "Config Sources", "shell-section-project-tab-config-sources"],
      ["right", "Collections", "shell-section-project-tab-collections"],
      ["left", "Config Sources", "shell-section-project-tab-config-sources"],
    ] as const) {
      setup.mockInput.pressArrow(direction);
      await setup.waitForFrame((frame) => frame.includes(title));
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(id);
    }
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER empty Config actions are reachable by Enter and mouse with the browser owner", async () => {
  const cases = [
    ["collections", "config-command-new-collection", "New Collection", "collection-create-id"],
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
                  collections: [],
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
        await waitForShell(setup);
        await openDestination(setup, "project");
        await openSection(setup, section);
        await setup.waitFor(
          () =>
            setup.renderer.currentFocusedRenderable?.id === `shell-section-project-tab-${section}`,
        );
        expect(setup.captureCharFrame()).toContain(section[0]!.toUpperCase() + section.slice(1));
        const action = setup.renderer.root.findDescendantById(id);
        expect(action).toBeDefined();
        if (input === "keyboard") {
          await focusLive(setup, id);
          await parsedEnter(setup);
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
test("RENDER Project direct Source rows select data without a generic action menu", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const browser = setup.renderer.root.findDescendantById("config-source-browser")!;
    browser.focus();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-browser",
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Selected Source  team-main"));
    expect(setup.renderer.root.findDescendantById("source-action-menu")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("config-command-add-source")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER empty Collection Use state does not advertise an unavailable action without collections", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
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
  state.selectSection("project", "collections");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjustedProjection}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("No Collections yet");
    expect(
      setup.renderer.root.findDescendantById("config-command-set-collection-use"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER integrations use native rows and an inspect-only catalog surface", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const adjustedProjection: WorkspaceView = {
    ...projection,
    effective: {
      ...projection.effective,
      status: "complete",
      managed: true,
      use: ["team"],
      agent: {
        status: "available",
        integration: [project.direct.integrations[0]!.owner],
        use: [project.direct.collectionUse[0]!.owner],
        reasons: [],
        catalog: [
          {
            selector: "team:guide",
            name: "Guide",
            description: "Review the team guide",
            aliases: ["guide"],
          },
          {
            selector: "team:review",
            name: "Review",
            description: "Review checklist",
            aliases: [],
          },
        ],
      },
    },
  };
  const state = createConfigState();
  const dispatched: string[] = [];
  state.selectSection("project", "integrations");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjustedProjection}
        destination="project"
        actions={[
          configAction(
            "disable-managed-opencode",
            "Disable Managed OpenCode",
            "Disable Managed OpenCode",
            true,
          ),
        ]}
        onSelect={(value) => state.select("project", value)}
        onAction={(id) => dispatched.push(id)}
        onBackIntegrationSurface={() => state.backIntegrationSurface("project")}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("config-integrations-browser")).toBeDefined();
    expect(setup.captureCharFrame()).not.toContain("Managed OpenCode catalog:");
    const browser = setup.renderer.root.findDescendantById(
      "config-integrations-browser",
    ) as import("@opentui/core").SelectRenderable;
    if (!browser) throw new Error(`Integration list did not mount\n${setup.captureCharFrame()}`);
    const integrationOwnerKey = configDeclarationOwnerKey(project.direct.integrations[0]!.owner);
    expect(browser.options).toHaveLength(1);
    expect(browser.options[0]?.name).toContain("Managed OpenCode");
    await focusLive(setup, "config-integrations-browser");
    await parsedEnter(setup);
    await setup.renderOnce();
    if (!setup.renderer.root.findDescendantById("config-integration-inspector"))
      throw new Error(`Initial integration inspector did not mount\n${setup.captureCharFrame()}`);
    expect(
      setup.renderer.root.findDescendantById("config-command-disable-managed-opencode"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.integration.back"),
    ).toBeDefined();
    await focusLive(setup, "config-command-disable-managed-opencode");
    await parsedEnter(setup);
    expect(dispatched).toEqual(["disable-managed-opencode"]);
    await focusLive(setup, "config-command-config.integration.back");
    await parsedEnter(setup);
    expect(state.section("project")).toBe("integrations");
    expect(setup.captureCharFrame()).toContain("Integrations connect this Config to agent hosts.");
    const reopenedBrowser = (await focusLive(
      setup,
      "config-integrations-browser",
    )) as import("@opentui/core").SelectRenderable;
    expect(reopenedBrowser.getSelectedOption()?.value).toBe(integrationOwnerKey);
    await parsedEnter(setup);
    expect(setup.renderer.root.findDescendantById("config-integration-inspector")).toBeDefined();
    const inspectorText = renderableText(setup.renderer.root);
    expect(inspectorText).toContain("Status  Available");
    expect(inspectorText).toContain("Collection Use");
    expect(inspectorText).toContain("Collection Use  project");
    const catalog = setup.renderer.root.findDescendantById(
      "config-integration-catalog",
    ) as import("@opentui/core").SelectRenderable;
    expect(catalog.options.map((option) => option.name)).toEqual([
      "team:guide · Guide",
      "team:review · Review",
    ]);
    catalog.focus();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(state.integrationCatalogSelection("project")).toBe("team:review");
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-catalog-entry-inspector"),
    );
    expect(setup.captureCharFrame()).toContain("Catalog Entry  team:review");
    const entryBack = setup.renderer.root.findDescendantById("config-command-config.catalog.back")!;
    entryBack.focus();
    await parsedEnter(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-integration-inspector"),
    );
    expect(state.integrationSurface("project")).toBe("inspector");
    expect(state.integrationCatalogSelection("project")).toBe("team:review");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER mixed integration owners keep Actions and Palette owner-safe", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  const projectOwner = project.direct.integrations[0]!.owner;
  const globalOwner = {
    level: "global" as const,
    file: "/home/user/.config/skctl.jsonc",
    pointer: "/agents/opencode",
  };
  const mixed: WorkspaceView = {
    ...projection,
    effective: {
      ...projection.effective,
      agent: {
        status: "available",
        integration: [projectOwner, globalOwner],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(mixed)} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById(
      "config-integrations-browser",
    ) as import("@opentui/core").SelectRenderable;
    expect(browser).toBeDefined();
    browser.focus();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(browser.getSelectedOption()?.value).toBe(configDeclarationOwnerKey(globalOwner));
    await parsedEnter(setup);
    expect(setup.captureCharFrame()).toContain("Open owning Config");
    expect(
      setup.renderer.root.findDescendantById("config-command-config.integration.open-owner"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.integration.back"),
    ).toBeDefined();
    setup.mockInput.pressEscape();
    await setup.renderOnce();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.renderOnce();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("palette-open-config-integration"),
    );
    expect(setup.renderer.root.findDescendantById("palette-open-config-integration")).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("palette-disable-managed-opencode"),
    ).toBeUndefined();
    setup.renderer.root.findDescendantById("palette-open-config-integration")!.focus();
    await parsedEnter(setup);
    await setup.waitFor(() => {
      const tab = setup.renderer.root.findDescendantById("shell-section-global-tab-integrations");
      return tab instanceof TabsTabRenderable && tab.getState().selected;
    });
    expect(renderableText(setup.renderer.root.findDescendantById("shell-scope-select"))).toContain(
      "Global",
    );
    expect(setup.captureCharFrame()).toContain(globalOwner.pointer);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER stale catalog entry keeps an explicit Back to Integration action", async () => {
  const initial = configProjection();
  if (initial.effective.status !== "complete") throw new Error("expected complete fixture");
  const complete = initial.effective;
  const project = initial.configs.find((item) => item.level === "project")!;
  const catalogProjection = (
    catalog: readonly {
      selector: string;
      name: string;
      description: string;
      aliases: readonly string[];
    }[],
  ): WorkspaceView => ({
    ...initial,
    effective: {
      ...complete,
      managed: true,
      use: ["team"],
      agent: {
        status: "available",
        integration: [project.direct.integrations[0]!.owner],
        use: [project.direct.collectionUse[0]!.owner],
        reasons: [],
        catalog,
      },
    },
  });
  const [projection, setProjection] = createSignal<WorkspaceView>(
    catalogProjection([
      {
        selector: "team:guide",
        name: "Guide",
        description: "Guide",
        aliases: [],
      },
    ]),
  );
  const state = createConfigState();
  state.land(
    "project",
    "integrations",
    configDeclarationOwnerKey(project.direct.integrations[0]!.owner),
  );
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={projection}
        destination="project"
        actions={[configAction("set-collection-use", "Set Collection Use", "Edit Collection Use")]}
        onSelect={(value) => state.select("project", value)}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    state.openIntegrationInspector("project");
    state.openIntegrationCatalogEntry("project", "team:guide");
    await setup.renderOnce();
    setProjection(catalogProjection([]));
    state.reconcile(
      catalogProjection([
        {
          selector: "team:guide",
          name: "Guide",
          description: "Guide",
          aliases: [],
        },
      ]),
      catalogProjection([]),
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Catalog entry unavailable");
    const back = setup.renderer.root.findDescendantById("config-command-config.catalog.back")!;
    expect(back).toBeDefined();
    back.focus();
    await parsedEnter(setup);
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("config-integration-inspector")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER unavailable integrations distinguish reasons from an available empty catalog and expose one enable action", async () => {
  const projection = configProjection();
  const adjustedProjection: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, integrations: [] } }
        : config,
    ),
    effective: {
      ...projection.effective,
      agent: {
        status: "unavailable",
        integration: [],
        use: [],
        reasons: [
          {
            code: "CONFIG_CONFLICT",
            severity: "warning",
            message: "Collection Use is incomplete",
          },
        ],
        catalog: [],
      },
    },
  };
  let enables = 0;
  const state = createConfigState();
  state.selectSection("project", "integrations");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjustedProjection}
        destination="project"
        actions={[
          configAction(
            "enable-managed-opencode",
            "Enable Managed OpenCode",
            "Enable managed OpenCode in this Config owner",
          ),
        ]}
        onSelect={() => {}}
        onAction={(id) => {
          if (id === "enable-managed-opencode") enables++;
        }}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Unavailable");
    expect(setup.captureCharFrame()).toContain("Collection Use is incomplete");
    expect(setup.captureCharFrame()).not.toContain("catalog: empty");
    await focusLive(setup, "config-command-enable-managed-opencode");
    await parsedEnter(setup);
    expect(enables).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER empty Config Integrations enables Managed OpenCode without an existing owner", async () => {
  const projection = workspaceProjection();
  const project = projection.configs.find((config) => config.level === "project")!;
  const adjusted: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, integrations: [] } }
        : config,
    ),
  };
  const changes: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(adjusted, {
          createCollection: async (_environment: import("@skctl/core").CoreOptions, request) => {
            changes.push(request);
            return {
              value: {
                level: project.level,
                file: project.file.file,
                changed: true,
              },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await focusLive(setup, "config-command-enable-managed-opencode");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Target:"));
    expect(setup.captureCharFrame()).toContain(project.file.file);
    expect(setup.captureCharFrame()).toContain("/agents/opencode");
    setup.mockInput.pressEscape();
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-command-enable-managed-opencode"),
    );
    expect(changes).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config Collections expose Set or Edit Collection Use only for a direct collection owner", async () => {
  const projection = configProjection();
  const state = createConfigState();
  state.land("project", "collections", "team");
  const selected = projection.configs.find((item) => item.level === "project")!;
  const actions: string[] = [];
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => projection}
        destination="project"
        actions={[configAction("set-collection-use", "Set Collection Use", "Edit Collection Use")]}
        onSelect={() => {}}
        onAction={(id) => actions.push(id)}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await focusLive(setup, "config-command-set-collection-use");
    await parsedEnter(setup);
    expect(actions).toEqual(["set-collection-use"]);
    expect(selected.direct.collections.some((item) => item.id === "team")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER contributed integrations expose only their read-only owning Config action", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  const owner = {
    level: "global" as const,
    file: "/home/user/.config/skctl.jsonc",
    pointer: "/agents/opencode",
    contribution: project.direct.configSources[0]!.owner
      ? {
          configSource: project.direct.configSources[0]!.owner,
          declaration: {
            level: "global" as const,
            pointer: "/agents/opencode",
          },
        }
      : undefined,
  };
  const adjusted: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, integrations: [] } }
        : config,
    ),
    effective: {
      ...projection.effective,
      agent: {
        status: "available",
        integration: [owner],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
  };
  const state = createConfigState();
  state.land("project", "integrations", configDeclarationOwnerKey(owner));
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjusted}
        destination="project"
        actions={[
          configAction(
            "enable-managed-opencode",
            "Enable Managed OpenCode",
            "Enable managed OpenCode in this Config owner",
          ),
        ]}
        onSelect={() => {}}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById("config-integrations-browser")!;
    browser.focus();
    await parsedEnter(setup);
    await setup.renderOnce();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.integration.open-owner"),
    ).toBeDefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.integration.back"),
    ).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Config keeps duplicate integration pointers distinct by owner", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  const globalOwner = {
    level: "global" as const,
    file: "/home/user/.config/skctl.jsonc",
    pointer: "/agents/opencode",
  };
  const adjusted: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              integrations: [
                {
                  kind: "opencode" as const,
                  owner: project.direct.integrations[0]!.owner,
                },
              ],
            },
          }
        : config,
    ),
    effective: {
      ...projection.effective,
      agent: {
        status: "available",
        integration: [globalOwner, project.direct.integrations[0]!.owner],
        use: [],
        reasons: [],
        catalog: [],
      },
    },
  };
  const state = createConfigState();
  state.selectSection("project", "integrations");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjusted}
        destination="project"
        actions={[configAction("set-collection-use", "Set Collection Use", "Edit Collection Use")]}
        onSelect={(value) => state.select("project", value)}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById(
      "config-integrations-browser",
    ) as import("@opentui/core").SelectRenderable;
    expect(browser.options).toHaveLength(2);
    expect(browser.options.map((option) => option.description)).toEqual([
      "project /workspace/skctl/skctl.jsonc /agents/opencode",
      "global /home/user/.config/skctl.jsonc /agents/opencode",
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER contributed Collection Use remains editable when its Collection declaration is contributed", async () => {
  const projection = configProjection();
  const project = projection.configs.find((item) => item.level === "project")!;
  const adjusted: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: [],
              collectionUse: [
                {
                  collection: "team/docs",
                  owner: {
                    ...project.direct.collectionUse[0]!.owner,
                    pointer: "/use/0",
                  },
                },
              ],
            },
            contributed: { ...config.contributed, collections: ["team/docs"] },
          }
        : config,
    ),
  };
  const state = createConfigState();
  state.land("project", "collections", "team/docs");
  const actions: string[] = [];
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjusted}
        destination="project"
        actions={[configAction("set-collection-use", "Set Collection Use", "Edit Collection Use")]}
        onSelect={(value) => state.select("project", value)}
        onAction={(id) => actions.push(id)}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await focusLive(setup, "config-command-set-collection-use");
    await parsedEnter(setup);
    expect(actions).toEqual(["set-collection-use"]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER contributed Collection without Collection Use has no false owning-Use action", async () => {
  const projection = configProjection();
  const adjusted: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: { ...config.direct, collections: [], collectionUse: [] },
            contributed: { ...config.contributed, collections: ["team/docs"] },
          }
        : config,
    ),
  };
  const state = createConfigState();
  state.land("project", "collections", "team/docs");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => adjusted}
        destination="project"
        actions={[configAction("set-collection-use", "Set Collection Use", "Edit Collection Use")]}
        onSelect={() => {}}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(
      setup.renderer.root.findDescendantById("config-command-set-collection-use"),
    ).toBeUndefined();
    expect(
      setup.renderer.root.findDescendantById("config-command-config.collection.open-owner"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER unresolved Config projection shows Loading instead of Managed OpenCode Unavailable", async () => {
  const state = createConfigState();
  state.selectSection("project", "integrations");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        projection={() => undefined}
        destination="project"
        actions={[]}
        onSelect={() => {}}
        onAction={() => {}}
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Loading");
    expect(setup.captureCharFrame()).not.toContain("Managed OpenCode Unavailable");
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
    await setup.renderOnce();
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
    setup.mockInput.pressKey("TAB");
    await parsedEnter(setup);
    expect(submitted).toEqual([
      {
        level: "local",
        id: "team",
        binding: { kind: "local", path: "/shared", root: "skills" },
      },
    ]);
    await parsedEscape(setup);
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
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-level",
    );
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await parsedEnter(setup);
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await parsedEnter(setup);
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
    await setup.renderOnce();
    setup.renderer.root.findDescendantById("source-register-submit")?.focus();
    await parsedEnter(setup);
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
    await setup.renderOnce();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-kind",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    await setup.renderOnce();
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
    setup.renderer.root.findDescendantById("source-register-submit")?.focus();
    await parsedEnter(setup);
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
    await parsedEnter(setup);
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
    await parsedEnter(setup);
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
    await parsedEnter(setup);
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
    await parsedEnter(setup);
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
    setup.mockInput.pressKey("TAB");
    await parsedEnter(setup);
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
