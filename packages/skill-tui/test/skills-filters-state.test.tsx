import { expect, test } from "bun:test";
import { InputRenderable, Renderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skill-cli/core";
import { skillAddressKey } from "@skill-cli/core";
import type { TuiCore } from "../src/effects";
import { App } from "../src/app";
import { createWorkspaceState } from "../src/workspace/state";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  enterInstalledAddress,
  enterLive,
  openReaderTab,
  selectedReaderTab,
} from "./reader-test-controls";
import { readerContent, readerProjection } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

function projection(): WorkspaceView {
  const base = readerProjection();
  const [guide, reference] = base.installedSkills;
  const extra = {
    ...reference!.source!,
    id: "team-main-extra",
    provenance: {
      level: "global" as const,
      file: "/global.jsonc",
      pointer: "/sources/extra",
    },
  };
  return {
    ...base,
    installedSkills: [
      {
        ...guide!,
        collections: [{ id: "engineering", entry: "guide", paths: [] }],
        selectors: ["engineering:guide"],
        selectorViews: {
          status: "complete",
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: [],
              useOwners: [],
            },
          ],
        },
      },
      {
        ...reference!,
        address: { source: "team-main-extra", path: "reference" },
        owner: { ...reference!.owner, source: "team-main-extra" },
        source: extra,
        collections: [{ id: "documentation", entry: "reference", paths: [] }],
        selectors: [],
        selectorViews: { status: "complete", values: [] },
      },
      {
        ...reference!,
        address: { source: "team-main-extra", path: "broken" },
        name: "broken",
        description: "Broken documentation Skill",
        owner: {
          ...reference!.owner,
          source: "team-main-extra",
          health: "missing",
        },
        source: extra,
        collections: [{ id: "documentation", entry: "broken", paths: [] }],
        selectors: [],
        selectorViews: { status: "unavailable" },
        problems: [
          {
            code: "SOURCE_MISSING",
            severity: "warning",
            message: "Source missing",
          },
        ],
      },
    ],
  };
}

async function key(setup: Setup, name: string, shift = false) {
  if (name === "ENTER") setup.mockInput.pressEnter();
  else if (name === "ARROW_DOWN") setup.mockInput.pressArrow("down");
  else setup.mockInput.pressKey(name, shift ? { shift: true } : undefined);
  await setup.renderOnce();
}

async function type(setup: Setup, value: string) {
  for (const character of value.toLocaleLowerCase()) await key(setup, character);
}

async function click(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeDefined();
  await setup.mockMouse.click(target!.screenX + 1, target!.screenY);
  await setup.renderOnce();
}

async function clickFilterOption(
  setup: Setup,
  id: "skills-filter-dimensions" | "skills-filter-values",
  value: string,
) {
  const select = setup.renderer.root.findDescendantById(id) as SelectRenderable;
  expect(select).toBeDefined();
  const index = select.options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(select.height).toBeGreaterThan(index);
  const hit = setup.renderer.hitTest(select.screenX + 1, select.screenY + index);
  const target = Renderable.renderablesByNumber.get(hit);
  expect(target === select || target?.parent === select).toBe(true);
  await setup.mockMouse.click(select.screenX + 1, select.screenY + index);
  await setup.renderOnce();
}

async function clearFilterWithKeyboard(setup: Setup, id: string) {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeDefined();
  expect(target!.isDestroyed).toBe(false);
  expect(target!.parent).toBeDefined();
  expect(target!.focusable).toBe(true);
  target!.focus();
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable === target &&
      !target!.isDestroyed &&
      target!.parent !== undefined &&
      target!.focusable,
  );
  await parsedEnter(setup);
  await setup.waitFor(() => setup.renderer.root.findDescendantById(id) === undefined);
}

async function parsedEscape(setup: Setup) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
  await setup.renderOnce();
}

async function parsedEnter(setup: Setup) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name !== "enter" && event.name !== "return") return;
      setup.renderer.keyInput.off("keypress", onKeypress);
      resolve();
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressEnter();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await setup.renderOnce();
}

async function chooseFilter(setup: Setup, dimension: string, value: string) {
  await focusAllInstalledSkills(setup);
  const query = setup.renderer.root.findDescendantById("skills-query")!;
  query.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
  const filter = setup.renderer.root.findDescendantById("open-skills-filter")!;
  filter.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === filter);
  await key(setup, "ENTER");
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-search"));
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "skills-filter-search");
  await clickFilterOption(setup, "skills-filter-dimensions", dimension);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-values"));
  await clickFilterOption(setup, "skills-filter-values", value);
  await setup.renderOnce();
  if (setup.renderer.root.findDescendantById("skills-filter-overlay"))
    throw new Error(
      `Filter remained open: focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
    );
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
  if (!browser)
    throw new Error(
      `Browser missing after filter: focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
    );
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}

async function focusAllInstalledSkills(setup: Setup) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skills-view-tab-all-installed-skills"),
  );
  const current = setup.renderer.root.findDescendantById("skills-view-tab-current-exposure")!;
  current.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === current);
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.renderOnce();
  await setup.waitFor(() => {
    const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
    return browser instanceof SelectRenderable && browser.options.length > 0;
  });
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}

async function query(setup: Setup, value: string) {
  await focusAllInstalledSkills(setup);
  const query = setup.renderer.root.findDescendantById("skills-query")!;
  query.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
  await type(setup, value);
}

function filterChipIds(setup: Setup): readonly string[] {
  return ["Collection", "Source", "Config", "Problems"].flatMap((dimension) =>
    setup.renderer.root.findDescendantById(`clear-skills-filter-${dimension}`) ? [dimension] : [],
  );
}

test("STATE-012 RENDER Skills compose query and dimensions, clear one physically, then clear all", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await chooseFilter(setup, "Collection", "documentation");
    await chooseFilter(setup, "Source", "team-main-extra");
    await query(setup, "reference");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/3"));
    expect(filterChipIds(setup)).toEqual(["Collection", "Source"]);
    expect(setup.captureCharFrame()).toContain("Collection: documentation");
    expect(setup.captureCharFrame()).toContain("Source: team-main-extra");
    await click(setup, "clear-skills-filter-Collection");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/3"));
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "reference",
    );
    expect(filterChipIds(setup)).toEqual(["Source"]);

    await clearFilterWithKeyboard(setup, "clear-skills-filter-Source");
    expect(filterChipIds(setup)).toEqual([]);

    await chooseFilter(setup, "Source", "team-main-extra");
    await click(setup, "clear-all-skills-filters");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 3/3"));
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "",
    );
    expect(filterChipIds(setup)).toEqual([]);
    expect(setup.renderer.root.findDescendantById("clear-all-skills-filters")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE-012 RENDER Skills toolbar discloses the active filter count", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await chooseFilter(setup, "Collection", "documentation");
    await chooseFilter(setup, "Source", "team-main-extra");
    expect(setup.captureCharFrame()).toContain("2 filters");
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE-012 source view remains the bounding context after Clear all", () => {
  const workspace = createWorkspaceState();
  workspace.showInstalledSkillsFromSource("team-main");
  workspace.setQuery("guide");
  workspace.setFilter("Collection", "engineering");
  workspace.clearFilters();
  expect(workspace.snapshot()).toMatchObject({
    sourceFilter: "team-main",
    query: "",
    filters: {},
  });
});

test("STATE-012 accepted refresh to empty while a filter is active clears Skill selection", () => {
  const current = projection();
  const workspace = createWorkspaceState();
  workspace.selectSkill({ source: "team-main-extra", path: "reference" });
  workspace.setFilter("Source", "team-main-extra");
  workspace.reconcile(current, { ...current, installedSkills: [] });
  expect(workspace.selectedSkill()).toBeUndefined();
});

test("STATE-004 RENDER empty filtering clears action context and destination return retains local filters", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          installed: {
            load: async ({ address }) => {
              loads.push(address.path);
              return readerContent;
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await focusAllInstalledSkills(setup);
    await query(setup, "no-such-skill");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 0/3"));
    const emptyFrame = setup.captureCharFrame();
    expect(emptyFrame).toContain("No Skills match the current search or filters");
    expect(emptyFrame).not.toContain("Select a Skill to read its SKILL.md,");
    expect(emptyFrame).not.toContain("resources, and details.");
    expect(emptyFrame).not.toContain("needle in prose");
    expect(emptyFrame).not.toContain("title: Guide");
    expect(setup.renderer.root.findDescendantById("reader-details-actions")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-views")).toBeUndefined();
    expect(loads).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});

const refreshedProblemsTest = async () => {
  const base = projection();
  const initial: WorkspaceView = {
    ...base,
    installedSkills: base.installedSkills.filter((skill) => skill.address.path !== "broken"),
  };
  const refreshed: WorkspaceView = {
    ...initial,
    installedSkills: initial.installedSkills.map((skill) =>
      skill.address.path === "guide"
        ? { ...skill, problems: [] }
        : skill.address.path === "reference"
          ? {
              ...skill,
              problems: [
                {
                  code: "SOURCE_MISSING",
                  severity: "warning",
                  message: "Source moved to reference",
                },
              ],
            }
          : skill,
    ),
  };
  let current: WorkspaceView = {
    ...initial,
    installedSkills: initial.installedSkills.map((skill) =>
      skill.address.path === "guide"
        ? {
            ...skill,
            problems: [
              {
                code: "SOURCE_MISSING",
                severity: "warning",
                message: "Guide is broken",
              },
            ],
          }
        : skill.address.path === "reference"
          ? { ...skill, problems: [] }
          : skill,
    ),
  };
  const loads: string[] = [];
  const checkedSources: string[] = [];
  const updates: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(current, {
          workspace: { get: async () => ({ value: current, diagnostics: [] }) },
          installed: {
            checkUpdate: async (request) => {
              checkedSources.push(request.source);
              return {
                value: {
                  source: request.source,
                  kind: "github",
                  changed: [{ path: "guide", name: "guide", description: "Refresh guide" }],
                  added: [],
                  removed: [],
                  unchanged: [],
                  baseline: "baseline:test",
                },
                diagnostics: [],
              };
            },
            update: async (request) => {
              updates.push(request);
              current = refreshed;
              return { value: undefined, diagnostics: [] };
            },
            load: async ({ address }) => {
              loads.push(address.path);
              return address.path === "reference"
                ? {
                    ...readerContent,
                    address,
                    name: "reference",
                    rawText: "---\ntitle: Reference\n---\n# Reference\n",
                    markdownText: "# Reference\n",
                  }
                : readerContent;
            },
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await chooseFilter(setup, "Problems", "Has problems");
    if (!setup.renderer.root.findDescendantById("clear-skills-filter-Problems"))
      throw new Error(
        `Problems filter did not apply; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
      );
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/2"));

    await enterInstalledAddress(setup, { source: "team-main", path: "guide" });
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await openReaderFromInspector(setup);
    await openReaderTab(setup, 2);
    await setup.waitForFrame((frame) => frame.includes("team-main/guide"));
    await enterLive(setup, "reader-details-action-skill-check-updates");
    await setup.waitFor(
      () => setup.renderer.root.findDescendantById("source-operation-selection") !== undefined,
    );
    await setup.waitForFrame((frame) => frame.includes("Source: team-main"));
    expect(setup.captureCharFrame()).toContain("Source: team-main");
    expect(checkedSources).toEqual(["team-main"]);
    await setup.waitForVisualIdle();
    const updateSelectionNode = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    );
    if (!updateSelectionNode)
      throw new Error(
        `Source selection unmounted after idle; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
      );
    if (updateSelectionNode.isDestroyed || !updateSelectionNode.parent)
      throw new Error(
        `Source selection stale after idle; destroyed=${updateSelectionNode.isDestroyed} parent=${updateSelectionNode.parent?.id}\n${setup.captureCharFrame()}`,
      );
    const updateSelection = updateSelectionNode as SelectRenderable;
    expect(updateSelection.options.map((option) => option.value)).toEqual(["guide"]);
    updateSelection.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === updateSelection);
    await parsedEnter(setup);
    const toggledUpdateSelection = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    ) as SelectRenderable;
    expect(toggledUpdateSelection.options.map((option) => option.name)).toContain(
      "[x] Changed guide",
    );
    await enterLive(setup, "source-operation-submit");
    await setup.waitFor(() => updates.length === 1);
    await setup.waitForFrame((frame) => frame.includes("Address  team-main-extra/reference"));

    expect(updates).toEqual([{ source: "team-main", paths: ["guide"] }]);
    expect(loads).toEqual(["guide", "reference"]);
    expect(setup.captureCharFrame()).toContain("Address  team-main-extra/reference");
    expect(selectedReaderTab(setup)).toBe(2);
    expect(setup.captureCharFrame()).toContain("Source moved");
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();
    await parsedEscape(setup);
    await parsedEscape(setup);
    const browserNode = setup.renderer.root.findDescendantById("installed-skill-browser");
    if (!browserNode)
      throw new Error(
        `Browser missing after Reader Escape; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
      );
    expect(browserNode.isDestroyed).toBe(false);
    expect(browserNode.parent).toBeDefined();
    const browser = browserNode as SelectRenderable;
    expect(browser.options.map((option) => option.value)).toEqual([
      skillAddressKey({ source: "team-main-extra", path: "reference" }),
    ]);
    expect(browser.getSelectedOption()?.value).toBe(
      skillAddressKey({ source: "team-main-extra", path: "reference" }),
    );
  } finally {
    setup.renderer.destroy();
  }
};

test("STATE-005 RENDER resize retains filters and never leaves unmounted clear focus", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await chooseFilter(setup, "Collection", "documentation");
    await query(setup, "reference");
    for (const width of [120, 79, 43, 120] as const) {
      setup.resize(width, 30);
      await setup.renderOnce();
      const browserAfterResize = setup.renderer.root.findDescendantById("installed-skill-browser");
      if (!browserAfterResize) {
        throw new Error(
          `Installed Skills browser is not mounted after resize ${width}; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
        );
      }
      if (
        !(browserAfterResize instanceof SelectRenderable) ||
        browserAfterResize.options.length === 0
      )
        throw new Error(
          `Browser missing after resize ${width}; focus=${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
        );
      const frame = setup.captureCharFrame();
      expect(frame).toContain("1/3");
      expect(
        (setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value,
      ).toBe("reference");
      expect(setup.renderer.currentFocusedRenderable).toBeDefined();
      if (width < 64) {
        expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeUndefined();
        await parsedEscape(setup);
        expect(setup.renderer.currentFocusedRenderable).toBeDefined();
      }
    }
    await click(setup, "clear-skills-filter-Collection");
    expect(filterChipIds(setup)).toEqual([]);
    await click(setup, "clear-all-skills-filters");
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE-012 RENDER local filtering makes no workspace, provider, or management calls", async () => {
  const calls = {
    workspace: 0,
    discover: 0,
    checkUpdate: 0,
    install: 0,
    update: 0,
    remove: 0,
  };
  const core: TuiCore = directSourceCore(projection(), {
    workspace: {
      get: async () => {
        calls.workspace++;
        return { value: projection(), diagnostics: [] };
      },
    },
    sources: {
      discover: async (request) => {
        calls.discover++;
        return {
          value: { source: request.source, kind: "github", candidates: [] },
          diagnostics: [],
        };
      },
      remove: async () => {
        calls.remove++;
        return { value: undefined, diagnostics: [] };
      },
    },
    installed: {
      checkUpdate: async (request) => {
        calls.checkUpdate++;
        return {
          value: {
            source: request.source,
            kind: "github",
            changed: [],
            added: [],
            removed: [],
            unchanged: [],
            baseline: "baseline:test",
          },
          diagnostics: [],
        };
      },
      install: async () => {
        calls.install++;
        return { value: [], diagnostics: [] };
      },
      update: async () => {
        calls.update++;
        return { value: undefined, diagnostics: [] };
      },
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.renderOnce();
    await focusAllInstalledSkills(setup);
    expect(calls.workspace).toBe(1);
    await chooseFilter(setup, "Collection", "documentation");
    await query(setup, "reference");
    await key(setup, "TAB");
    await key(setup, "TAB");
    await key(setup, "ENTER");
    expect(calls).toEqual({
      workspace: 1,
      discover: 0,
      checkUpdate: 0,
      install: 0,
      update: 0,
      remove: 0,
    });
  } finally {
    setup.renderer.destroy();
  }
});

test(
  "STATE-012 RENDER refreshed Problems membership reselects the visible Skill and its Reader actions",
  refreshedProblemsTest,
);
