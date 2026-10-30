import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { App } from "../src/app";
import { exposureTreePathKey } from "../src/collections/agent-access-tree";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";
import {
  enterInstalledAddress,
  enterLive,
  expectSharedReturn,
  live,
  openAllInstalledSkills,
  openReaderManagement,
  openReaderTab,
  focusLive,
  parsedEnter,
} from "./reader-test-controls";
const address = { source: "team-main", path: "guide" };
const globalCollectionOwner = {
  level: "global" as const,
  file: "/home/user/.config/skctl.jsonc",
  pointer: "/collections/personal",
};
const useOwner = { ...globalCollectionOwner, pointer: "/use/engineering" };
const engineeringOwner = { ...globalCollectionOwner, pointer: "/collections/engineering" };
const nativeText = (node: BaseRenderable): string =>
  node instanceof TextRenderable ? node.plainText : node.getChildren().map(nativeText).join("\n");
const membershipPaths = [
  { kind: "direct" as const, collection: "engineering", entryName: "guide", owner: directOwner },
  {
    kind: "via-link" as const,
    links: [{ collection: "docs", linkedCollection: "engineering", owner: directOwner }],
  },
  {
    kind: "repository-derived" as const,
    repository: "acme/main",
    source: "team-main",
    path: "guide",
  },
];
function detailsProjection() {
  const base = workspaceProjection();
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: [
                { id: "personal", owner: globalCollectionOwner },
                { id: "engineering", owner: engineeringOwner },
              ],
              collectionUse: [{ collection: "engineering", owner: useOwner }],
            },
          }
        : config.level === "project"
          ? {
              ...config,
              direct: {
                ...config.direct,
                collections: [{ id: "engineering", owner: directOwner }],
              },
            }
          : config,
    ),
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      collections: ["engineering", "personal"],
      use: ["engineering"],
      collectionsView: [
        {
          id: "engineering",
          declared: [directOwner, engineeringOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
        {
          id: "personal",
          declared: [globalCollectionOwner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills: [
      {
        address,
        name: "guide",
        description: "A detailed Installed Skill",
        owner: {
          source: "team-main",
          health: "healthy" as const,
          relevantRemoteRevision: "abc123",
        },
        source: base.effective.sources[0]!,
        collections: [
          {
            id: "engineering",
            entry: "guide",
            paths: membershipPaths,
          },
        ],
        selectors: ["engineering:guide"],
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "engineering:guide",
              collection: "engineering",
              entry: "guide",
              paths: membershipPaths,
              useOwners: [useOwner],
              exposurePaths: [{ owner: useOwner, segments: [{ collection: "engineering" }] }],
            },
          ],
        },
        primary: "engineering:guide",
        aliases: ["docs:guide"],
        problems: [
          { code: "SOURCE_DRIFT", severity: "warning" as const, message: "Observed binding drift" },
        ],
      },
    ],
  };
}
test("Details renders provenance and routes Collection Use to its owning Config Collection", async () => {
  const projection = detailsProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: async () => ({
            address,
            name: "guide",
            description: "A detailed Installed Skill",
            rawText: "# Guide",
            markdownText: "# Guide",
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, address);
    await openReaderTab(setup, 2);
    await setup.waitFor(() =>
      nativeText(live(setup, "reader-details-summary")).includes(
        "SOURCE_DRIFT: Observed binding drift",
      ),
    );
    const summary = nativeText(live(setup, "reader-details-summary"));
    for (const value of [
      "Address\nteam-main/guide",
      "Health\nhealthy",
      "SOURCE_DRIFT: Observed binding drift",
    ])
      expect(summary).toContain(value);
    await setup.waitForFrame((frame) => frame.includes("binding drift"));
    await enterLive(setup, "reader-details-metadata");
    const details = live(setup, "reader-details");
    if (!(details instanceof ScrollBoxRenderable))
      throw new Error("Expected native Details reader");
    await setup.waitFor(() => nativeText(details).includes("Repository-derived"));
    const metadata = nativeText(details);
    for (const value of [
      "Binding\ngithub",
      "Declaration level\nproject",
      directOwner.file,
      "Origin\nhttps://github.com/acme/main",
      "Source Root\nskills",
      "Tracked ref\nmain",
      "Declaration pointer\n/sources/team-main",
      "Revision\nabc123",
      "engineering:guide (engineering:guide)",
      "Membership\nengineering:guide (project)",
      "docs->engineering (project)",
      "acme/main (team-main/guide)",
      "docs:guide",
    ])
      expect(metadata).toContain(value);
    await focusLive(setup, "reader-details");
    await setup.flush();
    setup.mockInput.pressKey("END");
    await setup.flush();
    await setup.waitFor(() => details.scrollTop > 0);
    await setup.waitForFrame(
      (frame) =>
        frame.includes("engineering:guide") &&
        frame.includes("docs:guide") &&
        /Primary[^\n]*\n[^\n]*selector/.test(frame),
    );
    await openReaderManagement(setup);
    expect(live(setup, "reader-details-action-skill-add-to-collection").focusable).toBe(true);
    expect(live(setup, "reader-details-relationship-source").focusable).toBe(true);
    await enterLive(setup, "reader-details-relationship-selectors");
    const exposureRootId = `current-exposure-browser-row-${encodeURIComponent(exposureTreePathKey({ segments: [{ collection: "engineering" }] }))}`;
    await setup.waitFor(() => {
      const row = setup.renderer.root.findDescendantById(exposureRootId);
      return row instanceof BoxRenderable && row.backgroundColor.a > 0;
    });
    expect(setup.captureCharFrame()).toContain("Prepared in the Agent catalog");
    expect(setup.captureCharFrame()).toContain("engineering");
    const exposureName = live(setup, `${exposureRootId}-name`);
    expect(exposureName).toBeInstanceOf(TextRenderable);
    expect((exposureName as TextRenderable).plainText.trim()).toBe("engineering");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("current-exposure-browser");
    expect(setup.renderer.root.findDescendantById("collection-tabs-tab-entries")).toBeUndefined();
    await enterLive(setup, "agent-access-collection-details");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    await setup.waitForFrame(
      (frame) => frame.includes("engineering") && frame.includes("Relations"),
    );
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    await focusLive(setup, "collection-tabs-tab-entries");
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-tabs-tab-relations",
    );
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Collection Use"));
    await enterLive(setup, "collection-relationships");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    await enterLive(setup, "relationship.open-owner");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("config-collection-browser"),
    );
    const collections = live(setup, "config-collection-browser");
    if (!(collections instanceof SelectRenderable))
      throw new Error("Expected owning Config Collections");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable === collections);
    expect(collections.getSelectedOption()?.value).toBe("engineering");
    expect(collections.getSelectedOption()?.name.trim()).toBe("engineering (global)");
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Selected Collection  engineering") &&
        frame.includes(engineeringOwner.file) &&
        frame.includes("/collections/engineering"),
    );
    expect(nativeText(live(setup, "config-declaration-metadata"))).toContain(
      `Selected Collection  engineering\nOwner  ${engineeringOwner.file} ${engineeringOwner.pointer}`,
    );
    // Config returns to the owning relation inspector before its local Relations Back.
    await expectSharedReturn(setup, "Back to Collections");
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "relationship.open-owner",
    );
    expect(nativeText(live(setup, "collection-relation-inspector"))).toContain(
      `Owner  global ${useOwner.file} ${useOwner.pointer}`,
    );
    await expectSharedReturn(setup, "Back to Relations");
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.renderer.root.findDescendantById("collection-relation-inspector")).toBeUndefined();
    await setup.waitForFrame(
      (frame) => frame.includes("engineering") && frame.includes("Collection Use"),
    );
    // The cross-section detail has one route predecessor: the same Agent Access path/action.
    await expectSharedReturn(setup, "Back to Skills");
    await enterLive(setup, "route-back");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "agent-access-collection-details",
    );
    await setup.waitForFrame(
      (frame) => frame.includes("Prepared in the Agent catalog") && frame.includes("engineering"),
    );
    expect(nativeText(live(setup, `${exposureRootId}-name`)).trim()).toBe("engineering");
    expect((live(setup, exposureRootId) as BoxRenderable).backgroundColor.a).toBeGreaterThan(0);
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeUndefined();
    // Re-enter directly through the restored physical Details command.
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeDefined();
    await setup.waitForFrame(
      (frame) => frame.includes("engineering") && frame.includes("Relations"),
    );
  } finally {
    setup.renderer.destroy();
  }
});
