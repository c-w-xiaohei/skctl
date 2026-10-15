/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import type { ManagementProjection, UpdateObservation } from "@skill-cli/core";
import { InputRenderable, ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
const longFailure = `Remote unavailable: ${"the upstream request failed with a deliberately long diagnostic; ".repeat(8)}`;
const revision = "d".repeat(40);
let cacheIsolationSequence = 0;

async function renderApp(
  core: ReturnType<typeof directSourceCore>,
  size: { readonly width: number; readonly height: number },
) {
  const prior = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
  process.env.SKILL_TUI_UPDATE_CACHE_DIR = `/tmp/opencode/skill-tui-updates-v3-${process.pid}-${++cacheIsolationSequence}`;
  try {
    const setup = await testRender(() => <App core={core} exit={() => {}} />, size);
    return {
      setup,
      restoreCachePath() {
        if (prior === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
        else process.env.SKILL_TUI_UPDATE_CACHE_DIR = prior;
      },
    };
  } catch (error) {
    if (prior === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
    else process.env.SKILL_TUI_UPDATE_CACHE_DIR = prior;
    throw error;
  }
}

function sourceFixture(count = 12): ManagementProjection {
  const base = workspaceProjection({ includeContribution: false });
  const sources = Array.from({ length: count }, (_, index) => ({
    ...base.effective.sources[0]!,
    id: index === 0 ? "team-main" : `source-${String(index + 1).padStart(2, "0")}`,
    origin: `https://example.test/${index + 1}`,
  }));
  const installedSkills = sources.flatMap((source, index) => {
    const paths = index === 0 ? ["alpha", "bravo", "charlie"] : [`skill-${index + 1}`];
    return paths.map((path) => ({
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
    }));
  });
  return {
    ...base,
    effective: { ...base.effective, sources },
    installedSkills,
  };
}

function collectionFixture(): ManagementProjection {
  const projection = sourceFixture(2);
  if (projection.effective.status !== "complete") throw new Error("Expected complete projection");
  const owner = {
    level: "project" as const,
    file: "/workspace/skill-cli/skill-cli.jsonc",
    pointer: "/collections/release",
  };
  return {
    ...projection,
    effective: {
      ...projection.effective,
      collections: ["release"],
      collectionsView: [
        {
          id: "release",
          declared: [owner],
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
    changed: paths.map((path) => ({ path, name: path, description: `${path} changed` })),
    added: [],
    removed: [],
    unchanged: [],
  };
}

async function openUpdates(setup: Setup) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-section-tab-updates"), {
    maxPasses: 200,
  });
  await enterLive(setup, "shell-section-tab-updates");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"), {
    maxPasses: 200,
  });
}

async function waitForCompletedSources(
  setup: Setup,
  completed: readonly string[],
  expected: number,
) {
  try {
    await setup.waitFor(() => completed.length === expected, { maxPasses: 200 });
  } catch (error) {
    const list = setup.renderer.root.findDescendantById("updates-browser");
    throw new Error(
      `Expected ${expected} completed startup Source checks; completed=${completed.length} [${completed.join(", ")}], optionCount=${list instanceof SelectRenderable ? list.options.length : "unmounted"}, options=${list instanceof SelectRenderable ? list.options.map((option) => `${option.value}:${option.name}`).join(" | ") : "unmounted"}, focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
}

async function waitForSettledUpdateRows(setup: Setup, expected: number) {
  await setup.waitFor(
    () => {
      const list = setup.renderer.root.findDescendantById("updates-browser");
      return (
        list instanceof SelectRenderable &&
        list.options.length === expected &&
        list.options.every((option) => !/checking|pending|not checked/i.test(option.name))
      );
    },
    { maxPasses: 200 },
  );
}

async function waitForFailedSourceRow(setup: Setup, source: string) {
  try {
    await setup.waitFor(
      () => {
        const list = setup.renderer.root.findDescendantById("updates-browser");
        const row =
          list instanceof SelectRenderable
            ? list.options.find((option) => option.value === `group:${source}`)
            : undefined;
        return !!row && /could not check/i.test(row.name);
      },
      { maxPasses: 200 },
    );
  } catch (error) {
    const list = setup.renderer.root.findDescendantById("updates-browser");
    throw new Error(
      `Source ${source} failure did not publish; options=${list instanceof SelectRenderable ? list.options.map((option) => `${option.value}:${option.name}`).join(" | ") : "unmounted"}, focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
}

async function selectOption(setup: Setup, id: string, value: string) {
  const browser = await focusLive(setup, id);
  if (!(browser instanceof SelectRenderable)) throw new Error(`${id} is not a native Select`);
  const index = browser.options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  browser.setSelectedIndex(index);
  await setup.renderOnce();
  return browser;
}

function updatesPaneGeometry(setup: Setup, listId: string, actionId: string) {
  const pane = setup.renderer.root.findDescendantById(
    listId === "updates-browser" ? "updates-page" : "source-updates-page",
  );
  const list = setup.renderer.root.findDescendantById(listId);
  const action = setup.renderer.root.findDescendantById(actionId);
  if (!pane || !list || !action)
    throw new Error(`Missing pane/list/action: ${listId}, ${actionId}`);
  const scrollId =
    listId === "updates-browser" ? "updates-scroll-region" : "source-updates-scroll-region";
  const scroll = setup.renderer.root.findDescendantById(scrollId);
  const inside = (target: typeof pane) =>
    target.screenX >= pane.screenX + 1 &&
    target.screenX + target.width <= pane.screenX + pane.width - 1 &&
    target.screenY >= pane.screenY + 1 &&
    target.screenY + target.height <= pane.screenY + pane.height - 1;
  return {
    pane: { x: pane.screenX, y: pane.screenY, width: pane.width, height: pane.height },
    list: { y: list.screenY, height: list.height, width: list.width },
    action: { x: action.screenX, y: action.screenY, width: action.width, height: action.height },
    actionLocal: { x: action.x, y: action.y, parentId: action.parent?.id },
    listInsidePane: inside(list),
    actionInsidePane: inside(action),
    listBeforeAction: list.screenY + list.height <= action.screenY,
    actionInViewport:
      action.screenX >= 0 &&
      action.screenX + action.width <= setup.renderer.width &&
      action.screenY >= 0 &&
      action.screenY + action.height <= setup.renderer.height,
    actionGap: action.screenY - (list.screenY + list.height),
    actionWithinScrollViewport:
      scroll instanceof ScrollBoxRenderable &&
      action.screenY >= scroll.screenY &&
      action.screenY + action.height <= scroll.screenY + scroll.height,
    scroll:
      scroll instanceof ScrollBoxRenderable
        ? {
            id: scroll.id,
            viewportY: scroll.screenY,
            viewportHeight: scroll.height,
            scrollTop: scroll.scrollTop,
            scrollHeight: scroll.scrollHeight,
            contentY: scroll.content.y,
            contentHeight: scroll.content.height,
          }
        : { id: scroll?.id, missingScrollBox: true },
  };
}

async function focusRevealedSourceAction(setup: Setup) {
  const action = await focusLive(setup, "source-updates-submit");
  const inScrollViewport = () => {
    const scroll = setup.renderer.root.findDescendantById("source-updates-scroll-region");
    return (
      !!scroll &&
      setup.renderer.root.findDescendantById("source-updates-submit") === action &&
      setup.renderer.currentFocusedRenderable === action &&
      action.screenY >= scroll.screenY &&
      action.screenY + action.height <= scroll.screenY + scroll.height
    );
  };
  for (let frame = 0; frame < 3 && !inScrollViewport(); frame++) await setup.renderOnce();
  try {
    await setup.waitFor(inScrollViewport, { maxPasses: 200 });
  } catch (error) {
    throw new Error(
      `Focused Source submit did not become visible; focused=${setup.renderer.currentFocusedRenderable?.id ?? "none"}; ${JSON.stringify(updatesPaneGeometry(setup, "source-updates-browser", "source-updates-submit"))}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
  expect(setup.renderer.root.findDescendantById("source-updates-submit")).toBe(action);
  return action;
}

async function reachUpdatesCheckFromList(setup: Setup) {
  const browser = await focusLive(setup, "updates-browser");
  if (!(browser instanceof SelectRenderable))
    throw new Error("Updates list is not a native Select");
  const check = setup.renderer.root.findDescendantById("updates-check");
  if (!check) throw new Error("Updates Check command is not mounted");
  setup.mockInput.pressArrow("down");
  await setup.renderOnce();
  const inScrollViewport = () => {
    const scroll = setup.renderer.root.findDescendantById("updates-scroll-region");
    return (
      setup.renderer.currentFocusedRenderable === check &&
      setup.renderer.root.findDescendantById("updates-check") === check &&
      !!scroll &&
      check.screenY >= scroll.screenY &&
      check.screenY + check.height <= scroll.screenY + scroll.height
    );
  };
  try {
    await setup.waitFor(inScrollViewport, { maxPasses: 200 });
  } catch (error) {
    throw new Error(
      `Down from Updates list did not reveal Check; listIndex=${browser.getSelectedIndex()}/${browser.options.length}; focused=${setup.renderer.currentFocusedRenderable?.id ?? "none"}; ${JSON.stringify(updatesPaneGeometry(setup, "updates-browser", "updates-check"))}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
  return check;
}

async function expectUpdateReview(setup: Setup, targets: readonly string[]) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-review-cancel"), {
    maxPasses: 200,
  });
  const containsTargets = (frame: string) =>
    frame.includes("Exact update targets") && targets.every((target) => frame.includes(target));
  try {
    await setup.waitForFrame(containsTargets, { maxPasses: 200 });
  } catch (error) {
    throw new Error(
      `Update review frame did not show exact targets [${targets.join(", ")}]; modalMounted=${!!setup.renderer.root.findDescendantById("updates-review-cancel")}; executeMounted=${!!setup.renderer.root.findDescendantById("updates-review-execute")}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
  const frame = setup.captureCharFrame();
  expect(containsTargets(frame)).toBe(true);
  return frame;
}

async function cancelUpdateReview(setup: Setup) {
  await enterLive(setup, "updates-review-cancel");
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("updates-review-cancel"), {
    maxPasses: 200,
  });
}

async function executeUpdateReview(setup: Setup) {
  await enterLive(setup, "updates-review-execute");
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("updates-review-execute"), {
    maxPasses: 200,
  });
}

async function waitForAcceptanceStage(
  setup: Setup,
  stage: string,
  ready: () => boolean,
  ids: readonly string[],
  calls: { readonly checks?: readonly string[]; readonly updates?: readonly unknown[] } = {},
) {
  try {
    await setup.waitFor(ready, { maxPasses: 200 });
  } catch (error) {
    const mounted = ids.map((id) => {
      const target = setup.renderer.root.findDescendantById(id);
      return `${id}=${target && !target.isDestroyed && target.parent ? "mounted" : "absent"}`;
    });
    throw new Error(
      `${stage}: bounded wait did not settle; focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}; ${mounted.join(", ")}; checks=${JSON.stringify(calls.checks ?? [])}; updates=${JSON.stringify(calls.updates ?? [])}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
}

async function enterAcceptanceAction(
  setup: Setup,
  stage: string,
  id: string,
  followUpIds: readonly string[],
  calls: { readonly checks?: readonly string[]; readonly updates?: readonly unknown[] } = {},
) {
  try {
    await enterLive(setup, id);
  } catch (error) {
    const mounted = followUpIds.map((candidate) => {
      const target = setup.renderer.root.findDescendantById(candidate);
      return `${candidate}=${target && !target.isDestroyed && target.parent ? "mounted" : "absent"}`;
    });
    throw new Error(
      `${stage}: could not focus/activate ${id}; target=${setup.renderer.root.findDescendantById(id)?.id ?? "absent"}; focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}; ${mounted.join(", ")}; checks=${JSON.stringify(calls.checks ?? [])}; updates=${JSON.stringify(calls.updates ?? [])}\n${setup.captureCharFrame()}`,
      { cause: error },
    );
  }
}

test("App Updates keeps twelve Sources, one long check error and batch actions inside each supported viewport", async () => {
  const projection = sourceFixture();
  const checks: string[] = [];
  const completed: string[] = [];
  const core = directSourceCore(projection, {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      try {
        if (source === "source-12") throw new Error(longFailure);
        return { value: observation(source, []), diagnostics: [] };
      } finally {
        completed.push(source);
      }
    },
    loadInstalled: async () => {
      throw new Error("Updates must not read installed Skill content");
    },
  });
  const mounted = await renderApp(core, { width: 80, height: 16 });
  const setup = mounted.setup;
  try {
    await openUpdates(setup);
    // Wait for startup's per-Source completion event; do not start a competing
    // manual refresh while the session-owned queue may still be loading cache.
    await waitForCompletedSources(setup, completed, 12);
    await waitForSettledUpdateRows(setup, 12);
    expect([...checks].sort()).toEqual(
      [
        "team-main",
        ...Array.from({ length: 11 }, (_, index) => `source-${String(index + 2).padStart(2, "0")}`),
      ].sort(),
    );
    expect(new Set(completed)).toEqual(new Set(checks));
    const browser = setup.renderer.root.findDescendantById("updates-browser");
    if (!(browser instanceof SelectRenderable))
      throw new Error("Updates list is not a native Select");
    expect(browser.options).toHaveLength(12);
    const failedSource = browser.options.findIndex((option) => option.value === "group:source-12");
    expect(failedSource).toBeGreaterThanOrEqual(0);
    browser.setSelectedIndex(failedSource);
    await setup.renderOnce();
    await waitForFailedSourceRow(setup, "source-12");
    expect(browser.options[failedSource]?.name).toContain("source-12");
    expect(browser.options[failedSource]?.name).toContain("Could not check");
    expect(setup.captureCharFrame()).toContain("Remote unavailable:");
    browser.setSelectedIndex(0);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Remote unavailable:");
    browser.setSelectedIndex(failedSource);
    await setup.renderOnce();

    for (const [width, height] of [
      [80, 16],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.renderOnce();
      const list = setup.renderer.root.findDescendantById("updates-browser");
      if (!(list instanceof SelectRenderable))
        throw new Error("Updates list is not a native Select");
      const bounds = updatesPaneGeometry(setup, "updates-browser", "updates-check");
      expect(
        bounds.listInsidePane,
        `initial Updates list at ${width}x${height}: ${JSON.stringify(bounds)}`,
      ).toBe(true);
      expect(
        list.height,
        `long error must leave at least two list rows at ${width}x${height}`,
      ).toBeGreaterThanOrEqual(2);
      const focusedCheck = await reachUpdatesCheckFromList(setup);
      expect(setup.renderer.currentFocusedRenderable).toBe(focusedCheck);
      const revealed = updatesPaneGeometry(setup, "updates-browser", "updates-check");
      expect(revealed.actionInsidePane, JSON.stringify(revealed)).toBe(true);
      expect(revealed.actionInViewport, `${width}x${height}: ${JSON.stringify(revealed)}`).toBe(
        true,
      );
      expect(revealed.actionWithinScrollViewport, JSON.stringify(revealed)).toBe(true);
      expect(revealed.actionLocal.parentId).toBeTruthy();
      if (width === 80 && height === 16)
        expect(
          revealed.actionGap,
          `short list should keep actions local: ${JSON.stringify(revealed)}`,
        ).toBeLessThanOrEqual(4);
    }
  } finally {
    setup.renderer.destroy();
    mounted.restoreCachePath();
  }
});

test("App Updates keeps actions next to a short Source list at 80x16 and 43x30", async () => {
  const checks: string[] = [];
  const completed: string[] = [];
  const core = directSourceCore(sourceFixture(2), {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      try {
        return { value: observation(source, []), diagnostics: [] };
      } finally {
        completed.push(source);
      }
    },
  });
  const mounted = await renderApp(core, { width: 80, height: 16 });
  const setup = mounted.setup;
  try {
    await openUpdates(setup);
    await waitForCompletedSources(setup, completed, 2);
    await waitForSettledUpdateRows(setup, 2);
    for (const [width, height] of [
      [80, 16],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.renderOnce();
      const browser = setup.renderer.root.findDescendantById("updates-browser");
      const check = setup.renderer.root.findDescendantById("updates-check");
      expect(browser).toBeDefined();
      expect(check).toBeDefined();
      if (browser && check) {
        expect(check.screenY - (browser.screenY + browser.height)).toBeGreaterThanOrEqual(0);
      }
      const bounds = updatesPaneGeometry(setup, "updates-browser", "updates-check");
      expect(bounds.actionInsidePane, JSON.stringify(bounds)).toBe(true);
      expect(bounds.listBeforeAction, JSON.stringify(bounds)).toBe(true);
      expect(bounds.actionInViewport, `${width}x${height}: ${JSON.stringify(bounds)}`).toBe(true);
      if (browser && check)
        expect(check.screenY - (browser.screenY + browser.height)).toBeLessThanOrEqual(4);
    }
  } finally {
    setup.renderer.destroy();
    mounted.restoreCachePath();
  }
});

test("App Updates Enter opens the Source work area; semantic Back restores the prior Updates row", async () => {
  const projection = sourceFixture(2);
  const checks: string[] = [];
  const completed: string[] = [];
  const core = directSourceCore(projection, {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      try {
        return {
          value: observation(source, source === "team-main" ? ["alpha", "bravo", "charlie"] : []),
          diagnostics: [],
        };
      } finally {
        completed.push(source);
      }
    },
    loadInstalled: async () => {
      throw new Error("Opening a Source must use the installed projection, not read SKILL.md");
    },
  });
  const mounted = await renderApp(core, { width: 80, height: 24 });
  const setup = mounted.setup;
  try {
    await openUpdates(setup);
    await waitForCompletedSources(setup, completed, 2);
    await waitForSettledUpdateRows(setup, 2);
    await setup.waitFor(
      () => {
        const list = setup.renderer.root.findDescendantById("updates-browser");
        return (
          list instanceof SelectRenderable &&
          list.options.every((option) => !/checking|pending|not checked/i.test(option.name))
        );
      },
      { maxPasses: 200 },
    );
    await setup.waitFor(() => setup.captureCharFrame().includes("3 updates"), { maxPasses: 200 });

    // The Source row is activated as an object; it is not expanded into an Updates Skill tree.
    const updates = setup.renderer.root.findDescendantById("updates-browser");
    if (!(updates instanceof SelectRenderable))
      throw new Error("Updates list is not a native Select");
    const sourceRow = updates.options.findIndex((option) => option.value === "group:team-main");
    expect(sourceRow).toBeGreaterThanOrEqual(0);
    updates.setSelectedIndex(sourceRow);
    await setup.renderOnce();
    await focusLive(setup, "updates-browser");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"), {
      maxPasses: 200,
    });

    const sourceSkills = setup.renderer.root.findDescendantById("source-updates-browser");
    expect(sourceSkills).toBeInstanceOf(SelectRenderable);
    if (sourceSkills instanceof SelectRenderable)
      expect(sourceSkills.options.map((option) => option.value)).toEqual([
        "team-main\u0000alpha",
        "team-main\u0000bravo",
        "team-main\u0000charlie",
      ]);

    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"), {
      maxPasses: 200,
    });
    const restored = setup.renderer.root.findDescendantById("updates-browser");
    expect(restored).toBeInstanceOf(SelectRenderable);
    if (restored instanceof SelectRenderable)
      expect(restored.getSelectedOption()?.value).toBe("group:team-main");
  } finally {
    setup.renderer.destroy();
    mounted.restoreCachePath();
  }
});

test("Source query filtering preserves hidden update selections across semantic Back and Source re-entry", async () => {
  const checks: string[] = [];
  const completed: string[] = [];
  const updates: { source: string; paths: readonly string[] }[] = [];
  const core = directSourceCore(sourceFixture(2), {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      try {
        return {
          value: observation(source, source === "team-main" ? ["alpha", "bravo", "charlie"] : []),
          diagnostics: [],
        };
      } finally {
        completed.push(source);
      }
    },
    update: async ({ source, paths }) => {
      updates.push({ source, paths });
      return { value: undefined, diagnostics: [] };
    },
    loadInstalled: async () => {
      throw new Error("Source query filtering must not read installed Skill content");
    },
  });
  const mounted = await renderApp(core, { width: 80, height: 24 });
  const setup = mounted.setup;
  try {
    await openUpdates(setup);
    await waitForCompletedSources(setup, completed, 2);
    await waitForSettledUpdateRows(setup, 2);
    await selectOption(setup, "updates-browser", "group:team-main");
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"), {
      maxPasses: 200,
    });

    const sourceList = setup.renderer.root.findDescendantById("source-updates-browser");
    if (!(sourceList instanceof SelectRenderable))
      throw new Error("Source Skills list is not a native Select");
    for (const path of ["bravo", "charlie"] as const) {
      const addressKey = `team-main\u0000${path}`;
      const index = sourceList.options.findIndex((option) => option.value === addressKey);
      expect(index, `missing installed address ${addressKey}`).toBeGreaterThanOrEqual(0);
      sourceList.setSelectedIndex(index);
      await setup.renderOnce();
      setup.mockInput.pressKey(" ");
      await setup.renderOnce();
    }

    const query = setup.renderer.root.findDescendantById("source-updates-query");
    if (!(query instanceof InputRenderable)) throw new Error("Source query is not a native input");
    await focusLive(setup, "source-updates-query");
    for (const character of "bravo") {
      setup.mockInput.pressKey(character);
      await setup.renderOnce();
    }
    await setup.waitFor(
      () => {
        const list = setup.renderer.root.findDescendantById("source-updates-browser");
        return (
          list instanceof SelectRenderable &&
          list.options.length === 1 &&
          list.options[0]?.value === "team-main\u0000bravo"
        );
      },
      { maxPasses: 200 },
    );
    expect(query.value).toBe("bravo");
    expect(setup.captureCharFrame()).toContain("1 selected Skills hidden by this view");

    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id !== "source-updates-query",
      { maxPasses: 200 },
    );
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"), {
      maxPasses: 200,
    });
    expect(setup.captureCharFrame()).toContain("current workspace");
    await selectOption(setup, "updates-browser", "group:team-main");
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"), {
      maxPasses: 200,
    });

    const restoredQuery = setup.renderer.root.findDescendantById("source-updates-query");
    const restoredList = setup.renderer.root.findDescendantById("source-updates-browser");
    if (!(restoredQuery instanceof InputRenderable))
      throw new Error("Source query input did not restore as a native input");
    if (!(restoredList instanceof SelectRenderable))
      throw new Error("Source Skills list did not restore as a native Select");
    try {
      await setup.waitFor(
        () => {
          const currentQuery = setup.renderer.root.findDescendantById("source-updates-query");
          const currentList = setup.renderer.root.findDescendantById("source-updates-browser");
          return (
            currentQuery instanceof InputRenderable &&
            currentList instanceof SelectRenderable &&
            currentQuery.value === "bravo" &&
            currentList.options.length === 1 &&
            currentList.options[0]?.value === "team-main\u0000bravo"
          );
        },
        { maxPasses: 200 },
      );
    } catch (error) {
      const currentQuery = setup.renderer.root.findDescendantById("source-updates-query");
      const currentList = setup.renderer.root.findDescendantById("source-updates-browser");
      throw new Error(
        `Source re-entry did not restore query/draft: currentQuery=${currentQuery instanceof InputRenderable ? JSON.stringify(currentQuery.value) : "unmounted"}; sameRenderable=${currentQuery === restoredQuery}; options=${currentList instanceof SelectRenderable ? currentList.options.map((option) => `${option.value}:${option.name}`).join(" | ") : "unmounted"}; focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}\n${setup.captureCharFrame()}`,
        { cause: error },
      );
    }
    const liveRestoredQuery = setup.renderer.root.findDescendantById("source-updates-query");
    const liveRestoredList = setup.renderer.root.findDescendantById("source-updates-browser");
    if (!(liveRestoredQuery instanceof InputRenderable))
      throw new Error("Restored Source query stopped being mounted");
    if (!(liveRestoredList instanceof SelectRenderable))
      throw new Error("Restored Source list stopped being mounted");
    expect(liveRestoredQuery.value).toBe("bravo");
    expect(liveRestoredList.options).toHaveLength(1);
    expect(liveRestoredList.options[0]?.value).toBe("team-main\u0000bravo");
    expect(liveRestoredList.options[0]?.name).toContain("✓");
    expect(setup.captureCharFrame()).toContain("1 selected Skills hidden by this view");

    await enterLive(setup, "source-updates-submit");
    await expectUpdateReview(setup, ["team-main/bravo", "team-main/charlie"]);
    expect(updates).toEqual([]);
    await cancelUpdateReview(setup);
    expect(updates).toEqual([]);
    expect(setup.captureCharFrame()).toContain("1 selected Skills hidden by this view");
    expect(liveRestoredQuery.value).toBe("bravo");

    await enterLive(setup, "source-updates-submit");
    await expectUpdateReview(setup, ["team-main/bravo", "team-main/charlie"]);
    await executeUpdateReview(setup);
    await setup.waitFor(() => updates.length === 1, { maxPasses: 200 });
    expect(updates).toEqual([{ source: "team-main", paths: ["bravo", "charlie"] }]);
    expect(checks).toEqual(["team-main", "source-02"]);
  } finally {
    setup.renderer.destroy();
    mounted.restoreCachePath();
  }
});

test("Source secondary action reviews the whole Source without seeding its item-selection draft", async () => {
  const checks: string[] = [];
  const completed: string[] = [];
  const updates: { source: string; paths: readonly string[] }[] = [];
  const core = directSourceCore(sourceFixture(2), {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      try {
        return {
          value: observation(source, source === "team-main" ? ["alpha", "bravo", "charlie"] : []),
          diagnostics: [],
        };
      } finally {
        completed.push(source);
      }
    },
    update: async ({ source, paths }) => {
      updates.push({ source, paths });
      return { value: undefined, diagnostics: [] };
    },
    loadInstalled: async () => {
      throw new Error("Whole-Source update review must not read installed Skill content");
    },
  });
  const mounted = await renderApp(core, { width: 80, height: 24 });
  const setup = mounted.setup;
  try {
    await openUpdates(setup);
    await waitForCompletedSources(setup, completed, 2);
    await waitForSettledUpdateRows(setup, 2);
    await selectOption(setup, "updates-browser", "group:team-main");
    await enterLive(setup, "updates-browser");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"), {
      maxPasses: 200,
    });
    const emptyDraftList = setup.renderer.root.findDescendantById("source-updates-browser");
    if (!(emptyDraftList instanceof SelectRenderable))
      throw new Error("Source Skills list is not a native Select");
    expect(emptyDraftList.options.map((option) => option.value)).toEqual([
      "team-main\u0000alpha",
      "team-main\u0000bravo",
      "team-main\u0000charlie",
    ]);
    expect(emptyDraftList.options.every((option) => !option.name.includes("✓"))).toBe(true);
    expect(setup.renderer.root.findDescendantById("source-updates-submit")).toBeUndefined();

    await enterAcceptanceAction(
      setup,
      "Open Source details from Source Updates",
      "source-updates-details",
      ["source-actions-toggle", "source-review-all-updates", "source-updates-browser"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Source details opened from Source Updates",
      () => !!setup.renderer.root.findDescendantById("source-actions-toggle"),
      [
        "source-metadata",
        "source-actions-toggle",
        "source-review-all-updates",
        "source-updates-browser",
      ],
      { checks, updates },
    );
    await enterAcceptanceAction(
      setup,
      "Open Source Details Actions",
      "source-actions-toggle",
      ["source-review-all-updates", "source-metadata"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Source Actions expanded",
      () => !!setup.renderer.root.findDescendantById("source-review-all-updates"),
      ["source-metadata", "source-actions-toggle", "source-review-all-updates"],
      { checks, updates },
    );
    await enterAcceptanceAction(
      setup,
      "Review all updates in this Source",
      "source-review-all-updates",
      ["updates-review-cancel", "updates-review-execute", "source-updates-browser"],
      { checks, updates },
    );
    const wholeSourceReview = await expectUpdateReview(setup, [
      "team-main/alpha",
      "team-main/bravo",
      "team-main/charlie",
    ]);
    expect(wholeSourceReview).toContain("Source team-main");
    expect(updates).toEqual([]);
    await cancelUpdateReview(setup);
    expect(updates).toEqual([]);
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-updates-browser"), {
      maxPasses: 200,
    });
    const stillEmptyDraft = setup.renderer.root.findDescendantById("source-updates-browser");
    if (!(stillEmptyDraft instanceof SelectRenderable))
      throw new Error("Source Skills list did not restore after review cancellation");
    expect(stillEmptyDraft.options.every((option) => !option.name.includes("✓"))).toBe(true);
    expect(setup.renderer.root.findDescendantById("source-updates-submit")).toBeUndefined();

    await enterAcceptanceAction(
      setup,
      "Reopen Source details after whole-Source review cancellation",
      "source-updates-details",
      ["source-actions-toggle", "source-review-all-updates", "source-updates-browser"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Source details reopened after review cancellation",
      () => !!setup.renderer.root.findDescendantById("source-actions-toggle"),
      [
        "source-metadata",
        "source-actions-toggle",
        "source-review-all-updates",
        "source-updates-browser",
      ],
      { checks, updates },
    );
    await enterLive(setup, "source-actions-toggle");
    await waitForAcceptanceStage(
      setup,
      "Source Actions reopened after review cancellation",
      () => !!setup.renderer.root.findDescendantById("source-review-all-updates"),
      ["source-metadata", "source-actions-toggle", "source-review-all-updates"],
      { checks, updates },
    );
    await enterAcceptanceAction(
      setup,
      "Repeat whole-Source review after cancellation",
      "source-review-all-updates",
      ["updates-review-cancel", "updates-review-execute", "source-updates-browser"],
      { checks, updates },
    );
    await expectUpdateReview(setup, ["team-main/alpha", "team-main/bravo", "team-main/charlie"]);
    await executeUpdateReview(setup);
    await waitForAcceptanceStage(
      setup,
      "Whole-Source reviewed update executed",
      () => updates.length === 1,
      ["updates-review-cancel", "updates-review-execute", "source-updates-browser"],
      { checks, updates },
    );
    expect(updates).toEqual([{ source: "team-main", paths: ["alpha", "bravo", "charlie"] }]);
    expect(checks).toEqual(["team-main", "source-02"]);
  } finally {
    setup.renderer.destroy();
    mounted.restoreCachePath();
  }
});

test("Source-scoped update drafts stay separate from the original Collection range draft", async () => {
  const projection = collectionFixture();
  // The work-area handoff is exercised through App; Source selection is a separate
  // empty-by-default draft from the original Collection's one-address update range.
  const updates: { source: string; paths: readonly string[] }[] = [];
  const checks: string[] = [];
  const completed: string[] = [];
  const core = directSourceCore(projection, {
    checkUpdate: async ({ source }) => {
      checks.push(source);
      try {
        return {
          value: observation(
            source,
            source === "team-main" ? ["alpha", "bravo", "charlie"] : ["bravo"],
          ),
          diagnostics: [],
        };
      } finally {
        completed.push(source);
      }
    },
    update: async ({ source, paths }) => {
      updates.push({ source, paths });
      return { value: undefined, diagnostics: [] };
    },
    loadInstalled: async () => {
      throw new Error("Update range navigation must not read installed Skill content");
    },
  });
  const mounted = await renderApp(core, { width: 80, height: 24 });
  const setup = mounted.setup;
  try {
    await waitForCompletedSources(setup, completed, 2);
    await waitForAcceptanceStage(
      setup,
      "Collection section available after startup checks",
      () => !!setup.renderer.root.findDescendantById("shell-section-tab-collections"),
      ["shell-section-tab-collections", "collection-browser"],
      { checks, updates },
    );
    await enterLive(setup, "shell-section-tab-collections");
    const collectionBrowser = await focusLive(setup, "collection-browser");
    if (!(collectionBrowser instanceof SelectRenderable))
      throw new Error("Collection list is not a native Select");
    const collectionIndex = collectionBrowser.options.findIndex(
      (option) => option.value === "release",
    );
    expect(collectionIndex).toBeGreaterThanOrEqual(0);
    collectionBrowser.setSelectedIndex(collectionIndex);
    await setup.renderOnce();
    await enterLive(setup, "collection-browser");
    await waitForAcceptanceStage(
      setup,
      "Collection detail opened",
      () => !!setup.renderer.root.findDescendantById("collection-actions-toggle"),
      ["collection-browser", "collection-detail-pane", "collection-actions-toggle"],
      { checks, updates },
    );
    await enterLive(setup, "collection-actions-toggle");
    await waitForAcceptanceStage(
      setup,
      "Collection update action revealed",
      () => !!setup.renderer.root.findDescendantById("collection-action-collection-check-updates"),
      ["collection-actions-toggle", "collection-action-collection-check-updates"],
      { checks, updates },
    );
    const checksBeforeCollectionRefresh = checks.filter((source) => source === "team-main").length;
    const completedBeforeCollectionRefresh = completed.filter(
      (source) => source === "team-main",
    ).length;
    await enterAcceptanceAction(
      setup,
      "Enter Collection update scope",
      "collection-action-collection-check-updates",
      ["updates-page", "updates-browser", "updates-review-cancel"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Collection Updates page mounted",
      () => !!setup.renderer.root.findDescendantById("updates-browser"),
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Collection-scope check request started",
      () =>
        checks.filter((source) => source === "team-main").length > checksBeforeCollectionRefresh,
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Collection-scope check completed",
      () =>
        completed.filter((source) => source === "team-main").length >
        completedBeforeCollectionRefresh,
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    await waitForSettledUpdateRows(setup, 1);
    await setup.waitFor(() => setup.captureCharFrame().includes("1 updates"), { maxPasses: 200 });
    expect(setup.captureCharFrame()).toContain("Collection release");
    await selectOption(setup, "updates-browser", "group:team-main");
    await focusLive(setup, "updates-browser");
    setup.mockInput.pressEnter();
    await waitForAcceptanceStage(
      setup,
      "Open Source from the Collection Updates row",
      () => !!setup.renderer.root.findDescendantById("source-updates-browser"),
      ["updates-page", "updates-browser", "source-updates-page", "source-updates-browser"],
      { checks, updates },
    );

    const skills = await focusLive(setup, "source-updates-browser");
    if (!(skills instanceof SelectRenderable))
      throw new Error("Source Skills list is not a native Select");
    expect(skills.isDestroyed).toBe(false);
    expect(skills.parent).toBeDefined();
    expect(skills.options.map((option) => option.value)).toEqual([
      "team-main\u0000alpha",
      "team-main\u0000bravo",
      "team-main\u0000charlie",
    ]);
    expect(skills.options.every((option) => !option.name.includes("✓"))).toBe(true);
    const sourceDraft = [
      { source: "team-main", path: "bravo" },
      { source: "team-main", path: "charlie" },
    ] as const;
    for (const address of sourceDraft) {
      const value = `${address.source}\u0000${address.path}`;
      const index = skills.options.findIndex((option) => option.value === value);
      expect(index, `missing Source Skill ${value}`).toBeGreaterThanOrEqual(0);
      skills.setSelectedIndex(index);
      await setup.renderOnce();
      setup.mockInput.pressKey(" ");
      await setup.renderOnce();
    }
    const sourceSubmit = setup.renderer.root.findDescendantById("source-updates-submit");
    expect(sourceSubmit).toBeDefined();
    const focusedSubmit = await focusRevealedSourceAction(setup);
    expect(setup.renderer.currentFocusedRenderable).toBe(focusedSubmit);
    for (const [width, height] of [
      [80, 16],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.renderOnce();
      await focusRevealedSourceAction(setup);
      const bounds = updatesPaneGeometry(setup, "source-updates-browser", "source-updates-submit");
      expect(bounds.actionInsidePane, JSON.stringify(bounds)).toBe(true);
      expect(bounds.actionInViewport, `${width}x${height}: ${JSON.stringify(bounds)}`).toBe(true);
      expect(bounds.actionWithinScrollViewport, JSON.stringify(bounds)).toBe(true);
      expect(
        bounds.action.y,
        `Source action must be in its pane after reveal: ${JSON.stringify(bounds)}`,
      ).toBeGreaterThanOrEqual(bounds.pane.y + 1);
      expect(bounds.action.y + bounds.action.height).toBeLessThanOrEqual(
        bounds.pane.y + bounds.pane.height - 1,
      );
    }
    await enterAcceptanceAction(
      setup,
      "Review exactly the two selected Source Skills",
      "source-updates-submit",
      ["updates-review-cancel", "updates-review-execute", "source-updates-browser"],
      { checks, updates },
    );
    const sourceScopeReview = await expectUpdateReview(setup, [
      "team-main/bravo",
      "team-main/charlie",
    ]);
    expect(sourceScopeReview).toContain("Scope: Source team-main");
    expect(updates).toEqual([]);
    await executeUpdateReview(setup);
    await waitForAcceptanceStage(
      setup,
      "Execute the reviewed Source-scoped targets",
      () => updates.length === 1,
      ["updates-review-cancel", "updates-review-execute", "updates-browser"],
      { checks, updates },
    );
    expect(updates).toEqual([
      { source: "team-main", paths: sourceDraft.map((address) => address.path) },
    ]);

    await parsedEscape(setup);
    await waitForAcceptanceStage(
      setup,
      "Back restores the Collection Updates scope",
      () => !!setup.renderer.root.findDescendantById("updates-browser"),
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    expect(setup.captureCharFrame()).toContain("Collection release");
    expect(setup.captureCharFrame()).toContain("team-main");
    const checksBeforeRestoredScopeRefresh = checks.filter(
      (source) => source === "team-main",
    ).length;
    const completedBeforeRestoredScopeRefresh = completed.filter(
      (source) => source === "team-main",
    ).length;
    await enterLive(setup, "updates-check");
    await waitForAcceptanceStage(
      setup,
      "Restored Collection-scope check request started",
      () =>
        checks.filter((source) => source === "team-main").length > checksBeforeRestoredScopeRefresh,
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    await waitForAcceptanceStage(
      setup,
      "Restored Collection-scope check completed",
      () =>
        completed.filter((source) => source === "team-main").length >
        completedBeforeRestoredScopeRefresh,
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    await waitForSettledUpdateRows(setup, 1);
    await waitForAcceptanceStage(
      setup,
      "Restored Collection check publishes its exact eligible row",
      () => setup.captureCharFrame().includes("1 updates"),
      ["updates-page", "updates-browser", "updates-check", "updates-update-all"],
      { checks, updates },
    );
    await enterAcceptanceAction(
      setup,
      "Review the restored Collection's original update range",
      "updates-update-all",
      ["updates-review-cancel", "updates-review-execute", "updates-browser"],
      { checks, updates },
    );
    const collectionReview = await expectUpdateReview(setup, ["team-main/alpha"]);
    expect(collectionReview).toContain("Scope: Collection release");
    const submittedBeforeCollectionCancel = [...updates];
    expect(submittedBeforeCollectionCancel).toEqual([
      { source: "team-main", paths: ["bravo", "charlie"] },
    ]);
    await cancelUpdateReview(setup);
    expect(updates).toEqual(submittedBeforeCollectionCancel);
    expect(setup.captureCharFrame()).toContain("Collection release");
    await waitForAcceptanceStage(
      setup,
      "Collection review cancellation preserves eligible update action",
      () => !!setup.renderer.root.findDescendantById("updates-update-all"),
      ["updates-page", "updates-browser", "updates-update-all"],
      { checks, updates },
    );
    await enterAcceptanceAction(
      setup,
      "Re-review the original Collection target after cancellation",
      "updates-update-all",
      ["updates-review-cancel", "updates-review-execute", "updates-browser"],
      { checks, updates },
    );
    const executeCollectionReview = await expectUpdateReview(setup, ["team-main/alpha"]);
    expect(executeCollectionReview).toContain("Scope: Collection release");
    await executeUpdateReview(setup);
    await waitForAcceptanceStage(
      setup,
      "Collection-reviewed update executed",
      () => updates.length === 2,
      ["updates-review-cancel", "updates-review-execute", "updates-browser", "updates-update-all"],
      { checks, updates },
    );
    expect(updates[1]).toEqual({ source: "team-main", paths: ["alpha"] });
  } finally {
    setup.renderer.destroy();
    mounted.restoreCachePath();
  }
});
