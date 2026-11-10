import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  InputRenderable,
  SelectRenderable,
  ScrollBoxRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { createSignal } from "solid-js";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { ConfigPage } from "../src/config-page";
import { createConfigState } from "../src/config/state";
import { SourceRegistrationOverlay } from "../src/operations";
import type { IntegrationsApi } from "../src/integrations/state";
import type { MutationRequest } from "@skctl/integrations";
import type { ActionRecord } from "../src/actions";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import { openSettingsCategory } from "./settings-test-controls";

test.each([true, false])(
  "Config Source review keeps cancel and exact confirmation fixed while scrolling (allowed=%s)",
  async (allowed) => {
    const core = directSourceCore(workspaceProjection());
    const removed: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={{
            ...core,
            previewConfigRemoval: async (environment, request) => {
              const result = await core.previewConfigRemoval(environment, request);
              return {
                ...result,
                value: {
                  ...result.value!,
                  allowed,
                  disappearingSelectors: Array.from(
                    { length: 30 },
                    (_, index) => `team-config:long-selector-${index}`,
                  ),
                },
              };
            },
            removeConfig: async (_environment, request) => {
              removed.push(request.id);
              return { value: undefined, diagnostics: [] };
            },
          }}
          exit={() => {}}
        />
      ),
      { width: 120, height: 24 },
    );
    try {
      await openMainPage(setup, "settings");
      await openSettingsCategory(setup, "config-sources");
      await enterLive(setup, "config-config-source-browser");
      await enterLive(setup, "config-command-config-remove");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("config-operation-review"),
      );
      await setup.flush();
      const descendants = (node: BaseRenderable): BaseRenderable[] => [
        node,
        ...node.getChildren().flatMap(descendants),
      ];
      const cancel = setup.renderer.root.findDescendantById("config-operation-review")!;
      const body = descendants(setup.renderer.root).find(
        (node) =>
          node instanceof ScrollBoxRenderable &&
          descendants(node).some(
            (child) => "plainText" in child && String(child.plainText).includes("long-selector-29"),
          ),
      ) as ScrollBoxRenderable;
      for (const [width, height] of [
        [120, 30],
        [100, 24],
        [80, 23],
        [43, 13],
      ] as const) {
        setup.resize(width, height);
        await setup.flush();
        expect(!!body).toBe(true);
        expect(!!body.findDescendantById(cancel.id)).toBe(false);
        expect(body.viewport.height).toBeGreaterThanOrEqual(6);
        const y = cancel.screenY;
        body.scrollBy(20);
        await setup.flush();
        expect(cancel.screenY).toBe(y);
        expect(cancel.screenY + cancel.height).toBeLessThanOrEqual(height - 1);
        expect(!!setup.renderer.root.findDescendantById("config-operation-confirm")).toBe(allowed);
        await mkdir("out/task-footers", { recursive: true });
        await writeFile(
          `out/task-footers/config-${allowed ? "allowed" : "blocked"}-${width}x${height}.txt`,
          setup.captureCharFrame(),
        );
      }
      await enterLive(setup, "config-operation-review");
      expect(removed).toEqual([]);
      if (!allowed) return;
      await enterLive(setup, "config-command-config-remove");
      await enterLive(setup, "config-operation-confirm");
      await setup.waitFor(() => removed.length === 1);
      expect(removed).toEqual(["team-config"]);
    } finally {
      setup.renderer.destroy();
    }
  },
);
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
  if (!setup.renderer.root.findDescendantById("shell-scope-select")) {
    await openMainPage(setup, "settings");
  }
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
  await openSettingsCategory(setup, "sources");
}
async function waitForShell(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => {
    const page =
      setup.renderer.root.findDescendantById("shell-pages-select") ??
      setup.renderer.root.findDescendantById("shell-section-tab-settings");
    return !!page && !page.isDestroyed && !!page.parent;
  });
}
async function openSection(
  setup: Awaited<ReturnType<typeof testRender>>,
  section: "sources" | "config-sources" | "collections" | "integrations",
  scope: "global" | "project" | "local" = "project",
) {
  if (section === "integrations") {
    await openMainPage(setup, "agent");
    await focusLive(setup, `agent-view-tab-${scope === "global" ? "global" : "project"}`);
    await parsedEnter(setup);
    return;
  }
  await openSettingsCategory(setup, section);
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
    const browser = setup.renderer.root.findDescendantById("config-browser-pane")!;
    const sources = setup.renderer.root.findDescendantById(
      "config-source-browser",
    ) as import("@opentui/core").SelectRenderable;
    for (const panel of [browser]) {
      expect(panel.screenX).toBeGreaterThanOrEqual(0);
      expect(panel.screenY).toBeGreaterThanOrEqual(0);
      expect(panel.screenX + panel.width).toBeLessThanOrEqual(120);
      expect(panel.screenY + panel.height).toBeLessThanOrEqual(40);
    }
    expect(sources.height).toBeGreaterThanOrEqual(3);
    expect(sources.height).toBeLessThanOrEqual(browser.height);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Settings keeps declaration sections separate from the Agent page", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    await enterLive(setup, "config-command-config.categories");
    const frame = setup.captureCharFrame();
    expect(setup.renderer.root.findDescendantById("shell-scope-select")).toBeDefined();
    const categories = setup.renderer.root.findDescendantById(
      "settings-categories",
    ) as SelectRenderable;
    expect(categories.options.map((option) => option.value)).toEqual([
      "sources",
      "config-sources",
      "collections",
      "interface",
    ]);
    for (const label of ["Sources", "Config Sources", "Collections"])
      expect(frame).toContain(label);
    await openMainPage(setup, "agent");
    expect(!!setup.renderer.root.findDescendantById("agent-view-tab-catalog")).toBe(true);
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
    const browser = setup.renderer.root.findDescendantById("config-browser-pane")!;
    const y = browser.screenY;
    await openSection(setup, "collections");
    expect(setup.renderer.root.findDescendantById("config-browser-pane")!.screenY).toBe(y);
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
        mode="wide"
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await focusLive(setup, "config-source-contributions");
    await setup.waitForFrame((frame) => frame.includes("team/lark") && frame.includes("team/docs"));
    expect(setup.renderer.root.findDescendantById("config-source-contributions")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-back")).toBeDefined();
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
    const text = renderableText(sources.renderer.root);
    expect(text).toMatch(/Source\s+team-main/);
    expect(text).toMatch(/Origin\s+https:\/\/github.com\/acme\/main/);
    expect(text).toMatch(/Root\s+skills/);
    expect(text).toMatch(/Kind\s+github/);
    expect(text).toMatch(/Tracked ref\s+main/);
    expect(text).toContain("Yes, direct declaration");
  } finally {
    sources.renderer.destroy();
  }
  const contributed = await render("sources", "team/lark");
  try {
    const text = renderableText(contributed.renderer.root);
    expect(text).toMatch(/Source\s+team\/lark/);
    expect(text).toMatch(/Kind\s+github/);
    expect(text).toMatch(/Origin\s+https:\/\/github.com\/acme\/skills/);
    expect(text).toMatch(/Root\s+skills/);
    expect(text).toMatch(/Tracked ref\s+main/);
    expect(text).toContain("/configSources/team");
  } finally {
    contributed.renderer.destroy();
  }
  const collections = await render("collections", "team");
  try {
    expect(renderableText(collections.renderer.root)).toMatch(/Collection\s+team/);
    expect(renderableText(collections.renderer.root)).toContain("/workspace/skctl/skctl.jsonc");
    expect(renderableText(collections.renderer.root)).toContain("/collections/team");
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
      expect(renderableText(setup.renderer.root)).not.toContain("Tracked ref");
      expect(!!setup.renderer.root.findDescendantById("config-object-pane")).toBe(true);
      state.land("project", "sources", "team-main");
      await setup.waitFor(() => /Tracked ref\s+main/.test(renderableText(setup.renderer.root)));
      expect(renderableText(setup.renderer.root)).not.toMatch(/Tracked ref\s+team-main/);
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
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("team"));
    state.showDeclarations("project");
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
test("RENDER wide Config Source returns to categories while retaining its declaration", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    await openSection(setup, "config-sources");
    await focusLive(setup, "config-config-source-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    expect(setup.renderer.root.findDescendantById("config-source-inspector")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-source-contributions")).toBeDefined();
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "settings-categories",
    );
    expect(setup.captureCharFrame()).toContain("Config Sources");
    await parsedEnter(setup);
    const browser = (await focusLive(setup, "config-config-source-browser")) as SelectRenderable;
    expect(browser.getSelectedOption()?.value).toBe("/configSources/team");
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
        onContribution={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-inspector"));
    expect(setup.captureCharFrame()).toContain("Owner");
    expect(setup.captureCharFrame()).toContain("Kind");
    expect(setup.captureCharFrame()).toContain("Applied commit");
    expect(setup.renderer.root.findDescendantById("config-source-actions")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("route-back")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("config-source-contributions")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-command-config-observe")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("config-command-config-adopt")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("Review update");
    expect(setup.renderer.root.findDescendantById("config-back")).toBeDefined();
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
test("RENDER Settings categories lead to declarations while Agent owns connections", async () => {
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
    const values = ["sources", "config-sources", "collections"] as const;
    for (const value of values) await openSection(setup, value);
    await openSection(setup, "integrations");
    const integrationBrowser = setup.renderer.root.findDescendantById("integration-hosts")!;
    integrationBrowser.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === integrationBrowser);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Hosts");
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
    expect(sources.options[0]?.name.trimEnd()).toBe("team-main");
    expect(sources.options[0]?.value).toBe("team-main");
    expect(renderableText(setup.renderer.root)).toContain("https://github.com/acme/main");
    expect(sources.showDescription).toBe(false);
    expect(sources.showSelectionIndicator).toBe(true);
    await openSection(setup, "config-sources");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-config-source-browser"),
    );
    const configs = setup.renderer.root.findDescendantById(
      "config-config-source-browser",
    ) as import("@opentui/core").SelectRenderable;
    expect(configs.options[0]?.name.trimEnd()).toBe("team");
    expect(configs.options[0]?.value).toBe("/configSources/team");
    await setup.waitFor(() =>
      renderableText(setup.renderer.root).includes("/workspace/skctl/skctl.jsonc"),
    );
    expect(configs.showDescription).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});
test.each([120, 80, 43])(
  "RENDER Config scope label remains visible across category changes at width %i",
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
      for (const value of ["sources", "config-sources", "collections"] as const) {
        await openSection(setup, value);
        expect(!!setup.renderer.root.findDescendantById("config-browser-pane")).toBe(true);
        expect(
          renderableText(setup.renderer.root.findDescendantById("shell-scope-select")),
        ).toContain("Project");
      }
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
        state.land(destination, "sources");
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
test("RENDER primary declaration click restores browser ownership without entering the object", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const sources = setup.renderer.root.findDescendantById(
      "config-source-browser",
    ) as SelectRenderable;
    await setup.mockMouse.click(sources.screenX + 1, sources.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-source-browser",
    );
    expect(sources.getSelectedOption()?.value).toBe("team-main");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Tab traverses Scope and declaration browser without changing selection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const section = setup.renderer.root.findDescendantById(
      "config-source-browser",
    ) as SelectRenderable;
    for (
      let step = 0;
      step < 12 && setup.renderer.currentFocusedRenderable?.id !== "shell-scope-select";
      step++
    ) {
      setup.mockInput.pressKey("TAB");
      await setup.renderOnce();
    }
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "shell-scope-select");
    expect(setup.captureCharFrame()).toContain("Sources");
    const focused = setup.renderer.currentFocusedRenderable;
    expect(focused?.isDestroyed).toBe(false);
    expect(focused?.parent).toBeDefined();
    expect(renderableText(focused ?? undefined)).toContain("Project");
    for (let step = 0; step < 12 && setup.renderer.currentFocusedRenderable !== section; step++) {
      setup.mockInput.pressKey("TAB", { shift: true });
      await setup.renderOnce();
    }
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === section);
    expect(section.getSelectedOption()?.value).toBe("team-main");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER secondary declaration clicks preserve selection and focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    const sources = (await focusLive(setup, "config-source-browser")) as SelectRenderable;
    const selected = sources.getSelectedOption()?.value;
    await setup.mockMouse.click(sources.screenX + 1, sources.screenY, 2);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-source-browser");
    expect(sources.getSelectedOption()?.value).toBe(selected);
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
    await enterLive(setup, "config-command-config.categories");
    await focusLive(setup, "settings-categories");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    const frameListeners = interceptFrameListeners(setup);
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Config Sources"));
    expect(frameListeners.listeners.size).toBeGreaterThanOrEqual(1);
    setup.renderer.destroy();
    expect(frameListeners.listeners.size).toBe(0);
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy();
  }
});
test("RENDER browser focus survives repeated Config category transitions", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(configProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    for (const [category, title, id] of [
      ["config-sources", "Config Sources", "config-config-source-browser"],
      ["collections", "Collections", "config-collection-browser"],
      ["config-sources", "Config Sources", "config-config-source-browser"],
    ] as const) {
      await openSection(setup, category);
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
          () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
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
    await setup.waitForFrame((frame) => /Source\s+team-main/.test(frame));
    expect(setup.renderer.root.findDescendantById("source-action-menu")).toBeUndefined();
    expect(!!setup.renderer.root.findDescendantById("config-command-add-source")).toBe(true);
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
test("RENDER Integrations keeps selected host files through inspection and disconnects the exact entry", async () => {
  const changes: MutationRequest[] = [];
  let reads = 0;
  const files = ["/project/.codex/hooks.json", "/project/.codex/config.toml"];
  const integrations: IntegrationsApi = {
    inspect: async (target) => {
      reads++;
      return {
        target,
        recommended: "codex-hooks",
        selectionReason: "Host files",
        entries: files.map((file) => ({
          mechanism: "codex-hooks",
          file,
          status: "current",
          inherited: false,
          selected: "unknown",
        })),
        candidates: [],
        cli: "/bin/skctl",
        revision: `revision-${reads}`,
        diagnostics: [],
        nextSteps: [],
      };
    },
    connect: async () => ({
      action: "connect",
      mechanism: "codex-hooks",
      outcome: "unchanged",
      diagnostics: [],
    }),
    disconnect: async (request) => {
      changes.push(request);
      return {
        action: "disconnect",
        mechanism: "codex-hooks",
        outcome: "applied",
        diagnostics: [],
      };
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(configProjection())}
        integrations={integrations}
        environment={{ cwd: "/project" }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    await focusLive(setup, "integration-entries");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await enterLive(setup, "integration-more");
    await enterLive(setup, "integration-more-integration.refresh");
    await setup.waitFor(() => reads === 2);
    await setup.flush();
    expect(
      (
        setup.renderer.root.findDescendantById("integration-entries") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe(files[1]);
    expect(changes).toEqual([]);
    await enterLive(setup, "integration-disconnect");
    await setup.waitFor(() => changes.length === 1);
    expect(changes[0]).toMatchObject({ entry: { file: files[1] }, expected: "revision-2" });
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER mixed integration entries keep inherited selection read-only in controls and Actions", async () => {
  const disconnected: MutationRequest[] = [];
  const integrations: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "codex-hooks",
      selectionReason: "Host entries",
      entries: [
        {
          mechanism: "codex-hooks",
          file: "/project/.codex/hooks.json",
          status: "current",
          inherited: false,
          selected: "unknown",
        },
        {
          mechanism: "codex-hooks",
          file: "/home/user/.codex/hooks.json",
          status: "current",
          inherited: true,
          selected: "unknown",
        },
      ],
      candidates: [],
      cli: "/bin/skctl",
      revision: "reviewed",
      diagnostics: [],
      nextSteps: [],
    }),
    connect: async () => ({
      action: "connect",
      mechanism: "codex-hooks",
      outcome: "unchanged",
      diagnostics: [],
    }),
    disconnect: async (request) => {
      disconnected.push(request);
      return {
        action: "disconnect",
        mechanism: "codex-hooks",
        outcome: "applied",
        diagnostics: [],
      };
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(configProjection())}
        integrations={integrations}
        environment={{ cwd: "/project" }}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    await focusLive(setup, "integration-entries");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await enterLive(setup, "shell-more-actions");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const disconnect = choices.options.find(
      (option) => option.value.id === "integration.disconnect",
    );
    expect(disconnect?.value.enabled).toBe(false);
    await parsedEscape(setup);
    await focusLive(setup, "integration-entries");
    setup.mockInput.pressArrow("up");
    await setup.flush();
    await enterLive(setup, "integration-disconnect");
    await setup.waitFor(() => disconnected.length === 1);
    expect(disconnected[0]).toMatchObject({
      target: { scope: { kind: "project", directory: "/project" } },
      entry: { file: "/project/.codex/hooks.json" },
      expected: "reviewed",
    });
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER a removed host entry clears selection and preserves navigation after inspection", async () => {
  let present = true;
  const integrations: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "codex-hooks",
      selectionReason: "Host files",
      entries: present
        ? [
            {
              mechanism: "codex-hooks",
              file: "/project/.codex/hooks.json",
              status: "current",
              inherited: false,
              selected: "unknown",
            },
          ]
        : [],
      candidates: [],
      cli: "/bin/skctl",
      revision: present ? "present" : "removed",
      diagnostics: [],
      nextSteps: [],
    }),
    connect: async () => {
      throw new Error("Inspection must not connect");
    },
    disconnect: async () => {
      throw new Error("Missing entry must not disconnect");
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(configProjection())}
        integrations={integrations}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("integration-entries"));
    present = false;
    await enterLive(setup, "integration-more");
    await enterLive(setup, "integration-more-integration.refresh");
    await setup.waitForFrame((frame) => frame.includes("No existing entry found"));
    expect(!!setup.renderer.root.findDescendantById("integration-entries")).toBe(false);
    await enterLive(setup, "shell-more-actions");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      choices.options.find((option) => option.value.id === "integration.disconnect")?.value.enabled,
    ).toBe(false);
    await parsedEscape(setup);
    await openDestination(setup, "project");
    await openSection(setup, "sources");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-browser"));
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER failed host inspection shows the cause and retry resolves to an available empty host", async () => {
  let reads = 0;
  const integrations: IntegrationsApi = {
    inspect: async (target) => {
      if (++reads === 1) throw new Error("Host settings are unreadable");
      return {
        target,
        recommended: "codex-hooks",
        selectionReason: "Ready to connect",
        entries: [],
        candidates: [],
        cli: "/bin/skctl",
        revision: "empty",
        diagnostics: [],
        nextSteps: [],
      };
    },
    connect: async () => {
      throw new Error("Inspection must not connect");
    },
    disconnect: async () => {
      throw new Error("Inspection must not disconnect");
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(configProjection())}
        integrations={integrations}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.waitForFrame((frame) => frame.includes("Host settings are unreadable"));
    expect(setup.captureCharFrame()).not.toContain("No existing entry found");
    await enterLive(setup, "integration-more");
    await enterLive(setup, "integration-more-integration.refresh");
    await setup.waitForFrame((frame) => frame.includes("No existing entry found"));
    expect(setup.captureCharFrame()).not.toContain("Host settings are unreadable");
    expect(reads).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER empty Config Integrations connects the selected host without a Config declaration", async () => {
  const projection = workspaceProjection();
  const adjusted: WorkspaceView = {
    ...projection,
    configs: projection.configs.map((config) =>
      config.level === "project"
        ? { ...config, direct: { ...config.direct, integrations: [] } }
        : config,
    ),
  };
  const changes: MutationRequest[] = [];
  const integrations: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "codex-hooks",
      selectionReason: "Ready to connect",
      entries: [],
      candidates: [],
      cli: "/bin/skctl",
      revision: "empty",
      diagnostics: [],
      nextSteps: [],
    }),
    connect: async (request) => {
      changes.push(request);
      return { action: "connect", mechanism: "codex-hooks", outcome: "applied", diagnostics: [] };
    },
    disconnect: async () => {
      throw new Error("No entry to disconnect");
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(adjusted)}
        environment={{ cwd: "/project" }}
        integrations={integrations}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await waitForShell(setup);
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.waitForFrame((frame) => frame.includes("No existing entry found"));
    await enterLive(setup, "integration-connect");
    await setup.waitFor(() => changes.length === 1);
    expect(changes[0]).toMatchObject({
      target: {
        environment: { harness: "codex" },
        scope: { kind: "project", directory: "/project" },
      },
      expected: "empty",
    });
    expect(changes[0]?.entry).toBeUndefined();
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
test("RENDER inherited host files become editable only in their owning scope", async () => {
  const changes: MutationRequest[] = [];
  const file = "/home/user/.codex/hooks.json";
  const integrations: IntegrationsApi = {
    inspect: async (target) => ({
      target,
      recommended: "codex-hooks",
      selectionReason: "Host scope",
      entries: [
        {
          mechanism: "codex-hooks",
          file,
          status: "current",
          inherited: target.scope.kind === "project",
          selected: "unknown",
        },
      ],
      candidates: [],
      cli: "/bin/skctl",
      revision: target.scope.kind,
      diagnostics: [],
      nextSteps: [],
    }),
    connect: async () => {
      throw new Error("Scope navigation must not connect");
    },
    disconnect: async (request) => {
      changes.push(request);
      return {
        action: "disconnect",
        mechanism: "codex-hooks",
        outcome: "applied",
        diagnostics: [],
      };
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(configProjection())}
        integrations={integrations}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openDestination(setup, "project");
    await openSection(setup, "integrations");
    await setup.waitForFrame((frame) => frame.includes("inherited"));
    await enterLive(setup, "shell-more-actions");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      choices.options.find((option) => option.value.id === "integration.disconnect")?.value.enabled,
    ).toBe(false);
    await parsedEscape(setup);
    await openDestination(setup, "global");
    await openSection(setup, "integrations", "global");
    await setup.waitForFrame((frame) => frame.includes(file) && !frame.includes("inherited"));
    await enterLive(setup, "integration-disconnect");
    await setup.waitFor(() => changes.length === 1);
    expect(changes[0]).toMatchObject({
      target: { scope: { kind: "global" } },
      entry: { file },
      expected: "global",
    });
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
test("RENDER unresolved Config Source projection shows Loading", async () => {
  const state = createConfigState();
  state.selectSection("project", "config-sources");
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
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    expect(setup.captureCharFrame()).toContain("Enter a Source ID and local path");
    await setup.mockInput.typeText("/shared");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-register-id");
    (setup.renderer.currentFocusedRenderable as InputRenderable).value = "team";
    await enterLive(setup, "source-register-advanced");
    await focusLive(setup, "source-register-root");
    await setup.mockInput.typeText("skills");
    await enterLive(setup, "source-register-only");
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
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("https://git.example.com/acme/config");
    const id = (await focusLive(setup, "source-register-id")) as InputRenderable;
    id.value = "team";
    await focusLive(setup, "source-register-level");
    setup.mockInput.pressArrow("up");
    await enterLive(setup, "source-register-advanced");
    const ref = (await focusLive(setup, "source-register-ref")) as InputRenderable;
    ref.value = "release";
    await focusLive(setup, "source-register-root");
    await setup.mockInput.typeText("skills");
    await enterLive(setup, "source-register-submit");
    expect(submitted).toEqual([
      {
        level: "global",
        id: "team",
        binding: {
          kind: "git",
          origin: "https://git.example.com/acme/config",
          ref: "release",
          root: "skills",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER GitHub registration parses its address and traverses advanced fields in both directions", async () => {
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
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("https://github.com/acme/skills.git");
    const id = (await focusLive(setup, "source-register-id")) as InputRenderable;
    id.value = "team";
    await enterLive(setup, "source-register-advanced");
    const ref = (await focusLive(setup, "source-register-ref")) as InputRenderable;
    ref.value = "v1";
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-root",
    );
    await setup.mockInput.typeText("agents");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-ref",
    );
    await enterLive(setup, "source-register-submit");
    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "github",
          owner: "acme",
          repository: "skills",
          origin: "https://github.com/acme/skills",
          ref: "v1",
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
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("https://github.com/acme/skills");
    const id = (await focusLive(setup, "source-register-id")) as InputRenderable;
    id.value = "team";
    await enterLive(setup, "source-register-advanced");
    const initialRef = (await focusLive(setup, "source-register-ref")) as InputRenderable;
    initialRef.value = "v1";
    await focusLive(setup, "source-register-root");
    await setup.mockInput.typeText("agents");
    const origin = (await focusLive(setup, "source-register-origin")) as InputRenderable;
    origin.value = "/local";
    await setup.waitFor(() => initialRef.isDestroyed);
    expect(!!setup.renderer.root.findDescendantById("source-register-ref")).toBe(false);
    origin.value = "https://git.example.com/acme/skills";
    await setup.renderOnce();
    const remoteRef = (await focusLive(setup, "source-register-ref")) as InputRenderable;
    expect(remoteRef.value).toBe("v1");
    await enterLive(setup, "source-register-advanced");
    await setup.waitFor(() => remoteRef.isDestroyed);
    await enterLive(setup, "source-register-advanced");
    await focusLive(setup, "source-register-origin");
    origin.value = "https://github.com/acme/skills";
    await enterLive(setup, "source-register-submit");
    expect(submitted).toEqual([
      {
        level: "project",
        id: "team",
        binding: {
          kind: "github",
          owner: "acme",
          repository: "skills",
          origin: "https://github.com/acme/skills",
          ref: "v1",
          root: "agents",
        },
      },
    ]);
  } finally {
    setup.renderer.destroy();
  }
});
