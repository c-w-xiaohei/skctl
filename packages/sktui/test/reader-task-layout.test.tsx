/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable } from "@opentui/core";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection, readerContent } from "./installed-reader.fixture";
import {
  enterLive,
  openAllInstalledSkills,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
import { mkdir, writeFile } from "node:fs/promises";

for (const width of [120, 43]) {
  test(`Reader has two reading views and target-local maintenance at ${width} columns`, async () => {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
          })}
          exit={() => {}}
        />
      ),
      { width, height: width === 43 ? 13 : 32 },
    );
    try {
      await openAllInstalledSkills(setup);
      await enterLive(setup, "installed-skill-browser");
      await waitForReaderBody(setup, "needle", false);
      expect(!!setup.renderer.root.findDescendantById("reader-tabs-tab-details")).toBe(false);
      const body = setup.renderer.root.findDescendantById(
        "reader-scrollbox",
      ) as ScrollBoxRenderable;
      body.focus();
      setup.mockInput.pressKey("END");
      await setup.flush();
      const scroll = body.scrollTop;
      await enterLive(setup, "reader-more");
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Installation details");
      expect(setup.captureCharFrame()).toContain("Uninstall");
      const menu = setup.renderer.root.findDescendantById("reader-more-dialog")!;
      const trigger = setup.renderer.root.findDescendantById("reader-more")!;
      expect(menu.width).toBeLessThanOrEqual(32);
      expect(menu.height).toBeLessThanOrEqual(8);
      expect(menu.screenY).toBe(trigger.screenY + trigger.height);
      expect(setup.captureCharFrame()).toContain("Content");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-installation-open");
      setup.mockInput.pressArrow("down");
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-menu-raw");
      setup.mockInput.pressArrow("up");
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-installation-open");
      await mkdir("out/reader-redesign", { recursive: true });
      await writeFile(`out/reader-redesign/more-${width}.txt`, setup.captureCharFrame());
      await enterLive(setup, "reader-installation-open");
      await setup.flush();
      expect(!!setup.renderer.root.findDescendantById("reader-installation-dialog")).toBe(false);
      expect(!!setup.renderer.root.findDescendantById("reader-more-dialog")).toBe(false);
      const details = setup.renderer.root.findDescendantById("reader-details")!;
      const pane = setup.renderer.root.findDescendantById("reader-pane")!;
      expect(details.screenX).toBeGreaterThanOrEqual(pane.screenX);
      expect(details.screenX + details.width).toBeLessThanOrEqual(pane.screenX + pane.width);
      expect(details.screenY + details.height).toBeLessThanOrEqual(pane.screenY + pane.height);
      details.focus();
      await setup.flush();
      setup.mockInput.pressKey("END");
      await setup.flush();
      expect(!!setup.renderer.root.findDescendantById("reader-details-metadata")).toBe(true);
      await enterLive(setup, "reader-details-metadata");
      await setup.flush();
      expect(body.visible).toBe(false);
      expect(!!setup.renderer.root.findDescendantById("reader-danger-actions")).toBe(false);
      await mkdir("out/reader-redesign", { recursive: true });
      await writeFile(`out/reader-redesign/installation-${width}.txt`, setup.captureCharFrame());
      await parsedEscape(setup);
      await setup.flush();
      expect(!!setup.renderer.root.findDescendantById("reader-installation-dialog")).toBe(false);
      expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(body);
      expect(body.scrollTop).toBe(scroll);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-more");
      await enterLive(setup, "reader-more");
      await enterLive(setup, "reader-installation-open");
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("reader-popup-close")).toBeUndefined();
      await parsedEscape(setup);
      for (const id of [
        "reader-reload",
        "reader-find-open",
        "reader-raw",
        "reader-description-open",
      ]) {
        expect(setup.renderer.root.findDescendantById(id)).toBeUndefined();
      }
      expect(setup.renderer.root.findDescendantById("reader-description")).toBeUndefined();
      await enterLive(setup, "reader-description-toggle");
      expect(!!setup.renderer.root.findDescendantById("reader-description")).toBe(true);
      await enterLive(setup, "reader-description-toggle");
      body.scrollTo(0);
      await setup.flush();
      await writeFile(`out/reader-redesign/content-${width}.txt`, setup.captureCharFrame());
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("Installation Source navigation returns to the retained Reader", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 32 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-installation-open");
    await enterLive(setup, "reader-details-relationship-source");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
    await enterLive(setup, "route-back");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-more");
    expect(!!setup.renderer.root.findDescendantById("reader-scrollbox")).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test("More switches Markdown source and rereads only the current Skill", async () => {
  let loads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => {
            loads++;
            return readerContent;
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 32 },
  );
  try {
    await openAllInstalledSkills(setup);
    await enterLive(setup, "installed-skill-browser");
    await waitForReaderBody(setup, "needle", false);
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-raw");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-line-0"));
    expect(setup.renderer.root.findDescendantById("reader-description")).toBeUndefined();
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-raw");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("reader-description-toggle"),
    );
    const before = loads;
    await enterLive(setup, "reader-more");
    await enterLive(setup, "reader-menu-reload");
    await setup.waitFor(() => loads === before + 1);
    expect(setup.renderer.root.findDescendantById("reader-more-dialog")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
