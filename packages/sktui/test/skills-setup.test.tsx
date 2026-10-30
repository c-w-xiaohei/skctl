import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { parsedEnter, parsedEscape, enterLive } from "./reader-test-controls";
import { readerProjection } from "./installed-reader.fixture";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import * as api from "@skctl/core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const width of [120, 80, 43]) {
  test(`first-use guidance has one reachable action and no empty tree at ${width} columns`, async () => {
    const base = workspaceProjection({ includeDirect: false, includeContribution: false });
    const snapshot = {
      ...base,
      configs: base.configs.map((config) => ({
        ...config,
        file: { ...config.file, status: "missing" as const },
        direct: { ...config.direct, configSources: [] },
      })),
    };
    const setup = await testRender(
      () => <App core={directSourceCore(snapshot)} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
      expect(setup.captureCharFrame()).not.toContain("View Problems");
      expect(setup.captureCharFrame()).not.toContain("expand/fold");
      expect(setup.renderer.root.findDescendantById("agent-node-pane")).toBeUndefined();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
      );
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("Add Source"));
      expect(setup.renderer.root.findDescendantById("source-register-origin")).toBeDefined();
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
      );
    } catch (error) {
      throw new Error(
        `${error}\nFocused: ${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("without a resolved project Add only creates the global Source and leaves discovery for later", async () => {
  const root = await mkdtemp(join(tmpdir(), "skctl-global-source-"));
  const savedState = process.env.SKCTL_STATE_DIR;
  const savedSchedule = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = join(root, "schedule");
  const userConfigPath = join(root, "config.jsonc");
  const loaded = Promise.withResolvers<void>();
  const registered = Promise.withResolvers<void>();
  const refreshed = Promise.withResolvers<void>();
  let savedSource = false;
  let discoveries = 0;
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    await mkdir(join(root, "skills"));
    setup = await testRender(
      () => (
        <App
          core={{
            ...api,
            getWorkspace: async (...args) => {
              try {
                const value = await api.getWorkspace(...args);
                loaded.resolve();
                if (savedSource) refreshed.resolve();
                return value;
              } catch (error) {
                loaded.reject(error);
                throw error;
              }
            },
            registerSource: async (...args) => {
              try {
                const value = await api.registerSource(...args);
                savedSource = true;
                registered.resolve();
                return value;
              } catch (error) {
                registered.reject(error);
                throw error;
              }
            },
            discoverSkills: async () => {
              discoveries++;
              throw new Error("Add only must not discover Skills");
            },
          }}
          environment={{ cwd: root, userConfigPath }}
          exit={() => {}}
        />
      ),
      { width: 80, height: 24 },
    );
    await loaded.promise;
    await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup!.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
    await setup.mockInput.typeText(join(root, "skills"));
    await enterLive(setup, "source-register-only");
    await registered.promise;
    await refreshed.promise;
    await setup.waitFor(() => !setup!.renderer.root.findDescendantById("source-register-origin"));
    const saved = JSON.parse(await readFile(userConfigPath, "utf8"));
    expect(saved.sources.skills).toEqual({ kind: "local", path: join(root, "skills"), root: "" });
    expect(saved.collections).toBeUndefined();
    expect(saved.use).toBeUndefined();
    expect(await Bun.file(join(root, "skctl.jsonc")).exists()).toBe(false);
    expect(discoveries).toBe(0);
    await setup.waitForFrame((frame) => frame.includes("Global"));
  } finally {
    setup?.renderer.destroy();
    if (savedState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = savedState;
    if (savedSchedule === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    else process.env.SKTUI_UPDATE_SCHEDULE_DIR = savedSchedule;
    await rm(root, { recursive: true, force: true });
  }
});

test("an installed library with missing declarations stays visible and recovery is read-only", async () => {
  const empty = workspaceProjection({ includeDirect: false, includeContribution: false });
  const snapshot = { ...empty, installedSkills: readerProjection().installedSkills };
  let writes = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(snapshot, {
          registerSource: async () => {
            writes++;
            throw new Error("Must not register while recovering");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Your installed Skills are still here"));
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Restore your saved Source"));
    await parsedEscape(setup);
    await enterLive(setup, "skills-setup-inventory");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(setup.captureCharFrame()).not.toContain("Your Skill library is empty");
    expect(writes).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("configured Sources lead to discovery without a duplicate registration step", async () => {
  const snapshot = workspaceProjection({ includeContribution: false });
  let discoveries = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(snapshot, {
          discoverSkills: async (_options, request) => {
            discoveries++;
            return {
              value: { source: request.source, kind: "github", candidates: [] },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Choose Skills to install"));
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    expect(setup.renderer.root.findDescendantById("source-register-id")).toBeUndefined();
    expect(discoveries).toBe(0);
    await enterLive(setup, "workspace-action-add-skills");
    await setup.waitFor(() => discoveries === 1);
  } finally {
    setup.renderer.destroy();
  }
});

test("installation result locates the newly installed Skill ahead of older Source contents", async () => {
  const base = workspaceProjection({ includeContribution: false });
  const skill = readerProjection().installedSkills[0]!;
  const source = base.effective.sources[0]!.id;
  let snapshot: api.WorkspaceView = {
    ...base,
    installedSkills: [{ ...skill, address: { source, path: "older" }, name: "older" }],
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(snapshot, {
          getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
          discoverSkills: async () => ({
            value: {
              source,
              kind: "local",
              candidates: [{ path: "new", name: "new", description: "Just installed" }],
            },
            diagnostics: [],
          }),
          installSkills: async () => {
            snapshot = {
              ...snapshot,
              installedSkills: [
                ...snapshot.installedSkills,
                { ...skill, address: { source, path: "new" }, name: "new" },
              ],
            };
            return { value: [], diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("shell-section-tab-sources"),
    );
    await enterLive(setup, "shell-section-tab-sources");
    await setup.waitForFrame((frame) => frame.includes("Find and install"));
    await enterLive(setup, "workspace-action-add-skills");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("source-operation-selection"),
    );
    await enterLive(setup, "source-operation-selection");
    await enterLive(setup, "source-operation-submit");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-result-view"));
    await enterLive(setup, "installed-result-view");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).getSelectedOption()?.value,
    ).toBe(JSON.stringify([source, "new"]));
  } finally {
    setup.renderer.destroy();
  }
});

test("a failed initial read exposes Retry rather than claiming an empty library", async () => {
  const empty = workspaceProjection({ includeDirect: false, includeContribution: false });
  let reads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(empty, {
          getWorkspace: async () => {
            if (++reads === 1) throw new Error("state.json cannot be read");
            return { value: empty, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Could not read your workspace"));
    expect(setup.captureCharFrame()).not.toContain("Add your first Source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
    expect(reads).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});

test("invalid configuration shows its actual file, keeps installed inventory, and offers Retry", async () => {
  const base = readerProjection();
  const problem = {
    code: "CONFIG_PARSE_FAILED",
    severity: "warning" as const,
    message: "Invalid JSONC at line 12",
    location: { file: "/project/skctl.jsonc" },
  };
  const snapshot: api.WorkspaceView = {
    ...base,
    effective: {
      status: "unavailable",
      sources: [],
      collections: [],
      agent: base.effective.agent,
      reasons: [problem],
    },
    configs: [
      { ...base.configs[0]!, file: { status: "invalid", file: "/project/skctl.jsonc", problem } },
    ],
    diagnostics: [problem],
  };
  const setup = await testRender(() => <App core={directSourceCore(snapshot)} exit={() => {}} />, {
    width: 100,
    height: 24,
  });
  try {
    await setup.waitForFrame((frame) => frame.includes("Could not read your configuration"));
    expect(setup.captureCharFrame()).toContain("/project/skctl.jsonc");
    expect(setup.captureCharFrame()).toContain("Invalid JSONC at line 12");
    expect(setup.captureCharFrame()).not.toContain("Add your first Source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
    );
    setup.mockInput.pressTab();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-inventory",
    );
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection choice works without a managed declaration or an existing Config", async () => {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete workspace");
  const snapshot = {
    ...base,
    effective: {
      ...base.effective,
      collections: ["mine"],
      collectionsView: [
        {
          id: "mine",
          declared: [],
          repository: { derived: false, producers: [] },
          references: [],
          links: [],
          members: [
            {
              name: base.installedSkills[0]!.name,
              address: base.installedSkills[0]!.address,
              paths: [],
            },
          ],
        },
      ],
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...snapshot,
          configs: snapshot.configs.map((config) => ({
            ...config,
            file: { ...config.file, status: "missing" as const },
          })),
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Choose Collections for agents"));
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
    expect(setup.captureCharFrame()).not.toContain("Enable Managed OpenCode");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 43])(
  "real empty Config completes registration, discovery and Collection handoff at %i columns",
  async (width) => {
    const root = await mkdtemp(join(tmpdir(), "skctl-first-skill-"));
    const savedState = process.env.SKCTL_STATE_DIR;
    const savedSchedule = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    process.env.SKCTL_STATE_DIR = join(root, "state");
    process.env.SKTUI_UPDATE_SCHEDULE_DIR = join(root, "schedule");
    const options = { cwd: root, project: root, userConfigPath: join(root, "user.jsonc") };
    let setup: Awaited<ReturnType<typeof testRender>> | undefined;
    try {
      await mkdir(join(root, "local", "guide"), { recursive: true });
      await writeFile(
        join(root, "local", "guide", "SKILL.md"),
        "---\nname: guide\ndescription: My first Skill\n---\n# Hello\n",
      );
      const loaded = Promise.withResolvers<void>();
      const registered = Promise.withResolvers<void>();
      const discovered = Promise.withResolvers<void>();
      const installed = Promise.withResolvers<void>();
      const created = Promise.withResolvers<void>();
      const edited = Promise.withResolvers<void>();
      const rejectedEdit = Promise.withResolvers<void>();
      let edits = 0;
      let installs = 0;
      let mutation: "register" | "install" | "create" | "edit" | undefined;
      const core = {
        ...api,
        editMembers: async (...args: Parameters<typeof api.editMembers>) => {
          if (++edits === 1) {
            rejectedEdit.resolve();
            throw new api.SkctlError("CONFIG_CONFLICT", "Collection changed; retry");
          }
          const result = await api.editMembers(...args);
          mutation = "edit";
          return result;
        },
        createCollection: async (...args: Parameters<typeof api.createCollection>) => {
          const result = await api.createCollection(...args);
          mutation = "create";
          return result;
        },
        registerSource: async (...args: Parameters<typeof api.registerSource>) => {
          const result = await api.registerSource(...args);
          mutation = "register";
          return result;
        },
        discoverSkills: async (...args: Parameters<typeof api.discoverSkills>) => {
          const result = await api.discoverSkills(...args);
          discovered.resolve();
          return result;
        },
        installSkills: async (...args: Parameters<typeof api.installSkills>) => {
          installs++;
          const result = await api.installSkills(...args);
          mutation = "install";
          return result;
        },
        getWorkspace: async (...args: Parameters<typeof api.getWorkspace>) => {
          const result = await api.getWorkspace(...args);
          loaded.resolve();
          if (mutation === "register") registered.resolve();
          if (mutation === "install") installed.resolve();
          if (mutation === "create") created.resolve();
          if (mutation === "edit") edited.resolve();
          return result;
        },
      };
      setup = await testRender(() => <App core={core} environment={options} exit={() => {}} />, {
        width,
        height: 30,
      });
      await loaded.promise;
      await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
      expect(await Bun.file(join(root, "skctl.jsonc")).exists()).toBe(false);
      await parsedEnter(setup);
      const fill = async (id: string, text: string) => {
        setup!.renderer.root.findDescendantById(id)!.focus();
        setup!.mockInput.typeText(text);
        await setup!.renderOnce();
      };
      await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("source-register-id"));
      await fill("source-register-id", "mine");
      await fill("source-register-origin", join(root, "local"));
      expect(setup.renderer.root.findDescendantById("source-register-root")).toBeUndefined();
      await enterLive(setup, "source-register-submit");
      await registered.promise;
      await discovered.promise;
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("source-operation-selection"),
      );
      const config = JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8"));
      expect(config.sources.mine).toEqual({ kind: "local", path: join(root, "local"), root: "" });
      await discovered.promise;
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("source-operation-selection"),
      );
      await enterLive(setup, "source-operation-selection");
      await enterLive(setup, "source-operation-submit");
      await installed.promise;
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("installed-result-collection"),
      );
      const state = await Bun.file(join(root, "state", "state.json")).json();
      expect(state.installed[0]).toMatchObject({ source: "mine", path: "guide", name: "guide" });
      const after = JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8"));
      expect(after.agents).toBeUndefined();
      expect(after.use).toBeUndefined();
      await enterLive(setup, "installed-result-collection");
      await enterLive(setup, "collection-handoff-create");
      await fill("collection-create-id", "frontend");
      await fill("collection-create-description", "Frontend workflow");
      await enterLive(setup, "collection-create-back");
      await enterLive(setup, "collection-handoff-create");
      expect(
        (setup.renderer.root.findDescendantById("collection-create-id") as InputRenderable).value,
      ).toBe("frontend");
      expect(
        (setup.renderer.root.findDescendantById("collection-create-description") as InputRenderable)
          .value,
      ).toBe("Frontend workflow");
      expect(!!setup.renderer.root.findDescendantById("collection-create-level")).toBe(false);
      await enterLive(setup, "collection-create-submit");
      await created.promise;
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("installed-skill-name-0"),
      );
      await enterLive(setup, "installed-skill-acquire");
      await enterLive(setup, "acquire-source-back");
      expect(
        (setup.renderer.root.findDescendantById("installed-skill-name-0") as InputRenderable).value,
      ).toBe("guide");
      await enterLive(setup, "installed-skill-choice-submit");
      await rejectedEdit.promise;
      await setup.waitForFrame((frame) => frame.includes("Skills remain installed"));
      expect((await Bun.file(join(root, "state", "state.json")).json()).installed).toHaveLength(1);
      expect(
        JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8")).collections.frontend.members,
      ).toBeUndefined();
      await enterLive(setup, "installed-skill-choice-submit");
      await edited.promise;
      const saved = JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8"));
      expect(saved.collections.frontend.members.guide).toEqual({ source: "mine", path: "guide" });
      expect(installs).toBe(1);
      expect(edits).toBe(2);
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("collection-detail-pane"),
      );
      await setup.waitForFrame((frame) => frame.includes("frontend") && frame.includes("guide"));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
    } catch (error) {
      throw new Error(`${error}\n${setup?.captureCharFrame()}`);
    } finally {
      setup?.renderer.destroy();
      if (savedState === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = savedState;
      if (savedSchedule === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = savedSchedule;
      await rm(root, { recursive: true, force: true });
    }
  },
);
