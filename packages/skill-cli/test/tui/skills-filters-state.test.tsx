import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ManagementProjection } from "../../src/core/api";
import type { TuiCore } from "../../src/tui/effects";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";

type Setup = Awaited<ReturnType<typeof testRender>>;

function projection(): ManagementProjection {
  const base = readerProjection();
  const [guide, reference] = base.installedSkills;
  const extra = {
    ...reference!.source!,
    id: "team-main-extra",
    provenance: { level: "global" as const, file: "/global.jsonc", pointer: "/sources/extra" },
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
        owner: { ...reference!.owner, source: "team-main-extra", health: "missing" },
        source: extra,
        collections: [{ id: "documentation", entry: "broken", paths: [] }],
        selectors: [],
        selectorViews: { status: "unavailable" },
        problems: [{ code: "SOURCE_MISSING", severity: "warning", message: "Source missing" }],
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

async function chooseFilter(setup: Setup, dimension: string, value: string) {
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  await key(setup, "TAB");
  await key(setup, "TAB");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-skills-filter");
  await key(setup, "ENTER");
  await type(setup, dimension);
  await key(setup, "TAB");
  await key(setup, "ENTER");
  await type(setup, value);
  await key(setup, "TAB");
  await key(setup, "ARROW_DOWN");
  await key(setup, "ENTER");
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));
}

async function query(setup: Setup, value: string) {
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  await key(setup, "/");
  await type(setup, value);
}

function filterChipIds(setup: Setup): readonly string[] {
  return ["Collection", "Source", "Config", "For agents", "Problems"].flatMap((dimension) =>
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
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 3/3"));
    await chooseFilter(setup, "Collection", "documentation");
    await chooseFilter(setup, "Source", "team-main-extra");
    await query(setup, "reference");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/3"));
    expect(filterChipIds(setup)).toEqual(["Collection", "Source"]);
    expect(
      (setup.renderer.root.findDescendantById("clear-skills-filter-Collection") as SelectRenderable)
        .options[0]?.name,
    ).toBe("Collection: documentation");
    expect(
      (setup.renderer.root.findDescendantById("clear-skills-filter-Source") as SelectRenderable)
        .options[0]?.name,
    ).toBe("Source: team-main-extra");
    // The mounted toolbar order reaches the first chip without test-only focus mutation.
    await key(setup, "TAB");
    await key(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("clear-skills-filter-Collection");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/3"));
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "reference",
    );
    expect(filterChipIds(setup)).toEqual(["Source"]);

    await key(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("clear-all-skills-filters");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 3/3"));
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "",
    );
    expect(filterChipIds(setup)).toEqual([]);
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

test("STATE-012 RENDER source view remains the bounding context after Clear all", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await key(setup, "TAB", true);
    await key(setup, "ARROW_DOWN");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("View Installed Skills"));
    await key(setup, "ARROW_DOWN");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills from team-main"));
    await query(setup, "guide");
    await key(setup, "TAB");
    await key(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("clear-all-skills-filters");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills from team-main 1/1"));
    expect(setup.captureCharFrame()).toContain("guide");
    expect(setup.captureCharFrame()).not.toContain("reference");
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE-004 RENDER empty filtering clears action context and destination return retains local filters", async () => {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          loadInstalled: async ({ address }) => {
            loads.push(address.path);
            return { value: readerContent, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("A rich Installed Skill"));
    await query(setup, "no-such-skill");
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 0/3"));
    const emptyFrame = setup.captureCharFrame();
    expect(emptyFrame).toContain("No Installed Skills");
    expect(emptyFrame).toContain("No Installed Skill Selected");
    expect(emptyFrame).not.toContain("needle in prose");
    expect(emptyFrame).not.toContain("title: Guide");
    expect(setup.renderer.root.findDescendantById("reader-details-actions")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("reader-tabs")).toBeUndefined();
    expect(loads).toEqual(["guide"]);

    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Direct sources"));
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    await key(setup, "ENTER");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect((setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value).toBe(
      "no-such-skill",
    );
  } finally {
    setup.renderer.destroy();
  }
});

const refreshedProblemsTest = async () => {
  const base = projection();
  const initial: ManagementProjection = {
    ...base,
    installedSkills: base.installedSkills.filter((skill) => skill.address.path !== "broken"),
  };
  const refreshed: ManagementProjection = {
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
  let current: ManagementProjection = {
    ...initial,
    installedSkills: initial.installedSkills.map((skill) =>
      skill.address.path === "guide"
        ? {
            ...skill,
            problems: [{ code: "SOURCE_MISSING", severity: "warning", message: "Guide is broken" }],
          }
        : skill.address.path === "reference"
          ? { ...skill, problems: [] }
          : skill,
    ),
  };
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(current, {
          get: async () => ({ value: current, diagnostics: [] }),
          checkUpdate: async (request) => ({
            value: {
              source: request.source,
              kind: "github",
              changed: [{ path: "guide", name: "guide", description: "Refresh guide" }],
              added: [],
              removed: [],
              unchanged: [],
            },
            diagnostics: [],
          }),
          update: async () => {
            current = refreshed;
            return { value: undefined, diagnostics: [] };
          },
          loadInstalled: async ({ address }) => {
            loads.push(address.path);
            return {
              value:
                address.path === "reference"
                  ? {
                      ...readerContent,
                      address,
                      name: "reference",
                      rawText: "---\ntitle: Reference\n---\n# Reference\n",
                      markdownText: "# Reference\n",
                    }
                  : readerContent,
              diagnostics: [],
            };
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
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 1/2"));

    await key(setup, "ENTER");
    await key(setup, "TAB", true);
    await key(setup, "ARROW_RIGHT");
    await key(setup, "ENTER");
    await key(setup, "TAB", true);
    await key(setup, "ARROW_RIGHT");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Address  team-main/guide"));
    await key(setup, "TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-actions",
    );
    await key(setup, "ENTER");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-action-menu");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-operation-selection",
    );
    await setup.waitForFrame(
      (frame) => frame.includes("Changed guide") && frame.includes("Update 0 Skills"),
    );
    const updateSelection = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    ) as SelectRenderable;
    expect(updateSelection.options.map((option) => option.value)).toEqual([
      "guide",
      "cancel",
      "submit",
    ]);
    expect(updateSelection.getSelectedIndex()).toBe(0);
    await key(setup, "ENTER");
    const toggledUpdateSelection = setup.renderer.root.findDescendantById(
      "source-operation-selection",
    ) as SelectRenderable;
    expect(toggledUpdateSelection.options.map((option) => option.name)).toContain(
      "[x] Changed guide",
    );
    expect(toggledUpdateSelection.options.map((option) => option.name)).toContain(
      "Update 1 Skills",
    );
    await key(setup, "ARROW_DOWN");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitForFrame((frame) => frame.includes("Address  team-main-extra/reference"));

    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.getSelectedIndex()).toBe(0);
    expect(browser.options.map((option) => option.value)).toEqual(["team-main-extra/reference"]);
    expect(loads).toEqual(["guide", "guide", "reference"]);
    expect(setup.captureCharFrame()).toContain("Address  team-main-extra/reference");
    expect(
      (
        setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
      ).getSelectedIndex(),
    ).toBe(2);
    expect(setup.captureCharFrame()).toContain("Source moved to reference");
    expect(setup.renderer.root.findDescendantById("reader-details")).toBeDefined();
    const actions = setup.renderer.root.findDescendantById("reader-details-actions")!;
    expect(setup.renderer.currentFocusedRenderable).toBe(actions);
    await key(setup, "ENTER");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-action-menu");
    expect(
      (
        setup.renderer.root.findDescendantById("source-action-menu") as SelectRenderable
      ).options.map((option) => option.description),
    ).toContain("Check updates for Source team-main-extra");
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
      const frame = setup.captureCharFrame();
      expect(frame).toContain("1/3");
      expect(
        (setup.renderer.root.findDescendantById("skills-query") as InputRenderable).value,
      ).toBe("reference");
      expect(setup.renderer.currentFocusedRenderable).toBeDefined();
      if (width < 80) {
        expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeUndefined();
        await parsedEscape(setup);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      }
    }
    await key(setup, "TAB");
    await key(setup, "TAB");
    await key(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("clear-skills-filter-Collection");
    await key(setup, "ENTER");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("clear-all-skills-filters");
  } finally {
    setup.renderer.destroy();
  }
});

test("STATE-012 RENDER local filtering makes no workspace, provider, or management calls", async () => {
  const calls = { workspace: 0, discover: 0, checkUpdate: 0, install: 0, update: 0, remove: 0 };
  const core: TuiCore = directSourceCore(projection(), {
    get: async () => {
      calls.workspace++;
      return { value: projection(), diagnostics: [] };
    },
    discover: async (request) => {
      calls.discover++;
      return { value: { source: request.source, kind: "github", candidates: [] }, diagnostics: [] };
    },
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
    remove: async () => {
      calls.remove++;
      return { value: undefined, diagnostics: [] };
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Installed Skills 3/3"));
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
