import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { openMainPage } from "./main-page-controls";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
import { openSettingsCategory } from "./settings-test-controls";
import { ConfigPage } from "../src/config-page";
import { createConfigState } from "../src/config/state";
import { SelectRenderable, ScrollBoxRenderable } from "@opentui/core";

test("Settings breadcrumbs return through declarations and categories", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
    { width: 144, height: 24 },
  );
  try {
    await openMainPage(setup, "settings");
    await openSettingsCategory(setup, "config-sources");
    await enterLive(setup, "config-config-source-browser");
    await enterLive(setup, "breadcrumb-2");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "config-config-source-browser",
    );
    await enterLive(setup, "breadcrumb-1");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "settings-categories",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("Settings Scope restores each declaration layer, selection and object scroll", async () => {
  const base = workspaceProjection();
  const projection = {
    ...base,
    configs: base.configs.map((config) => ({
      ...config,
      direct: {
        ...config.direct,
        configSources: Array.from({ length: 3 }, (_, index) => ({
          id: `${config.level}-${index}`,
          owner: {
            level: config.level,
            file: config.file.file,
            pointer: `/configSources/${index}`,
          },
          binding: {
            kind: "local" as const,
            path: `/shared/${config.level}/${index}/` + "directory/".repeat(100),
            root: ".",
          },
          adoption: { status: "live" as const },
          contributed: { sources: [], collections: [] },
        })),
      },
    })),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  const scope = async (value: string) => {
    await enterLive(setup, "shell-scope-select");
    const list = (await focusLive(setup, "scope-choices")) as SelectRenderable;
    const index = list.options.findIndex((item) => item.value === value);
    while (list.getSelectedIndex() !== index) {
      setup.mockInput.pressArrow(list.getSelectedIndex() < index ? "down" : "up");
      await setup.flush();
    }
    await parsedEnter(setup);
  };
  try {
    await openMainPage(setup, "settings");
    await openSettingsCategory(setup, "config-sources");
    await focusLive(setup, "config-config-source-browser");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await parsedEnter(setup);
    const body = (await focusLive(setup, "config-declaration-body")) as ScrollBoxRenderable;
    await setup.waitFor(() => body.scrollHeight > body.height + 8);
    await setup.flush();
    body.scrollBy(8);
    await setup.flush();
    const offset = body.scrollTop;
    expect(offset).toBeGreaterThan(0);
    await openMainPage(setup, "agent");
    await enterLive(setup, "agent-view-tab-global");
    await openMainPage(setup, "settings");
    await setup.waitFor(
      () =>
        (setup.renderer.root.findDescendantById("config-declaration-body") as ScrollBoxRenderable)
          ?.scrollTop === offset,
    );
    expect(!!setup.renderer.root.findDescendantById("config-config-source-browser")).toBe(false);
    await scope("project");
    await openSettingsCategory(setup, "config-sources");
    await scope("global");
    expect(!!setup.renderer.root.findDescendantById("config-config-source-browser")).toBe(false);
    await setup.waitFor(
      () =>
        (setup.renderer.root.findDescendantById("config-declaration-body") as ScrollBoxRenderable)
          ?.scrollTop === offset,
    );
    await focusLive(setup, "config-declaration-body");
    await parsedEscape(setup);
    const list = (await focusLive(setup, "config-config-source-browser")) as SelectRenderable;
    expect(list.getSelectedOption()?.value).toBe("/configSources/1");
    await scope("project");
    expect(!!setup.renderer.root.findDescendantById("config-config-source-browser")).toBe(true);
    expect(!!setup.renderer.root.findDescendantById("config-declaration-body")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("Unreadable Config preserves the exact problem and exposes no mutation controls", async () => {
  const base = workspaceProjection();
  const state = createConfigState();
  state.land("global", "sources", "team-main");
  const setup = await testRender(
    () => (
      <ConfigPage
        config={state}
        destination="global"
        mode="wide"
        projection={() => ({
          ...base,
          configs: base.configs.map((config) =>
            config.level === "global"
              ? {
                  ...config,
                  file: {
                    status: "invalid",
                    file: "/global.jsonc",
                    problem: {
                      code: "CONFIG_PARSE_FAILED",
                      severity: "warning",
                      message: "Invalid JSONC at line 12",
                      location: { file: "/global.jsonc", pointer: "/sources/team-main" },
                    },
                  },
                }
              : config,
          ),
        })}
        actions={[
          {
            id: "add-source",
            verb: "Add Source",
            destination: "global",
            scope: "page",
            keys: ["enter"],
            enabled: true,
            danger: false,
          },
        ]}
        onSelect={() => {}}
        onAction={() => {
          throw new Error("Unexpected mutation");
        }}
        onContribution={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("CONFIG_PARSE_FAILED");
    expect(setup.captureCharFrame()).toContain("/sources/team-main");
    expect(!!setup.renderer.root.findDescendantById("config-command-add-source")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("config-command-check-updates")).toBe(false);
    expect(!!setup.renderer.root.findDescendantById("config-file-problem")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test("Settings contribution Back returns to its exact Config Source instead of categories", async () => {
  const base = workspaceProjection();
  const contributed = base.effective.sources.find((source) => !!source.contribution)!;
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            contributed: { ...config.contributed, sources: [contributed] },
            direct: {
              ...config.direct,
              configSources: config.direct.configSources.map((source) => ({
                ...source,
                contributed: { ...source.contributed, sources: [contributed] },
              })),
            },
          }
        : config,
    ),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openMainPage(setup, "settings");
    await openSettingsCategory(setup, "config-sources");
    await enterLive(setup, "config-config-source-browser");
    await enterLive(setup, "config-source-contributions");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-command-add-skills"),
    );
    await focusLive(setup, "config-declaration-body");
    await parsedEscape(setup);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-source-contributions"),
    );
    expect(setup.captureCharFrame()).toContain("team-config");
    expect(!!setup.renderer.root.findDescendantById("settings-categories")).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test.each([43, 80, 100, 132])(
  "Settings categories and declarations share the browser at %i columns",
  async (width) => {
    const base = workspaceProjection();
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore({
            ...base,
            configs: base.configs.map((config) =>
              config.level === "global"
                ? {
                    ...config,
                    direct: {
                      ...config.direct,
                      sources: base.configs
                        .find((item) => item.level === "project")!
                        .direct.sources.map((source) => ({
                          ...source,
                          ref: {
                            ...source.ref,
                            owner: { ...source.ref.owner, level: "global", file: config.file.file },
                          },
                        })),
                    },
                  }
                : config,
            ),
          })}
          exit={() => {}}
        />
      ),
      { width, height: width === 43 ? 13 : 24 },
    );
    try {
      await openMainPage(setup, "settings");
      expect(!!setup.renderer.root.findDescendantById("settings-categories")).toBe(true);
      expect(!!setup.renderer.root.findDescendantById("settings-section")).toBe(false);
      await enterLive(setup, "settings-categories");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("config-source-browser"));
      expect(!!setup.renderer.root.findDescendantById("settings-categories")).toBe(false);
      const browser = setup.renderer.root.findDescendantById("config-browser-pane")!;
      if (width >= 100) {
        expect(browser.width).toBe(38);
        const object = setup.renderer.root.findDescendantById("config-object-pane")!;
        expect(object.screenY).toBe(browser.screenY);
        expect(object.screenX).toBe(browser.screenX + browser.width + 1);
      } else expect(!!setup.renderer.root.findDescendantById("config-object-pane")).toBe(false);
      await enterLive(setup, "config-source-browser");
      expect(!!setup.renderer.root.findDescendantById("config-object-pane")).toBe(true);
      if (width < 100)
        expect(!!setup.renderer.root.findDescendantById("config-source-browser")).toBe(false);
      await mkdir("out/settings-workspace", { recursive: true });
      await setup.flush();
      await writeFile(`out/settings-workspace/declaration-${width}.txt`, setup.captureCharFrame());
      expect(setup.captureCharFrame()).toContain("team-main");
      expect(setup.captureCharFrame()).toContain("github");
      await parsedEscape(setup);
      if (width < 100) {
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("config-source-browser"),
        );
        await parsedEscape(setup);
      }
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("settings-categories"));
      await focusLive(setup, "settings-categories");
      for (let index = 0; index < 3; index++) {
        setup.mockInput.pressArrow("down");
        await setup.flush();
      }
      await setup.flush();
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("interface-browser-width"),
      );
      expect(!!setup.renderer.root.findDescendantById("shell-scope-select")).toBe(false);
      await parsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("settings-categories"));
    } finally {
      setup.renderer.destroy();
    }
  },
);
