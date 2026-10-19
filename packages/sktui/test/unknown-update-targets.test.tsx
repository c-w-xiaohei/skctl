/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { SkctlError, type WorkspaceView } from "@skctl/core";
import { SelectRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { createRoot, createSignal } from "solid-js";
import { CommandPalette } from "../src/command-palette";
import { createCommandRegistry } from "../src/commands";
import { createFocusRegistry } from "../src/focus";
import { createUpdateController } from "../src/updates/controller";
import { updateFeedback } from "../src/updates/feedback";
import { buildUpdateScope, createUpdatesState } from "../src/updates/model";
import { SourceUpdatesPage, UpdatesPage } from "../src/updates/page";
import type { UpdateAddress } from "../src/updates/scope";
import type { UpdateRun } from "../src/updates/state";
import { workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter } from "./reader-test-controls";
const source = "team-main";
const first = { source, path: "guides/alpha" };
const second = { source, path: "guides/bravo" };
const other = { source: "other", path: "guides/alpha" };
const key = (address: UpdateAddress) => `${address.source}\0${address.path}`;
type Setup = Awaited<ReturnType<typeof testRender>>;
function fixture(
  paths = [first.path, second.path],
  failure: "unknown" | "check" | "metadata" | "ownership" = "unknown",
) {
  return createRoot((dispose) => {
    const base = workspaceProjection({ includeContribution: false });
    const projection: WorkspaceView = {
      ...base,
      installedSkills: paths.map((path) => ({
        address: { source, path },
        // Deliberately identical names: recovery must retain the path, not just a label.
        name: "Guide",
        description: "Installed guide",
        owner: { source, health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    };
    const state = createUpdatesState(buildUpdateScope(projection, { kind: "workspace" }));
    const checks: string[] = [];
    const updates: Parameters<typeof import("@skctl/core").updateSkills>[1][] = [];
    const controller = createUpdateController(
      {
        getWorkspace: async () => ({
          value:
            failure === "ownership"
              ? {
                  ...projection,
                  installedSkills: projection.installedSkills.map((skill, index) =>
                    index
                      ? skill
                      : { ...skill, owner: { ...skill.owner, health: "drifted" as const } },
                  ),
                }
              : projection,
          diagnostics: [],
        }),
        checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
          checks.push(source);
          if (failure === "check") throw new Error("Source unavailable");
          return {
            value: {
              source,
              kind: "github",
              exactRevision: "a".repeat(40),
              baseline: "checked-baseline",
              changed: paths.map((path) => ({ path, name: "Guide", description: "Changed" })),
              unchanged: [],
              removed: [],
              added: [],
            },
            diagnostics: [],
          };
        },
        updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
          updates.push(request);
          if (failure === "metadata")
            throw new SkctlError("INVALID_ARGUMENT", "Invalid SKILL.md", [
              {
                code: "UPDATE_NOT_APPLIED",
                severity: "warning",
                message: "Rejected before publication",
                subject: { kind: "installed-skill", address: { source, path: paths[0]! } },
              },
            ]);
          throw new Error("Publication receipt unavailable");
        },
      },
      state,
    );
    return {
      state,
      controller,
      checks,
      updates,
      skills: projection.installedSkills,
      commands: createCommandRegistry(() => []),
      dispose() {
        controller.teardown();
        dispose();
      },
    };
  });
}
test.each([1, 2])(
  "unknown feedback retains all %i targets from an actual atomic Source call",
  async (count) => {
    const data = fixture([first.path, second.path].slice(0, count));
    try {
      expect(await data.controller.submit()).toBe(false);
      const notices = updateFeedback(
        data.state.scope.addresses,
        data.state.groups(),
        data.controller.run(),
      );
      expect(data.checks).toEqual([source]);
      expect(data.updates).toEqual([
        {
          source,
          paths: [first.path, second.path].slice(0, count),
          exactRevision: "a".repeat(40),
          expectedBaseline: "checked-baseline",
        },
      ]);
      expect(notices.map((notice) => notice.address)).toEqual([first, second].slice(0, count));
      expect(notices).toHaveLength(count);
      for (const notice of notices) {
        expect(notice.recovery).toBe("inspect-skill");
        expect(notice.detail).toContain("Publication receipt unavailable");
        expect(notice.body).not.toMatch(/kept|rollback/i);
      }
      expect(data.controller.retryable()).toEqual([]);
    } finally {
      data.dispose();
    }
  },
);
test("unknown feedback retains missing diagnostics, distinct messages and exact bounded targets without duplicate notices", () => {
  const results: UpdateRun["results"] = [
    { address: first, status: "unknown", message: "alpha diagnostic" },
    { address: second, status: "unknown" },
    { address: first, status: "unknown", message: "alpha diagnostic" },
    {
      address: first,
      status: "unknown",
      message: "alpha follow-up",
      issue: { kind: "metadata", address: second },
    },
    { address: other, status: "unknown", message: "out of scope" },
  ];
  const notices = updateFeedback(
    [first, second],
    [{ source, status: "cancelled", expanded: false, error: "same uncertain batch" }],
    { phase: "settled", addresses: [first, second, other], results },
  );
  expect(notices.map((notice) => notice.address)).toEqual([first, second]);
  expect(notices[0]!.detail).toBe("alpha diagnostic\n\nalpha follow-up");
  expect(notices[1]!.detail).toBe("same uncertain batch");
  expect(notices.every((notice) => notice.recovery === "inspect-skill")).toBe(true);
  expect(notices.map((notice) => notice.body).join(" ")).not.toMatch(/kept|rollback/i);
  expect(
    updateFeedback([second], [], { phase: "settled", addresses: [first, second, other], results }),
  ).toMatchObject([
    {
      address: second,
      recovery: "inspect-skill",
      detail: expect.stringContaining("not confirmed"),
    },
  ]);
});
async function mountPage(
  data: ReturnType<typeof fixture>,
  options: {
    sourceView?: boolean;
    width?: number;
    height?: number;
    inspectSkill?: boolean;
    inspectSource?: boolean;
    run?: () => UpdateRun | undefined;
  } = {},
) {
  const inspected: UpdateAddress[] = [];
  const sources: string[] = [];
  const checks: (readonly string[] | undefined)[] = [];
  const updates: (readonly UpdateAddress[])[] = [];
  const [palette, setPalette] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<"all" | "updates">("all");
  const common = {
    state: data.state,
    skills: data.skills,
    run: options.run ?? data.controller.run,
    active: data.controller.active,
    onCheck: (targets?: readonly string[]) => {
      checks.push(targets);
    },
    onUpdate: (targets: readonly UpdateAddress[]) => {
      updates.push(targets);
    },
    onStop: () => {
      data.controller.stop();
    },
    onInspectSkill:
      options.inspectSkill === false
        ? undefined
        : (address: UpdateAddress) => {
            inspected.push(address);
          },
    onInspectSource:
      options.inspectSource === false
        ? undefined
        : (source: string) => {
            sources.push(source);
          },
    focusRegistry: createFocusRegistry(),
    registerCommand: data.commands.register,
  };
  const setup = await testRender(
    () => (
      <>
        {options.sourceView ? (
          <SourceUpdatesPage
            {...common}
            source={source}
            query={query()}
            filter={filter()}
            onQuery={setQuery}
            onFilter={setFilter}
            onSourceDetails={() => sources.push(source)}
          />
        ) : (
          <UpdatesPage {...common} />
        )}
        <CommandPalette
          open={palette()}
          actions={data.commands.records()}
          onSelect={(record) => {
            setPalette(false);
            data.commands.execute(record.id);
          }}
          onClose={() => setPalette(false)}
        />
      </>
    ),
    { width: options.width ?? 80, height: options.height ?? 24, kittyKeyboard: true },
  );
  await setup.flush();
  const prefix = options.sourceView ? "source-updates" : "updates";
  return {
    setup,
    inspected,
    sources,
    checks,
    updates,
    prefix,
    setPalette,
    setQuery,
    query,
    filter,
  };
}
async function chooseRecovery(page: Awaited<ReturnType<typeof mountPage>>) {
  page.setPalette(true);
  await page.setup.waitFor(
    () => page.setup.renderer.currentFocusedRenderable?.id === "palette-choices",
  );
  const choices = page.setup.renderer.currentFocusedRenderable as SelectRenderable;
  const index = choices.options.findIndex(
    (option) => option.value.id === `${page.prefix}.feedback-recover`,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  choices.setSelectedIndex(index);
  await page.setup.renderOnce();
  await parsedEnter(page.setup);
  await page.setup.flush();
}
function diagnosticText(setup: Setup, prefix: string) {
  const pane = setup.renderer.root.findDescendantById(`${prefix}-feedback-pane`)!;
  return pane
    .getChildren()
    .filter((node): node is TextRenderable => node instanceof TextRenderable)
    .map((node) => node.plainText)
    .join("\n");
}
test.each([
  [80, 24],
  [43, 13],
])(
  "RENDER unknown recovery follows the current Skill for keyboard, pointer and Actions at %ix%i",
  async (width, height) => {
    const data = fixture();
    await data.controller.submit();
    data.state.toggle(first);
    const page = await mountPage(data, { sourceView: true, width, height });
    const { setup } = page;
    try {
      expect(
        data.commands.resolve("source-updates.feedback-recover")!.record.destination,
      ).toContain(first.path);
      expect(data.commands.resolve("source-updates.feedback-recover")!.record.verb).toBe(
        "Inspect Skill",
      );
      const recovery = setup.renderer.root.findDescendantById("source-updates-feedback-recover")!;
      expect(recovery).toBeInstanceOf(ButtonRenderable);
      expect(recovery.screenY + recovery.height).toBeLessThanOrEqual(height);
      await enterLive(setup, recovery.id);
      expect(page.inspected).toEqual([first]);
      await focusLive(setup, "source-updates-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => data.state.sourcePosition(source)?.currentKey === key(second));
      await setup.flush();
      expect(
        data.commands.resolve("source-updates.feedback-recover")!.record.destination,
      ).toContain(second.path);
      const secondRecovery = setup.renderer.root.findDescendantById(
        "source-updates-feedback-recover",
      )!;
      await setup.mockMouse.click(secondRecovery.screenX + 1, secondRecovery.screenY);
      await setup.flush();
      expect(page.inspected).toEqual([first, second]);
      // A pointer-selected row retargets the same registered recovery command.
      const firstRow = setup.renderer.root.findDescendantById(
        `source-updates-browser-row-${encodeURIComponent(key(first))}`,
      )!;
      await setup.mockMouse.click(firstRow.screenX + 8, firstRow.screenY);
      await setup.waitFor(() => data.state.sourcePosition(source)?.currentKey === key(first));
      await chooseRecovery(page);
      expect(page.inspected).toEqual([first, second, first]);
      await focusLive(setup, "source-updates-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => data.state.sourcePosition(source)?.currentKey === key(second));
      await chooseRecovery(page);
      expect(page.inspected).toEqual([first, second, first, second]);
      // Filtering changes the visible current item, not the checked batch or receipt.
      page.setQuery(second.path);
      await setup.flush();
      expect(data.commands.execute("source-updates.feedback-details")).toBe(true);
      await setup.flush();
      expect(diagnosticText(setup, page.prefix)).toContain(second.path);
      expect(diagnosticText(setup, page.prefix)).toContain("Publication receipt unavailable");
      expect(
        data.commands.resolve("source-updates.feedback-recover")!.record.destination,
      ).toContain(second.path);
      expect(data.commands.execute("source-updates.feedback-details")).toBe(true);
      await setup.flush();
      expect(data.state.sourcePosition(source)?.currentKey).toBe(key(second));
      expect(page.query()).toBe(second.path);
      expect(data.state.selected()).toEqual([first]);
      expect(page.checks).toEqual([]);
      expect(page.updates).toEqual([]);
      expect(page.sources).toEqual([]);
      expect(data.checks).toEqual([source]);
      expect(data.updates).toHaveLength(1);
    } finally {
      setup.renderer.destroy();
      data.dispose();
    }
  },
);
test.each([1, 2])(
  "RENDER overview keeps a usable exact unknown target for %i results without rechecking",
  async (count) => {
    const data = fixture([first.path, second.path].slice(0, count));
    await data.controller.submit();
    const page = await mountPage(data);
    try {
      const record = data.commands.resolve("updates.feedback-recover")!.record;
      expect(record.destination).toContain(first.path);
      expect(record.verb).toBe("Inspect Skill");
      expect(
        data.commands.records().filter((record) => record.id === "updates.feedback-recover"),
      ).toHaveLength(1);
      await chooseRecovery(page);
      expect(page.inspected).toEqual([first]);
      expect(page.checks).toEqual([]);
      expect(page.updates).toEqual([]);
      expect(data.checks).toEqual([source]);
      expect(data.updates).toHaveLength(1);
    } finally {
      page.setup.renderer.destroy();
      data.dispose();
    }
  },
);
test.each([true, false])(
  "RENDER missing-message unknown still offers exact Skill inspection with Source diagnostic=%s",
  async (groupDiagnostic) => {
    const data = fixture([first.path]);
    await data.controller.submit();
    if (!groupDiagnostic) data.state.setStatus(source, "partial");
    const run = data.controller.run()!;
    const page = await mountPage(data, {
      sourceView: true,
      run: () => ({
        ...run,
        results: run.results.map((result) => ({ ...result, message: undefined })),
      }),
    });
    try {
      expect(data.commands.resolve("source-updates.feedback-recover")!.record.verb).toBe(
        "Inspect Skill",
      );
      await chooseRecovery(page);
      expect(page.inspected).toEqual([first]);
      data.commands.execute("source-updates.feedback-details");
      await page.setup.flush();
      expect(diagnosticText(page.setup, page.prefix)).toContain(
        groupDiagnostic ? "Publication receipt unavailable" : "No diagnostic was returned",
      );
      expect(page.checks).toEqual([]);
      expect(page.updates).toEqual([]);
    } finally {
      page.setup.renderer.destroy();
      data.dispose();
    }
  },
);
test.each([true, false])(
  "RENDER absent Skill inspection names the exact target and Source fallback availability=%s",
  async (inspectSource) => {
    const data = fixture([first.path]);
    await data.controller.submit();
    const page = await mountPage(data, { sourceView: true, inspectSkill: false, inspectSource });
    try {
      const record = data.commands.resolve("source-updates.feedback-recover")!.record;
      expect(record.verb).toBe("Open Source");
      expect(record.destination).toContain(first.path);
      expect(record.enabled).toBe(inspectSource);
      if (!inspectSource) expect(record.disabledReason).toContain("inspection unavailable");
      await chooseRecovery(page);
      expect(page.sources).toEqual(inspectSource ? [source] : []);
      expect(page.inspected).toEqual([]);
      expect(page.checks).toEqual([]);
      expect(page.updates).toEqual([]);
      expect(data.updates).toHaveLength(1);
    } finally {
      page.setup.renderer.destroy();
      data.dispose();
    }
  },
);
test("RENDER a current successful sibling does not inherit another Skill's unknown recovery", async () => {
  const data = fixture();
  await data.controller.submit();
  const run = data.controller.run()!;
  const page = await mountPage(data, {
    sourceView: true,
    run: () => ({ ...run, results: [run.results[0]!, { address: second, status: "updated" }] }),
  });
  try {
    await focusLive(page.setup, "source-updates-browser");
    page.setup.mockInput.pressArrow("down");
    await page.setup.waitFor(() => data.state.sourcePosition(source)?.currentKey === key(second));
    expect(data.commands.resolve("source-updates.feedback-recover")).toBeUndefined();
    expect(page.inspected).toEqual([]);
    expect(page.checks).toEqual([]);
    expect(data.state.selected()).toEqual([]);
  } finally {
    page.setup.renderer.destroy();
    data.dispose();
  }
});
test.each(["check", "metadata", "ownership"] as const)(
  "RENDER ordinary %s failures retain their explicit recovery, deduplicated per Source",
  async (failure) => {
    const data = fixture(undefined, failure);
    await data.controller.submit();
    const page = await mountPage(data);
    try {
      const notices = updateFeedback(
        data.state.scope.addresses,
        data.state.groups(),
        data.controller.run(),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]!.recovery).toBe(
        failure === "check"
          ? "recheck"
          : failure === "metadata"
            ? "inspect-source"
            : "inspect-skill",
      );
      await chooseRecovery(page);
      expect(page.checks).toEqual(failure === "check" ? [[source]] : []);
      expect(page.sources).toEqual(failure === "metadata" ? [source] : []);
      expect(page.inspected).toEqual(failure === "ownership" ? [first] : []);
      expect(page.updates).toEqual([]);
      expect(data.updates).toHaveLength(failure === "metadata" ? 1 : 0);
      expect(data.checks).toEqual(failure === "ownership" ? [] : [source]);
    } finally {
      page.setup.renderer.destroy();
      data.dispose();
    }
  },
);
