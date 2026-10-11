import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import type { ManagementProjection } from "@skill-cli/core";
import { enterLive, parsedEnter } from "./reader-test-controls";

const diagnostic = (address: { readonly source: string; readonly path: string }, code: string) => ({
  code,
  severity: "warning" as const,
  message: code,
  subject: { kind: "installed-skill" as const, address },
});

async function openProblems(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-current-exposure"),
  );
  const currentExposure = setup.renderer.root.findDescendantById(
    "skills-view-tab-current-exposure",
  )!;
  currentExposure!.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === currentExposure);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  const all = setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills")!;
  all.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === all);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  const unassigned = setup.renderer.root.findDescendantById("skills-view-tab-unassigned")!;
  unassigned.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === unassigned);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.renderOnce();
  await setup.waitFor(
    () =>
      !!setup.renderer.root.findDescendantById("skills-view-tab-problems") &&
      !!setup.renderer.root.findDescendantById("problems-browser"),
  );
  const browser = setup.renderer.root.findDescendantById("problems-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}

async function openReader(setup: Awaited<ReturnType<typeof testRender>>) {
  const browser = setup.renderer.root.findDescendantById("problems-browser") as SelectRenderable;
  browser.focus();
  await parsedEnter(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
}

async function startSkillUpdate(setup: Awaited<ReturnType<typeof testRender>>) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "palette-navigate.workspace",
  );
  await enterLive(setup, "palette-skill-check-updates");
  if (!setup.renderer.root.findDescendantById("source-operation-selection"))
    throw new Error(setup.captureCharFrame());
  const selection = setup.renderer.root.findDescendantById(
    "source-operation-selection",
  ) as SelectRenderable;
  selection.focus();
  selection.setSelectedIndex(0);
  await parsedEnter(setup);
  await enterLive(setup, "source-operation-submit");
  await setup.waitFor(
    () => setup.renderer.root.findDescendantById("source-operation-selection") === undefined,
  );
}

function problemProjection(
  base: ManagementProjection,
  refreshed: "reorder" | "fallback" | "empty",
) {
  const first = diagnostic(base.installedSkills[0]!.address, "FIRST");
  const second = diagnostic(base.installedSkills[1]!.address, "SECOND");
  const initial: ManagementProjection = {
    ...base,
    installedSkills: [
      { ...base.installedSkills[0]!, problems: [first] },
      { ...base.installedSkills[1]!, problems: [] },
    ],
  };
  const next: ManagementProjection =
    refreshed === "reorder"
      ? {
          ...base,
          installedSkills: [
            { ...base.installedSkills[1]!, problems: [second] },
            { ...base.installedSkills[0]!, problems: [first] },
          ],
        }
      : refreshed === "fallback"
        ? {
            ...base,
            installedSkills: [
              { ...base.installedSkills[0]!, problems: [] },
              { ...base.installedSkills[1]!, problems: [second] },
            ],
          }
        : { ...base, installedSkills: [] };
  return { initial, next };
}

for (const refreshed of ["reorder", "fallback", "empty"] as const) {
  test(`RENDER Problems refresh ${refreshed} synchronizes Inspector and Reader`, async () => {
    const base = readerProjection();
    const projections = problemProjection(base, refreshed);
    let current = projections.initial;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(current, {
            get: async () => ({ value: current, diagnostics: [] }),
            checkUpdate: async (request) => ({
              value: {
                source: request.source,
                kind: "github" as const,
                changed: [{ path: "guide", name: "guide", description: "guide" }],
                added: [],
                removed: [],
                unchanged: [],
              },
              diagnostics: [],
            }),
            update: async () => {
              current = projections.next;
              return { value: undefined, diagnostics: [] };
            },
            loadInstalled: async ({ address }) => ({
              value: { ...readerContent, address },
              diagnostics: [],
            }),
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openProblems(setup);
      await openReader(setup);
      await startSkillUpdate(setup);
      if (refreshed === "reorder") {
        await setup.waitForFrame((frame) => frame.includes("Reader · guide"));
        expect(setup.captureCharFrame()).toContain("Reader · guide");
      } else if (refreshed === "fallback") {
        await setup.waitForFrame((frame) => frame.includes("Reader · reference"));
        expect(setup.captureCharFrame()).toContain("Reader · reference");
      } else {
        await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
        expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
      }
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("RENDER Problems routes integration diagnostics to Config Integrations", async () => {
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/integrations/opencode",
  };
  const base = readerProjection();
  const current: ManagementProjection = {
    ...base,
    diagnostics: [
      {
        code: "CONFIG_INVALID",
        severity: "warning",
        message: "integration is unavailable",
        subject: { kind: "config", owner },
      },
    ],
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              integrations: [{ kind: "opencode" as const, owner }],
            },
          }
        : config,
    ),
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(current, {
          get: async () => ({ value: current, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openProblems(setup);
    await setup.waitForFrame((frame) => frame.includes("-> Config Integrations"));
    expect(setup.captureCharFrame()).toContain("-> Config Integrations");
  } finally {
    setup.renderer.destroy();
  }
});
