/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { WorkspaceView, UpdateObservation } from "@skill-cli/core";
import {
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { App } from "../src/app";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEnter, parsedEscape } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
const longFailure = `Remote unavailable: ${"the upstream request failed with a deliberately long diagnostic; ".repeat(8)}`;
const revision = "d".repeat(40);
const sourcePaths = ["alpha", "bravo", "charlie"];
const viewports = [
  [80, 16],
  [43, 30],
] as const;

async function renderApp(
  core: ReturnType<typeof directSourceCore>,
  size = { width: 80, height: 24 },
) {
  await mkdir("/tmp/opencode", { recursive: true });
  const cache = await mkdtemp("/tmp/opencode/source-updates-acceptance-");
  const prior = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
  process.env.SKILL_TUI_UPDATE_CACHE_DIR = cache;
  let setup: Setup | undefined;
  const dispose = async () => {
    setup?.renderer.destroy();
    if (prior === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
    else process.env.SKILL_TUI_UPDATE_CACHE_DIR = prior;
    await rm(cache, { recursive: true, force: true });
  };
  try {
    setup = await testRender(() => <App core={core} exit={() => {}} />, size);
    return { setup, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function sourceFixture(count: number): WorkspaceView {
  const base = workspaceProjection({ includeContribution: false });
  const sources = Array.from({ length: count }, (_, index) => ({
    ...base.effective.sources[0]!,
    id: index === 0 ? "team-main" : `source-${String(index + 1).padStart(2, "0")}`,
    origin: `https://example.test/${index + 1}`,
  }));
  return {
    ...base,
    effective: { ...base.effective, sources },
    installedSkills: sources.flatMap((source, index) =>
      (index === 0 ? sourcePaths : [`skill-${index + 1}`]).map((path) => ({
        address: { source: source.id, path },
        name: path,
        description: `Installed ${path} from ${source.id}`,
        owner: { source: source.id, health: "healthy" as const },
        source,
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      })),
    ),
  };
}

function collectionFixture(): WorkspaceView {
  const projection = sourceFixture(2);
  if (projection.effective.status !== "complete") throw new Error("Expected complete projection");
  return {
    ...projection,
    effective: {
      ...projection.effective,
      collections: ["release"],
      collectionsView: [
        {
          id: "release",
          declared: [
            {
              level: "project",
              file: "/workspace/skill-cli/skill-cli.jsonc",
              pointer: "/collections/release",
            },
          ],
          repository: { derived: false, producers: [] },
          members: [{ name: "alpha", address: { source: "team-main", path: "alpha" }, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
  };
}

function observation(source: string, paths: readonly string[]): UpdateObservation {
  return {
    source,
    kind: "github",
    exactRevision: revision,
    baseline: `checked-${source}`,
    changed: paths.map((path) => ({ path, name: path, description: `${path} changed` })),
    added: [],
    removed: [],
    unchanged: [],
  };
}

// Only external Core inputs/calls are fixtures; App owns drafts, routes and tasks.
function updateCore(projection: WorkspaceView) {
  const checks: string[] = [];
  const completed: string[] = [];
  const updates: unknown[] = [];
  const reads: unknown[] = [];
  const core = directSourceCore(projection, {
    installed: {
      checkUpdate: async ({ source }) => {
        checks.push(source);
        const paths = projection.installedSkills
          .filter((skill) => skill.address.source === source)
          .map((skill) => skill.address.path);
        completed.push(source);
        return { value: observation(source, paths), diagnostics: [] };
      },
      update: async (request) => {
        updates.push(request);
        return { value: undefined, diagnostics: [] };
      },
      load: async (request) => {
        reads.push(request);
        throw new Error("Updates navigation must not read installed Skill content");
      },
    },
  });
  return { core, checks, completed, updates, reads };
}

function text(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  return target instanceof TextRenderable ? target.plainText : undefined;
}

const rowId = (table: string, key: string) => `${table}-row-${encodeURIComponent(key)}`;
const skillRow = (path: string) => rowId("source-updates-browser", `team-main\u0000${path}`);

function tableRows(setup: Setup, id: string) {
  const body = setup.renderer.root.findDescendantById(`${id}-body`);
  return body instanceof ScrollBoxRenderable
    ? body.content.getChildren().filter((child) => child.id.startsWith(`${id}-row-`))
    : [];
}

async function openUpdates(setup: Setup) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-updates"));
  await enterLive(setup, "shell-section-tab-updates");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
}

async function settledSources(
  setup: Setup,
  completed: readonly string[],
  sources: readonly string[],
) {
  await setup.waitFor(
    () =>
      completed.length === sources.length &&
      sources.every((source) => {
        const status = text(setup, `${rowId("updates-browser", source)}:cell-status`);
        return status !== undefined && !["Not checked", "Checking", "Waiting"].includes(status);
      }),
    { maxPasses: 200 },
  );
  expect(tableRows(setup, "updates-browser")).toHaveLength(sources.length);
}

async function openActions(setup: Setup) {
  setup.mockInput.pressKey("p", { ctrl: true });
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  const choices = setup.renderer.currentFocusedRenderable;
  if (!(choices instanceof SelectRenderable)) throw new Error("Actions must be a native Select");
  return choices;
}

async function chooseAction(setup: Setup, id: string) {
  const choices = await openActions(setup);
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index, `Missing current command ${id}`).toBeGreaterThanOrEqual(0);
  expect(choices.options[index]!.value.enabled).toBe(true);
  for (let step = 0; step < index; step++) setup.mockInput.pressArrow("down");
  await parsedEnter(setup);
}

function expectActionBounds(setup: Setup, prefix: string, actionId: string) {
  const pane = setup.renderer.root.findDescendantById(`${prefix}-page`)!;
  const browser = setup.renderer.root.findDescendantById(`${prefix}-browser`)!;
  const action = setup.renderer.root.findDescendantById(actionId)!;
  expect(pane).toBeDefined();
  expect(browser).toBeDefined();
  expect(action).toBeDefined();
  for (const target of [browser, action]) {
    expect(target.screenX).toBeGreaterThanOrEqual(pane.screenX + 1);
    expect(target.screenX + target.width).toBeLessThanOrEqual(pane.screenX + pane.width - 1);
    expect(target.screenY).toBeGreaterThanOrEqual(pane.screenY + 1);
    expect(target.screenY + target.height).toBeLessThanOrEqual(pane.screenY + pane.height - 1);
  }
  expect(browser.height).toBeGreaterThanOrEqual(2);
  expect(action.screenY).toBeGreaterThanOrEqual(browser.screenY + browser.height);
  const localContent = setup.renderer.root.findDescendantById(`${prefix}-notice`) ?? browser;
  expect(action.screenY - (localContent.screenY + localContent.height)).toBeGreaterThanOrEqual(0);
  expect(action.screenY - (localContent.screenY + localContent.height)).toBeLessThanOrEqual(4);
  expect(action.screenX).toBeGreaterThanOrEqual(0);
  expect(action.screenX + action.width).toBeLessThanOrEqual(setup.renderer.width);
  expect(action.screenY + action.height).toBeLessThanOrEqual(setup.renderer.height - 1);
  return action;
}

test.each([12, 2])(
  "App Updates keeps %i startup Sources and local actions bounded across short/narrow viewports",
  async (count) => {
    const projection = sourceFixture(count);
    const checks: string[] = [];
    const completed: string[] = [];
    const reads: unknown[] = [];
    const core = directSourceCore(projection, {
      installed: {
        checkUpdate: async ({ source }) => {
          checks.push(source);
          try {
            if (source === "source-12") throw new Error(longFailure);
            return { value: observation(source, []), diagnostics: [] };
          } finally {
            completed.push(source);
          }
        },
        load: async (request) => {
          reads.push(request);
          throw new Error("Opening Updates must not read installed content");
        },
      },
    });
    const mounted = await renderApp(core, { width: 80, height: 16 });
    const { setup } = mounted;
    try {
      await openUpdates(setup);
      const sources = projection.effective.sources.map((source) => source.id);
      await settledSources(setup, completed, sources);
      expect([...checks].sort()).toEqual([...sources].sort());
      expect([...completed].sort()).toEqual([...sources].sort());
      if (count === 12) {
        expect(text(setup, "updates-browser-row-source-12:cell-source")).toBe("source-12");
        expect(text(setup, "updates-browser-row-source-12:cell-status")).toBe("Check needed");
      }
      for (const [width, height] of viewports) {
        setup.resize(width, height);
        await setup.flush();
        await focusLive(setup, "updates-browser");
        setup.mockInput.pressKey("END");
        await setup.renderOnce();
        if (count === 12) {
          const body = setup.renderer.root.findDescendantById(
            "updates-browser-body",
          ) as ScrollBoxRenderable;
          const rows = tableRows(setup, "updates-browser");
          const last = rows.at(-1)!;
          if (body.scrollHeight > body.viewport.height)
            await setup.waitFor(() => body.scrollTop > 0);
          else expect(body.scrollTop).toBe(0);
          expect(last.screenY).toBeGreaterThanOrEqual(body.viewport.screenY);
          expect(last.screenY + last.height).toBeLessThanOrEqual(
            body.viewport.screenY + body.viewport.height,
          );
          // Failed rows have a priority sort; navigate its actual rendered position.
          const failedIndex = rows.findIndex((row) => row.id === "updates-browser-row-source-12");
          expect(failedIndex).toBeGreaterThanOrEqual(0);
          setup.mockInput.pressKey("HOME");
          for (let step = 0; step < failedIndex; step++) setup.mockInput.pressArrow("down");
          await setup.renderOnce();
          await setup.mockInput.typeText("d");
          const detailText = (target: BaseRenderable): string =>
            target instanceof TextRenderable
              ? target.plainText
              : target.getChildren().map(detailText).join("");
          // Native JSX text reaches plainText on its lifecycle pass, after ref/focus.
          await setup.waitFor(() => {
            const current = setup.renderer.root.findDescendantById("updates-feedback-pane");
            return (
              current instanceof ScrollBoxRenderable &&
              !current.isDestroyed &&
              !!current.parent &&
              setup.renderer.currentFocusedRenderable === current &&
              detailText(current.content).includes(longFailure)
            );
          });
          const detail = setup.renderer.root.findDescendantById(
            "updates-feedback-pane",
          ) as ScrollBoxRenderable;
          expect(detailText(detail.content)).toContain(longFailure);
          expect(detail.screenY + detail.height).toBeLessThanOrEqual(height - 1);
          setup.mockInput.pressKey("END");
          await setup.renderOnce();
          expect(detail.scrollTop).toBeGreaterThanOrEqual(0);
          expect(detail.scrollTop).toBeLessThanOrEqual(
            Math.max(0, detail.scrollHeight - detail.viewport.height),
          );
          await parsedEscape(setup);
          await setup.waitFor(
            () =>
              setup.renderer.currentFocusedRenderable?.id === "updates-browser" &&
              !setup.renderer.root.findDescendantById("updates-feedback-pane"),
          );
          setup.mockInput.pressKey("HOME");
          await setup.renderOnce();
          expect(setup.captureCharFrame()).not.toContain("Remote unavailable:");
        }
        // Compact failure feedback replaces the ordinary update toolbar.
        const compactFeedback = count === 12 && height <= 18;
        const firstAction = compactFeedback ? "updates-feedback-recover" : "updates-update-all";
        for (
          let step = 0;
          step < 8 && setup.renderer.currentFocusedRenderable?.id !== firstAction;
          step++
        ) {
          setup.mockInput.pressTab();
          await setup.renderOnce();
        }
        const first = expectActionBounds(setup, "updates", firstAction);
        expect(first).toBeInstanceOf(ButtonRenderable);
        expect(setup.renderer.currentFocusedRenderable).toBe(first);
        if (!compactFeedback) setup.mockInput.pressArrow("right");
        setup.mockInput.pressArrow("right");
        await setup.renderOnce();
        const action = expectActionBounds(
          setup,
          "updates",
          compactFeedback ? "updates-feedback-details" : "updates-check",
        );
        expect(action).toBeInstanceOf(ButtonRenderable);
        expect(setup.renderer.currentFocusedRenderable).toBe(action);
        if (compactFeedback) {
          const choices = await openActions(setup);
          for (const id of [
            "updates.feedback-recover",
            "updates.feedback-details",
            "updates.update-all",
          ]) {
            expect(choices.options.find((option) => option.value.id === id)?.value).toMatchObject({
              enabled: true,
            });
          }
          await parsedEscape(setup);
          expect(setup.renderer.currentFocusedRenderable).toBe(action);
        }
        if (count === 2) {
          const last = tableRows(setup, "updates-browser").at(-1)!;
          const browser = setup.renderer.root.findDescendantById("updates-browser")!;
          const body = setup.renderer.root.findDescendantById(
            "updates-browser-body",
          ) as ScrollBoxRenderable;
          expect(
            action.screenY - (last.screenY + last.height),
            `A short list must not leave a large blank region before its actions: ${JSON.stringify({
              viewport: [width, height],
              browser: [browser.screenY, browser.height],
              body: [body.viewport.screenY, body.viewport.height, body.scrollTop],
              lastRow: [last.screenY, last.height],
              action: [action.screenY, action.height],
              focused: setup.renderer.currentFocusedRenderable?.id,
            })}`,
          ).toBeLessThanOrEqual(4);
        }
      }
      expect(checks).toHaveLength(count);
      expect(reads).toEqual([]);
    } finally {
      await mounted.dispose();
    }
  },
);

test("Source row activation and semantic Back restore the exact overview row without new work", async () => {
  const fixture = updateCore(sourceFixture(2));
  const mounted = await renderApp(fixture.core);
  const { setup } = mounted;
  try {
    await openUpdates(setup);
    await settledSources(setup, fixture.completed, ["team-main", "source-02"]);
    expect(text(setup, "updates-browser-row-team-main:cell-updates")).toBe("3");
    await focusLive(setup, "updates-browser");
    setup.mockInput.pressKey("END");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"));
    expect(tableRows(setup, "source-updates-browser").map((row) => row.id)).toEqual([
      rowId("source-updates-browser", "source-02\u0000skill-2"),
    ]);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
    const row = setup.renderer.root.findDescendantById("updates-browser-row-source-02")!;
    expect((row.getChildren()[0]!.getChildren()[0] as TextRenderable).plainText).toBe("› ");
    expect(fixture.checks).toEqual(["team-main", "source-02"]);
    expect(fixture.updates).toEqual([]);
    expect(fixture.reads).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});

test("Committed Source query and hidden checked targets survive draft cancellation, Back and re-entry", async () => {
  const fixture = updateCore(sourceFixture(2));
  const mounted = await renderApp(fixture.core);
  const { setup } = mounted;
  try {
    await openUpdates(setup);
    await settledSources(setup, fixture.completed, ["team-main", "source-02"]);
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => tableRows(setup, "source-updates-browser").length === 3);
    await focusLive(setup, "source-updates-browser");
    for (const path of ["bravo", "charlie"]) {
      setup.mockInput.pressArrow("down");
      await setup.mockInput.typeText(" ");
      await setup.waitFor(() => text(setup, `${skillRow(path)}:check`)?.includes("✓") === true);
    }
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable);
    await setup.mockInput.typeText("bravo");
    await parsedEnter(setup);
    await setup.waitFor(() => setup.captureCharFrame().includes("Filter: bravo"));
    expect(tableRows(setup, "source-updates-browser").map((row) => row.id)).toEqual([
      skillRow("bravo"),
    ]);
    expect(setup.captureCharFrame()).toContain("1 selected Skills hidden by this view");
    await setup.mockInput.typeText("/");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable);
    const input = setup.renderer.currentFocusedRenderable as InputRenderable;
    expect(input.value).toBe("bravo");
    await setup.mockInput.typeText("-cancelled");
    expect(input.value).toBe("bravo-cancelled");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-updates-browser",
    );
    expect(setup.captureCharFrame()).toContain("Filter: bravo");
    expect(fixture.updates).toEqual([]);

    // Shared Back navigates; browser Escape intentionally clears selection/query first.
    await enterLive(setup, "route-back");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(skillRow("bravo")));
    expect(tableRows(setup, "source-updates-browser").map((row) => row.id)).toEqual([
      skillRow("bravo"),
    ]);
    expect(text(setup, `${skillRow("bravo")}:check`)).toContain("✓");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Filter: bravo") && frame.includes("1 selected Skills hidden by this view"),
    );
    const choices = await openActions(setup);
    expect(
      choices.options.find((option) => option.value.id === "source-updates.update-all")?.value,
    ).toMatchObject({
      enabled: true,
      destination: "team-main · 2 selected Skills · 1 hidden selections included",
    });
    await parsedEscape(setup);
    expect(fixture.updates).toEqual([]);
    expect(text(setup, `${skillRow("bravo")}:check`)).toContain("✓");
    await enterLive(setup, "source-updates-update-all");
    await setup.waitFor(
      () =>
        fixture.updates.length === 1 &&
        !!setup.renderer.root.findDescendantById("source-updates-update-all"),
    );
    expect(fixture.updates).toEqual([
      {
        source: "team-main",
        paths: ["bravo", "charlie"],
        exactRevision: revision,
        expectedBaseline: "checked-team-main",
      },
    ]);
    expect(fixture.checks).toEqual(["team-main", "source-02"]);
    expect(fixture.reads).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});

test("An empty Source draft submits all legal targets; Stop before mutation keeps it empty and retry stays exact", async () => {
  const fixture = updateCore(sourceFixture(2));
  const get = fixture.core.workspace.get;
  let holdSubmission = false;
  let heldSignal: AbortSignal | undefined;
  fixture.core.workspace.get = async (options) => {
    if (holdSubmission) {
      heldSignal = options?.signal;
      await new Promise<void>((_resolve, reject) => {
        options!.signal!.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("Stopped before mutation"), { code: "CANCELLED" })),
          { once: true },
        );
      });
    }
    return get(options);
  };
  const mounted = await renderApp(fixture.core);
  const { setup } = mounted;
  try {
    await openUpdates(setup);
    await settledSources(setup, fixture.completed, ["team-main", "source-02"]);
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => tableRows(setup, "source-updates-browser").length === 3);
    expect(tableRows(setup, "source-updates-browser").map((row) => row.id)).toEqual(
      sourcePaths.map(skillRow),
    );
    expect(setup.renderer.root.findDescendantById("source-updates-clear")).toBeUndefined();
    for (const path of sourcePaths) expect(text(setup, `${skillRow(path)}:check`)).toBeUndefined();
    const choices = await openActions(setup);
    expect(
      choices.options.find((option) => option.value.id === "source-updates.update-all")?.value,
    ).toMatchObject({ enabled: true, destination: "team-main · 3 installed Skills" });
    await parsedEscape(setup);
    expect(fixture.updates).toEqual([]);
    holdSubmission = true;
    await enterLive(setup, "source-updates-update-all");
    await setup.waitFor(
      () => !!heldSignal && !!setup.renderer.root.findDescendantById("source-updates-stop"),
    );
    await enterLive(setup, "source-updates-stop");
    await setup.waitFor(
      () =>
        heldSignal!.aborted &&
        !!setup.renderer.root.findDescendantById("source-updates-update-all"),
    );
    expect(fixture.updates).toEqual([]);
    expect(setup.renderer.root.findDescendantById("source-updates-clear")).toBeUndefined();
    for (const path of sourcePaths) expect(text(setup, `${skillRow(path)}:check`)).toBeUndefined();
    expect(fixture.checks).toEqual(["team-main", "source-02"]);
    holdSubmission = false;
    await enterLive(setup, "source-updates-update-all");
    await setup.waitFor(
      () =>
        fixture.updates.length === 1 &&
        !!setup.renderer.root.findDescendantById("source-updates-update-all"),
    );
    expect(fixture.updates).toEqual([
      {
        source: "team-main",
        paths: sourcePaths,
        exactRevision: revision,
        expectedBaseline: "checked-team-main",
      },
    ]);
    // Submission invalidated the stopped task's observation; retry checks only its Source.
    expect(fixture.checks).toEqual(["team-main", "source-02", "team-main"]);
    expect(fixture.reads).toEqual([]);
  } finally {
    await mounted.dispose();
  }
});

test.each(["current-exposure", "problems"] as const)(
  "Collection Source drill-down from %s retains its bounded draft, selection and check count across Back and recheck",
  async (initialView) => {
    const fixture = updateCore(collectionFixture());
    const mounted = await renderApp(fixture.core);
    const { setup } = mounted;
    try {
      await setup.waitFor(
        () =>
          fixture.completed.length === 2 &&
          !!setup.renderer.root.findDescendantById("skills-view-tab-problems"),
      );
      if (initialView === "problems") await enterLive(setup, "skills-view-tab-problems");
      await enterLive(setup, "shell-section-tab-collections");
      const tree = await focusLive(setup, "collection-browser");
      expect(tree).toBeInstanceOf(ScrollBoxRenderable);
      const collectionKey = collectionFilterPathKey({ segments: [{ collection: "release" }] });
      expect(
        text(setup, `collection-browser-row-${encodeURIComponent(collectionKey)}-name`)?.trimEnd(),
      ).toBe("release");
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-relationships"),
      );
      await chooseAction(setup, "collection-check-updates");
      try {
        await setup.waitFor(
          () =>
            fixture.completed.length === 3 &&
            text(setup, "updates-browser-row-team-main:cell-updates") === "1",
        );
      } catch (error) {
        throw new Error(
          `Collection check action did not enter the alpha-only Updates scope: ${JSON.stringify({
            initialView,
            collection: text(
              setup,
              `collection-browser-row-${encodeURIComponent(collectionKey)}-name`,
            )?.trimEnd(),
            contentsMounted: !!setup.renderer.root.findDescendantById("collection-relationships"),
            updatesMounted: !!setup.renderer.root.findDescendantById("updates-page"),
            focused: setup.renderer.currentFocusedRenderable?.id,
            updates: text(setup, "updates-browser-row-team-main:cell-updates"),
            checks: fixture.checks,
            completed: fixture.completed,
          })}`,
          { cause: error },
        );
      }
      expect(tableRows(setup, "updates-browser").map((row) => row.id)).toEqual([
        "updates-browser-row-team-main",
      ]);
      expect(setup.captureCharFrame()).toContain("Collection release");
      expect(setup.renderer.root.findDescendantById("updates-clear")).toBeUndefined();
      expect(text(setup, "updates-browser-row-team-main:check")).toBeUndefined();
      const checksBeforeDrilldown = [...fixture.checks];
      await enterLive(setup, "updates-browser");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(skillRow("alpha")));
      expect(tableRows(setup, "source-updates-browser").map((row) => row.id)).toEqual([
        skillRow("alpha"),
      ]);
      expect(text(setup, `${skillRow("alpha")}:check`)).toBeUndefined();
      expect(setup.renderer.root.findDescendantById("source-updates-clear")).toBeUndefined();
      await enterLive(setup, "route-back");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
      expect(text(setup, "updates-browser-row-team-main:check")).toBeUndefined();
      expect(fixture.checks).toEqual(checksBeforeDrilldown);
      expect(fixture.updates).toEqual([]);
      await focusLive(setup, "updates-browser");
      await setup.mockInput.typeText(" ");
      await setup.waitFor(
        () => text(setup, "updates-browser-row-team-main:check")?.includes("✓") === true,
      );
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(skillRow("alpha")));
      const source = await focusLive(setup, "source-updates-browser");
      expect(source.isDestroyed).toBe(false);
      expect(source.parent).toBeDefined();
      expect(tableRows(setup, "source-updates-browser").map((row) => row.id)).toEqual([
        skillRow("alpha"),
      ]);
      expect(setup.renderer.root.findDescendantById(skillRow("bravo"))).toBeUndefined();
      expect(setup.renderer.root.findDescendantById(skillRow("charlie"))).toBeUndefined();
      expect(text(setup, `${skillRow("alpha")}:check`)).toContain("✓");
      expect(fixture.checks).toEqual(checksBeforeDrilldown);
      expect(fixture.updates).toEqual([]);
      const choices = await openActions(setup);
      expect(
        choices.options.find((option) => option.value.id === "source-updates.update-all")?.value,
      ).toMatchObject({ enabled: true, destination: "team-main · 1 selected Skills" });
      await parsedEscape(setup);
      expect(fixture.updates).toEqual([]);
      for (const [width, height] of viewports) {
        setup.resize(width, height);
        await setup.flush();
        const action = expectActionBounds(setup, "source-updates", "source-updates-update-all");
        await focusLive(setup, action.id);
        expect(setup.renderer.currentFocusedRenderable).toBe(action);
      }
      setup.resize(80, 24);
      await setup.flush();
      await enterLive(setup, "route-back");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
      expect(setup.captureCharFrame()).toContain("Collection release");
      expect(text(setup, "updates-browser-row-team-main:check")).toContain("✓");
      expect(fixture.checks).toEqual(checksBeforeDrilldown);
      expect(fixture.updates).toEqual([]);
      await enterLive(setup, "updates-check");
      await setup.waitFor(
        () =>
          fixture.completed.length === 4 &&
          text(setup, "updates-browser-row-team-main:cell-updates") === "1",
      );
      expect(fixture.checks).toEqual(["team-main", "source-02", "team-main", "team-main"]);
      await enterLive(setup, "updates-browser");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById(skillRow("alpha")));
      expect(text(setup, `${skillRow("alpha")}:check`)).toContain("✓");
      await enterLive(setup, "source-updates-update-all");
      await setup.waitFor(
        () =>
          fixture.updates.length === 1 &&
          !!setup.renderer.root.findDescendantById("source-updates-update-all"),
      );
      expect(fixture.updates).toEqual([
        {
          source: "team-main",
          paths: ["alpha"],
          exactRevision: revision,
          expectedBaseline: "checked-team-main",
        },
      ]);
      await enterLive(setup, "route-back");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "updates-browser");
      expect(setup.captureCharFrame()).toContain("Collection release");
      expect(setup.renderer.root.findDescendantById("updates-clear")).toBeUndefined();
      expect(fixture.checks).toEqual(["team-main", "source-02", "team-main", "team-main"]);
      await enterLive(setup, "updates-check");
      await setup.waitFor(
        () =>
          fixture.completed.length === 5 &&
          text(setup, "updates-browser-row-team-main:cell-installed") === "1",
      );
      await enterLive(setup, "updates-update-all");
      await setup.waitFor(
        () =>
          fixture.updates.length === 2 &&
          !!setup.renderer.root.findDescendantById("updates-update-all"),
      );
      expect(fixture.updates[1]).toEqual({
        source: "team-main",
        paths: ["alpha"],
        exactRevision: revision,
        expectedBaseline: "checked-team-main",
      });
      expect(fixture.checks).toEqual([
        "team-main",
        "source-02",
        "team-main",
        "team-main",
        "team-main",
      ]);
      expect(fixture.reads).toEqual([]);
    } finally {
      await mounted.dispose();
    }
  },
);
