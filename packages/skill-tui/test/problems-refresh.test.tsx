import { expect, test } from "bun:test";
import { SelectRenderable, TextRenderable } from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection, readerSecondContent } from "./installed-reader.fixture";
import type { WorkspaceView } from "@skill-cli/core";
import { enterLive, live, waitForReaderBody } from "./reader-test-controls";
const diagnostic = (
  address: {
    readonly source: string;
    readonly path: string;
  },
  code: string,
) => ({
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
function problemProjection(base: WorkspaceView, refreshed: "reorder" | "fallback" | "empty") {
  const first = diagnostic(base.installedSkills[0]!.address, "FIRST");
  const second = diagnostic(base.installedSkills[1]!.address, "SECOND");
  const initial: WorkspaceView = {
    ...base,
    installedSkills: [
      { ...base.installedSkills[0]!, problems: [first] },
      { ...base.installedSkills[1]!, problems: [] },
    ],
  };
  const next: WorkspaceView =
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
  test(`RENDER Problems refresh ${refreshed} returns through route predecessors`, async () => {
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
            getWorkspace: async () => {
              receipt = current;
              return { value: current, diagnostics: [] };
            },
            checkUpdate: async (_environment: import("@skill-cli/core").CoreOptions, request) => ({
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
            updateSkills: async (_environment: import("@skill-cli/core").CoreOptions, request) => {
              updates.push(request);
              current = projections.next;
              return { value: undefined, diagnostics: [] };
            },
            loadInstalledSkill: async (
              _environment: import("@skill-cli/core").CoreOptions,
              { address },
            ) => (address.path === "guide" ? readerContent : readerSecondContent),
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
        await waitForReaderBody(setup, "needle in prose");
        expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
        await enterLive(setup, "route-back");
        const problems = live(setup, "problems-browser") as SelectRenderable;
        expect(problems.options).toHaveLength(1);
        const selected = problems.getSelectedOption()!;
        expect(selected.name.trimEnd()).toBe("warning: Installed Skill team-main/reference");
        expect(selected.description.trimEnd()).toBe("SECOND");
        expect(JSON.parse(selected.value).intent).toEqual({
          kind: "installed-skill",
          address: { source: "team-main", path: "reference" },
        });
        expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
        await enterLive(setup, "problems-browser");
        await waitForReaderBody(setup, "other needle");
        expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("reference");
      } else {
        expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
        expect(live(setup, "route-back").id).toBe("route-back");
        await enterLive(setup, "route-back");
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
  const current: WorkspaceView = {
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
          getWorkspace: async () => ({ value: current, diagnostics: [] }),
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
