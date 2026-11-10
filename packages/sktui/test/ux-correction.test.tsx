import { InputRenderable, SelectRenderable, TextRenderable } from "@opentui/core";
import { TabsTabRenderable } from "@tuiparts/core/tabs";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { openSettingsCategory } from "./settings-test-controls";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  openInstallation,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
const emptyProjection = () =>
  workspaceProjection({ includeDirect: false, includeContribution: false });
const mount = (empty = false, width = 120, height = 40) =>
  testRender(
    () => (
      <App
        core={directSourceCore(empty ? emptyProjection() : readerProjection())}
        exit={() => {}}
      />
    ),
    { width, height },
  );

async function scope(setup: Setup, destination: string) {
  if (!setup.renderer.root.findDescendantById("shell-scope-select"))
    await openMainPage(setup, "settings");
  await enterLive(setup, "shell-scope-select");
  const choices = (await focusLive(setup, "scope-choices")) as SelectRenderable;
  const index = choices.options.findIndex((option) => option.value === destination);
  expect(index).toBeGreaterThanOrEqual(0);
  choices.setSelectedIndex(index);
  await parsedEnter(setup);
  await setup.flush();
}

async function reader(setup: Setup) {
  await openAllInstalledSkills(setup);
  await parsedEnter(setup);
  await waitForReaderBody(setup, "guide");
}

test.each([120, 80, 43])(
  "empty Workspace offers Source registration with bounded chrome at %i columns",
  async (width) => {
    const setup = await mount(true, width, 24);
    try {
      await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
      for (const id of ["shell-more-actions", "section-nav", "command-status"]) {
        const control = setup.renderer.root.findDescendantById(id)!;
        expect(control.screenX).toBeGreaterThanOrEqual(0);
        expect(control.screenX + control.width).toBeLessThanOrEqual(width);
        expect(control.screenY + control.height).toBeLessThanOrEqual(24);
      }
      expect(setup.captureCharFrame()).not.toContain("Current Exposure is unavailable");
      await enterLive(setup, "skills-setup-primary");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
      );
      expect(!!setup.renderer.root.findDescendantById("source-register-origin")).toBe(true);
      expect(setup.captureCharFrame()).toContain("Add Source");
      setup.mockInput.pressTab();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "source-register-id",
      );
      await parsedEscape(setup);
      await setup.waitForFrame((frame) => frame.includes("Add your first Source"));
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Source empty state provides its own registration action", async () => {
  const setup = await mount(true);
  try {
    await setup.flush();
    await openMainPage(setup, "sources");
    await setup.waitForFrame((frame) => frame.includes("No Sources yet"));
    await enterLive(setup, "workspace-action-add-source");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-register-origin",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 43])(
  "Reader identifies its Skill and exposes all views at %i columns",
  async (width) => {
    const setup = await mount(false, width);
    try {
      await reader(setup);
      expect(
        (setup.renderer.root.findDescendantById("reader-identity") as TextRenderable).plainText,
      ).toBe("guide");
      for (const [index, label] of [
        [0, "Content"],
        [1, "Resources"],
      ] as const) {
        await openReaderTab(setup, index);
        expect(selectedReaderTab(setup)).toBe(index);
        expect(setup.captureCharFrame()).toContain(label);
      }
      await openInstallation(setup);
      await setup.waitForFrame((frame) => frame.includes("Installation details"));
      if (width === 43) await enterLive(setup, "reader-more");
      await focusLive(
        setup,
        width === 43 ? "reader-menu-skill-check-updates" : "reader-action-skill-check-updates",
      );
      await setup.waitForFrame((frame) => frame.includes("Check updates"));
      if (width === 43) await parsedEscape(setup);
      await focusLive(setup, "reader-details-action-skill-add-to-collection");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(
        "reader-details-action-skill-add-to-collection",
      );
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each(["arrow", "native"])(
  "%s browser selection loads the exact next Skill without moving physical focus",
  async (method) => {
    const setup = await mount();
    try {
      await reader(setup);
      await openReaderTab(setup, 1);
      const browser = (await focusLive(setup, "installed-skill-browser")) as SelectRenderable;
      if (method === "arrow") setup.mockInput.pressArrow("down");
      else browser.setSelectedIndex(1);
      await setup.waitFor(() => browser.getSelectedOption()?.value === '["team-main","reference"]');
      await waitForReaderBody(setup, "reference");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      expect(selectedReaderTab(setup)).toBe(0);
      expect(
        (setup.renderer.root.findDescendantById("reader-identity") as TextRenderable).plainText,
      ).toBe("reference");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.each([120, 43])(
  "Config Enter reaches the selected declaration without changing Scope at %i columns",
  async (width) => {
    const setup = await mount(false, width);
    try {
      await setup.flush();
      await scope(setup, "project");
      await openSettingsCategory(setup, "sources");
      const browser = (await focusLive(setup, "config-source-browser")) as SelectRenderable;
      const selection = browser.getSelectedOption()?.value;
      await parsedEnter(setup);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("config-command-check-updates");
      expect(browser.getSelectedOption()?.value).toBe(selection);
      expect(setup.captureCharFrame()).toContain("Project");
      expect(setup.captureCharFrame()).toContain("team-main");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Scope selection commits on activation, including reselecting the current Scope", async () => {
  const setup = await mount(true);
  try {
    await setup.flush();
    await openMainPage(setup, "settings");
    await enterLive(setup, "shell-scope-select");
    const choices = (await focusLive(setup, "scope-choices")) as SelectRenderable;
    expect(choices.getSelectedOption()?.value).toBe("global");
    setup.mockInput.pressArrow("down");
    await setup.waitFor(() => choices.getSelectedOption()?.value === "project");
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Scope: Global");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("settings-categories"));
    expect(setup.captureCharFrame()).toContain("Scope: Project");
    await scope(setup, "project");
    expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
    await focusLive(setup, "shell-scope-select");
    await setup.waitForFrame((frame) => frame.includes("Enter Change Scope"));
  } finally {
    setup.renderer.destroy();
  }
});

test("main-page arrows switch pages and Settings category arrows only move selection", async () => {
  const setup = await mount(true);
  try {
    await setup.flush();
    await focusLive(setup, "shell-section-tab-skills");
    for (const section of ["collections", "sources", "updates"]) {
      setup.mockInput.pressArrow("right");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === `shell-section-tab-${section}`,
      );
      expect(
        (setup.renderer.currentFocusedRenderable as TabsTabRenderable).getState().selected,
      ).toBe(true);
      expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
    }
    await scope(setup, "global");
    const categories = (await focusLive(setup, "settings-categories")) as SelectRenderable;
    for (const section of ["config-sources", "collections"]) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => categories.getSelectedOption()?.value === section);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("settings-categories");
      expect(!!setup.renderer.root.findDescendantById("config-config-source-browser")).toBe(false);
      expect(!!setup.renderer.root.findDescendantById("config-collection-browser")).toBe(false);
      expect(setup.captureCharFrame()).toContain("Global");
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("empty Config pages provide direct actions", async () => {
  const setup = await mount(true);
  try {
    await setup.flush();
    await scope(setup, "global");
    for (const [section, label] of [
      ["sources", "Add Source"],
      ["config-sources", "Add Config Source"],
      ["collections", "New Collection"],
    ] as const) {
      await openSettingsCategory(setup, section);
      await setup.waitForFrame((frame) => frame.includes(label!));
    }
  } finally {
    setup.renderer.destroy();
  }
});

test.each(["pointer", "enter", "escape"])(
  "shared Back %s returns directly to the selected Skill inventory",
  async (activation) => {
    const setup = await mount(false, 80);
    try {
      await reader(setup);
      const back = await focusLive(setup, "route-back");
      if (activation === "pointer") await setup.mockMouse.click(back.screenX + 1, back.screenY);
      else if (activation === "enter") await parsedEnter(setup);
      else await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(
        (setup.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.value,
      ).toBe('["team-main","guide"]');
      expect(!!setup.renderer.root.findDescendantById("route-back")).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("search owns text editing and arrows without changing page or clearing the query", async () => {
  const setup = await mount();
  try {
    await openAllInstalledSkills(setup);
    setup.mockInput.pressKey("/");
    const input = (await focusLive(setup, "skills-query")) as InputRenderable;
    await setup.mockInput.typeText("abc");
    setup.mockInput.pressArrow("left");
    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(input.value).toBe("abc");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("skills-query");
    await parsedEscape(setup);
    expect(input.value).toBe("abc");
    expect(
      (
        setup.renderer.root.findDescendantById("shell-section-tab-skills") as TabsTabRenderable
      ).getState().selected,
    ).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
