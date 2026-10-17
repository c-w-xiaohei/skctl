import { expect, test } from "bun:test";
import { SelectRenderable, TextRenderable } from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerSecondContent } from "./installed-reader.fixture";
import type { ManagementProjection } from "@skill-cli/core";
import { enterLive, live, waitForReaderBody } from "./reader-test-controls";

const diagnostic = (address: { readonly source: string; readonly path: string }, code: string) => ({
  code,
  severity: "warning" as const,
  message: code,
  subject: { kind: "installed-skill" as const, address },
});

async function openProblems(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-view-tab-problems"));
  await enterLive(setup, "skills-view-tab-problems");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("problems-browser"));
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
  test(`RENDER Problems refresh ${refreshed} reconciles Problems and Reader`, async () => {
    const base = readerProjection();
    const projections = problemProjection(base, refreshed);
    let current = projections.initial;
    let receipt = current;
    const updates: unknown[] = [];
    const exactRevision = "a".repeat(40);
    const baseline = "problems-baseline";
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(current, {
            get: async () => {
              receipt = current;
              return { value: current, diagnostics: [] };
            },
            checkUpdate: async (request) => ({
              value: {
                source: request.source,
                kind: "github" as const,
                exactRevision,
                baseline,
                changed: [{ path: "guide", name: "guide", description: "guide" }],
                added: [],
                removed: [],
                unchanged: [],
              },
              diagnostics: [],
            }),
            update: async (request) => {
              updates.push(request);
              current = projections.next;
              return { value: undefined, diagnostics: [] };
            },
            loadInstalled: async ({ address }) => ({
              value: address.path === "guide" ? readerContent : readerSecondContent,
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
      await enterLive(setup, "problems-browser");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
      await waitForReaderBody(setup, "needle in prose");
      expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
      await enterLive(setup, "reader-action-skill-check-updates");
      await setup.waitFor(() => receipt === projections.next);
      await setup.waitForFrame((frame) => frame.includes("Updated 1 Skill"));
      expect(updates).toEqual([
        { source: "team-main", paths: ["guide"], exactRevision, expectedBaseline: baseline },
      ]);
      await enterLive(setup, "route-back");
      if (refreshed === "reorder") {
        await waitForReaderBody(setup, "needle in prose");
        expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
      } else if (refreshed === "fallback") {
        await waitForReaderBody(setup, "other needle");
        expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("reference");
      } else {
        await setup.waitForFrame((frame) => frame.includes("No Problems"));
        expect((live(setup, "problems-browser") as SelectRenderable).options).toEqual([]);
        expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
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
    await setup.waitForFrame(
      (frame) =>
        frame.includes("warning: integrations") && frame.includes("integration is unavailable"),
    );
    const problem = (live(setup, "problems-browser") as SelectRenderable).getSelectedOption()!;
    expect(problem.name.trimEnd()).toBe("warning: integrations");
    expect(problem.description.trimEnd()).toBe("integration is unavailable");
    await enterLive(setup, "problems-browser");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-integrations-browser"),
    );
    expect(
      (live(setup, "shell-section-project-tab-integrations") as TabsTabRenderable).getState()
        .selected,
    ).toBe(true);
    const integration = (
      live(setup, "config-integrations-browser") as SelectRenderable
    ).getSelectedOption()!;
    expect(integration.name.trimEnd()).toBe("Managed OpenCode · Direct");
    expect(integration.description.trimEnd()).toBe(`${owner.level} ${owner.file} ${owner.pointer}`);
  } finally {
    setup.renderer.destroy();
  }
});
