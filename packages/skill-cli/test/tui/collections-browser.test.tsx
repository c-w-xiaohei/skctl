import { expect, test } from "bun:test";
import { SelectRenderable, TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { collectionFilterValues, filterCollections } from "../../src/tui/collections-filter";
import { collectionMemberOriginIntent } from "../../src/tui/collections-page";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

async function navigateToCollections(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills"),
  );
  setup.renderer.root.findDescendantById("workspace-section-browser-tab-skills")!.focus();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-skills",
  );
  setup.mockInput.pressArrow("right");
  await setup.waitFor(
    () =>
      setup.renderer.currentFocusedRenderable?.id === "workspace-section-browser-tab-collections",
  );
  setup.mockInput.pressEnter();
}

async function openDetails(setup: Awaited<ReturnType<typeof testRender>>, skill: string) {
  await setup.waitFor(
    () =>
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      )?.getSelectedOption()?.value === skill &&
      setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressKey("TAB");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
  setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressKey("ARROW_RIGHT");
  await setup.waitFor(
    () =>
      (
        setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
      )?.getSelectedIndex() === 2 && setup.captureCharFrame().includes(`Address  ${skill}`),
  );
}

test("FILTER Collections combines semantic facts without Core calls", () => {
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/a" };
  const collections = [
    {
      id: "engineering",
      declared: [owner],
      repository: { derived: false, producers: [] },
      members: [{ name: "review", address: { source: "main", path: "review" }, paths: [] }],
      references: [{ name: "docs", collection: "docs", description: "Read docs", owner }],
      links: [],
    },
    {
      id: "empty",
      declared: [],
      repository: { derived: false, producers: [] },
      members: [],
      references: [],
      links: [],
    },
  ];
  expect(
    filterCollections(collections, {
      query: "READ",
      filters: { "Contains Skill": "main/review", Config: "project" },
    }).map((item) => item.id),
  ).toEqual(["engineering"]);
  expect(filterCollections(collections, { query: "missing", filters: {} })).toEqual([]);
});

test("COLLECTION direct Membership intent preserves entry, address, Collection, and owner", () => {
  const owner = {
    level: "project" as const,
    file: "/project.jsonc",
    pointer: "/collections/engineering",
  };
  expect(
    collectionMemberOriginIntent(
      "engineering",
      { name: "stable-review", address: { source: "team-main", path: "review" } },
      { kind: "direct", collection: "engineering", entryName: "stable-review", owner },
    ),
  ).toEqual({
    kind: "collection-direct",
    collection: "engineering",
    name: "stable-review",
    address: { source: "team-main", path: "review" },
    owner,
  });
});

test("COLLECTION member origins preserve contribution, producer, and outer Link routes", () => {
  const owner = {
    level: "global" as const,
    file: "/global.jsonc",
    pointer: "/collections/engineering",
    contribution: {
      configSource: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/configSources/team",
      },
      declaration: { level: "global" as const, pointer: "/collections/engineering" },
    },
  };
  const member = { name: "guide", address: { source: "team", path: "guide" } };
  expect(
    collectionMemberOriginIntent("engineering", member, {
      kind: "direct",
      collection: "engineering",
      entryName: "guide",
      owner,
    }),
  ).toMatchObject({ kind: "collection-contribution", collection: "engineering", owner });
  expect(
    collectionMemberOriginIntent("engineering", member, {
      kind: "repository-derived",
      repository: "acme/team",
      source: "team",
      path: "guide",
    }),
  ).toEqual({
    kind: "collection-producer",
    collection: "engineering",
    address: { source: "team", path: "guide" },
  });
  expect(
    collectionMemberOriginIntent("engineering", member, {
      kind: "via-link",
      links: [
        { collection: "engineering", linkedCollection: "shared", owner },
        { collection: "shared", linkedCollection: "nested", owner },
      ],
    }),
  ).toMatchObject({ kind: "collection-link", collection: "engineering", target: "shared", owner });
});

test("FILTER Collection values are exact structural and explicit booleans", () => {
  const owner = { level: "global" as const, file: "/global.jsonc", pointer: "/collections/docs" };
  const collection = {
    id: "docs",
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [{ name: "guide", address: { source: "team", path: "guide" }, paths: [] }],
    references: [],
    links: [],
  };
  expect(collectionFilterValues("Contains Skill", [collection])).toEqual(["team/guide"]);
  expect(collectionFilterValues("Config", [collection])).toEqual(["global"]);
  expect(collectionFilterValues("For agents", [collection])).toEqual(["Included", "Excluded"]);
  expect(collectionFilterValues("Problems", [collection])).toEqual(["Has problems", "No problems"]);
});

test("RENDER Collection producer route lands its distinct Installed Skill in Workspace, Reader, and Details", async () => {
  const loads: string[] = [];
  let loadedReference!: () => void;
  const referenceLoaded = new Promise<void>((resolve) => {
    loadedReference = resolve;
  });
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const projection = {
    ...base,
    effective: {
      ...base.effective,
      collections: ["engineering"],
      collectionsView: [
        {
          id: "engineering",
          declared: [],
          repository: { derived: true, producers: [readerSecondAddress] },
          members: [
            {
              name: "reference",
              address: readerSecondAddress,
              paths: [
                {
                  kind: "repository-derived" as const,
                  repository: "acme/main",
                  source: readerSecondAddress.source,
                  path: readerSecondAddress.path,
                },
              ],
            },
          ],
          references: [],
          links: [],
        },
      ],
    },
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalled: (request) => {
            loads.push(request.address.path);
            const result = {
              value:
                request.address.path === readerSecondAddress.path
                  ? readerSecondContent
                  : readerContent,
              diagnostics: [],
            };
            return Promise.resolve(result).then((value) => {
              if (request.address.path === readerSecondAddress.path) loadedReference();
              return value;
            });
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.waitForFrame((frame) => frame.includes("const needle = true;"));
    await navigateToCollections(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("engineering  1 Skills");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-relationships"));
    const producer = setup.renderer.root.findDescendantById("collection-relationships");
    expect(producer).toBeInstanceOf(SelectRenderable);
    producer!.focus();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === producer);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("Workspace › Skills"));
    await setup.waitFor(
      () =>
        (
          setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
        )?.getSelectedOption()?.value === "team-main/reference" &&
        setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(setup.renderer.root.findDescendantById("collection-browser")).toBeUndefined();
    expect(loads).toEqual(["guide", "reference"]);
    await openDetails(setup, "team-main/reference");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Address  team-main/reference");
    expect(frame).toContain("Entry name  reference");
    expect(setup.renderer.root.findDescendantById("reader-details-actions")).toBeDefined();
    await referenceLoaded;
    setup.mockInput.pressKey("ARROW_LEFT");
    setup.mockInput.pressKey("ARROW_LEFT");
    await setup.waitForFrame((value) => value.includes("other needle"));
  } finally {
    setup.renderer.destroy();
  }
});
