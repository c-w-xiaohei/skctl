import { expect, test } from "bun:test";
import { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { Diagnostic, ManagementProjection } from "../../src/core/api";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";

function filterProjection(
  agentStatus: "available" | "unavailable" = "available",
): ManagementProjection {
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
          provenance: { level: "project", file: "/project.jsonc", pointer: "/sources/team-main" },
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
        owner: { ...reference!.owner, source: "team-main-extra", health: "healthy" },
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
        owner: { ...reference!.owner, source: "team-main-extra", health: "missing" },
        source: contributedSource,
        collections: [{ id: "engineering", entry: "broken", paths: [] }],
        selectors: [],
        selectorViews: { status: "unavailable" },
        problems: [{ code: "SOURCE_MISSING", severity: "warning", message: "Source is missing" }],
      },
    ],
  };
}

type Setup = Awaited<ReturnType<typeof testRender>>;

async function key(setup: Setup, name: string) {
  if (name === "ENTER") setup.mockInput.pressEnter();
  else if (name === "ARROW_DOWN") setup.mockInput.pressArrow("down");
  else setup.mockInput.pressKey(name);
  await setup.renderOnce();
}

async function type(setup: Setup, value: string) {
  for (const character of value.toLocaleLowerCase()) await key(setup, character);
}

async function openFilter(setup: Setup) {
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  await key(setup, "TAB");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
  await key(setup, "TAB");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-skills-filter");
  await key(setup, "ENTER");
  await setup.waitForFrame((frame) => frame.includes("Filter Skills"));
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-filter-search");
}

async function clickRow(setup: Setup, id: string) {
  const row = setup.renderer.root.findDescendantById(id);
  expect(row).toBeDefined();
  await setup.mockMouse.click(row!.screenX + 1, row!.screenY);
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
    ).toEqual(["team-main-extra/reference"]);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Skills filter mouse selects the exact mounted Collection value", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(filterProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await openFilter(setup);
    await clickRow(setup, "skills-filter-dimension-Collection");
    expect(setup.renderer.root.findDescendantById("skills-filter-values")).toBeDefined();
    await clickRow(setup, "skills-filter-value-Collection-documentation");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills 1/3") && frame.includes("Collection: documentation"),
    );
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).options.map((option) => option.value),
    ).toEqual(["team-main-extra/reference"]);
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
    await clickRow(setup, "skills-filter-dimension-Collection");
    await clickRow(setup, "skills-filter-value-Collection-engineering");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Installed Skills 2/3") && frame.includes("Collection: engineering"),
    );
    expect(
      setup.renderer.root.findDescendantById("skills-filter-value-Collection-documentation"),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Skills filter physically distinguishes every semantic dimension", async () => {
  const cases = [
    ["Collection", "documentation", "available", "1/3", "reference"],
    ["Source", "team-main-extra", "available", "2/3", "reference"],
    ["Config", "project", "available", "1/3", "guide"],
    ["Config", "global /configSources/shared", "available", "2/3", "reference"],
    ["For agents", "Available", "available", "1/3", "guide"],
    ["For agents", "Not disclosed", "available", "2/3", "reference"],
    ["For agents", "Unavailable", "unavailable", "3/3", "broken"],
    ["Problems", "Has problems", "available", "1/3", "broken"],
  ] as const;
  for (const [dimension, value, agentStatus, count, row] of cases) {
    const setup = await testRender(
      () => <App core={directSourceCore(filterProjection(agentStatus))} exit={() => {}} />,
      { width: 120, height: 40 },
    );
    try {
      await setup.renderOnce();
      if (dimension === "For agents" && value === "Unavailable") {
        expect(filterProjection(agentStatus).effective.agent.reasons).toEqual([
          {
            code: "INCOMPLETE_COLLECTION_USE",
            severity: "warning",
            message: "Managed collection Use is incomplete",
          },
        ]);
      }
      await chooseByKeyboard(setup, dimension, value);
      await setup.waitForFrame(
        (frame) => frame.includes(`Installed Skills ${count}`) && frame.includes(`${dimension}: `),
      );
      expect(
        (
          setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
        ).options.some((option) => option.value?.endsWith(`/${row}`)),
      ).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  }
});
