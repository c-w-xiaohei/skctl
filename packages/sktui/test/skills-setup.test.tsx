import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { parsedEnter, parsedEscape, enterLive } from "./reader-test-controls";
import { readerProjection } from "./installed-reader.fixture";
import { InputRenderable } from "@opentui/core";
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
      await setup.waitForFrame((frame) => frame.includes("Add your first Skills"));
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
    expect(setup.captureCharFrame()).not.toContain("Add your first Skills");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Add your first Skills"));
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
    expect(setup.captureCharFrame()).not.toContain("Add your first Skills");
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

test("Agent setup works with a missing Config and does not expose all installed Skills", async () => {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete workspace");
  const snapshot = { ...base, effective: { ...base.effective, collections: ["mine"] } };
  const requests: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          {
            ...snapshot,
            configs: snapshot.configs.map((config) => ({
              ...config,
              file: { ...config.file, status: "missing" as const },
            })),
          },
          {
            setManagedOpenCode: async (_options, request) => {
              requests.push(request);
              return {
                value: { level: request.level, file: "/project/skctl.jsonc", changed: true },
                diagnostics: [],
              };
            },
          },
        )}
        exit={() => {}}
      />
    ),
    { width: 100, height: 30 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("Choose what OpenCode can discover"));
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-operation-confirm"));
    expect(requests).toEqual([]);
    await enterLive(setup, "config-operation-confirm");
    await setup.waitFor(() => requests.length === 1);
    expect(requests).toEqual([{ level: "project", managed: true }]);
  } finally {
    setup.renderer.destroy();
  }
});

test("real empty Config completes registration, discovery and selected installation without manual file creation", async () => {
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
    let mutation: "register" | "install" | undefined;
    const core = {
      ...api,
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
        const result = await api.installSkills(...args);
        mutation = "install";
        return result;
      },
      getWorkspace: async (...args: Parameters<typeof api.getWorkspace>) => {
        const result = await api.getWorkspace(...args);
        loaded.resolve();
        if (mutation === "register") registered.resolve();
        if (mutation === "install") installed.resolve();
        return result;
      },
    };
    setup = await testRender(() => <App core={core} environment={options} exit={() => {}} />, {
      width: 120,
      height: 30,
    });
    await loaded.promise;
    await setup.waitForFrame((frame) => frame.includes("Add your first Skills"));
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
    expect(
      (setup.renderer.root.findDescendantById("source-register-root") as InputRenderable).value,
    ).toBe("");
    await enterLive(setup, "source-register-submit");
    await registered.promise;
    await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("config-source-browser"));
    const config = JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8"));
    expect(config.sources.mine).toEqual({ kind: "local", path: join(root, "local"), root: "" });
    await enterLive(setup, "config-command-add-skills");
    await discovered.promise;
    await setup.waitFor(
      () => !!setup!.renderer.root.findDescendantById("source-operation-selection"),
    );
    await enterLive(setup, "source-operation-selection");
    await enterLive(setup, "source-operation-submit");
    await installed.promise;
    const state = await Bun.file(join(root, "state", "state.json")).json();
    expect(state.installed[0]).toMatchObject({ source: "mine", path: "guide", name: "guide" });
    const after = JSON.parse(await readFile(join(root, "skctl.jsonc"), "utf8"));
    expect(after.agents).toBeUndefined();
    expect(after.use).toBeUndefined();
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
});
