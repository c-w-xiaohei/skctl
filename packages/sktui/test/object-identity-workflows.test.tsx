/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import {
  parsedEnter,
  parsedEscape,
  filterUncollectedSkills,
  openAllInstalledSkills,
} from "./reader-test-controls";
import { SkctlError, type CollectionRenameImpact, type RebindImpact } from "@skctl/core";
import {
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import * as core from "@skctl/core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "jsonc-parser";
import {
  createOverlaySession,
  reduceOverlaySession,
  sessionMatches,
} from "../src/overlays/session";
import { openMainPage } from "./main-page-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

test.each(["source-selection", "source-removal"])(
  "late %s settlement cannot replace a newer overlay session",
  (family) => {
    const old = reduceOverlaySession(createOverlaySession(), {
      type: "open",
      kind: family === "source-selection" ? "selection" : "confirm",
      payload: { family },
      phase: "executing",
    });
    const newer = reduceOverlaySession(old, {
      type: "open",
      kind: "form",
      payload: { family: "collection-draft" },
    });
    expect(
      sessionMatches(newer, old, family === "source-selection" ? "selection" : "confirm", family),
    ).toBe(false);
    const settled = reduceOverlaySession(newer, {
      type: "settle",
      revision: old.revision,
      requestEpoch: old.requestEpoch,
      phase: "review",
      payload: { family },
    });
    expect(settled).toEqual(newer);
  },
);

test("Actions navigation lists the six semantic pages and opens the selected page", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await clickVisible(setup, "shell-more-actions");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const navigation = choices.options.filter((option) =>
      String(option.value.id).startsWith("navigate."),
    );
    expect(navigation.map((option) => option.value.id)).toEqual([
      "navigate.skills",
      "navigate.collections",
      "navigate.sources",
      "navigate.updates",
      "navigate.agent",
      "navigate.settings",
    ]);
    const index = choices.options.findIndex((option) => option.value.id === "navigate.sources");
    choices.setSelectedIndex(index);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    expect(setup.renderer.currentFocusedRenderable).toBeTruthy();
  } finally {
    setup.renderer.destroy();
  }
});

test("main-page navigation retains the membership filter and checked selection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openAllInstalledSkills(setup);
    await filterUncollectedSkills(setup);
    await clickVisible(setup, "installed-skill-browser");
    await setup.mockInput.typeText(" ");
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-selected"));
    await clickVisible(setup, "shell-section-tab-collections");
    await clickVisible(setup, "shell-section-tab-skills");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-selected"));
    expect(setup.captureCharFrame()).toContain("Filter (1)");
  } finally {
    setup.renderer.destroy();
  }
});

test("120-column Settings keeps every main destination reachable within the allocated chrome", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await clickVisible(setup, "shell-section-tab-settings");
    const chooser = setup.renderer.root.findDescendantById("shell-pages-select");
    if (chooser) {
      await clickVisible(setup, "shell-pages-select");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-choices",
      );
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      expect(choices.options.map((item) => item.value)).toEqual([
        "skills",
        "collections",
        "sources",
        "updates",
        "agent",
        "settings",
      ]);
      choices.setSelectedIndex(0);
      await parsedEnter(setup);
    } else {
      const skills = setup.renderer.root.findDescendantById("shell-section-tab-skills")!;
      expect(skills.screenX).toBeGreaterThanOrEqual(0);
      expect(skills.screenX + skills.width).toBeLessThanOrEqual(setup.renderer.width);
      await clickVisible(setup, "shell-section-tab-skills");
    }
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

test("Settings subsection arrows keep their own focus and Enter opens the selected browser", async () => {
  const base = readerProjection();
  const owner = {
    level: "global" as const,
    file: "/home/user/.config/skctl.jsonc",
    pointer: "/collections/team",
  };
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? { ...config, direct: { ...config.direct, collections: [{ id: "team", owner }] } }
        : config,
    ),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  let step = "open";
  try {
    await clickVisible(setup, "shell-section-tab-settings");
    step = "config sources";
    await clickVisible(setup, "settings-categories");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "settings-categories",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    step = "collections";
    await setup.waitFor(
      () =>
        (setup.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.value ===
        "collections",
    );
    await parsedEnter(setup);
    step = "browser";
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-collection-browser",
    );
  } catch (error) {
    throw new Error(
      `${step}: ${String(error)} focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("main-page navigation leaves Reader and Source workspaces without a remount", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(collectionsSourcesProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await clickVisible(setup, "installed-skill-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    await clickVisible(setup, "shell-section-tab-sources");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await clickVisible(setup, "source-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    await clickVisible(setup, "shell-section-tab-collections");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

test.each([43, 80])(
  "Escape from Source browser reaches Pages and dismiss restores it at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await clickVisible(setup, "shell-pages-select");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-choices",
      );
      const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
      choices.setSelectedIndex(choices.options.findIndex((item) => item.value === "sources"));
      await parsedEnter(setup);
      await clickVisible(setup, "source-browser");
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-select",
      );
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-choices",
      );
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-pages-select",
      );
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("compact Reader shows current keyboard guidance at 43x30 and retains seven body rows at 43x13", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await clickVisible(setup, "installed-skill-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
    setup.resize(43, 30);
    await setup.flush();
    await clickVisible(setup, "reader-tabs-tab-skill");
    await setup.waitForFrame((frame) => frame.includes("←→ move"));
    expect(setup.renderer.root.findDescendantById("command-status")?.height).toBe(1);
    setup.resize(43, 13);
    await setup.flush();
    const body = setup.renderer.root.findDescendantById("reader-scrollbox");
    expect(body).toBeInstanceOf(ScrollBoxRenderable);
    expect((body as ScrollBoxRenderable).viewport.height).toBeGreaterThanOrEqual(7);
    const identity = setup.renderer.root.findDescendantById("reader-identity") as TextRenderable;
    expect(identity.width).toBeGreaterThanOrEqual(12);
    expect(identity.plainText).toBe("guide");
    const more = setup.renderer.root.findDescendantById("reader-more")!;
    const add = setup.renderer.root.findDescendantById(
      "reader-details-action-skill-add-to-collection",
    )!;
    expect(more.height).toBeGreaterThan(0);
    expect(add.height).toBeGreaterThan(0);
    expect(add.screenY).toBe(more.screenY);
    expect(add.screenX + add.width).toBeLessThan(more.screenX);
    const status = setup.renderer.root.findDescendantById("command-status");
    expect(status?.height).toBe(1);
    const hint = setup.renderer.root.findDescendantById("interaction-guidance") as TextRenderable;
    expect(hint.plainText).toMatch(/←→|Enter|scroll/);
  } finally {
    setup.renderer.destroy();
  }
});

test("43x13 Collection members show the current Enter and Space grammar", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(collectionsSourcesProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await openMainPage(setup, "collections");
    const key = collectionFilterPathKey({ segments: [{ collection: "team" }] });
    await clickVisible(setup, `collection-browser-row-${encodeURIComponent(key)}`);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    await clickVisible(setup, "collection-relationships");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id.startsWith("collection-relationships") === true,
    );
    const status = setup.renderer.root.findDescendantById("command-status");
    expect(status?.height).toBe(1);
    const hint = setup.renderer.root.findDescendantById("interaction-guidance") as TextRenderable;
    expect(hint.plainText).toContain("Space");
    expect(hint.plainText).toContain("Enter");
  } finally {
    setup.renderer.destroy();
  }
});

test("43x13 Source Settings keeps every management button inside the pane and metadata scrollable", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 43, height: 13 },
  );
  try {
    await openMainPage(setup, "sources");
    await clickVisible(setup, "source-browser");
    await parsedEnter(setup);
    await clickVisible(setup, "source-view-tab-settings");
    await setup.flush();
    const pane = setup.renderer.root.findDescendantById("source-details-pane")!;
    for (const id of [
      "source-update-all",
      "source-replace",
      "source-command-config",
      "workspace-action-remove-source",
    ]) {
      const control = setup.renderer.root.findDescendantById(id)!;
      expect(control, id).toBeDefined();
      expect(control.width, id).toBeGreaterThan(0);
      expect(control.height, id).toBeGreaterThan(0);
      expect(control.screenX, id).toBeGreaterThan(pane.screenX);
      expect(control.screenX + control.width, id).toBeLessThanOrEqual(
        pane.screenX + pane.width - 1,
      );
      expect(control.screenY, id).toBeGreaterThan(pane.screenY);
      expect(control.screenY + control.height, id).toBeLessThanOrEqual(pane.screenY + pane.height);
    }
    const metadata = setup.renderer.root.findDescendantById(
      "source-metadata",
    ) as ScrollBoxRenderable;
    expect(metadata).toBeInstanceOf(ScrollBoxRenderable);
    expect(metadata.viewport.height).toBeGreaterThanOrEqual(3);
    expect(setup.renderer.root.findDescendantById("command-status")?.height).toBe(1);
    await setup.mockMouse.scroll(metadata.viewport.screenX + 1, metadata.viewport.screenY, "down");
    await setup.flush();
    expect(metadata.scrollTop).toBeGreaterThan(0);
  } finally {
    setup.renderer.destroy();
  }
});

async function clickVisible(setup: Setup, id: string) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
  const target = setup.renderer.root.findDescendantById(id)!;
  expect(target.width).toBeGreaterThan(0);
  expect(target.height).toBeGreaterThan(0);
  await setup.mockMouse.click(target.screenX + 1, target.screenY);
  await setup.flush();
}

// Task entries do not exist yet. Locate their visible label instead of prescribing
// a private renderable ID or programmatically forcing focus into a hidden control.
async function clickLabel(setup: Setup, label: string) {
  await setup.waitForFrame((frame) => frame.includes(label));
  const lines = setup.captureCharFrame().split("\n");
  const y = lines.findIndex((line) => line.includes(label));
  expect(y).toBeGreaterThanOrEqual(0);
  const x = lines[y]!.indexOf(label);
  await setup.mockMouse.click(x, y);
  await setup.flush();
}

async function openTeamSettings(setup: Setup) {
  await clickVisible(setup, "shell-section-tab-collections");
  const key = collectionFilterPathKey({ segments: [{ collection: "team" }] });
  await clickVisible(setup, `collection-browser-row-${encodeURIComponent(key)}`);
  await parsedEnter(setup);
  await clickVisible(setup, "collection-tabs-tab-settings");
}

async function openSourceSettings(setup: Setup) {
  await clickVisible(setup, "shell-section-tab-sources");
  await clickVisible(setup, "source-browser");
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
  await clickVisible(setup, "source-view-tab-settings");
}

test("Collection Settings offers Rename for the selected Collection and Cancel makes no mutation", async () => {
  let mutations = 0;
  const core = {
    ...directSourceCore(collectionsSourcesProjection()),
    renameCollection: async () => {
      mutations++;
      throw new Error("unexpected rename");
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 24,
  });
  try {
    await openTeamSettings(setup);
    await clickLabel(setup, "Rename");
    await setup.waitForFrame((frame) => frame.includes("team") && frame.includes("Preview"));
    expect(mutations).toBe(0);
    await parsedEscape(setup);
    expect(mutations).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("Source Settings offers replacement for the selected Source and Cancel retains the old installs", async () => {
  const projection = collectionsSourcesProjection();
  const oldSource = projection.effective.sources[0]!;
  const oldAddresses = projection.installedSkills
    .filter((skill) => skill.address.source === oldSource.id)
    .map((skill) => skill.address);
  expect(oldAddresses.length).toBeGreaterThan(0);
  let registrations = 0;
  let rebindings = 0;
  let removals = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          registerSource: async () => {
            registrations++;
            throw new Error("unexpected registration");
          },
          rebindSkill: async () => {
            rebindings++;
            throw new Error("unexpected rebind");
          },
          removeSource: async () => {
            removals++;
            throw new Error("unexpected removal");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openSourceSettings(setup);
    expect(setup.captureCharFrame()).toContain(oldSource.id);
    await clickLabel(setup, "Replace Source");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-register-origin"));
    await parsedEscape(setup);
    expect({ registrations, rebindings, removals }).toEqual({
      registrations: 0,
      rebindings: 0,
      removals: 0,
    });
    expect(projection.installedSkills.map((skill) => skill.address)).toEqual(
      expect.arrayContaining(oldAddresses),
    );
  } finally {
    setup.renderer.destroy();
  }
});

async function registerReplacement(setup: Setup) {
  await openSourceSettings(setup);
  await clickLabel(setup, "Replace Source");
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
  );
  await setup.mockInput.typeText("/replacement");
  await clickVisible(setup, "source-register-only");
  await setup.waitForFrame((frame) => frame.includes("Registered replacement"));
}

test.each([false, true])(
  "replacement registration discover=%s honors the chosen continuation exactly once",
  async (discover) => {
    const workspace = collectionsSourcesProjection();
    let registrations = 0;
    const discoveries: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(workspace, {
            registerSource: async () => {
              registrations++;
              return {
                value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
                diagnostics: [],
              };
            },
            discoverSkills: async (_env, request) => {
              discoveries.push(request.source);
              return {
                value: { source: request.source, kind: "local", candidates: [] },
                diagnostics: [],
              };
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 30 },
    );
    try {
      await openSourceSettings(setup);
      await clickLabel(setup, "Replace Source");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
      );
      await setup.mockInput.typeText("/replacement");
      await clickVisible(setup, discover ? "source-register-submit" : "source-register-only");
      if (discover) {
        await setup.waitFor(() => discoveries.length === 1);
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("source-operation-selection"),
        );
        await parsedEscape(setup);
      }
      await setup.waitForFrame((frame) => frame.includes("Registered replacement"));
      expect(registrations).toBe(1);
      expect(discoveries).toEqual(discover ? ["replacement"] : []);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("install result names only newly installed addresses and opens the first exact Skill", async () => {
  const base = collectionsSourcesProjection();
  const beta = base.installedSkills[0]!;
  let workspace = {
    ...base,
    installedSkills: [
      { ...beta, address: { source: beta.address.source, path: "beta" }, name: "beta" },
    ],
  };
  const reads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
          discoverSkills: async (_env, request) => ({
            value: {
              source: request.source,
              kind: "local",
              candidates: [{ name: "alpha", path: "alpha", description: "New" }],
            },
            diagnostics: [],
          }),
          installSkills: async () => {
            workspace = {
              ...workspace,
              installedSkills: [
                ...workspace.installedSkills,
                { ...beta, address: { source: beta.address.source, path: "alpha" }, name: "alpha" },
              ],
            };
            return { value: [], diagnostics: [] };
          },
          loadInstalledSkill: async (_env, request) => {
            reads.push(request.address.path);
            return {
              address: request.address,
              name: request.address.path,
              description: "",
              rawText: "alpha content",
              markdownText: "alpha content",
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await clickVisible(setup, "shell-section-tab-sources");
    await clickVisible(setup, "source-browser");
    await parsedEnter(setup);
    await clickVisible(setup, "workspace-action-add-skills");
    await clickVisible(setup, "source-operation-selection");
    await parsedEnter(setup);
    await clickVisible(setup, "source-operation-submit");
    await setup.waitForFrame((frame) => frame.includes(`${beta.address.source}/alpha`));
    expect(setup.captureCharFrame()).not.toContain(`${beta.address.source}/beta`);
    await clickVisible(setup, "installed-result-view");
    await setup.waitFor(() => reads.includes("alpha"));
  } finally {
    setup.renderer.destroy();
  }
});

test("separate acquisition returns exact installed addresses and retains the registration receipt", async () => {
  const requests: unknown[] = [];
  const workspace = collectionsSourcesProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
            diagnostics: [],
          }),
          discoverSkills: async (_env, request) => ({
            value: {
              source: request.source,
              kind: "local",
              candidates: [
                { name: "new-guide", path: "nested/new-guide", description: "Separate Skill" },
              ],
            },
            diagnostics: [],
          }),
          installSkills: async (_env, request) => {
            requests.push(request);
            return { value: [], diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-acquire");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-operation-selection"),
    );
    await clickVisible(setup, "source-operation-selection");
    await parsedEnter(setup);
    await clickVisible(setup, "source-operation-submit");
    await setup.waitForFrame((frame) =>
      frame.includes("Installed separately replacement/nested/new-guide"),
    );
    expect(setup.captureCharFrame()).toContain("Registered replacement");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source: "replacement", paths: ["nested/new-guide"] });
  } finally {
    setup.renderer.destroy();
  }
});

test("old Source removal previews the captured owner and cancel returns to replacement receipts", async () => {
  const previews: unknown[] = [];
  const removals: unknown[] = [];
  const workspace = collectionsSourcesProjection();
  const oldSource = workspace.effective.sources[0]!.id;
  const owner = workspace.configs
    .flatMap((config) => config.direct.sources)
    .find((source) => source.id === oldSource)!.ref.owner;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: owner.file, changed: true },
            diagnostics: [],
          }),
          previewSourceRemoval: async (_env, request) => {
            previews.push(request);
            return {
              value: {
                kind: "source-removal",
                source: request.source,
                owner,
                installed: [],
                repairs: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
          removeSource: async (_env, request) => {
            removals.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-remove");
    await setup.waitFor(() => previews.length === 1);
    expect(previews[0]).toMatchObject({
      source: oldSource,
      level: owner.level,
      expectedOwner: owner,
    });
    await setup.waitForFrame((frame) => frame.includes(oldSource) && frame.includes("Cancel"));
    await parsedEscape(setup);
    await setup.waitForFrame((frame) => frame.includes("Registered replacement"));
    expect(removals).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

test("failed separate installation preserves registration and blocks blind retry pending inspection", async () => {
  const workspace = collectionsSourcesProjection();
  let calls = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
            diagnostics: [],
          }),
          discoverSkills: async (_env, request) => ({
            value: {
              source: request.source,
              kind: "local",
              candidates: [{ name: "new-guide", path: "new-guide", description: "Separate Skill" }],
            },
            diagnostics: [],
          }),
          installSkills: async () => {
            calls++;
            throw new Error("transport lost");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-acquire");
    await clickVisible(setup, "source-operation-selection");
    await parsedEnter(setup);
    await clickVisible(setup, "source-operation-submit");
    await setup.waitForFrame((frame) => frame.includes("Installation outcome unknown"));
    expect(setup.captureCharFrame()).toContain("Registered replacement");
    expect(calls).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

for (const scenario of ["match", "root-drift", "owner-drift"] as const) {
  test(`uncertain Local installation inspection ${scenario}`, async () => {
    const original = collectionsSourcesProjection();
    let workspace = original;
    let installs = 0;
    const source = {
      ...original.effective.sources[0]!,
      id: "replacement",
      kind: "local" as const,
      origin: "/replacement",
      root: "",
    };
    const declaration = original.configs.find((config) => config.level === "project")!.direct
      .sources[0]!;
    const registered = {
      ...declaration,
      id: "replacement",
      kind: "local" as const,
      origin: "/replacement",
      root: "",
      trackedRef: undefined,
      ref: {
        id: "replacement",
        owner: { ...declaration.ref.owner, pointer: "/sources/replacement" },
      },
    };
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(original, {
            getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
            registerSource: async () => {
              workspace = {
                ...original,
                configs: original.configs.map((config) =>
                  config.level !== "project"
                    ? config
                    : {
                        ...config,
                        direct: {
                          ...config.direct,
                          sources: [...config.direct.sources, registered],
                        },
                      },
                ),
                effective: {
                  ...original.effective,
                  sources: [...original.effective.sources, source],
                },
              };
              return {
                value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
                diagnostics: [],
              };
            },
            discoverSkills: async (_env, request) => ({
              value: {
                source: request.source,
                kind: "local",
                candidates: [
                  { name: "new-guide", path: "new-guide", description: "Separate Skill" },
                ],
              },
              diagnostics: [],
            }),
            installSkills: async () => {
              installs++;
              throw new Error("transport lost");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 30 },
    );
    try {
      await registerReplacement(setup);
      await clickVisible(setup, "replacement-acquire");
      await clickVisible(setup, "source-operation-selection");
      await parsedEnter(setup);
      await clickVisible(setup, "source-operation-submit");
      await setup.waitForFrame((frame) => frame.includes("Installation outcome unknown"));
      const item = original.installedSkills[0]!;
      workspace = {
        ...workspace,
        configs:
          scenario === "owner-drift"
            ? workspace.configs.map((config) =>
                config.level !== "project"
                  ? config
                  : {
                      ...config,
                      direct: {
                        ...config.direct,
                        sources: config.direct.sources.map((entry) =>
                          entry.id !== "replacement"
                            ? entry
                            : {
                                ...entry,
                                ref: {
                                  ...entry.ref,
                                  owner: { ...entry.ref.owner, pointer: "/sources/other" },
                                },
                              },
                        ),
                      },
                    },
              )
            : workspace.configs,
        installedSkills: [
          ...workspace.installedSkills,
          {
            ...item,
            address: { source: "replacement", path: "new-guide" },
            source,
            owner: {
              ...item.owner,
              source: "replacement",
              health: "healthy" as const,
              relevantLocalRoot:
                scenario === "root-drift" ? "/other/new-guide" : "/replacement/new-guide",
              relevantRemoteRevision: undefined,
            },
          },
        ],
      };
      await clickVisible(setup, "replacement-inspect");
      if (scenario === "match")
        await setup.waitForFrame((frame) =>
          frame.includes("Inspected installation replacement/new-guide"),
        );
      else await setup.waitForFrame((frame) => frame.includes("insufficient"));
      expect(installs).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });
}

for (const input of ["../skills", "/x/../skills"]) {
  test(`uncertain Local install uses the resolved binding captured for ${input}`, async () => {
    const initial = collectionsSourcesProjection();
    let workspace = initial;
    const origin = input === "../skills" ? "/workspace/skills" : "/skills";
    const declaration = initial.configs.find((item) => item.level === "project")!.direct
      .sources[0]!;
    const source = {
      ...initial.effective.sources[0]!,
      id: "skills",
      kind: "local" as const,
      origin,
      root: "",
    };
    const config = {
      ...declaration,
      id: "skills",
      kind: "local" as const,
      origin,
      root: "",
      trackedRef: undefined,
      ref: { id: "skills", owner: { ...declaration.ref.owner, pointer: "/sources/skills" } },
    };
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(initial, {
            getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
            registerSource: async () => {
              workspace = {
                ...initial,
                configs: initial.configs.map((item) =>
                  item.level !== "project"
                    ? item
                    : {
                        ...item,
                        direct: { ...item.direct, sources: [...item.direct.sources, config] },
                      },
                ),
                effective: {
                  ...initial.effective,
                  sources: [...initial.effective.sources, source],
                },
              };
              return {
                value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
                diagnostics: [],
              };
            },
            discoverSkills: async (_env, request) => ({
              value: {
                source: request.source,
                kind: "local",
                candidates: [
                  { name: "new-guide", path: "new-guide", description: "Separate Skill" },
                ],
              },
              diagnostics: [],
            }),
            installSkills: async () => {
              throw new Error("publication unknown");
            },
          })}
          environment={{ cwd: "/workspace/skctl" }}
          exit={() => {}}
        />
      ),
      { width: 120, height: 30 },
    );
    try {
      await openSourceSettings(setup);
      await clickLabel(setup, "Replace Source");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
      );
      await setup.mockInput.typeText(input);
      await clickVisible(setup, "source-register-only");
      await setup.waitForFrame((frame) => frame.includes("Registered skills"));
      await clickVisible(setup, "replacement-acquire");
      await clickVisible(setup, "source-operation-selection");
      await parsedEnter(setup);
      await clickVisible(setup, "source-operation-submit");
      await setup.waitForFrame((frame) => frame.includes("Installation outcome unknown"));
      const item = initial.installedSkills[0]!;
      workspace = {
        ...workspace,
        installedSkills: [
          ...workspace.installedSkills,
          {
            ...item,
            address: { source: "skills", path: "new-guide" },
            source,
            owner: {
              ...item.owner,
              source: "skills",
              health: "healthy",
              relevantLocalRoot: `${origin}/new-guide`,
              relevantRemoteRevision: undefined,
            },
          },
        ],
      };
      await clickVisible(setup, "replacement-inspect");
      await setup.waitForFrame((frame) =>
        frame.includes("Inspected installation skills/new-guide"),
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("confirmed old Source removal records the captured Source without discarding prior receipts", async () => {
  const workspace = collectionsSourcesProjection();
  const old = workspace.effective.sources[0]!.id;
  const owner = workspace.configs
    .flatMap((config) => config.direct.sources)
    .find((source) => source.id === old)!.ref.owner;
  const removals: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: owner.file, changed: true },
            diagnostics: [],
          }),
          previewSourceRemoval: async (_env, request) => ({
            value: {
              kind: "source-removal",
              source: request.source,
              owner,
              installed: [],
              repairs: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          removeSource: async (_env, request) => {
            removals.push(request);
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-remove");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-removal-confirm"));
    await clickVisible(setup, "source-removal-confirm");
    await setup.waitForFrame((frame) => frame.includes(`Removed Source ${old}`));
    expect(setup.captureCharFrame()).toContain("Registered replacement");
    expect(removals).toEqual([{ source: old, level: owner.level, expectedOwner: owner }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("uncertain registration does not accept a different binding with the same Source ID", async () => {
  const original = collectionsSourcesProjection();
  let workspace = original;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(original, {
          getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
          registerSource: async () => {
            throw new Error("publication outcome unknown");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openSourceSettings(setup);
    await clickLabel(setup, "Replace Source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("/replacement");
    await clickVisible(setup, "source-register-only");
    await setup.waitForFrame((frame) => frame.includes("Registration outcome unknown"));
    const old = original.configs.find((item) => item.level === "project")!.direct.sources[0]!;
    workspace = {
      ...original,
      configs: original.configs.map((config) =>
        config.level !== "project"
          ? config
          : {
              ...config,
              direct: {
                ...config.direct,
                sources: [
                  ...config.direct.sources,
                  {
                    ...old,
                    id: "replacement",
                    kind: "local",
                    origin: "/different",
                    root: "",
                    trackedRef: undefined,
                    ref: {
                      id: "replacement",
                      owner: { ...old.ref.owner, pointer: "/sources/replacement" },
                    },
                  },
                ],
              },
            },
      ),
    };
    await clickVisible(setup, "replacement-inspect");
    await setup.waitForFrame((frame) => frame.includes("insufficient"));
    expect(setup.captureCharFrame()).not.toContain("Inspected registration replacement");
  } finally {
    setup.renderer.destroy();
  }
});

test("uncertain registration accepts only the captured direct owner and matching binding", async () => {
  const original = collectionsSourcesProjection();
  let workspace = original;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(original, {
          getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
          registerSource: async () => {
            throw new Error("publication outcome unknown");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openSourceSettings(setup);
    await clickLabel(setup, "Replace Source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("/replacement");
    await clickVisible(setup, "source-register-only");
    await setup.waitForFrame((frame) => frame.includes("Registration outcome unknown"));
    const old = original.configs.find((item) => item.level === "project")!.direct.sources[0]!;
    workspace = {
      ...original,
      configs: original.configs.map((config) =>
        config.level !== "project"
          ? config
          : {
              ...config,
              direct: {
                ...config.direct,
                sources: [
                  ...config.direct.sources,
                  {
                    ...old,
                    id: "replacement",
                    kind: "local",
                    origin: "/replacement",
                    root: "",
                    trackedRef: undefined,
                    ref: {
                      id: "replacement",
                      owner: { ...old.ref.owner, pointer: "/sources/replacement" },
                    },
                  },
                ],
              },
            },
      ),
    };
    await clickVisible(setup, "replacement-inspect");
    await setup.waitForFrame((frame) => frame.includes("Inspected registration replacement"));
    expect(setup.captureCharFrame()).not.toContain("outcome unknown");
  } finally {
    setup.renderer.destroy();
  }
});

function renameImpact(): CollectionRenameImpact {
  const workspace = collectionsSourcesProjection();
  if (workspace.effective.status !== "complete") throw new Error("complete workspace required");
  const team = workspace.effective.collectionsView.find((item) => item.id === "team")!;
  return {
    kind: "collection-rename",
    collection: "team",
    target: "new-team",
    scope: "captured-workspace",
    limitation: "Captured workspace only",
    baseline: "opaque",
    declarations: team.declared,
    references: [],
    addresses: [{ before: "team", after: "new-team" }],
    blockers: [],
    allowed: true,
  };
}

async function previewTeamRename(setup: Setup, target = "new-team") {
  await openTeamSettings(setup);
  await clickLabel(setup, "Rename");
  await clickVisible(setup, "collection-rename-target");
  await setup.mockInput.typeText(target);
  await clickVisible(setup, "collection-rename-preview");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-review-confirm"));
}

test("uncertain rename can close and resume after the original Collection disappears", async () => {
  const initial = collectionsSourcesProjection();
  if (initial.effective.status !== "complete") throw new Error("complete workspace required");
  const effective = initial.effective;
  let workspace = initial;
  let applies = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(initial, {
          getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
          previewCollectionRename: async () => ({ value: renameImpact(), diagnostics: [] }),
          renameCollection: async () => {
            applies++;
            throw new Error("publication unknown");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await previewTeamRename(setup);
    await clickVisible(setup, "collection-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("Rename outcome unknown"));
    await clickVisible(setup, "rename-outcome-close");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("rename-outcome-inspect"));
    workspace = {
      ...initial,
      effective: {
        ...effective,
        collections: effective.collections.filter((id) => id !== "team"),
        collectionsView: effective.collectionsView.filter((item) => item.id !== "team"),
      },
    };
    await clickVisible(setup, "rename-outcome-resume-team");
    await setup.waitForFrame((frame) => frame.includes("Rename outcome unknown"));
    await clickVisible(setup, "rename-outcome-inspect");
    await setup.waitForFrame((frame) => frame.includes("does not prove"));
    expect(applies).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("long rename outcome preserves the full target and fixed close across task sizes", async () => {
  const target = "team/" + "很长的目录/".repeat(20);
  const requests: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(collectionsSourcesProjection(), {
          previewCollectionRename: async (_environment, request) => {
            requests.push(request.target);
            return { value: { ...renameImpact(), target: request.target }, diagnostics: [] };
          },
          renameCollection: async () => {
            throw new Error("publication unknown");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await previewTeamRename(setup, target);
    await clickVisible(setup, "collection-review-confirm");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("rename-outcome-close"));
    for (const [width, height] of [
      [120, 30],
      [100, 24],
      [80, 23],
      [43, 13],
    ]) {
      setup.resize(width!, height!);
      await setup.flush();
      const close = setup.renderer.root.findDescendantById("rename-outcome-close")!;
      const nodes = (node: BaseRenderable): BaseRenderable[] => [
        node,
        ...node.getChildren().flatMap(nodes),
      ];
      const body = nodes(setup.renderer.root).find(
        (node) =>
          node instanceof ScrollBoxRenderable &&
          nodes(node).some(
            (child) => child instanceof TextRenderable && child.plainText.includes(target),
          ),
      ) as ScrollBoxRenderable;
      expect(!!body).toBe(true);
      expect(body.viewport.height).toBeGreaterThanOrEqual(6);
      expect(!!body.findDescendantById(close.id)).toBe(false);
      const y = close.screenY;
      body.scrollBy(20);
      await setup.flush();
      expect(close.screenY).toBe(y);
      expect(close.screenY + close.height).toBeLessThanOrEqual(height! - 1);
    }
    expect(requests).toEqual([target]);
    await clickVisible(setup, "rename-outcome-close");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("rename-outcome-close"));
  } finally {
    setup.renderer.destroy();
  }
});

test("retained rename is reachable by keyboard after closing the result", async () => {
  const initial = collectionsSourcesProjection();
  let calls = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(initial, {
          previewCollectionRename: async () => ({ value: renameImpact(), diagnostics: [] }),
          renameCollection: async () => {
            calls++;
            throw new Error("publication unknown");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await previewTeamRename(setup);
    await clickVisible(setup, "collection-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("Rename outcome unknown"));
    await parsedEscape(setup);
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("rename-outcome-inspect"));
    for (
      let i = 0;
      i < 20 && !setup.renderer.currentFocusedRenderable?.id.startsWith("rename-outcome-resume");
      i++
    ) {
      setup.mockInput.pressTab();
      await setup.renderOnce();
    }
    expect(setup.renderer.currentFocusedRenderable?.id).toStartWith("rename-outcome-resume");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Rename outcome unknown"));
    expect(calls).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("stale rename requires explicit fresh preview before another apply", async () => {
  let previews = 0,
    applies = 0;
  const impact = renameImpact();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(collectionsSourcesProjection(), {
          previewCollectionRename: async () => {
            previews++;
            return { value: impact, diagnostics: [] };
          },
          renameCollection: async () => {
            applies++;
            throw new SkctlError("CONFIG_CONFLICT", "stale");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await previewTeamRename(setup);
    await clickVisible(setup, "collection-review-confirm");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-review-preview-again"),
    );
    expect(applies).toBe(1);
    expect(previews).toBe(1);
    expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
    await clickVisible(setup, "collection-review-preview-again");
    await setup.waitFor(() => previews === 2);
    expect(applies).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("applied rename with refresh failure retains receipt and does not navigate to an unverified target", async () => {
  let reads = 0;
  const workspace = collectionsSourcesProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          getWorkspace: async () => {
            if (++reads > 1) throw new Error("refresh failed");
            return { value: workspace, diagnostics: [] };
          },
          previewCollectionRename: async () => ({ value: renameImpact(), diagnostics: [] }),
          renameCollection: async () => ({ value: renameImpact(), diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await previewTeamRename(setup);
    await clickVisible(setup, "collection-review-confirm");
    await setup.waitForFrame(
      (frame) => frame.includes("Rename applied") && frame.includes("stale"),
    );
    expect(setup.renderer.root.findDescendantById("rename-outcome-inspect")).toBeTruthy();
  } finally {
    setup.renderer.destroy();
  }
});

test("registration fulfilled after Cancel retains its durable receipt", async () => {
  let finish!: () => void;
  let started = false;
  const workspace = collectionsSourcesProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () =>
            new Promise((resolve) => {
              started = true;
              finish = () =>
                resolve({
                  value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
                  diagnostics: [],
                });
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await openSourceSettings(setup);
    await clickLabel(setup, "Replace Source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("/replacement");
    await clickVisible(setup, "source-register-only");
    await setup.waitFor(() => started);
    await parsedEscape(setup);
    finish();
    await setup.waitForFrame((frame) => frame.includes("Registered replacement"));
  } finally {
    setup.renderer.destroy();
  }
});

test("fulfilled registration with failed refresh retains receipt and blocks further mutation", async () => {
  const workspace = collectionsSourcesProjection();
  let registered = false;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          getWorkspace: async () => {
            if (registered) throw new Error("refresh failed");
            return { value: workspace, diagnostics: [] };
          },
          registerSource: async () => {
            registered = true;
            return {
              value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await registerReplacement(setup);
    await setup.waitForFrame((frame) => frame.includes("workspace stale"));
    expect(setup.captureCharFrame()).toContain("Registered replacement");
    const acquire = setup.renderer.root.findDescendantById("replacement-acquire");
    expect(acquire?.focusable).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("rebind fulfilled after Cancel remains recorded in replacement progress", async () => {
  const workspace = collectionsSourcesProjection();
  const address = workspace.installedSkills[0]!.address;
  const impact: RebindImpact = {
    kind: "rebind",
    address,
    owner: "replacement",
    ownerPath: address.path,
    proof: "proven",
    scope: "captured-workspace",
    limitation: "Captured workspace",
    baseline: "opaque",
    allowed: true,
    blockers: [],
    directMemberships: [],
  };
  let finish!: () => void;
  let started = false;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
            diagnostics: [],
          }),
          previewRebind: async () => ({ value: impact, diagnostics: [] }),
          rebindSkill: async () =>
            new Promise((resolve) => {
              started = true;
              finish = () => resolve({ value: undefined, diagnostics: [] });
            }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-skills");
    await parsedEnter(setup);
    await clickVisible(setup, "replacement-preview");
    await clickVisible(setup, "installed-skill-review-confirm");
    await setup.waitFor(() => started);
    await parsedEscape(setup);
    finish();
    await setup.waitForFrame((frame) =>
      frame.includes(`Rebound ${address.source}/${address.path}`),
    );
    expect(setup.captureCharFrame()).toContain("Registered replacement");
  } finally {
    setup.renderer.destroy();
  }
});

test("unknown old Source removal remains blocked after inspection without retry", async () => {
  const workspace = collectionsSourcesProjection();
  const old = workspace.effective.sources[0]!.id;
  const owner = workspace.configs
    .flatMap((config) => config.direct.sources)
    .find((source) => source.id === old)!.ref.owner;
  let removals = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: owner.file, changed: true },
            diagnostics: [],
          }),
          previewSourceRemoval: async (_env, request) => ({
            value: {
              kind: "source-removal",
              source: request.source,
              owner,
              installed: [],
              repairs: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          removeSource: async () => {
            removals++;
            throw new Error("unknown publication");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-remove");
    await clickVisible(setup, "source-removal-confirm");
    await setup.waitForFrame((frame) => frame.includes("unknown outcome"));
    await clickVisible(setup, "replacement-inspect");
    await setup.waitForFrame((frame) => frame.includes("insufficient"));
    expect(removals).toBe(1);
    expect(setup.captureCharFrame()).not.toContain(`Removed Source ${old}`);
  } finally {
    setup.renderer.destroy();
  }
});

test("uncertain old Source removal is resolved only after the declaration and dependencies disappear", async () => {
  const original = collectionsSourcesProjection();
  let workspace = original;
  const old = original.effective.sources[0]!.id;
  const owner = original.configs
    .flatMap((config) => config.direct.sources)
    .find((source) => source.id === old)!.ref.owner;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(original, {
          getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
          registerSource: async () => ({
            value: { level: "project", file: owner.file, changed: true },
            diagnostics: [],
          }),
          previewSourceRemoval: async (_env, request) => ({
            value: {
              kind: "source-removal",
              source: request.source,
              owner,
              installed: [],
              repairs: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          removeSource: async () => {
            throw new Error("unknown publication");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-remove");
    await clickVisible(setup, "source-removal-confirm");
    await setup.waitForFrame((frame) => frame.includes("unknown outcome"));
    if (original.effective.status !== "complete") throw new Error("complete workspace required");
    workspace = {
      ...original,
      configs: original.configs.map((config) =>
        config.level !== owner.level
          ? config
          : {
              ...config,
              direct: {
                ...config.direct,
                sources: config.direct.sources.filter((source) => source.id !== old),
              },
            },
      ),
      installedSkills: original.installedSkills.filter((skill) => skill.address.source !== old),
      effective: {
        ...original.effective,
        sources: original.effective.sources.filter((source) => source.id !== old),
        collectionsView: original.effective.collectionsView.map((collection) => ({
          ...collection,
          members: collection.members.filter((member) => member.address.source !== old),
        })),
      },
    };
    await clickVisible(setup, "replacement-inspect");
    await setup.waitForFrame((frame) => frame.includes(`Inspected removal of Source ${old}`));
  } finally {
    setup.renderer.destroy();
  }
});

test("replacement progress remains resumable from Sources after its old Source disappears", async () => {
  const original = collectionsSourcesProjection();
  let workspace = original;
  const old = original.effective.sources[0]!.id;
  const owner = original.configs
    .flatMap((config) => config.direct.sources)
    .find((source) => source.id === old)!.ref.owner;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(original, {
          getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
          registerSource: async () => ({
            value: { level: "project", file: owner.file, changed: true },
            diagnostics: [],
          }),
          previewSourceRemoval: async (_env, request) => ({
            value: {
              kind: "source-removal",
              source: request.source,
              owner,
              installed: [],
              repairs: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          }),
          removeSource: async () => {
            workspace = {
              ...workspace,
              effective: {
                ...workspace.effective,
                sources: workspace.effective.sources.filter((source) => source.id !== old),
              },
              installedSkills: workspace.installedSkills.filter(
                (skill) => skill.address.source !== old,
              ),
            };
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-remove");
    await clickVisible(setup, "source-removal-confirm");
    await setup.waitForFrame((frame) => frame.includes(`Removed Source ${old}`));
    await clickVisible(setup, "replacement-close");
    await clickVisible(setup, `source-resume-missing-${encodeURIComponent(old)}`);
    await setup.waitForFrame(
      (frame) =>
        frame.includes(`Removed Source ${old}`) && frame.includes("Registered replacement"),
    );
  } finally {
    setup.renderer.destroy();
  }
});

for (const consistent of [true, false]) {
  test(`uncertain rename inspection ${consistent ? "accepts the captured effects" : "rejects missing captured effects"}`, async () => {
    const initial = collectionsSourcesProjection();
    if (initial.effective.status !== "complete") throw new Error("complete workspace required");
    const owner = initial.effective.collectionsView.find((item) => item.id === "team")!
      .declared[0]!;
    const useOwner = { ...owner, pointer: "/use/0" };
    const impact: CollectionRenameImpact = {
      ...renameImpact(),
      references: [{ kind: "use", owner: useOwner }],
    };
    let workspace = initial;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(initial, {
            getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
            previewCollectionRename: async () => ({ value: impact, diagnostics: [] }),
            renameCollection: async () => {
              throw new Error("publication unknown");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 30 },
    );
    try {
      await previewTeamRename(setup);
      await clickVisible(setup, "collection-review-confirm");
      await setup.waitForFrame((frame) => frame.includes("Rename outcome unknown"));
      workspace = {
        ...initial,
        configs: initial.configs.map((config) =>
          config.level !== owner.level
            ? config
            : {
                ...config,
                direct: {
                  ...config.direct,
                  collectionUse: consistent ? [{ collection: "new-team", owner: useOwner }] : [],
                },
              },
        ),
        effective: {
          ...initial.effective,
          collections: initial.effective.collections.map((id) => (id === "team" ? "new-team" : id)),
          collectionsView: initial.effective.collectionsView.map((collection) =>
            collection.id !== "team"
              ? collection
              : {
                  ...collection,
                  id: "new-team",
                  declared: [{ ...owner, pointer: "/collections/new-team" }],
                },
          ),
        },
      };
      await clickVisible(setup, "rename-outcome-inspect");
      if (consistent)
        await setup.waitFor(
          () => !setup.renderer.root.findDescendantById("rename-outcome-inspect"),
        );
      else await setup.waitForFrame((frame) => frame.includes("does not prove"));
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("replacement receipt and uncertain guard survive Close and reopening the same Source task", async () => {
  const workspace = collectionsSourcesProjection();
  let registrations = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => {
            registrations++;
            throw new Error("unknown publication");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openSourceSettings(setup);
    await clickLabel(setup, "Replace Source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText("/replacement");
    await clickVisible(setup, "source-register-only");
    await setup.waitForFrame((frame) => frame.includes("Registration outcome unknown"));
    await clickVisible(setup, "replacement-close");
    await clickLabel(setup, "Resume replacement");
    await setup.waitForFrame((frame) => frame.includes("Registration outcome unknown"));
    expect(registrations).toBe(1);
    expect(setup.renderer.root.findDescendantById("source-register-origin")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("replacement Back from rebind review preserves selected address and target path", async () => {
  const workspace = collectionsSourcesProjection();
  const address = workspace.installedSkills[0]!.address;
  const impact: RebindImpact = {
    kind: "rebind",
    address,
    owner: "replacement",
    ownerPath: "nested/guide",
    proof: "proven",
    scope: "captured-workspace",
    limitation: "Captured workspace",
    baseline: "opaque",
    allowed: true,
    blockers: [],
    directMemberships: [],
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
            diagnostics: [],
          }),
          previewRebind: async () => ({ value: impact, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-skills");
    await parsedEnter(setup);
    await clickVisible(setup, "replacement-path");
    setup.mockInput.pressKey("HOME");
    await setup.mockInput.typeText("nested/");
    await clickVisible(setup, "replacement-preview");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("installed-skill-review-cancel"),
    );
    await clickVisible(setup, "installed-skill-review-cancel");
    await setup.waitForFrame((frame) => frame.includes("nested/guide"));
    expect(setup.renderer.root.findDescendantById("replacement-preview")?.focusable).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test("replacement retains the first rebind receipt when the next rebind outcome is unknown", async () => {
  const workspace = collectionsSourcesProjection();
  const first = workspace.installedSkills[0]!.address;
  const second = workspace.installedSkills[1]!.address;
  let calls = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(workspace, {
          registerSource: async () => ({
            value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
            diagnostics: [],
          }),
          previewRebind: async (_env, request) => ({
            value: {
              kind: "rebind",
              address: { source: request.source, path: request.path },
              owner: request.owner,
              ownerPath: request.ownerPath ?? request.path,
              proof: "proven",
              scope: "captured-workspace",
              limitation: "Captured workspace",
              baseline: "opaque",
              allowed: true,
              blockers: [],
              directMemberships: [],
            },
            diagnostics: [],
          }),
          rebindSkill: async () => {
            if (++calls === 2) throw new Error("unknown publication");
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await registerReplacement(setup);
    await clickVisible(setup, "replacement-skills");
    await parsedEnter(setup);
    await clickVisible(setup, "replacement-preview");
    await clickVisible(setup, "installed-skill-review-confirm");
    await setup.waitForFrame((frame) => frame.includes(`Rebound ${first.source}/${first.path}`));
    await clickVisible(setup, "replacement-skills");
    await parsedEnter(setup);
    await clickVisible(setup, "replacement-preview");
    await clickVisible(setup, "installed-skill-review-confirm");
    await setup.waitForFrame((frame) => frame.includes("Rebind outcome unknown"));
    expect(setup.captureCharFrame()).toContain(`Rebound ${first.source}/${first.path}`);
    expect(calls).toBe(2);
    expect(second.path).not.toBe(first.path);
  } finally {
    setup.renderer.destroy();
  }
});

for (const scenario of [
  "repaired",
  "membership-mismatch",
  "identity-mismatch",
  "identity-unavailable",
] as const) {
  test(`uncertain rebind inspection ${scenario}`, async () => {
    const initial = collectionsSourcesProjection();
    if (initial.effective.status !== "complete") throw new Error("complete workspace required");
    const skill = initial.installedSkills[0]!;
    const collection = initial.effective.collectionsView.find((item) => item.id === "team")!;
    const member = collection.members.find((item) => item.name === skill.name)!;
    const direct = member.paths.find((path) => path.kind === "direct")!;
    if (direct.kind !== "direct" || !direct.owner) throw new Error("direct membership required");
    const after = { source: "replacement", path: skill.address.path };
    const source = initial.effective.sources.find((item) => item.id === skill.address.source)!;
    const impact: RebindImpact = {
      kind: "rebind",
      address: skill.address,
      owner: after.source,
      ownerPath: after.path,
      proof: "proven",
      scope: "captured-workspace",
      limitation: "Captured workspace",
      baseline: "opaque",
      allowed: true,
      blockers: [],
      directMemberships: [
        {
          collection: "team",
          name: member.name,
          owner: direct.owner,
          before: skill.address,
          after,
        },
        {
          collection: "team",
          name: "other-alias",
          owner: { ...direct.owner, pointer: `${direct.owner.pointer}-alias` },
          before: skill.address,
          after,
        },
      ],
      ...(scenario === "identity-unavailable"
        ? {}
        : {
            identity: {
              kind: "remote" as const,
              canonicalOrigin: source.origin,
              originRelativeSkillRoot: `${source.root}/${skill.address.path}`,
            },
          }),
    };
    let workspace = initial;
    let previews = 0;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(initial, {
            getWorkspace: async () => ({ value: workspace, diagnostics: [] }),
            registerSource: async () => ({
              value: { level: "project", file: "/workspace/skctl/skctl.jsonc", changed: true },
              diagnostics: [],
            }),
            previewRebind: async () => {
              previews++;
              return { value: impact, diagnostics: [] };
            },
            rebindSkill: async () => {
              throw new Error("unknown publication");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 30 },
    );
    try {
      await registerReplacement(setup);
      await clickVisible(setup, "replacement-skills");
      await parsedEnter(setup);
      await clickVisible(setup, "replacement-preview");
      await setup.waitFor(() => previews > 0);
      await setup.waitForFrame(
        (frame) => frame.includes("Rebind Skill") && frame.includes("Identity proof"),
      );
      await clickVisible(setup, "installed-skill-review-confirm");
      await setup.waitForFrame((frame) => frame.includes("Rebind outcome unknown"));
      workspace = {
        ...initial,
        installedSkills: initial.installedSkills.map((item) =>
          item === skill
            ? {
                ...item,
                address: after,
                owner: { ...item.owner, source: after.source, health: "healthy" },
              }
            : item,
        ),
        effective: {
          ...initial.effective,
          sources: [
            ...initial.effective.sources,
            {
              ...initial.effective.sources.find((source) => source.id === skill.address.source)!,
              id: after.source,
              ...(scenario === "identity-mismatch"
                ? { origin: "https://github.com/other/repository" }
                : {}),
            },
          ],
          collectionsView: initial.effective.collectionsView.map((item) =>
            item.id !== "team"
              ? item
              : {
                  ...item,
                  members: [
                    ...item.members.map((entry) =>
                      entry.name !== member.name ? entry : { ...entry, address: after },
                    ),
                    {
                      ...member,
                      name: "other-alias",
                      address: scenario !== "membership-mismatch" ? after : skill.address,
                      paths: [
                        {
                          ...direct,
                          entryName: "other-alias",
                          owner: { ...direct.owner!, pointer: `${direct.owner!.pointer}-alias` },
                        },
                      ],
                    },
                  ],
                },
          ),
        },
      };
      await clickVisible(setup, "replacement-inspect");
      await setup.waitForFrame((frame) =>
        frame.includes(scenario === "repaired" ? "Inspected rebind" : "insufficient"),
      );
      if (scenario !== "repaired")
        expect(setup.captureCharFrame()).not.toContain("Inspected rebind");
    } finally {
      setup.renderer.destroy();
    }
  });
}

async function realFixture() {
  const root = await mkdtemp(join(tmpdir(), "sktui-identity-"));
  const global = join(root, "global", "config.jsonc");
  const project = join(root, "skctl.jsonc");
  const previous = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  await mkdir(join(root, "global"), { recursive: true });
  await writeFile(global, "{}\n");
  await writeFile(project, "{}\n");
  const options = { cwd: root, userConfigPath: global };
  return {
    root,
    global,
    project,
    options,
    dispose: async () => {
      if (previous === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("App Collection rename persists writable Use and Reference through real Core", async () => {
  const f = await realFixture();
  let setup: Setup | undefined;
  try {
    await writeFile(f.global, '{ "collections": { "team": {} }, "use": ["team"] }\n');
    await writeFile(
      f.project,
      '{ "collections": { "parent": { "references": { "alias": { "collection": "team", "description": "Team" } } } } }\n',
    );
    let workspaceDone!: ReturnType<typeof core.getWorkspace>;
    let previewDone!: ReturnType<typeof core.previewCollectionRename>;
    let renameDone!: ReturnType<typeof core.renameCollection>;
    const appCore = {
      ...core,
      getWorkspace: (...args: Parameters<typeof core.getWorkspace>) =>
        (workspaceDone = core.getWorkspace(...args)),
      previewCollectionRename: (...args: Parameters<typeof core.previewCollectionRename>) =>
        (previewDone = core.previewCollectionRename(...args)),
      renameCollection: (...args: Parameters<typeof core.renameCollection>) =>
        (renameDone = core.renameCollection(...args)),
    };
    setup = await testRender(() => <App core={appCore} environment={f.options} exit={() => {}} />, {
      width: 120,
      height: 24,
    });
    await workspaceDone;
    await setup.flush();
    await clickVisible(setup, "shell-section-tab-collections");
    await setup.waitForFrame((frame) => frame.includes("team"));
    await collectionBrowserCommand(setup, "collections.expand-all");
    const key = collectionFilterPathKey({
      segments: [
        { collection: "parent" },
        { collection: "team", reference: { name: "alias", target: "team" } },
      ],
    });
    await clickVisible(setup, `collection-browser-row-${encodeURIComponent(key)}`);
    await parsedEnter(setup);
    await clickVisible(setup, "collection-tabs-tab-settings");
    await clickLabel(setup, "Rename");
    await clickVisible(setup, "collection-rename-target");
    await setup.mockInput.typeText("new-team");
    await clickVisible(setup, "collection-rename-preview");
    await previewDone;
    await setup.flush();
    await clickVisible(setup, "collection-review-confirm");
    await renameDone;
    await workspaceDone;
    await setup.waitForFrame((frame) => frame.includes("new-team") && frame.includes("Settings"));
    expect(parse(await readFile(f.global, "utf8")).use).toEqual(["new-team"]);
    expect(
      parse(await readFile(f.project, "utf8")).collections.parent.references.alias.collection,
    ).toBe("new-team");
    expect(parse(await readFile(f.global, "utf8")).collections.team).toBeUndefined();
  } finally {
    setup?.renderer.destroy();
    await f.dispose();
  }
});

test("App replacement rebind persists actual Core membership and installed owner", async () => {
  const f = await realFixture();
  let setup: Setup | undefined;
  try {
    const skills = join(f.root, "skills");
    await mkdir(join(skills, "guide"), { recursive: true });
    await writeFile(
      join(skills, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\nBody\n",
    );
    await core.registerSource(f.options, {
      level: "project",
      id: "first",
      binding: { kind: "local", path: skills, root: "" },
    });
    await core.installSkills(f.options, { source: "first", paths: ["guide"] });
    await core.createCollection(f.options, { level: "project", collection: "daily" });
    await core.addMember(f.options, {
      level: "project",
      collection: "daily",
      name: "alias",
      address: { source: "first", path: "guide" },
    });
    let registrationDone!: ReturnType<typeof core.registerSource>;
    let rebindDone!: ReturnType<typeof core.rebindSkill>;
    let previewDone!: ReturnType<typeof core.previewRebind>;
    let refreshDone: ReturnType<typeof core.getWorkspace> | undefined;
    const appCore = {
      ...core,
      registerSource: (...args: Parameters<typeof core.registerSource>) =>
        (registrationDone = core.registerSource(...args)),
      previewRebind: (...args: Parameters<typeof core.previewRebind>) =>
        (previewDone = core.previewRebind(...args)),
      rebindSkill: (...args: Parameters<typeof core.rebindSkill>) =>
        (rebindDone = core.rebindSkill(...args)),
      getWorkspace: (...args: Parameters<typeof core.getWorkspace>) =>
        (refreshDone = core.getWorkspace(...args)),
    };
    setup = await testRender(() => <App core={appCore} environment={f.options} exit={() => {}} />, {
      width: 120,
      height: 30,
    });
    await openSourceSettings(setup);
    await clickLabel(setup, "Replace Source");
    await setup.waitFor(
      () => setup!.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText(skills);
    await clickVisible(setup, "source-register-only");
    await registrationDone;
    await refreshDone;
    await setup.waitForFrame((frame) => frame.includes("Registered skills"), { maxPasses: 1000 });
    await clickVisible(setup, "replacement-skills");
    await parsedEnter(setup);
    await clickVisible(setup, "replacement-preview");
    await previewDone;
    await setup.waitFor(
      () => !!setup!.renderer.root.findDescendantById("installed-skill-review-confirm"),
    );
    await setup.flush();
    await clickVisible(setup, "installed-skill-review-confirm");
    await rebindDone;
    await refreshDone;
    await setup.waitForFrame((frame) => frame.includes("Rebound first/guide"));
    expect(parse(await readFile(f.project, "utf8")).collections.daily.members.alias).toEqual({
      source: "skills",
      path: "guide",
    });
    expect((await core.getWorkspace(f.options)).value.installedSkills[0]!.address).toEqual({
      source: "skills",
      path: "guide",
    });
  } finally {
    setup?.renderer.destroy();
    await f.dispose();
  }
});
import { collectionBrowserCommand } from "./reader-test-controls";
