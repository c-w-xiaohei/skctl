import { expect, test } from "bun:test";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { exposureTreePathKey } from "../src/collections/agent-access-tree";
import { skillAddressKey } from "../src/types";
import { directSourceCore } from "./direct-source.fixture";
import { readerAddress, readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterInstalledAddress,
  enterLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
} from "./reader-test-controls";
test("Reader action and selector relationship return from the exposure Tree to their exact physical commands", async () => {
  const base = readerProjection();
  const effective = base.effective;
  if (effective.status !== "complete") throw new Error("Expected complete fixture projection");
  const exposureOwner = {
    level: "project" as const,
    file: "/workspace/skctl/skctl.jsonc",
    pointer: "/use/0",
  };
  const collectionOwner = { ...exposureOwner, pointer: "/collections/engineering" };
  const projection = {
    ...base,
    configs: base.configs.map((config) =>
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
    ),
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
    installedSkills: [
      {
        ...base.installedSkills[0]!,
        description: "Reader return context. ".repeat(160),
        selectorViews: {
          status: "complete" as const,
          values: [
            {
              selector: "guide",
              collection: "engineering",
              entry: "guide",
              paths: [],
              exposurePaths: [{ owner: exposureOwner, segments: [{ collection: "engineering" }] }],
              useOwners: [exposureOwner],
            },
          ],
        },
      },
    ],
  };
  let contentReads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection, {
          loadInstalledSkill: async () => {
            contentReads++;
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await openReaderTab(setup, 2);
    await parsedEnter(setup);
    await setup.flush();
    setup.mockInput.pressArrow("right");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-description-toggle",
    );
    await parsedEnter(setup);
    await enterLive(setup, "reader-tabs-tab-details");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    const initialDetails = live(setup, "reader-details") as ScrollBoxRenderable;
    await setup.flush();
    await setup.mockMouse.scroll(initialDetails.screenX + 1, initialDetails.screenY + 1, "down");
    await setup.waitFor(() => initialDetails.scrollTop > 0);
    for (const id of [
      "reader-description-toggle",
      "reader-details-relationship-source",
      "reader-details-relationship-config",
      "reader-details-relationship-selectors",
      "reader-details-metadata",
      "reader-details-manage",
    ]) {
      setup.mockInput.pressArrow("right");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
    }
    await parsedEnter(setup);
    await setup.flush();
    const listeners = [
      setup.renderer.listenerCount("frame"),
      setup.renderer.listenerCount("selection"),
    ];
    for (const [key, path] of [
      ["ARROW_DOWN", ["reader-reload", "reader-details-action-skill-open-collection-use"]],
      [
        "ARROW_UP",
        [
          "reader-reload",
          "reader-details-manage",
          "reader-details-metadata",
          "reader-details-relationship-selectors",
        ],
      ],
    ] as const) {
      const initiatingId = path.at(-1)!;
      for (const id of path) {
        setup.mockInput.pressKey(key);
        await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
      }
      await setup.flush();
      const details = live(setup, "reader-details") as ScrollBoxRenderable;
      await setup.mockMouse.scroll(
        details.screenX + 1,
        details.screenY + 1,
        key === "ARROW_DOWN" ? "down" : "up",
      );
      await setup.flush();
      const savedScroll = details.scrollTop;
      expect(savedScroll).toBeGreaterThan(0);
      await parsedEnter(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
      );
      expect(live(setup, "current-exposure-browser")).toBeInstanceOf(ScrollBoxRenderable);
      const rowId = `current-exposure-browser-row-${encodeURIComponent(exposureTreePathKey({ segments: [{ collection: "engineering" }] }))}`;
      await setup.waitFor(() => (live(setup, rowId) as BoxRenderable).backgroundColor.a > 0);
      expect((live(setup, `${rowId}-name`) as TextRenderable).plainText.trim()).toBe("engineering");
      expect(live(setup, "current-exposure-browser").focused).toBe(true);
      expect(setup.captureCharFrame()).toContain("engineering");
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === initiatingId);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.focused).toBe(true);
      expect((live(setup, "reader-details") as ScrollBoxRenderable).scrollTop).toBe(savedScroll);
      expect(setup.renderer.root.findDescendantById("reader-tabs-viewport")).toBeDefined();
      expect(selectedReaderTab(setup)).toBe(2);
      expect(
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
      ).toBe(skillAddressKey(readerAddress));
      expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
      expect(setup.captureCharFrame()).toContain("guide");
      expect(contentReads).toBe(1);
      await setup.flush();
      expect([
        setup.renderer.listenerCount("frame"),
        setup.renderer.listenerCount("selection"),
      ]).toEqual(listeners);
    }
  } finally {
    setup.renderer.destroy();
  }
});
