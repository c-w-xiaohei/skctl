import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { exposurePathKey } from "../src/collections/state";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterReaderDetailsAction,
  enterReaderDetailsRelationship,
  enterInstalledAddress,
  enterLive,
  live,
  parsedEscape,
} from "./reader-test-controls";

const exposureOwner = {
  level: "project" as const,
  file: "/workspace/skill-cli/skill-cli.jsonc",
  pointer: "/use/0",
};
const collectionOwner = { ...exposureOwner, pointer: "/collections/engineering" };

function exposureProjection() {
  const base = readerProjection();
  const configs = base.configs.map((config) =>
    config.level === "project"
      ? {
          ...config,
          direct: {
            ...config.direct,
            collections: [{ id: "engineering", owner: collectionOwner }],
            collectionUse: [{ collection: "engineering", owner: exposureOwner }],
          },
        }
      : config,
  );
  const effective = base.effective;
  if (effective.status !== "complete") throw new Error("Expected complete fixture projection");
  const installedSkills = base.installedSkills.map((skill) =>
    skill.address.path === readerAddress.path && skill.address.source === readerAddress.source
      ? {
          ...skill,
          description: "Reader return context. ".repeat(160),
          selectorViews: {
            status: "complete" as const,
            values: [
              {
                selector: "guide",
                collection: "engineering",
                entry: "guide",
                paths: [],
                exposurePaths: [
                  { owner: exposureOwner, segments: [{ collection: "engineering" }] },
                ],
                useOwners: [exposureOwner],
              },
            ],
          },
        }
      : skill,
  );
  return {
    ...base,
    configs,
    effective: {
      ...effective,
      collections: ["engineering"],
      use: ["engineering"],
      managed: true,
      agent: { ...effective.agent, status: "available" as const, use: [exposureOwner] },
      collectionsView: [
        {
          id: "engineering",
          declared: [collectionOwner],
          repository: { derived: false, producers: [] },
          members: [{ name: "guide", address: readerAddress, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
    installedSkills,
  };
}

for (const invocation of [
  {
    name: "Reader Details action",
    enter: async (setup: Awaited<ReturnType<typeof testRender>>) =>
      enterReaderDetailsAction(setup, "skill-open-collection-use"),
  },
  {
    name: "Reader selector relationship",
    enter: async (setup: Awaited<ReturnType<typeof testRender>>) =>
      enterReaderDetailsRelationship(setup, "selectors"),
  },
]) {
  test(`${invocation.name} returns Collection exposure Back to the initiating physical command`, async () => {
    const projection = exposureProjection();
    let contentReads = 0;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            loadInstalled: async (request) => {
              contentReads++;
              return {
                value: { ...readerContent, address: request.address },
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
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      await enterInstalledAddress(setup, readerAddress);
      await enterLive(setup, "skill-inspector-open-reader");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("reader-tabs-tab-details"),
      );
      const detailsTab = live(setup, "reader-tabs-tab-details");
      await setup.renderOnce();
      await setup.mockMouse.click(detailsTab.screenX + 1, detailsTab.screenY);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
      const details = live(setup, "reader-details") as ScrollBoxRenderable;
      await setup.renderOnce();
      const initiatingId =
        invocation.name === "Reader Details action"
          ? "reader-details-action-skill-open-collection-use"
          : "reader-details-relationship-selectors";
      details.scrollChildIntoView(initiatingId);
      await setup.renderOnce();
      await setup.mockMouse.scroll(details.screenX + 1, details.screenY + 1, "down");
      await setup.renderOnce();
      const savedScroll = details.scrollTop;
      expect(savedScroll).toBeGreaterThan(0);

      await invocation.enter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("current-exposure-browser"),
      );
      expect(
        (live(setup, "current-exposure-browser") as SelectRenderable).getSelectedOption()?.value,
      ).toBe(exposurePathKey({ segments: [{ collection: "engineering" }] }));
      await parsedEscape(setup);

      await setup.waitFor(
        () =>
          setup.renderer.currentFocusedRenderable?.id ===
          (invocation.name === "Reader Details action"
            ? "reader-details-action-skill-open-collection-use"
            : "reader-details-relationship-selectors"),
      );
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        invocation.name === "Reader Details action"
          ? "reader-details-action-skill-open-collection-use"
          : "reader-details-relationship-selectors",
      );
      expect(setup.renderer.currentFocusedRenderable?.focused).toBe(true);
      expect(live(setup, "reader-details")).toBeInstanceOf(ScrollBoxRenderable);
      expect((live(setup, "reader-details") as ScrollBoxRenderable).scrollTop).toBe(savedScroll);
      expect(setup.renderer.root.findDescendantById("reader-tabs-viewport")).toBeDefined();
      expect(setup.captureCharFrame()).toContain(`${readerAddress.source}/${readerAddress.path}`);
      expect(contentReads).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });
}
