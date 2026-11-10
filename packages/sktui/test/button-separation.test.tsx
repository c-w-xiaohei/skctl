/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import {
  InputRenderable,
  type BaseRenderable,
  type Renderable,
  SelectRenderable,
} from "@opentui/core";
import { ButtonRenderable } from "@tuiparts/core/button";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import {
  InstalledSkillPreviewFailureOverlay,
  MembershipRemovalPlanOverlay,
  CollectionCreateOverlay,
} from "../src/operations";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  parsedEnter,
  type ReaderSetup,
} from "./reader-test-controls";
const descendants = (node: BaseRenderable): BaseRenderable[] => [
  node,
  ...node.getChildren().flatMap(descendants),
];
function visible(node: Renderable): boolean {
  for (let current: BaseRenderable | null = node; current; current = current.parent)
    if (!current.visible) return false;
  return node.width > 0 && node.height > 0;
}
function separated(setup: ReaderSetup, id: string, minimum = 2) {
  const buttons = descendants(live(setup, id)).filter(
    (node): node is ButtonRenderable => node instanceof ButtonRenderable && visible(node),
  );
  expect(buttons.length).toBeGreaterThanOrEqual(minimum);
  for (const [index, left] of buttons.entries())
    for (const right of buttons.slice(index + 1)) {
      const apart =
        left.screenX + left.width + 1 <= right.screenX ||
        right.screenX + right.width + 1 <= left.screenX ||
        left.screenY + left.height + 1 <= right.screenY ||
        right.screenY + right.height + 1 <= left.screenY;
      expect(apart, `${left.id} touches ${right.id} in ${id}`).toBe(true);
    }
  return buttons;
}
async function revealCommands(setup: ReaderSetup, buttons: readonly ButtonRenderable[]) {
  for (const button of buttons) {
    if (!button.focusable) continue;
    await focusLive(setup, button.id);
    await setup.flush();
    const current = live(setup, button.id);
    const content = live(setup, "route-content");
    expect(current.screenY).toBeGreaterThanOrEqual(content.screenY);
    expect(current.screenY + current.height).toBeLessThanOrEqual(content.screenY + content.height);
  }
}
async function capture(setup: ReaderSetup, name: string) {
  const output = process.env.BUTTON_CAPTURE_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${name}.txt`), setup.captureCharFrame());
  await writeFile(
    join(output, `${name}.spans.json`),
    JSON.stringify(setup.captureSpans(), null, 2),
  );
}
async function mount(width: number, height = 24, adoptedConfig = false, agentCatalog = false) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/button-separation-");
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const base = collectionsSourcesProjection();
  const projection: WorkspaceView =
    agentCatalog && base.effective.status === "complete"
      ? {
          ...base,
          effective: {
            ...base.effective,
            agent: { ...base.effective.agent, status: "available" },
            use: ["team"],
          },
        }
      : adoptedConfig
        ? {
            ...base,
            configs: base.configs.map((config) =>
              config.level !== "global"
                ? config
                : {
                    ...config,
                    direct: {
                      ...config.direct,
                      configSources: config.direct.configSources.map((source) => ({
                        ...source,
                        binding: {
                          kind: "github",
                          origin: "https://github.com/acme/config",
                          root: ".",
                          ref: "main",
                        },
                        adoption: { status: "adopted", commit: "a".repeat(40) },
                      })),
                    },
                  },
            ),
          }
        : base;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => ({
            address,
            name: address.path,
            description: "Installed instructions",
            rawText: "Installed instructions",
            markdownText: "Installed instructions",
          }),
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await setup.flush();
  return {
    setup,
    async dispose() {
      setup.renderer.destroy();
      if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
      await rm(cache, { recursive: true, force: true });
    },
  };
}
test.each([144, 80, 43])(
  "Source command groups separate adjacent and wrapped buttons at %i columns",
  async (width) => {
    const mounted = await mount(width);
    const { setup } = mounted;
    try {
      await openMainPage(setup, "updates");
      await enterLive(setup, "updates-browser");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
      setup.mockInput.pressKey("p", { ctrl: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
      const choices = live(setup, "palette-choices") as SelectRenderable;
      const index = choices.options.findIndex(
        (option) => option.value.id === "source-updates.source-details",
      );
      expect(index).toBeGreaterThanOrEqual(0);
      choices.setSelectedIndex(index);
      await parsedEnter(setup);
      await setup.flush();
      separated(setup, "source-content-controls-pane");
      await revealCommands(setup, separated(setup, "source-management-pane"));
      await capture(setup, `source-${width}`);
    } finally {
      await mounted.dispose();
    }
  },
);
test.each([144, 80, 43])(
  "Reader management buttons remain distinct after wrapping at %i columns",
  async (width) => {
    const mounted = await mount(width);
    const { setup } = mounted;
    try {
      await openAllInstalledSkills(setup);
      await parsedEnter(setup);
      await enterLive(setup, "reader-more");
      await setup.flush();
      const menu = live(setup, "reader-more-dialog");
      const source = live(setup, "reader-menu-skill-rebind");
      const uninstall = live(setup, "reader-menu-skill-uninstall");
      expect(uninstall.screenY - source.screenY).toBeGreaterThanOrEqual(2);
      expect(menu.width).toBeLessThanOrEqual(32);
      expect(setup.captureCharFrame()).toContain("Content");
      await capture(setup, `reader-management-${width}`);
    } finally {
      await mounted.dispose();
    }
  },
);
test.each([100, 43])(
  "Config destructive command group has separate button surfaces at %i columns",
  async (width) => {
    const mounted = await mount(width, 24, true);
    const { setup } = mounted;
    try {
      await openMainPage(setup, "settings");
      await enterLive(setup, "shell-scope-select");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("scope-choices"));
      const choices = live(setup, "scope-choices") as SelectRenderable;
      const index = choices.options.findIndex((option) => option.value === "global");
      expect(index).toBeGreaterThanOrEqual(0);
      choices.setSelectedIndex(index);
      await parsedEnter(setup);
      await openSettingsCategory(setup, "config-sources");
      await enterLive(setup, "config-config-source-browser");
      await setup.flush();
      await revealCommands(setup, separated(setup, "config-source-inspector"));
      await capture(setup, `config-source-${width}`);
    } finally {
      await mounted.dispose();
    }
  },
);
test("short Agent access recovery separates commands and reveals each focused button", async () => {
  const mounted = await mount(43, 13, false, true);
  const { setup } = mounted;
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "agent-view-tab-catalog");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("agent-access-pane"));
    const buttons = separated(setup, "agent-catalog-actions");
    for (const button of buttons) {
      if (!button.focusable) continue;
      await focusLive(setup, button.id);
      await setup.flush();
      const pane = live(setup, "agent-access-pane");
      expect(button.screenY).toBeGreaterThan(pane.screenY);
      expect(button.screenY + button.height).toBeLessThanOrEqual(pane.screenY + pane.height - 1);
    }
    await capture(setup, "agent-recovery-43x13");
  } finally {
    await mounted.dispose();
  }
});
test.each([80, 43])(
  "modal Cancel and Retry are separated without changing native traversal at %i columns",
  async (width) => {
    let retries = 0;
    const setup = await testRender(
      () => (
        <InstalledSkillPreviewFailureOverlay
          request={{ kind: "uninstall", address: { source: "team-main", path: "guide" } }}
          pending={false}
          cancelling={false}
          onCancel={() => {}}
          onRetry={() => {
            retries++;
          }}
        />
      ),
      { width, height: 13 },
    );
    try {
      await setup.flush();
      const cancel = live(setup, "installed-skill-preview-failure-cancel");
      const retry = live(setup, "installed-skill-preview-failure-retry");
      expect(retry.screenY).toBe(cancel.screenY);
      expect(retry.screenX - cancel.screenX - cancel.width).toBeGreaterThanOrEqual(1);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(cancel.id);
      setup.mockInput.pressTab();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === retry);
      await parsedEnter(setup);
      expect(retries).toBe(1);
      await capture(setup, `modal-${width}x13`);
    } finally {
      setup.renderer.destroy();
    }
  },
);
test("review-plan button spacing leaves a non-activating gap and keeps Cancel-first traversal", async () => {
  let continued = 0;
  const setup = await testRender(
    () => (
      <MembershipRemovalPlanOverlay
        plan={{
          collection: "team",
          rows: [],
          removals: [],
          ownerGroups: [],
          explanations: [],
          executable: false,
        }}
        review={{
          kind: "collection-use",
          id: "spacing",
          intent: { kind: "collection-use", level: "project", collections: [] },
          impact: {
            kind: "collection-use",
            owner: { level: "project", file: "/config.jsonc", pointer: "/use" },
            oldCollections: [],
            newCollections: [],
            newlyExposed: [],
            removedAtOwner: [],
            alternateOwners: [],
            affectedSelectors: [],
            retained: [],
            currentComplete: true,
            blockers: [],
            proposedComplete: true,
            allowed: true,
          },
        }}
        pending={false}
        onSelect={() => {}}
        onConfirm={() => {
          continued++;
        }}
        onCancel={() => {}}
      />
    ),
    { width: 43, height: 13 },
  );
  try {
    await setup.flush();
    const cancel = live(setup, "membership-removal-plan");
    const next = live(setup, "collection-review-confirm");
    expect(next.screenX - cancel.screenX - cancel.width).toBeGreaterThanOrEqual(1);
    expect(setup.renderer.currentFocusedRenderable === cancel).toBe(true);
    await setup.mockMouse.click(cancel.screenX + cancel.width, cancel.screenY);
    expect(continued).toBe(0);
    await focusLive(setup, cancel.id);
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === next);
    await parsedEnter(setup);
    expect(continued).toBe(1);
    await capture(setup, "review-plan-43x13");
  } finally {
    setup.renderer.destroy();
  }
});
test("resizing a spaced form keeps its focused command visible without losing the draft", async () => {
  const setup = await testRender(
    () => (
      <CollectionCreateOverlay
        allowedLevels={["global", "project", "local"]}
        collection="spacing-draft"
        pending={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    ),
    { width: 144, height: 40 },
  );
  try {
    await setup.flush();
    const cancel = await focusLive(setup, "collection-create-cancel");
    await setup.flush();
    setup.resize(43, 13);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable === cancel).toBe(true);
    expect(cancel.screenY).toBeGreaterThanOrEqual(0);
    expect(cancel.screenY + cancel.height).toBeLessThanOrEqual(13);
    expect((live(setup, "collection-create-id") as InputRenderable).value).toBe("spacing-draft");
    expect(setup.captureCharFrame()).toContain("›Cancel");
    await capture(setup, "create-resized-43x13");
  } finally {
    setup.renderer.destroy();
  }
});
import { openSettingsCategory } from "./settings-test-controls";
