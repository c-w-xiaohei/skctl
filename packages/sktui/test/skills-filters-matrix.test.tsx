import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable, TextBufferRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { Diagnostic, WorkspaceView } from "@skctl/core";
import { skillAddressKey } from "@skctl/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

function filterProjection(agentStatus: "available" | "unavailable" = "available"): WorkspaceView {
  const base = readerProjection();
  const [guide, reference] = base.installedSkills;
  const contributedSource = {
    ...reference!.source!,
    id: "team-main-extra",
    provenance: {
      level: "global" as const,
      file: "/global.jsonc",
      pointer: "/sources/team-main-extra",
    },
    contribution: {
      configSource: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/configSources/shared",
      },
      declaration: {
        level: "local" as const,
        file: "/shared.jsonc",
        pointer: "/sources/reference",
      },
    },
  };
  return {
    ...base,
    effective: {
      ...base.effective,
      agent: {
        ...base.effective.agent,
        status: agentStatus,
        reasons:
          agentStatus === "unavailable"
            ? [
                {
                  code: "INCOMPLETE_COLLECTION_USE",
                  severity: "warning",
                  message: "Managed collection Use is incomplete",
                } satisfies Diagnostic,
              ]
            : [],
      },
    },
    installedSkills: [
      {
        ...guide!,
        owner: { ...guide!.owner, source: "team-main", health: "healthy" },
        source: {
          ...guide!.source!,
          id: "team-main",
          provenance: {
            level: "project",
            file: "/project.jsonc",
            pointer: "/sources/team-main",
          },
        },
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
        owner: {
          ...reference!.owner,
          source: "team-main-extra",
          health: "healthy",
        },
        source: contributedSource,
        collections: [{ id: "documentation", entry: "reference", paths: [] }],
        selectors: [],
        selectorViews: { status: "complete", values: [] },
      },
      {
        ...reference!,
        address: { source: "team-main-extra", path: "broken" },
        name: "broken",
        description: "A problem Skill",
        owner: {
          ...reference!.owner,
          source: "team-main-extra",
          health: "missing",
        },
        source: contributedSource,
        collections: [{ id: "engineering", entry: "broken", paths: [] }],
        selectors: [],
        selectorViews: { status: "unavailable" },
        problems: [
          {
            code: "SOURCE_MISSING",
            severity: "warning",
            message: "Source is missing",
          },
        ],
      },
    ],
  };
}

type Setup = Awaited<ReturnType<typeof testRender>>;

function textIn(renderable: { getChildren(): readonly unknown[] }): string {
  return (
    renderable.getChildren() as {
      getChildren?: () => readonly unknown[];
      plainText?: string;
    }[]
  )
    .flatMap((child) =>
      child instanceof TextBufferRenderable
        ? [child.plainText]
        : child.getChildren
          ? [textIn(child as { getChildren(): readonly unknown[] })]
          : [],
    )
    .join("\n");
}

async function key(setup: Setup, name: string, shift = false) {
  if (name === "ENTER") setup.mockInput.pressEnter();
  else if (name === "ARROW_DOWN") setup.mockInput.pressArrow("down");
  else setup.mockInput.pressKey(name, shift ? { shift: true } : undefined);
  await setup.renderOnce();
}

async function type(setup: Setup, value: string) {
  await setup.mockInput.pasteBracketedText(value.toLocaleLowerCase());
  await setup.renderOnce();
}

async function pressEscape(setup: Setup) {
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

async function openFilter(setup: Setup) {
  await focusAllInstalledSkills(setup);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  const query = setup.renderer.root.findDescendantById("skills-query");
  expect(query).toBeDefined();
  query!.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === query);
  const filter = setup.renderer.root.findDescendantById("open-skills-filter");
  expect(filter).toBeDefined();
  filter!.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === filter);
  setup.mockInput.pressEnter();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skills-filter-overlay"));
  await setup.renderOnce();
  const search = setup.renderer.root.findDescendantById("skills-filter-search");
  expect(search).toBeDefined();
  search!.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === search);
  await setup.waitForFrame((frame) => frame.includes("Filter Skills"));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
}

async function clickFilterOption(
  setup: Setup,
  id: "skills-filter-dimensions" | "skills-filter-values",
  value: string,
) {
  const select = setup.renderer.root.findDescendantById(id) as SelectRenderable;
  const index = select.options.findIndex((option) => option.value === value);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(select.height).toBeGreaterThan(index);
  await setup.mockMouse.click(select.screenX + 1, select.screenY + index);
  await setup.renderOnce();
}

async function chooseByKeyboard(setup: Setup, dimension: string, value: string) {
  await openFilter(setup);
  await type(setup, dimension);
  expect(
    (setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable).value,
  ).toBe(dimension.toLocaleLowerCase());
  expect(
    (
      setup.renderer.root.findDescendantById("skills-filter-dimensions") as SelectRenderable
    ).options.map((option) => option.value),
  ).toEqual([dimension]);
  await key(setup, "TAB");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-dimensions");
  await key(setup, "ENTER");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
  await type(setup, value);
  expect(
    (setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable).value,
  ).toBe(value.toLocaleLowerCase());
  await key(setup, "TAB");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-values");
  await key(setup, "ARROW_DOWN");
  await key(setup, "ENTER");
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));
}

test("RENDER Skills filter keyboard flow searches native stages and applies Collection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(filterProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    await type(setup, "Collection");
    expect(
      (setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable).value,
    ).toBe("collection");
    await key(setup, "TAB");
    await key(setup, "ENTER");
    await type(setup, "documentation");
    expect(
      (setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable).value,
    ).toBe("documentation");
    await key(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-values");
    await key(setup, "ARROW_DOWN");
    await key(setup, "ENTER");
    await setup.waitFor(() => !setup.renderer.root.findDescendantById("skills-filter-overlay"));
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills 1/3") && frame.includes("Collection: documentation"),
    );
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).options.map((option) => option.value),
    ).toEqual([skillAddressKey({ source: "team-main-extra", path: "reference" })]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([
  [120, "Enter select · Tab next control · Esc filter"],
  [43, "Enter select · Tab next control · Esc filter"],
] as const)(
  "RENDER Skills filter Escape projects its selected stage at width %i",
  async (width, selectedStageHelp) => {
    const setup = await testRender(
      () => <App core={directSourceCore(filterProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.renderOnce();
      await openFilter(setup);
      await type(setup, "Collection");
      await key(setup, "TAB");
      await key(setup, "ENTER");

      const search = () =>
        setup.renderer.root.findDescendantById("skills-filter-search") as InputRenderable;
      expect(textIn(setup.renderer.root)).toContain(selectedStageHelp);
      expect(setup.renderer.currentFocusedRenderable).toBe(search());
      expect(search().value).toBe("");
      expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBeDefined();

      await pressEscape(setup);

      await setup.waitFor(
        () => setup.renderer.root.findDescendantById("skills-filter-values") === undefined,
      );
      expect(textIn(setup.renderer.root)).toContain(
        width === 120
          ? "Enter select · Tab next control · Esc close"
          : "Enter select · Tab next control · Esc close",
      );
      expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("skills-filter-dimensions")).toBeDefined();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
      expect(search().value).toBe("");

      await pressEscape(setup);

      expect(setup.renderer.root.findDescendantById("skills-filter-overlay")).toBeUndefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("RENDER Skills filter mouse selects the exact mounted Collection value", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(filterProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    await clickFilterOption(setup, "skills-filter-dimensions", "Collection");
    expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBeDefined();
    await clickFilterOption(setup, "skills-filter-values", "documentation");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills 1/3") && frame.includes("Collection: documentation"),
    );
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).options.map((option) => option.value),
    ).toEqual([skillAddressKey({ source: "team-main-extra", path: "reference" })]);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Skills filter mouse does not infer a Collection value from row position", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(filterProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    await clickFilterOption(setup, "skills-filter-dimensions", "Collection");
    await clickFilterOption(setup, "skills-filter-values", "engineering");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills 2/3") && frame.includes("Collection: engineering"),
    );
    expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Skills filter physically distinguishes every semantic dimension", async () => {
  const cases = [
    ["Collection", "documentation", "available", "1/3", "reference"],
    ["Source", "team-main-extra", "available", "2/3", "reference"],
    ["Config", "project", "available", "1/3", "guide"],
    ["Config", "global", "available", "2/3", "reference"],
    ["Problems", "Has problems", "available", "1/3", "broken"],
  ] as const;
  for (const [dimension, value, agentStatus, count, row] of cases) {
    const setup = await testRender(
      () => <App core={directSourceCore(filterProjection(agentStatus))} exit={() => {}} />,
      { width: 120, height: 40 },
    );
    try {
      await setup.renderOnce();
      await chooseByKeyboard(setup, dimension, value);
      await setup.waitForFrame(
        (frame) => frame.includes(`Installed Skills ${count}`) && frame.includes(`${dimension}: `),
      );
      expect(
        (
          setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
        ).options.some(
          (option) =>
            option.value ===
            skillAddressKey({
              source: row === "guide" ? "team-main" : "team-main-extra",
              path: row,
            }),
        ),
      ).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  }
});
