import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { AccordionTriggerRenderable } from "@tuiparts/core/accordion";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { createReaderOwner } from "../src/reader/state";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, readerSecondAddress } from "./installed-reader.fixture";
import {
  enterReaderDetailsRelationship,
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  selectedReaderTab,
} from "./reader-test-controls";

const firstAddress = { source: "team-main", path: "guide" };

test("Reader cache keeps technical disclosure per address through selection and semantic restore", () => {
  const owner = createReaderOwner(directSourceCore(readerProjection()).installed);
  owner.select(firstAddress);
  owner.patch({ tab: "details", detailsMetadataOpen: true, detailsDescriptionOpen: true });
  const saved = owner.current()!;

  owner.select(readerSecondAddress);
  expect(owner.current()?.detailsMetadataOpen).toBeUndefined();
  owner.patch({ detailsManagementOpen: true });
  owner.restore(saved);

  expect(owner.current()).toMatchObject({
    address: firstAddress,
    tab: "details",
    detailsMetadataOpen: true,
    detailsDescriptionOpen: true,
  });
  expect(owner.cached(readerSecondAddress)?.detailsMetadataOpen).toBeUndefined();
  expect(owner.cached(readerSecondAddress)?.detailsManagementOpen).toBe(true);
});

test("production App restores expanded technical details on exact relationship Back without leaking to another Skill", async () => {
  const projection = readerProjection();
  const second = projection.installedSkills.find(
    (skill) => skill.address.path === readerSecondAddress.path,
  )!;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...projection,
          installedSkills: [projection.installedSkills[0]!, second],
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await openReaderTab(setup, 2);
    await setup.flush();
    await focusLive(setup, "reader-details-metadata");
    await parsedEnter(setup);
    await setup.waitFor(
      () => (live(setup, "reader-details-metadata") as AccordionTriggerRenderable).getState().open,
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");

    await enterReaderDetailsRelationship(setup, "source");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-details-pane"));
    await enterLive(setup, "route-back");

    expect(selectedReaderTab(setup)).toBe(2);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-relationship-source");
    expect(
      (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
    ).toBe(JSON.stringify([firstAddress.source, firstAddress.path]));
    expect(
      (live(setup, "reader-details-metadata") as AccordionTriggerRenderable).getState().open,
    ).toBe(true);

    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(
      () =>
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value ===
        JSON.stringify([readerSecondAddress.source, readerSecondAddress.path]),
    );
    expect(setup.captureCharFrame()).toContain("reference");
    expect(selectedReaderTab(setup)).toBe(0);
    await openReaderTab(setup, 2);
    await setup.flush();
    expect(
      (live(setup, "reader-details-metadata") as AccordionTriggerRenderable).getState().open,
    ).toBe(false);

    await focusLive(setup, "installed-skill-browser");
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () =>
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value ===
        JSON.stringify([firstAddress.source, firstAddress.path]),
    );
    expect(selectedReaderTab(setup)).toBe(0);
    await openReaderTab(setup, 2);
    await setup.flush();
    expect(
      (live(setup, "reader-details-metadata") as AccordionTriggerRenderable).getState().open,
    ).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test("compact Reader keeps technical disclosure across resize and details reentry", async () => {
  const projection = readerProjection();
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await openReaderTab(setup, 2);
    await setup.flush();
    await focusLive(setup, "reader-details-metadata");
    await parsedEnter(setup);
    await setup.waitFor(
      () => (live(setup, "reader-details-metadata") as AccordionTriggerRenderable).getState().open,
    );

    setup.resize(43, 13);
    await setup.flush();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-metadata",
    );
    const compactMetadata = live(setup, "reader-details-metadata");
    expect(compactMetadata.screenY).toBeGreaterThanOrEqual(0);
    expect(compactMetadata.screenY + compactMetadata.height).toBeLessThanOrEqual(13);
    expect(setup.captureCharFrame()).toContain("▾ Technical details");
    setup.resize(80, 24);
    await setup.flush();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-details-metadata",
    );
    const resizedMetadata = live(setup, "reader-details-metadata");
    expect(resizedMetadata.screenY).toBeGreaterThanOrEqual(0);
    expect(resizedMetadata.screenY + resizedMetadata.height).toBeLessThanOrEqual(24);
    expect(setup.captureCharFrame()).toContain("▾ Technical details");
    expect(
      (live(setup, "reader-details-metadata") as AccordionTriggerRenderable).getState().open,
    ).toBe(true);

    await openReaderTab(setup, 0);
    await setup.flush();
    expect(selectedReaderTab(setup)).toBe(0);
    expect(live(setup, "reader-scrollbox")).toBeInstanceOf(ScrollBoxRenderable);
    await openReaderTab(setup, 2);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("▾ Technical details");
    await focusLive(setup, "reader-tabs-tab-details");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs-tab-details");
    expect(live(setup, "reader-details-metadata")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
