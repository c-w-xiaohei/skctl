/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import {
  DiffRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type {
  CoreOptions,
  OperationOptions,
  OperationResult,
  UpdateObservation,
  WorkspaceView,
  UpdatePreview,
} from "@skctl/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";
const revision = "a".repeat(40);
const address = { source: "team-main", path: "guide" };
const readyPreview: UpdatePreview = {
  address,
  status: "ready",
  targetRevision: revision,
  removed: false,
  files: [
    {
      path: "SKILL.md",
      status: "modified",
      content: { kind: "text", before: "Installed\n", after: "Checked\n" },
    },
  ],
};
async function mount(
  previewUpdate: typeof import("@skctl/core").previewUpdate,
  checkUpdate: typeof import("@skctl/core").checkUpdate = async (_environment, { source }) => ({
    value: {
      source,
      kind: "github",
      exactRevision: revision,
      baseline: "checked-baseline",
      changed: [{ path: address.path, name: "Guide", description: "Updated Skill" }],
      unchanged: [],
      removed: [],
      added: [],
    },
    diagnostics: [],
  }),
  initialStatus = "Updates available",
  options: {
    readonly width?: number;
    readonly skillPaths?: readonly string[];
    readonly otherSource?: boolean;
    readonly update?: typeof import("@skctl/core").updateSkills;
  } = {},
) {
  const prior = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/updates-return-");
  process.env.SKTUI_UPDATE_SCHEDULE_DIR = cache;
  const base = workspaceProjection({ includeContribution: false });
  const sources = options.otherSource
    ? [...base.effective.sources, { ...base.effective.sources[0]!, id: "other" }]
    : base.effective.sources;
  const projection: WorkspaceView = {
    ...base,
    effective: { ...base.effective, sources },
    installedSkills: sources.flatMap((source) =>
      (options.skillPaths ?? [address.path]).map((path) => ({
        address: { source: source.id, path },
        name: path === address.path ? "Guide" : "Guide two",
        description: "Updated Skill",
        source,
        owner: { source: source.id, health: "healthy" as const },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
  };
  const checks: string[] = [];
  let workspaceReads = 0;
  const updates: Parameters<typeof import("@skctl/core").updateSkills>[1][] = [];
  const updateSignals: (AbortSignal | undefined)[] = [];
  function checked(
    options: CoreOptions,
    request: { source: string; observation: "retained" },
    operation?: OperationOptions,
  ): Promise<OperationResult<UpdateObservation | undefined>>;
  function checked(
    options: CoreOptions,
    request: { source: string; observation?: "current" },
    operation?: OperationOptions,
  ): Promise<OperationResult<UpdateObservation>>;
  function checked(
    options: CoreOptions,
    request: { source: string; observation?: "current" | "retained" },
    operation?: OperationOptions,
  ) {
    checks.push(request.source);
    return request.observation === "retained"
      ? checkUpdate(options, { source: request.source, observation: "retained" }, operation)
      : checkUpdate(options, { source: request.source }, operation);
  }
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  const dispose = async () => {
    setup?.renderer.destroy();
    if (prior === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    else process.env.SKTUI_UPDATE_SCHEDULE_DIR = prior;
    await rm(cache, { recursive: true, force: true });
  };
  try {
    setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            getUpdateBaseline: async () => ({ value: "checked-baseline", diagnostics: [] }),
            getWorkspace: async () => {
              workspaceReads++;
              return { value: projection, diagnostics: [] };
            },
            checkUpdate: checked,
            previewUpdate,
            updateSkills: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
              context,
            ) => {
              updates.push(request);
              updateSignals.push(context?.signal);
              if (options.update) return options.update(_environment, request, context);
              throw new Error("This return scenario must not submit an update");
            },
            loadInstalledSkill: async () => {
              throw new Error("Updates preview must not load installed content");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: options.width ?? 80, height: 24 },
    );
    const mounted = setup;
    await openMainPage(mounted, "updates");
    // App starts checks asynchronously after projection/cache hydration. A mounted
    // table alone does not prove it has an activatable row or a checked baseline.
    await mounted.waitFor(
      () => {
        const row = mounted.renderer.root.findDescendantById(
          "updates-browser-row-team-main:cell-source",
        );
        const status = mounted.renderer.root.findDescendantById(
          "updates-browser-row-team-main:cell-status",
        );
        return (
          checks.length > 0 &&
          row instanceof TextRenderable &&
          row.plainText === address.source &&
          status instanceof TextRenderable &&
          status.plainText === initialStatus
        );
      },
      { maxPasses: 200 },
    );
    await mounted.renderOnce();
    return {
      setup: mounted,
      checks,
      updates,
      updateSignals,
      workspaceReads: () => workspaceReads,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
test("RED shared Back closes a preview exactly once: aborts its read, ignores its late reply, and restores the source draft", async () => {
  const signals: AbortSignal[] = [];
  const requests: Parameters<typeof import("@skctl/core").previewUpdate>[1][] = [];
  const replies: ((
    value: Awaited<ReturnType<typeof import("@skctl/core").previewUpdate>>,
  ) => void)[] = [];
  const mounted = await mount(async (_environment, request, options) => {
    requests.push(request);
    signals.push(options!.signal!);
    return await new Promise((resolve) => replies.push(resolve));
  });
  const { setup } = mounted;
  try {
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => {
      const status = setup.renderer.root.findDescendantById(
        "source-updates-browser-row-team-main%00guide:cell-status",
      );
      return status instanceof TextRenderable && status.plainText === "Update available";
    });
    const sourceBrowser = await focusLive(setup, "source-updates-browser");
    const sourcePage = setup.renderer.root.findDescendantById("source-updates-page");
    const sourceBody = setup.renderer.root.findDescendantById("source-updates-browser-body");
    expect(sourcePage).toBeDefined();
    expect(sourceBody).toBeInstanceOf(ScrollBoxRenderable);
    await setup.mockInput.typeText("/");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-updates-query",
    );
    await setup.mockInput.typeText("guide");
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "source-updates-browser" &&
        setup.captureCharFrame().includes("Filter: guide"),
    );
    expect(setup.renderer.currentFocusedRenderable === sourceBrowser).toBe(true);
    expect(setup.renderer.root.findDescendantById("source-updates-page")).toBe(sourcePage);
    expect(setup.renderer.root.findDescendantById("source-updates-browser-body")).toBe(sourceBody);
    expect(sourceBrowser.isDestroyed).toBe(false);
    await setup.mockInput.typeText("/");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-updates-query",
    );
    const queryInput = setup.renderer.currentFocusedRenderable;
    if (!(queryInput instanceof InputRenderable)) throw new Error("Expected native Source query");
    expect(queryInput.value).toBe("guide");
    await setup.mockInput.typeText("-cancelled");
    expect(queryInput.value).toBe("guide-cancelled");
    expect(setup.renderer.currentFocusedRenderable === queryInput).toBe(true);
    expect(queryInput.isDestroyed).toBe(false);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === sourceBrowser);
    expect(setup.captureCharFrame()).toContain("Filter: guide");
    for (const caption of ["All Skills", "Updates only"]) {
      await enterLive(setup, "source-updates-show-all");
      await setup.waitFor(() => setup.captureCharFrame().includes(caption));
      expect(setup.renderer.root.findDescendantById("source-updates-page")).toBe(sourcePage);
      expect(setup.renderer.root.findDescendantById("source-updates-browser")).toBe(sourceBrowser);
      expect(setup.renderer.root.findDescendantById("source-updates-browser-body")).toBe(
        sourceBody,
      );
      expect(sourceBrowser.isDestroyed).toBe(false);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-show-all");
    }
    await focusLive(setup, "source-updates-browser");
    await setup.mockInput.typeText(" ");
    const checkId = "source-updates-browser-row-team-main%00guide:check";
    await setup.waitFor(
      () =>
        setup.renderer.root.findDescendantById(checkId) instanceof TextRenderable &&
        !!setup.renderer.root.findDescendantById("source-updates-clear"),
    );
    const checkedBefore = (setup.renderer.root.findDescendantById(checkId) as TextRenderable)
      .plainText;
    const body = setup.renderer.root.findDescendantById(
      "source-updates-browser-body",
    ) as ScrollBoxRenderable;
    const selectedBefore = body.scrollTop;
    const checksBefore = mounted.checks.length;
    await parsedEnter(setup);
    await setup.waitFor(() => signals.length === 1);
    expect(requests).toEqual([
      { ...address, exactRevision: revision, expectedBaseline: "checked-baseline" },
    ]);
    // Source drilldown already has a route Back: its mere presence cannot prove
    // that the private preview has taken ownership of the shared return.
    expect(!!setup.renderer.root.findDescendantById("source-updates-preview-back")).toBe(false);
    expect(setup.renderer.root.findDescendantById("route-back")).toBeDefined();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const previewChoices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      previewChoices.options.find((option) => option.value.id === "source-updates.preview-back")
        ?.value,
    ).toMatchObject({ enabled: true, verb: "Back to updates" });
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("route-back"));
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "source-updates-browser" &&
        !setup.renderer.root.findDescendantById("source-updates-preview-pane"),
    );
    expect(signals[0]!.aborted).toBe(true);
    expect(setup.captureCharFrame()).toContain("Filter: guide");
    expect(body.scrollTop).toBe(selectedBefore);
    expect((setup.renderer.root.findDescendantById(checkId) as TextRenderable).plainText).toBe(
      checkedBefore,
    );
    expect(setup.renderer.root.findDescendantById("source-updates-clear")).toBeDefined();
    expect(mounted.checks).toHaveLength(checksBefore);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-updates-browser");
    await enterLive(setup, "source-updates-browser");
    await setup.waitFor(() => replies.length === 2);
    replies[0]!({ value: readyPreview, diagnostics: [] });
    await setup.flush();
    expect(!!setup.renderer.root.findDescendantById("source-updates-preview-diff")).toBe(false);
    replies[1]!({ value: readyPreview, diagnostics: [] });
    await setup.waitFor(
      () =>
        setup.renderer.root.findDescendantById("source-updates-preview-diff") instanceof
        DiffRenderable,
    );
    // The second comparison returns through the same semantic command in Actions.
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const index = choices.options.findIndex(
      (option) => option.value.id === "source-updates.preview-back",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "source-updates-browser" &&
        !setup.renderer.root.findDescendantById("source-updates-preview-pane"),
    );
    expect(signals[1]!.aborted).toBe(true);
    expect(mounted.checks).toHaveLength(checksBefore);
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const listChoices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      listChoices.options.some((option) => option.value.id === "source-updates.preview-back"),
    ).toBe(false);
    await parsedEscape(setup);
  } finally {
    replies.forEach((reply) => reply({ value: readyPreview, diagnostics: [] }));
    await mounted.dispose();
  }
});
test("RED shared Back owns feedback detail, while search Escape only cancels its draft", async () => {
  const mounted = await mount(
    async () => ({ value: readyPreview, diagnostics: [] }),
    async () => {
      throw new Error("Source check failed with diagnostic detail");
    },
    "Check needed",
  );
  const { setup } = mounted;
  try {
    await focusLive(setup, "updates-browser");
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-query");
    await setup.mockInput.typeText("no-match");
    await parsedEscape(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "updates-browser" &&
        setup.renderer.root.findDescendantById(
          "updates-browser-row-team-main:cell-source",
        ) instanceof TextRenderable,
    );
    expect(!!setup.renderer.root.findDescendantById("updates-query")).toBe(false);
    expect(setup.renderer.root.findDescendantById("updates-browser")).toBeDefined();
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
    const checksBefore = mounted.checks.length;
    // Root toolbar uses updates-check, not the Source drilldown/palette ID.
    await enterLive(setup, "updates-check");
    await setup.waitFor(() => {
      const status = setup.renderer.root.findDescendantById(
        "updates-browser-row-team-main:cell-status",
      );
      return (
        mounted.checks.length === checksBefore + 1 &&
        status instanceof TextRenderable &&
        status.plainText === "Check needed" &&
        !!setup.renderer.root.findDescendantById("updates-feedback-details")
      );
    });
    await enterLive(setup, "updates-feedback-details");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "updates-feedback-pane" &&
        setup.captureCharFrame().includes("Source check failed with diagnostic detail"),
    );
    expect(setup.renderer.root.findDescendantById("route-back")).toBeDefined();
    expect(!!setup.renderer.root.findDescendantById("updates-feedback-details")).toBe(false);
    for (const [width, height] of [
      [144, 40],
      [100, 24],
      [80, 24],
      [43, 13],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      const content = setup.renderer.root.findDescendantById("updates-feedback-pane")!;
      const back = setup.renderer.root.findDescendantById("route-back")!;
      expect(content.height).toBeGreaterThan(0);
      expect(content.screenY + content.height).toBeLessThanOrEqual(height - 1);
      expect(back.screenX + back.width).toBeLessThanOrEqual(width);
      expect(back.screenY + back.height).toBeLessThanOrEqual(content.screenY);
    }
    setup.resize(80, 24);
    await setup.flush();
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    expect(
      choices.options.find((option) => option.value.id === "updates.feedback-details")?.value,
    ).toMatchObject({ enabled: true, verb: "Back to updates" });
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "updates-feedback-pane",
    );
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "updates-browser" &&
        !setup.renderer.root.findDescendantById("updates-feedback-pane"),
    );
    expect(!!setup.renderer.root.findDescendantById("updates-feedback-pane")).toBe(false);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("updates-browser");
    expect(mounted.checks).toHaveLength(checksBefore + 1);
  } finally {
    await mounted.dispose();
  }
});
type UpdatesSetup = Awaited<ReturnType<typeof testRender>>;
async function openActions(setup: UpdatesSetup) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  return setup.renderer.currentFocusedRenderable as SelectRenderable;
}
async function tabToFeedbackToolbar(
  setup: UpdatesSetup,
  prefix: string,
  action = "feedback-recover",
) {
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(`${prefix}-feedback-pane`);
  // This crossing must be real pane traversal, not focusLive repairing App's
  // remembered content or leaving focus in the diagnostic reader.
  setup.mockInput.pressTab({ shift: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === `${prefix}-${action}`);
}
async function feedbackFixture(source: boolean) {
  const mounted = await mount(
    async () => ({ value: readyPreview, diagnostics: [] }),
    async () => {
      throw new Error("FI-1 diagnostic detail");
    },
    "Check needed",
    { width: 144, skillPaths: ["guide", "guide-two"] },
  );
  const { setup } = mounted;
  const focusEvents: (string | null)[] = [];
  const observeFocus = (target: typeof setup.renderer.currentFocusedRenderable) => {
    focusEvents.push(target?.id ?? null);
    if (focusEvents.length > 32) focusEvents.shift();
  };
  setup.renderer.on("focused_renderable", observeFocus);
  const dispose = async () => {
    setup.renderer.off("focused_renderable", observeFocus);
    await mounted.dispose();
  };
  try {
    const prefix = source ? "source-updates" : "updates";
    const rowKey = source ? "team-main%00guide" : "team-main";
    const currentKey = source ? "team-main%00guide-two" : rowKey;
    if (source) {
      await enterLive(setup, "updates-browser");
      await setup.waitFor(() => {
        const status = setup.renderer.root.findDescendantById(
          "source-updates-browser-row-team-main%00guide-two:cell-status",
        );
        return status instanceof TextRenderable && status.plainText === "Check needed";
      });
    }
    await focusLive(setup, `${prefix}-browser`);
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === `${prefix}-query`);
    const query = source ? "guide" : "team";
    await setup.mockInput.typeText(query);
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === `${prefix}-browser` &&
        setup.captureCharFrame().includes(`Filter: ${query}`),
    );
    await setup.mockInput.typeText(" ");
    const checkId = `${prefix}-browser-row-${rowKey}:check`;
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(`${prefix}-clear`));
    const checked = (setup.renderer.root.findDescendantById(checkId) as TextRenderable).plainText;
    if (source) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    const body = setup.renderer.root.findDescendantById(
      `${prefix}-browser-body`,
    ) as ScrollBoxRenderable;
    const scroll = body.scrollTop;
    const checks = [...mounted.checks];
    const reads = mounted.workspaceReads();
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(source);
    await setup.mockInput.typeText("d");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === `${prefix}-feedback-pane` &&
        setup.captureCharFrame().includes("FI-1 diagnostic detail"),
    );
    return {
      ...mounted,
      prefix,
      dispose,
      async assertRestored() {
        expect(!!setup.renderer.root.findDescendantById(`${prefix}-feedback-pane`)).toBe(false);
        expect(
          !!setup.renderer.root.findDescendantById(`${prefix}-browser-row-${currentKey}`),
        ).toBe(true);
        try {
          await setup.waitFor(
            () =>
              setup.renderer.currentFocusedRenderable?.id === `${prefix}-browser` &&
              !setup.renderer.root.findDescendantById(`${prefix}-feedback-pane`),
          );
        } catch (error) {
          const focused = setup.renderer.currentFocusedRenderable;
          const browser = setup.renderer.root.findDescendantById(`${prefix}-browser`);
          const ancestry = (target: typeof focused) => {
            const nodes: {
              id: string;
              visible: boolean;
              destroyed: boolean;
            }[] = [];
            for (let node = target; node; node = node.parent as typeof focused)
              nodes.push({ id: node.id, visible: node.visible, destroyed: node.isDestroyed });
            return nodes;
          };
          throw new Error(
            `FI-1 local close failed to restore browser focus\n${JSON.stringify(
              {
                expected: `${prefix}-browser`,
                focusEvents,
                focused: ancestry(focused),
                browser: browser && {
                  id: browser.id,
                  visible: browser.visible,
                  focusable: browser.focusable,
                  destroyed: browser.isDestroyed,
                  width: browser.width,
                  height: browser.height,
                  ancestors: ancestry(browser),
                },
                feedbackMounted: !!setup.renderer.root.findDescendantById(
                  `${prefix}-feedback-pane`,
                ),
                checks: mounted.checks,
                updates: mounted.updates,
                reads: mounted.workspaceReads(),
              },
              null,
              2,
            )}\n${setup.captureCharFrame()}`,
            { cause: error },
          );
        }
        await setup.renderOnce();
        expect(setup.captureCharFrame()).toContain(`Filter: ${query}`);
        expect((setup.renderer.root.findDescendantById(checkId) as TextRenderable).plainText).toBe(
          checked,
        );
        expect(!!setup.renderer.root.findDescendantById(`${prefix}-clear`)).toBe(true);
        expect(body.scrollTop).toBe(scroll);
        // Native current-row marker, not injected page/state inspection.
        const current = setup.renderer.root.findDescendantById(
          `${prefix}-browser-row-${currentKey}`,
        )!;
        const marker = current.getChildren()[0]!.getChildren()[0] as TextRenderable;
        expect(marker.plainText).toBe("› ");
        expect(mounted.checks).toEqual(checks);
        expect(mounted.updates).toEqual([]);
        expect(mounted.workspaceReads()).toBe(reads);
        const choices = await openActions(setup);
        expect(choices.options.some((option) => option.value.id === "route.back")).toBe(source);
        // The entry Details action has reverted; no stale local-return callback.
        expect(
          choices.options.find((option) => option.value.id === `${prefix}.feedback-details`)?.value
            .verb,
        ).toBe("Details");
        await parsedEscape(setup);
        if (source) {
          // Consuming the surviving R is a second explicit action, not an effect
          // of closing feedback. It must restore the original Source overview.
          await enterLive(setup, "route-back");
          await setup.waitFor(
            () =>
              setup.renderer.currentFocusedRenderable?.id === "updates-browser" &&
              !!setup.renderer.root.findDescendantById("updates-browser-row-team-main:cell-source"),
          );
          expect(mounted.checks).toEqual(checks);
          expect(mounted.updates).toEqual([]);
          expect(mounted.workspaceReads()).toBe(reads);
        } else {
          expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
        }
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
test("FI-1 root feedback retains local Back after ordinary toolbar Tab and pointer return", async () => {
  const mounted = await feedbackFixture(false);
  const { setup, prefix } = mounted;
  try {
    await tabToFeedbackToolbar(setup, prefix);
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(true);
    const choices = await openActions(setup);
    expect(
      choices.options.find((option) => option.value.id === "updates.feedback-details")?.value,
    ).toMatchObject({ verb: "Back to updates", destination: "Sources in Updates" });
    expect(choices.options.some((option) => option.value.id === "route.back")).toBe(false);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "updates-feedback-recover",
    );
    await setup.renderOnce();
    const back = setup.renderer.root.findDescendantById("route-back")!;
    expect(back.width).toBeGreaterThan(0);
    await setup.mockMouse.click(back.screenX + 1, back.screenY);
    await mounted.assertRestored();
  } finally {
    await mounted.dispose();
  }
});
test("FI-1 Source feedback retains local Actions return after ordinary toolbar Tab and preserves outer R", async () => {
  const mounted = await feedbackFixture(true);
  const { setup, prefix } = mounted;
  try {
    await tabToFeedbackToolbar(setup, prefix);
    const choices = await openActions(setup);
    const index = choices.options.findIndex(
      (option) => option.value.id === "source-updates.feedback-details",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(choices.options[index]!.value).toMatchObject({
      verb: "Back to updates",
      destination: "Skill updates for team-main",
    });
    expect(choices.options.some((option) => option.value.id === "route.back")).toBe(true);
    for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    await mounted.assertRestored();
  } finally {
    await mounted.dispose();
  }
});
test("FI-1 root feedback d from ordinary toolbar Tab closes only the detail with checks and filter intact", async () => {
  const mounted = await feedbackFixture(false);
  try {
    await tabToFeedbackToolbar(mounted.setup, mounted.prefix);
    await mounted.setup.mockInput.typeText("d");
    await mounted.setup.renderOnce();
    await mounted.assertRestored();
  } finally {
    await mounted.dispose();
  }
});
test("FI-1 Source feedback Escape from ordinary toolbar Tab closes detail before selection or filter modes", async () => {
  const mounted = await feedbackFixture(true);
  try {
    await tabToFeedbackToolbar(mounted.setup, mounted.prefix);
    await parsedEscape(mounted.setup);
    await mounted.assertRestored();
  } finally {
    await mounted.dispose();
  }
});
test("FI-1 Source feedback ordinary Tab to toolbar then Tab Enter uses local Back rather than outer R", async () => {
  const mounted = await feedbackFixture(true);
  const { setup } = mounted;
  try {
    await tabToFeedbackToolbar(setup, mounted.prefix);
    for (
      let step = 0;
      step < 12 && setup.renderer.currentFocusedRenderable?.id !== "route-back";
      step++
    ) {
      setup.mockInput.pressTab();
      await setup.renderOnce();
    }
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("route-back");
    await parsedEnter(setup);
    await mounted.assertRestored();
  } finally {
    await mounted.dispose();
  }
});
test("FI-1 running Stop toolbar keeps local feedback Back without aborting or restarting its task", async () => {
  let settle: (() => void) | undefined;
  const mounted = await mount(
    async () => ({ value: readyPreview, diagnostics: [] }),
    async (_environment, { source }) => {
      if (source === address.source) throw new Error("FI-1 diagnostic detail");
      return {
        value: {
          source,
          kind: "github",
          exactRevision: revision,
          baseline: "checked-baseline",
          changed: [{ path: "guide", name: "Guide", description: "Updated Skill" }],
          unchanged: [],
          removed: [],
          added: [],
        },
        diagnostics: [],
      };
    },
    "Check needed",
    {
      width: 144,
      otherSource: true,
      update: async () => {
        await new Promise<void>((resolve) => {
          settle = resolve;
        });
        return { value: undefined, diagnostics: [] };
      },
    },
  );
  const { setup } = mounted;
  try {
    await setup.waitFor(() => {
      const status = setup.renderer.root.findDescendantById(
        "updates-browser-row-other:cell-status",
      );
      return status instanceof TextRenderable && status.plainText === "Updates available";
    });
    await enterLive(setup, "updates-update-all");
    await setup.waitFor(() => mounted.updates.length === 1 && !!settle);
    expect(mounted.updates[0]).toMatchObject({
      source: "other",
      paths: ["guide"],
      exactRevision: revision,
      expectedBaseline: "checked-baseline",
    });
    const signal = mounted.updateSignals[0]!;
    expect(signal.aborted).toBe(false);
    await focusLive(setup, "updates-browser");
    await setup.mockInput.typeText("d");
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "updates-feedback-pane" &&
        setup.captureCharFrame().includes("FI-1 diagnostic detail"),
    );
    const checks = [...mounted.checks];
    const updates = [...mounted.updates];
    const reads = mounted.workspaceReads();
    await tabToFeedbackToolbar(setup, "updates", "stop");
    const stop = setup.renderer.root.findDescendantById("updates-stop")!;
    expect(stop.height).toBeGreaterThan(0);
    expect(stop.screenY + stop.height).toBeLessThanOrEqual(23);
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(true);
    const choices = await openActions(setup);
    const index = choices.options.findIndex(
      (option) => option.value.id === "updates.feedback-details",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(choices.options[index]!.value.verb).toBe("Back to updates");
    for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
    await parsedEnter(setup);
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedRenderable?.id === "updates-browser" &&
        !setup.renderer.root.findDescendantById("updates-feedback-pane"),
    );
    expect(!!setup.renderer.root.findDescendantById("updates-stop")).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(mounted.checks).toEqual(checks);
    expect(mounted.updates).toEqual(updates);
    expect(mounted.workspaceReads()).toBe(reads);
  } finally {
    settle?.();
    await mounted.dispose();
  }
});
