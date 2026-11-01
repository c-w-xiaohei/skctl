import { expect, test } from "bun:test";
import {
  InputRenderable,
  BoxRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { skillAddressKey } from "../src/types";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
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
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;
const content = {
  ...readerContent,
  rawText: `${readerContent.rawText}${"padding\n".repeat(80)}`,
  markdownText: `${readerContent.markdownText}${"padding\n".repeat(80)}`,
};
async function mount(width = 120, height = 40) {
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment, { address }) => {
            loads.push(address.path);
            return address.path === "reference" ? readerSecondContent : content;
          },
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await openAllInstalledSkills(setup);
  await parsedEnter(setup);
  await waitForReaderBody(setup, "needle in prose");
  return { setup, loads };
}
async function find(setup: Setup, query: string) {
  await enterLive(setup, "reader-find-open");
  await focusLive(setup, "reader-find");
  await setup.mockInput.typeText(query);
  await parsedEnter(setup);
  await setup.flush();
}
async function rawMatch(setup: Setup) {
  await find(setup, "needle");
  await setup.waitForFrame((frame) => frame.includes("1/3"));
  await enterLive(setup, "reader-find-next");
  expect(setup.captureCharFrame()).toContain("2/3");
  await enterLive(setup, "open-match-raw");
  await setup.flush();
}
async function inventory(setup: Setup) {
  await focusLive(setup, "reader-scrollbox");
  await parsedEscape(setup);
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
}

test("Installed inventory keeps names primary, exposes problems in Details, and uses available list height", async () => {
  const base = readerProjection();
  const template = base.installedSkills[0]!;
  const projection = {
    ...base,
    installedSkills: Array.from({ length: 12 }, (_, index) => ({
      ...template,
      address: { source: "team-main", path: `entry-${index}` },
      name: `entry-${index}`,
      description: `Description ${index}`,
      owner: {
        ...template.owner,
        health: index === 11 ? ("missing" as const) : template.owner.health,
      },
      problems:
        index === 11
          ? [{ code: "SOURCE_MISSING", severity: "warning" as const, message: "Source missing" }]
          : [],
    })),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    const browser = await openAllInstalledSkills(setup);
    expect(browser.options.map((option) => option.value)).toEqual(
      projection.installedSkills.map((skill) =>
        JSON.stringify([skill.address.source, skill.address.path]),
      ),
    );
    expect(browser.options[0]!.name).toContain("entry-0");
    expect(browser.options[11]!.name).toContain("entry-11");
    expect(browser.height).toBeGreaterThan(10);
    expect(browser.screenY + browser.height).toBeLessThanOrEqual(40);
    for (let index = 1; index < 12; index++) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === index);
    }
    await parsedEnter(setup);
    await openReaderTab(setup, 2);
    await setup.waitForFrame((frame) => frame.includes("team-main/entry-11"));
    expect(setup.captureCharFrame()).toContain("missing");
    expect(setup.captureCharFrame()).toContain("Source missing");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 79])(
  "selected Skill exposes secondary facts in Reader Details at %i columns",
  async (width) => {
    const base = readerProjection();
    const skill = base.installedSkills[0]!;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore({
            ...base,
            installedSkills: [
              {
                ...skill,
                name: "broken-guide",
                description: "Recover an unavailable guide",
                owner: { ...skill.owner, health: "missing" },
                problems: [
                  { code: "SOURCE_MISSING", severity: "warning", message: "Source missing" },
                ],
              },
            ],
          })}
          exit={() => {}}
        />
      ),
      { width, height: 40 },
    );
    try {
      await openAllInstalledSkills(setup);
      await parsedEnter(setup);
      await openReaderTab(setup, 2);
      await setup.waitForFrame(
        (frame) => frame.includes("team-main/guide") && frame.includes("Source missing"),
      );
      expect(setup.captureCharFrame()).toContain("broken-guide");
      expect(setup.captureCharFrame()).toContain("missing");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Reader mounts native Markdown once while Find edits structural content", async () => {
  const { setup, loads } = await mount();
  try {
    const scrollbox = setup.renderer.root.findDescendantById(
      "reader-scrollbox",
    ) as ScrollBoxRenderable;
    const markdown = scrollbox.getChildren().find((child) => child instanceof MarkdownRenderable);
    expect(!!markdown).toBe(true);
    await find(setup, "needle");
    expect(
      scrollbox.getChildren().find((child) => child instanceof MarkdownRenderable) === markdown,
    ).toBe(true);
    expect(loads).toEqual(["guide"]);
    expect(setup.captureCharFrame()).toContain("1/3");
    expect(setup.captureCharFrame()).not.toContain("title: Guide");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80, 79, 43])(
  "Reader is bounded and returns directly to its selected inventory row at %i columns",
  async (width) => {
    const { setup } = await mount(width);
    try {
      const body = await focusLive(setup, "reader-scrollbox");
      expect(body.screenX).toBeGreaterThanOrEqual(0);
      expect(body.screenX + body.width).toBeLessThanOrEqual(width);
      expect(body.screenY + body.height).toBeLessThanOrEqual(40);
      await inventory(setup);
      expect(
        (setup.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.value,
      ).toBe(JSON.stringify([readerAddress.source, readerAddress.path]));
    } finally {
      setup.renderer.destroy();
    }
  },
);

test("Find reveals the selected raw match and supports native scrolling", async () => {
  const { setup } = await mount(120, 24);
  try {
    await rawMatch(setup);
    const body = (await focusLive(setup, "reader-scrollbox")) as ScrollBoxRenderable;
    await setup.flush();
    expect(body.scrollHeight).toBeGreaterThan(body.height);
    expect(!!setup.renderer.root.findDescendantById("reader-line-15")).toBe(true);
    const before = body.scrollTop;
    await setup.mockMouse.scroll(body.screenX + 1, body.screenY + 1, "down");
    await setup.flush();
    expect(body.scrollTop).toBeGreaterThan(before);
    setup.mockInput.pressKey("HOME");
    await setup.flush();
    expect(body.scrollTop).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader Find owns slash characters", async () => {
  const { setup } = await mount();
  try {
    await find(setup, "https://example.com");
    expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
      "https://example.com",
    );
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader retains per-Skill Find, raw mode and match across A B A without reading twice", async () => {
  const { setup, loads } = await mount();
  try {
    await rawMatch(setup);
    await inventory(setup);
    await enterInstalledAddress(setup, readerSecondAddress);
    await waitForReaderBody(setup, "other needle");
    await inventory(setup);
    await enterInstalledAddress(setup, readerAddress);
    await enterLive(setup, "reader-find-open");
    await setup.waitForFrame((frame) => frame.includes("2/3"));
    expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
      "needle",
    );
    expect(!!setup.renderer.root.findDescendantById("reader-line-15")).toBe(true);
    expect(loads).toEqual(["guide", "reference"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader remembers zero after scrolling raw content and Details back to the top", async () => {
  const { setup } = await mount(120, 24);
  try {
    await rawMatch(setup);
    for (const tab of [0, 2] as const) {
      await openReaderTab(setup, tab);
      if (tab === 2) await enterLive(setup, "reader-details-metadata");
      const id = tab === 0 ? "reader-scrollbox" : "reader-details";
      const body = (await focusLive(setup, id)) as ScrollBoxRenderable;
      await setup.flush();
      body.scrollTo(7);
      await setup.mockMouse.scroll(body.screenX, body.screenY, "down");
      await setup.flush();
      expect(body.scrollTop).toBeGreaterThan(0);
      body.scrollTo(0);
      await setup.mockMouse.scroll(body.screenX, body.screenY, "up");
      await setup.flush();
      await parsedEscape(setup);
      await enterInstalledAddress(setup, readerAddress);
      await openReaderTab(setup, tab);
      await setup.flush();
      expect((setup.renderer.root.findDescendantById(id) as ScrollBoxRenderable).scrollTop).toBe(0);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader state survives a Scope round-trip and repeated responsive changes", async () => {
  const { setup, loads } = await mount();
  try {
    await rawMatch(setup);
    await openMainPage(setup, "settings");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("shell-scope-select"));
    for (const destination of ["global", "project", "global"]) {
      await enterLive(setup, "shell-scope-select");
      const choices = (await focusLive(setup, "scope-choices")) as SelectRenderable;
      const index = choices.options.findIndex((option) => option.value === destination);
      expect(index).toBeGreaterThanOrEqual(0);
      choices.setSelectedIndex(index);
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.toLowerCase().includes(destination));
    }
    await openAllInstalledSkills(setup);
    await parsedEnter(setup);
    await enterLive(setup, "reader-find-open");
    expect(!!setup.renderer.root.findDescendantById("reader-line-15")).toBe(true);
    for (const width of [120, 79, 43, 80, 120]) {
      setup.resize(width, 40);
      await setup.flush();
      expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
        "needle",
      );
      expect(setup.captureCharFrame()).toContain("2/3");
      expect(
        (setup.renderer.root.findDescendantById("reader-identity") as TextRenderable).plainText,
      ).toBe("guide");
    }
    expect(loads).toEqual(["guide"]);
  } catch (error) {
    console.error("Reader scope round-trip", {
      focus: setup.renderer.currentFocusedRenderable?.id,
      frame: setup.captureCharFrame(),
      loads,
    });
    throw error;
  } finally {
    setup.renderer.destroy();
  }
});

test("Reader Details Escape restores the current inventory row", async () => {
  const { setup } = await mount();
  try {
    await openReaderTab(setup, 2);
    await focusLive(setup, "reader-details");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("Source workspace returns from Reader to the exact installed Skill and Source", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment, { address }) =>
            address.path === readerSecondAddress.path ? readerSecondContent : readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 79, height: 24 },
  );
  try {
    await setup.flush();
    await openMainPage(setup, "sources");
    await enterLive(setup, "source-browser");
    const rowId = `source-installed-skills-row-${encodeURIComponent(skillAddressKey(readerSecondAddress))}`;
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById(rowId));
    const row = setup.renderer.root.findDescendantById(rowId)!;
    await setup.waitFor(() => row.width > 0 && row.height > 0 && row.screenY > 0);
    await setup.flush();
    await setup.mockMouse.click(row.screenX + 1, row.screenY);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-installed-skills",
    );
    await setup.waitFor(() => (row as BoxRenderable).backgroundColor.a > 0);
    expect((row.getChildren()[0]!.getChildren()[0] as TextRenderable).plainText).toBe("› ");
    await parsedEnter(setup);
    await waitForReaderBody(setup, "reference");
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "source-installed-skills",
    );
    const restoredRow = setup.renderer.root.findDescendantById(rowId) as BoxRenderable;
    expect(restoredRow).toBeInstanceOf(BoxRenderable);
    expect(restoredRow.backgroundColor.a).toBeGreaterThan(0);
    expect((restoredRow.getChildren()[0]!.getChildren()[0] as TextRenderable).plainText).toBe("› ");
    expect(
      (setup.renderer.root.findDescendantById("source-details-pane") as BoxRenderable).title,
    ).toBe(readerSecondAddress.source);
    await parsedEscape(setup);
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
  } catch (error) {
    console.error("Source Reader return", {
      focus: setup.renderer.currentFocusedRenderable?.id,
      frame: setup.captureCharFrame(),
    });
    throw error;
  } finally {
    setup.renderer.destroy();
  }
});

test.each([120, 80])(
  "empty Source opens its detail surface and restores its browser at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.flush();
      await openMainPage(setup, "sources");
      await enterLive(setup, "source-browser");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("source-view-tab-settings"),
      );
      await enterLive(setup, "source-view-tab-settings");
      await setup.waitForFrame((frame) => frame.includes("https://github.com/acme/main"));
      await parsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "source-browser");
    } finally {
      setup.renderer.destroy();
    }
  },
);
