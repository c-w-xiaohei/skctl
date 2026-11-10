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
  focusLive,
  live,
  openAllInstalledSkills,
  openInstallation,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
test("Reader discovery facts stay inline and the exposure action returns to the same Skill", async () => {
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
    await openInstallation(setup);
    await enterLive(setup, "reader-details-relationship-selectors");
    expect(!!setup.renderer.root.findDescendantById("current-exposure-browser")).toBe(false);
    await focusLive(setup, "reader-details");
    setup.mockInput.pressKey("END");
    await setup.flush();
    expect((live(setup, "reader-details") as ScrollBoxRenderable).scrollTop).toBeGreaterThan(0);
    for (let visit = 0; visit < 2; visit++) {
      await enterLive(setup, "shell-more-actions");
      const choices = (await focusLive(setup, "palette-choices")) as SelectRenderable;
      const index = choices.options.findIndex(
        (option) => option.value.id === "skill-open-collection-use",
      );
      expect(index).toBeGreaterThanOrEqual(0);
      choices.setSelectedIndex(index);
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
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
      expect(
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
      ).toBe(skillAddressKey(readerAddress));
      expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
      expect(setup.captureCharFrame()).toContain("guide");
      expect(contentReads).toBe(1);
    }
  } finally {
    setup.renderer.destroy();
  }
});
