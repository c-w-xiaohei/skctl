import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable, type Renderable } from "@opentui/core";
import { AccordionTriggerRenderable } from "@tuiparts/core/accordion";
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
  focusLive,
  live,
  openAllInstalledSkills,
  openInstallation,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";

function expectInBounds(target: Renderable, width: number, height: number) {
  expect(target.screenX).toBeGreaterThanOrEqual(0);
  expect(target.screenY).toBeGreaterThanOrEqual(0);
  expect(target.width).toBeGreaterThan(0);
  expect(target.height).toBeGreaterThan(0);
  expect(target.screenX + target.width).toBeLessThanOrEqual(width);
  expect(target.screenY + target.height).toBeLessThanOrEqual(height);
}

test.each([
  [120, 40],
  [43, 13],
])("Installation and More return through their own layer at %ix%i", async (width, height) => {
  const setup = await testRender(
    () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
    { width, height },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterInstalledAddress(setup, readerAddress);
    for (const origin of [
      "reader-details",
      "reader-details-relationship-source",
      "reader-details-metadata",
    ]) {
      await openInstallation(setup);
      await focusLive(setup, origin);
      await setup.flush();
      expectInBounds(live(setup, origin), width, height);
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-more");
      expect(!!setup.renderer.root.findDescendantById("reader-details")).toBe(false);
    }
    await enterLive(setup, "reader-more");
    for (const id of [
      "reader-menu-raw",
      "reader-menu-reload",
      ...(width === 43 ? ["reader-menu-skill-check-updates"] : []),
      "reader-menu-skill-rebind",
      "reader-menu-skill-uninstall",
    ]) {
      setup.mockInput.pressArrow("down");
      await setup
        .waitFor(() => setup.renderer.currentFocusedRenderable?.id === id)
        .catch((error) => {
          throw new Error(
            `Expected ${id}, got ${setup.renderer.currentFocusedRenderable?.id}\n${setup.captureCharFrame()}`,
            { cause: error },
          );
        });
      expectInBounds(live(setup, id), width, height);
    }
    setup.mockInput.pressArrow("up");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "reader-menu-skill-rebind",
    );
    await parsedEscape(setup);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(
      (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
    ).toBe(skillAddressKey(readerAddress));
  } finally {
    setup.renderer.destroy();
  }
});

test("Installation omits unavailable relationships and metadata toggles through resize", async () => {
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
    await openInstallation(setup);
    for (const relationship of ["source", "config"])
      expect(
        !!setup.renderer.root.findDescendantById(`reader-details-relationship-${relationship}`),
      ).toBe(false);
    await focusLive(setup, "reader-details-metadata");
    const metadata = () => live(setup, "reader-details-metadata") as AccordionTriggerRenderable;
    expect(metadata().getState().open).toBe(false);
    await parsedEnter(setup);
    await setup.waitFor(() => metadata().getState().open);
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => !metadata().getState().open);
    setup.mockInput.pressKey(" ");
    await setup.waitFor(() => metadata().getState().open);
    for (const [width, height] of [
      [80, 24],
      [79, 24],
      [43, 30],
    ]) {
      setup.resize(width!, height!);
      await setup.flush();
      expect(metadata().getState().open).toBe(true);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details-metadata");
      expectInBounds(metadata(), width!, height!);
      expectInBounds(live(setup, "reader-details"), width!, height!);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("Installation restores exact scroll per address through A/B/A/B and responsive remounts", async () => {
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
              problems: Array.from({ length: 60 }, (_, index) => ({
                code: "DETAIL",
                severity: "warning" as const,
                message: `${skill.name} diagnostic ${index}`,
              })),
            })),
          },
          {
            loadInstalledSkill: async (_environment, request) => {
              loads.push(request.address.path);
              return request.address.path === readerSecondAddress.path
                ? readerSecondContent
                : readerContent;
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
    for (const [index, address] of [
      readerAddress,
      readerSecondAddress,
      readerAddress,
      readerSecondAddress,
    ].entries()) {
      await enterInstalledAddress(setup, address);
      await openInstallation(setup);
      await focusLive(setup, "reader-details");
      const details = live(setup, "reader-details") as ScrollBoxRenderable;
      if (index < 2) {
        setup.mockInput.pressKey(index === 0 ? "\u001b[6~" : "END");
        await setup.waitFor(() => details.scrollTop > 0);
        const beforeWheel = details.scrollTop;
        await setup.mockMouse.scroll(
          details.screenX + 1,
          details.screenY + 1,
          index === 0 ? "down" : "up",
        );
        await setup.waitFor(() => details.scrollTop !== beforeWheel);
        positions.push(details.scrollTop);
        if (index === 1) expect(positions[1]).not.toBe(positions[0]);
      } else await setup.waitFor(() => details.scrollTop === positions[index - 2]);
      expect(
        (live(setup, "installed-skill-browser") as SelectRenderable).getSelectedOption()?.value,
      ).toBe(skillAddressKey(address));
      await parsedEscape(setup);
      await parsedEscape(setup);
    }
    await enterInstalledAddress(setup, readerAddress);
    await openInstallation(setup);
    await focusLive(setup, "reader-details");
    for (const [width, height] of [
      [120, 40],
      [80, 24],
      [79, 24],
      [43, 30],
    ]) {
      setup.resize(width!, height!);
      await setup.flush();
      const details = live(setup, "reader-details") as ScrollBoxRenderable;
      expect(details.scrollTop).toBe(positions[0]!);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-details");
      expectInBounds(details, width!, height!);
    }
    expect(loads).toEqual(["guide", "reference"]);
  } finally {
    setup.renderer.destroy();
  }
});
