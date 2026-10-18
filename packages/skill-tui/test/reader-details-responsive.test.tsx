import { expect, test } from "bun:test";
import {
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
  type Renderable,
} from "@opentui/core";
import { AccordionTriggerRenderable } from "@tuiparts/core/accordion";
import { ButtonRenderable } from "@tuiparts/core/button";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { skillAddressKey } from "../src/types";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerAddress,
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
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

type Setup = Awaited<ReturnType<typeof testRender>>;

async function arrowFocus(setup: Setup, key: string, id: string) {
  setup.mockInput.pressKey(key);
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === id);
  await setup.flush();
  expect(setup.renderer.currentFocusedRenderable === live(setup, id)).toBe(true);
  expect(live(setup, id).focused).toBe(true);
}

function expectInBounds(target: Renderable, width: number, height: number) {
  expect(target.screenX).toBeGreaterThanOrEqual(0);
  expect(target.screenY).toBeGreaterThanOrEqual(0);
  expect(target.width).toBeGreaterThan(0);
  expect(target.height).toBeGreaterThan(0);
  expect(target.screenX + target.width).toBeLessThanOrEqual(width);
  expect(target.screenY + target.height).toBeLessThanOrEqual(height);
}

test("Details arrows traverse live controls both ways and Escape from each physical origin returns to the selected browser", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    await openReaderTab(setup, 2);
    await parsedEnter(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
    const controls = [
      "reader-details-relationship-source",
      "reader-details-relationship-config",
      "reader-details-metadata",
      "reader-details-manage",
      "reader-reload",
      "reader-details-action-skill-rebind",
      "reader-details-action-skill-uninstall",
    ];
    for (const [index, id] of controls.entries()) {
      await arrowFocus(setup, index === 0 ? "ARROW_RIGHT" : "ARROW_DOWN", id);
      if (id === "reader-details-manage") await parsedEnter(setup);
      expectInBounds(live(setup, id), 120, 40);
    }
    await arrowFocus(setup, "ARROW_DOWN", controls.at(-1)!);
    expect(
      (live(setup, "reader-details-action-skill-add-to-collection") as ButtonRenderable).getState()
        .disabled,
    ).toBe(true);
    for (const id of [...controls.slice(0, -1).reverse(), "reader-details"])
      await arrowFocus(setup, "ARROW_UP", id);
    await arrowFocus(setup, "ARROW_RIGHT", controls[0]!);
    await arrowFocus(setup, "ARROW_RIGHT", controls[1]!);
    await arrowFocus(setup, "ARROW_LEFT", "reader-details");

    for (const origin of [controls[5]!, controls[0]!, controls[2]!]) {
      for (const [index, id] of controls.slice(0, controls.indexOf(origin) + 1).entries())
        await arrowFocus(setup, index === 0 ? "ARROW_RIGHT" : "ARROW_DOWN", id);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
      ).toBe(skillAddressKey(readerAddress));
      expect(live(setup, "installed-skill-browser").focused).toBe(true);
      expect(live(setup, "reader-views").isDestroyed).toBe(false);
      expect(selectedReaderTab(setup)).toBe(2);
      expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
      await parsedEnter(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
      expect(
        (live(setup, "reader-details-manage") as AccordionTriggerRenderable).getState().open,
      ).toBe(true);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("Details skips absent and disabled controls and metadata Enter/Space really toggles across resize", async () => {
  const base = readerProjection();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore({
          ...base,
          installedSkills: base.installedSkills.map((skill) => ({ ...skill, source: undefined })),
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
    for (const relationship of ["source", "config"])
      expect(
        setup.renderer.root.findDescendantById(`reader-details-relationship-${relationship}`),
      ).toBeUndefined();
    const controls = [
      "reader-details-metadata",
      "reader-details-manage",
      "reader-reload",
      "reader-details-action-skill-rebind",
      "reader-details-action-skill-uninstall",
    ];
    for (const [index, id] of controls.entries()) {
      await arrowFocus(setup, index === 0 ? "ARROW_RIGHT" : "ARROW_DOWN", id);
      if (id === "reader-details-manage") await parsedEnter(setup);
    }
    for (const action of ["skill-add-to-collection", "skill-open-source"])
      expect(
        (live(setup, `reader-details-action-${action}`) as ButtonRenderable).getState().disabled,
      ).toBe(true);
    for (const id of [...controls.slice(0, -1).reverse(), "reader-details"])
      await arrowFocus(setup, "ARROW_UP", id);
    await arrowFocus(setup, "ARROW_RIGHT", "reader-details-metadata");
    const metadata = () => live(setup, "reader-details-metadata") as AccordionTriggerRenderable;
    expect(metadata().getState().open).toBe(false);
    await parsedEnter(setup);
    await setup.waitFor(() => metadata().getState().open);
    expect(setup.renderer.currentFocusedRenderable === metadata() && metadata().focused).toBe(true);
    await setup.waitForFrame((frame) => frame.includes("▾ Technical details"));
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => !metadata().getState().open);
    expect(setup.renderer.currentFocusedRenderable === metadata() && metadata().focused).toBe(true);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("▸ Technical details");
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => metadata().getState().open);
    expect(setup.renderer.currentFocusedRenderable === metadata() && metadata().focused).toBe(true);
    for (const [width, height] of [
      [80, 24],
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      expect(metadata().getState().open).toBe(true);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");
      expect(metadata().focused).toBe(true);
      expect(selectedReaderTab(setup)).toBe(2);
      expectInBounds(live(setup, "reader-details"), width, height);
      expectInBounds(metadata(), width, height);
      expect(setup.captureCharFrame()).toContain("▾ Technical details");
      for (const id of controls.slice(1)) {
        await arrowFocus(setup, "ARROW_DOWN", id);
        expectInBounds(live(setup, id), width, height);
      }
      for (const id of controls.slice(0, -1).reverse()) await arrowFocus(setup, "ARROW_UP", id);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("Details restores exact native scroll per address through A/B/A/B, view remount and responsive geometry", async () => {
  const base = readerProjection();
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          {
            ...base,
            installedSkills: base.installedSkills.map((skill) => ({
              ...skill,
              description: Array.from(
                { length: 100 },
                (_, i) => `${skill.name} description line ${i}`,
              ).join("\n"),
            })),
          },
          {
            installed: {
              load: async (request) => {
                loads.push(request.address.path);
                return request.address.path === readerSecondAddress.path
                  ? readerSecondContent
                  : readerContent;
              },
            },
          },
        )}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openAllInstalledSkills(setup);
    const positions: number[] = [];
    const visits = [readerAddress, readerSecondAddress, readerAddress, readerSecondAddress];
    for (const [index, address] of visits.entries()) {
      await enterInstalledAddress(setup, address);
      if (index > 0) expect(selectedReaderTab(setup)).toBe(0);
      await openReaderTab(setup, 2);
      await parsedEnter(setup);
      await setup.flush();
      const details = live(setup, "reader-details") as ScrollBoxRenderable;
      if (index < 2) {
        await arrowFocus(setup, "ARROW_RIGHT", "reader-description-toggle");
        await parsedEnter(setup);
        await enterLive(setup, "reader-tabs-tab-details");
        await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-details");
        await setup.flush();
        setup.mockInput.pressKey(index === 0 ? "\u001b[6~" : "END");
        await setup.waitFor(() => details.scrollTop > 0);
        const beforeWheel = details.scrollTop;
        await setup.mockMouse.scroll(
          details.screenX + 1,
          details.screenY + 1,
          index === 0 ? "down" : "up",
        );
        await setup.waitFor(() => details.scrollTop !== beforeWheel);
        await setup.flush();
        positions.push(details.scrollTop);
        expect(positions[index]).toBeGreaterThan(0);
        if (index === 1) expect(positions[1]).not.toBe(positions[0]);
      } else {
        await setup.waitFor(() => details.scrollTop === positions[index - 2]);
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details");
        expect(selectedReaderTab(setup)).toBe(2);
        expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe(address.path);
        expect(
          (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
        ).toBe(skillAddressKey(address));
      }
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
    }
    await enterInstalledAddress(setup, readerAddress);
    await openReaderTab(setup, 2);
    await parsedEnter(setup);
    await setup.waitFor(
      () => (live(setup, "reader-details") as ScrollBoxRenderable).scrollTop === positions[0],
    );
    await openReaderTab(setup, 0);
    await openReaderTab(setup, 2);
    await parsedEnter(setup);
    for (const [width, height] of [
      [120, 40],
      [80, 24],
      [79, 24],
      [43, 30],
    ] as const) {
      setup.resize(width, height);
      await setup.flush();
      const details = live(setup, "reader-details") as ScrollBoxRenderable;
      expect(details.scrollTop).toBe(positions[0]!);
      expect(selectedReaderTab(setup)).toBe(2);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details");
      expect(details.focused).toBe(true);
      expectInBounds(details, width, height);
      expectInBounds(live(setup, "reader-tools"), width, height);
      expect((live(setup, "reader-identity") as TextRenderable).plainText).toBe("guide");
      expect(setup.captureCharFrame()).toContain("guide");
    }
    expect(loads).toEqual(["guide", "reference"]);
  } finally {
    setup.renderer.destroy();
  }
});
