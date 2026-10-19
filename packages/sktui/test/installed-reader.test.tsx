import { expect, test } from "bun:test";
import {
  InputRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { skillAddressKey } from "../src/types";
import {
  directSourceCore,
  openReaderFromInspector,
  workspaceProjection,
} from "./direct-source.fixture";
import {
  readerAddress,
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";
import {
  focusLive,
  enterInstalledAddress,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
const paddedReaderContent = {
  ...readerContent,
  rawText: `${readerContent.rawText}${"padding\n".repeat(80)}`,
  markdownText: `${readerContent.markdownText}${"padding\n".repeat(80)}`,
};
async function loadedReader(setup: Awaited<ReturnType<typeof testRender>>) {
  await openReader(setup);
  await setup.renderOnce();
  await setup.waitFor(
    () =>
      !!setup.renderer.root
        .findDescendantById("reader-scrollbox")
        ?.getChildren()
        .some((child) => child instanceof MarkdownRenderable),
  );
}
async function escapeReaderToBrowser(setup: Awaited<ReturnType<typeof testRender>>) {
  await focusLive(setup, "reader-scrollbox");
  await parsedEscape(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  await focusLive(setup, "skill-inspector-open-reader");
  await parsedEscape(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
  const browser = setup.renderer.root.findDescendantById("installed-skill-browser")!;
  browser.focus();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
}
async function openReader(setup: Awaited<ReturnType<typeof testRender>>) {
  await openReaderFromInspector(setup);
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
}
async function enterInstalledSkill(
  setup: Awaited<ReturnType<typeof testRender>>,
  address: {
    readonly source: string;
    readonly path: string;
  },
) {
  let browser = mountedSelect(setup, "installed-skill-browser");
  const value = JSON.stringify([address.source, address.path]);
  const target = browser.options.findIndex((option) => option.value === value);
  expect(target).toBeGreaterThanOrEqual(0);
  const direction = target >= browser.getSelectedIndex() ? "down" : "up";
  while (browser.getSelectedIndex() !== target) {
    const nextIndex = browser.getSelectedIndex() + (direction === "down" ? 1 : -1);
    setup.mockInput.pressArrow(direction);
    await setup.waitFor(() => {
      const current = setup.renderer.root.findDescendantById("installed-skill-browser");
      return current instanceof SelectRenderable && current.getSelectedIndex() === nextIndex;
    });
    browser = mountedSelect(setup, "installed-skill-browser");
  }
  await focusLive(setup, "installed-skill-browser");
  await parsedEnter(setup);
  await setup.waitFor(
    () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
  );
  await setup.waitFor(() =>
    setup.captureCharFrame().includes(`Address  ${address.source}/${address.path}`),
  );
}
async function openDetails(setup: Awaited<ReturnType<typeof testRender>>) {
  await openReaderTab(setup, 2);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-details"));
  const details = setup.renderer.root.findDescendantById("reader-details");
  expect(details).toBeInstanceOf(ScrollBoxRenderable);
  details!.focus();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === details);
}
async function openInstalledSkills(setup: Awaited<ReturnType<typeof testRender>>) {
  await openAllInstalledSkills(setup);
}
const readerContentFor = (address: { readonly path: string }) =>
  address.path === readerSecondAddress.path ? readerSecondContent : paddedReaderContent;
function mountedSelect(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: string,
): SelectRenderable {
  const target = setup.renderer.root.findDescendantById(id);
  expect(target).toBeInstanceOf(SelectRenderable);
  const select = target as SelectRenderable;
  expect(select.isDestroyed).toBe(false);
  expect(select.parent).toBeDefined();
  return select;
}
test("RENDER Installed Skills keeps identity primary and uses available list height", async () => {
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
          ? [{ code: "SOURCE_MISSING", severity: "warning" as const, message: "Missing" }]
          : [],
    })),
  };
  const setup = await testRender(
    () => <App core={directSourceCore(projection)} exit={() => {}} />,
    { width: 120, height: 40 },
  );
  try {
    await openInstalledSkills(setup);
    await setup.waitFor(() => {
      const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
      return browser instanceof SelectRenderable && browser.options.length === 12;
    });
    let browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.options[0]).toEqual({
      name: "entry-0 -> Skill details",
      description: "Description 0 · team-main",
      value: JSON.stringify(["team-main", "entry-0"]),
    });
    expect(browser.options[11]).toMatchObject({
      name: "! entry-11 -> Skill details",
      value: JSON.stringify(["team-main", "entry-11"]),
    });
    expect(browser.showDescription).toBe(false);
    expect(browser.showSelectionIndicator).toBe(true);
    expect(browser.showScrollIndicator).toBe(true);
    expect(browser.height).toBeGreaterThan(10);
    expect(browser.height).toBeLessThanOrEqual(40 - browser.screenY);
    await focusLive(setup, "installed-skill-browser");
    for (let index = 0; index < 11; index++) {
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => {
        const current = setup.renderer.root.findDescendantById("installed-skill-browser");
        return current instanceof SelectRenderable && current.getSelectedIndex() === index + 1;
      });
    }
    browser = mountedSelect(setup, "installed-skill-browser");
    await setup.waitFor(
      () => browser.getSelectedOption()?.value === JSON.stringify(["team-main", "entry-11"]),
    );
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skill-inspector"));
    await setup.waitForFrame((frame) => frame.includes("Address  team-main/entry-11"));
    expect(setup.captureCharFrame()).toContain("Address  team-main/entry-11");
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Installed Skills keeps the selected Skill's secondary facts visible", async () => {
  const base = readerProjection();
  const template = base.installedSkills[0]!;
  const projection = {
    ...base,
    installedSkills: [
      {
        ...template,
        name: "broken-guide",
        description: "Recover an unavailable guide",
        owner: { ...template.owner, health: "missing" as const },
        problems: [
          { code: "SOURCE_MISSING", severity: "warning" as const, message: "Source missing" },
        ],
      },
    ],
  };
  for (const width of [120, 79] as const) {
    const setup = await testRender(
      () => <App core={directSourceCore(projection)} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await openInstalledSkills(setup);
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("skill-inspector"));
      await setup.renderOnce();
      await setup.waitForFrame((frame) => frame.includes("broken-guide"));
      const frame = setup.captureCharFrame();
      expect(frame).toContain("broken-guide");
      expect(frame).toContain("guide");
      expect(frame).toContain("broken-guide");
      expect(frame).toContain("Health  missing");
      expect(frame).toContain("Problem  Source missing");
    } finally {
      setup.renderer.destroy();
    }
  }
});
async function enterFind(setup: Awaited<ReturnType<typeof testRender>>, value: string) {
  await setup.waitFor(
    () =>
      !!setup.renderer.root
        .findDescendantById("reader-scrollbox")
        ?.getChildren()
        .some((child) => child instanceof MarkdownRenderable),
  );
  await focusLive(setup, "reader-find");
  await setup.mockInput.pressKeys([...value]);
  await parsedEnter(setup);
  if (value)
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-find-next"));
  else await setup.renderOnce();
}
async function selectReaderControl(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: "reader-find-next" | "reader-raw" | "open-match-raw",
) {
  await focusLive(setup, id);
  await parsedEnter(setup);
}
async function restoreReaderScroll(setup: Awaited<ReturnType<typeof testRender>>) {
  const scrollbox = setup.renderer.root.findDescendantById("reader-scrollbox");
  expect(scrollbox).toBeInstanceOf(ScrollBoxRenderable);
  await focusLive(setup, "reader-scrollbox");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
}
function patchScrollTargets() {
  const targets: string[] = [];
  const positions: number[] = [];
  const detailsPositions: number[] = [];
  const original = ScrollBoxRenderable.prototype.scrollChildIntoView;
  const scrollTop = Object.getOwnPropertyDescriptor(ScrollBoxRenderable.prototype, "scrollTop")!;
  ScrollBoxRenderable.prototype.scrollChildIntoView = function (id) {
    if (this.id === "reader-scrollbox") targets.push(id);
    return original.call(this, id);
  };
  Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", {
    configurable: true,
    get: scrollTop.get,
    set(value: number) {
      if (this.id === "reader-scrollbox") positions.push(value);
      if (this.id === "reader-details") detailsPositions.push(value);
      scrollTop.set!.call(this, value);
    },
  });
  return {
    targets,
    positions,
    detailsPositions,
    restore: () => {
      ScrollBoxRenderable.prototype.scrollChildIntoView = original;
      Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", scrollTop);
    },
  };
}
test.serial(
  "RENDER Installed Skill uses structural content and native Reader renderables",
  async () => {
    const loads: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              loads.push(request);
              return readerContent;
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openReader(setup);
      await setup.waitFor(
        () =>
          !!setup.renderer.root
            .findDescendantById("reader-scrollbox")
            ?.getChildren()
            .some((child) => child instanceof MarkdownRenderable),
      );
      expect(loads).toEqual([{ address: readerAddress }]);
      expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeInstanceOf(
        ScrollBoxRenderable,
      );
      expect(setup.renderer.root.findDescendantById("reader-find")).toBeInstanceOf(InputRenderable);
      const reader = setup.renderer.root.findDescendantById("reader-scrollbox")!;
      expect(reader.getChildren().some((child) => child instanceof MarkdownRenderable)).toBe(true);
      expect(setup.captureCharFrame()).not.toContain("title: Guide");
      await enterFind(setup, "");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
      const markdown = reader
        .getChildren()
        .find((child) => child instanceof MarkdownRenderable) as MarkdownRenderable;
      await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
      await setup.renderOnce();
      expect(reader.getChildren().filter((child) => child instanceof MarkdownRenderable)).toEqual([
        markdown,
      ]);
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("1/3"));
      expect(setup.renderer.root.findDescendantById("reader-find-next")).toBeDefined();
      expect(
        setup.renderer.root.findDescendantById("reader-scrollbox")?.getChildren(),
      ).toHaveLength(1);
      await parsedEscape(setup);
      await parsedEnter(setup);
      await setup.renderOnce();
      expect(setup.renderer.root.findDescendantById("reader-find")).toBeInstanceOf(InputRenderable);
      expect(setup.renderer.root.findDescendantById("reader-line-0")).toBeUndefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);
test.serial(
  "RENDER Installed Skill Enter focuses Reader and Escape restores the list at standard and narrow widths",
  async () => {
    for (const width of [120, 79] as const) {
      const setup = await testRender(
        () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
        { width, height: 40 },
      );
      try {
        await openReader(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox",
        );
        await parsedEscape(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
        );
        await parsedEscape(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
        );
        expect(setup.captureCharFrame()).toContain("guide");
      } finally {
        setup.renderer.destroy();
      }
    }
  },
);
test.serial(
  "RENDER Reader navigation reveals matches, preserves native scroll, and gives controls an explicit Tab order",
  async () => {
    const content = {
      ...readerContent,
      rawText: `${readerContent.rawText}${"padding\n".repeat(40)}`,
      markdownText: `${readerContent.markdownText}${"padding\n".repeat(40)}`,
    };
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), { loadInstalledSkill: async () => content })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 24 },
    );
    try {
      await openReader(setup);
      await enterFind(setup, "");
      await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("1/3"));
      await selectReaderControl(setup, "reader-find-next");
      const scrollbox = setup.renderer.root.findDescendantById(
        "reader-scrollbox",
      ) as ScrollBoxRenderable;
      expect(scrollbox.scrollHeight).toBeGreaterThan(scrollbox.height);
      await selectReaderControl(setup, "open-match-raw");
      await Promise.resolve();
      await setup.renderOnce();
      const rawScrollbox = setup.renderer.root.findDescendantById(
        "reader-scrollbox",
      ) as ScrollBoxRenderable;
      expect(rawScrollbox.getRenderable("reader-line-13")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("open-match-raw")).toBeUndefined();
      await restoreReaderScroll(setup);
      setup.mockInput.pressKey("PAGEDOWN");
      setup.mockInput.pressKey("END");
      await setup.renderOnce();
      expect(rawScrollbox.scrollHeight).toBeGreaterThan(rawScrollbox.height);
    } finally {
      setup.renderer.destroy();
    }
  },
);
test.serial(
  "RENDER Reader ignores unavailable zero native scroll telemetry after opening a raw match",
  async () => {
    const scroll = patchScrollTargets();
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => paddedReaderContent,
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 16 },
    );
    try {
      await openReader(setup);
      await setup.waitFor(
        () =>
          !!setup.renderer.root
            .findDescendantById("reader-scrollbox")
            ?.getChildren()
            .some((child) => child instanceof MarkdownRenderable),
      );
      await enterFind(setup, "needle");
      await selectReaderControl(setup, "reader-find-next");
      await selectReaderControl(setup, "open-match-raw");
      await setup.renderOnce();
      await restoreReaderScroll(setup);
      expect(scroll.positions).toContain(15);
      setup.mockInput.pressKey("PAGEDOWN");
      setup.mockInput.pressKey("END");
      await setup.renderOnce();
      await parsedEscape(setup);
      expect(scroll.positions).toContain(15);
    } finally {
      scroll.restore();
      setup.renderer.destroy();
    }
  },
);
test.serial("RENDER Reader find input owns slash characters", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async () => readerContent,
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openReader(setup);
    await enterFind(setup, "");
    await setup.renderOnce();
    await setup.mockInput.pressKeys([
      "h",
      "t",
      "t",
      "p",
      "s",
      ":",
      "/",
      "/",
      "e",
      "x",
      "a",
      "m",
      "p",
      "l",
      "e",
      ".",
      "c",
      "o",
      "m",
    ]);
    await parsedEnter(setup);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
  } finally {
    setup.renderer.destroy();
  }
});
test.serial(
  "RENDER Reader restores per-Skill find/raw/match and scroll target across A B A",
  async () => {
    const scroll = patchScrollTargets();
    const loads: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              loads.push(request.address.path);
              return readerContentFor(request.address);
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 16 },
    );
    try {
      await openReader(setup);
      await setup.waitFor(
        () =>
          !!setup.renderer.root
            .findDescendantById("reader-scrollbox")
            ?.getChildren()
            .some((child) => child instanceof MarkdownRenderable),
      );
      await enterFind(setup, "needle");
      await selectReaderControl(setup, "reader-find-next");
      await selectReaderControl(setup, "open-match-raw");
      expect(setup.captureCharFrame()).toContain("2/3");
      expect(scroll.targets).toContain("reader-line-15");
      await escapeReaderToBrowser(setup);
      let activeBrowser = mountedSelect(setup, "installed-skill-browser");
      activeBrowser.focus();
      setup.mockInput.pressArrow("down");
      await setup.waitFor(
        () =>
          (
            setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
          ).getSelectedIndex() === 1,
      );
      activeBrowser = mountedSelect(setup, "installed-skill-browser");
      activeBrowser.focus();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === activeBrowser);
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
      await focusLive(setup, "skill-inspector-open-reader");
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
      );
      await openReader(setup);
      await setup.waitFor(
        () =>
          !!setup.renderer.root
            .findDescendantById("reader-scrollbox")
            ?.getChildren()
            .some(
              (child) =>
                child instanceof MarkdownRenderable && child.content.includes("# Reference"),
            ),
      );
      expect(loads.at(-1)).toBe("reference");
      const referenceReader = setup.renderer.root.findDescendantById("reader-scrollbox");
      expect(referenceReader).toBeInstanceOf(ScrollBoxRenderable);
      const referenceMarkdown = referenceReader!
        .getChildren()
        .find((child) => child instanceof MarkdownRenderable);
      expect(referenceMarkdown).toBeInstanceOf(MarkdownRenderable);
      expect((referenceMarkdown as MarkdownRenderable).content).toContain("# Reference");
      scroll.targets.length = 0;
      scroll.positions.length = 0;
      await escapeReaderToBrowser(setup);
      await enterInstalledSkill(setup, readerAddress);
      await focusLive(setup, "skill-inspector-open-reader");
      await openReader(setup);
      await setup.waitFor(
        () =>
          (setup.renderer.root.findDescendantById("reader-find") as InputRenderable | undefined)
            ?.value === "needle",
      );
      await setup.renderOnce();
      expect(loads).toEqual(["guide", "reference"]);
      await setup.renderOnce();
      expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
        "needle",
      );
      expect(setup.captureCharFrame()).toContain("2/3");
      expect(scroll.positions).toContain(15);
    } finally {
      scroll.restore();
      setup.renderer.destroy();
      await Promise.resolve();
    }
  },
);
test.serial(
  "RENDER Reader saves zero after returning SKILL.md and Details to the top",
  async () => {
    const scroll = patchScrollTargets();
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => paddedReaderContent,
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 16 },
    );
    try {
      await openReader(setup);
      await setup.waitFor(
        () =>
          !!setup.renderer.root
            .findDescendantById("reader-scrollbox")
            ?.getChildren()
            .some((child) => child instanceof MarkdownRenderable),
      );
      await enterFind(setup, "needle");
      await selectReaderControl(setup, "reader-find-next");
      await selectReaderControl(setup, "open-match-raw");
      await restoreReaderScroll(setup);
      expect(scroll.positions).toContain(15);
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
      setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
      await openReader(setup);
      const reopenedReader = setup.renderer.root.findDescendantById(
        "reader-scrollbox",
      ) as ScrollBoxRenderable;
      await setup.renderOnce();
      expect(scroll.positions).toContain(15);
      scroll.positions.length = 0;
      reopenedReader.scrollTop = 0;
      reopenedReader.focus();
      await setup.mockMouse.scroll(reopenedReader.screenX, reopenedReader.screenY, "up");
      await Promise.resolve();
      await setup.renderOnce();
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
      setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
      await openReader(setup);
      await setup.renderOnce();
      expect(scroll.positions).not.toContain(15);
      expect(
        (setup.renderer.root.findDescendantById("reader-scrollbox") as ScrollBoxRenderable)
          .scrollTop,
      ).toBe(0);
      await openDetails(setup);
      const details = setup.renderer.root.findDescendantById(
        "reader-details",
      ) as ScrollBoxRenderable;
      const metadata = setup.renderer.root.findDescendantById("reader-details-metadata")!;
      metadata.focus();
      await parsedEnter(setup);
      await setup.waitFor(() => details.scrollHeight > details.height);
      details.scrollTop = 7;
      details.focus();
      setup.mockInput.pressKey("PAGEDOWN");
      await Promise.resolve();
      await setup.mockMouse.scroll(details.screenX, details.screenY, "down");
      await setup.renderOnce();
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
      setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
      await openReader(setup);
      await openDetails(setup);
      const reopenedDetails = setup.renderer.root.findDescendantById(
        "reader-details",
      ) as ScrollBoxRenderable;
      await setup.renderOnce();
      expect(scroll.detailsPositions).toContain(7);
      scroll.detailsPositions.length = 0;
      reopenedDetails.scrollTop = 0;
      reopenedDetails.focus();
      setup.mockInput.pressKey("HOME");
      await Promise.resolve();
      await setup.mockMouse.scroll(reopenedDetails.screenX, reopenedDetails.screenY, "up");
      await setup.renderOnce();
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
      setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
      await openReader(setup);
      await openDetails(setup);
      await setup.renderOnce();
      expect(scroll.detailsPositions).not.toContain(7);
      expect(
        (setup.renderer.root.findDescendantById("reader-details") as ScrollBoxRenderable).scrollTop,
      ).toBe(0);
    } finally {
      scroll.restore();
      setup.renderer.destroy();
    }
  },
);
test.serial("RENDER Reader state survives destination away and return", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) =>
            readerContentFor(request.address),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await loadedReader(setup);
    await enterFind(setup, "needle");
    await selectReaderControl(setup, "reader-find-next");
    await selectReaderControl(setup, "open-match-raw");
    expect(setup.renderer.root.findDescendantById("reader-line-15")).toBeDefined();
    await escapeReaderToBrowser(setup);
    const liveBrowser = mountedSelect(setup, "installed-skill-browser");
    expect(liveBrowser.getSelectedOption()?.value).toBe(skillAddressKey(readerAddress));
    await enterInstalledAddress(setup, readerAddress);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
    );
    await focusLive(setup, "skill-inspector-open-reader");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
    expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
      "needle",
    );
    expect(setup.captureCharFrame()).toContain("2/3");
    expect(setup.renderer.root.findDescendantById("reader-line-15")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test.serial("RENDER Reader Details Escape restores the initiating Inspector command", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) =>
            readerContentFor(request.address),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openReader(setup);
    await openDetails(setup);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
    );
  } finally {
    setup.renderer.destroy();
  }
});
test.serial("RENDER Reader state survives 120 79 43 80 120 resize sequence", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) =>
            readerContentFor(request.address),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await loadedReader(setup);
    await enterFind(setup, "needle");
    await selectReaderControl(setup, "reader-find-next");
    await selectReaderControl(setup, "open-match-raw");
    await restoreReaderScroll(setup);
    for (const width of [120, 79, 43, 80, 120] as const) {
      setup.resize(width, 40);
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(setup.renderer.currentFocusedRenderable).toBeDefined();
      const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
      const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
      expect(!!reader || !!browser).toBe(true);
      if (width >= 80) {
        expect(frame).toContain("needle");
        expect(frame).toContain("2/3");
        expect(reader).toBeDefined();
        expect(reader!.screenX + reader!.width).toBeLessThanOrEqual(width);
      } else if (browser) {
        expect(frame).toContain("guide");
        browser.focus();
        await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
        await parsedEnter(setup);
        await setup.waitFor(
          () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
        );
        setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
        );
        await openReader(setup);
        expect(setup.captureCharFrame()).toContain("needle");
        expect(setup.captureCharFrame()).toContain("2/3");
      }
      if (width === 43) {
        await parsedEscape(setup);
        await setup.renderOnce();
        await Promise.resolve();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("skill-inspector-open-reader");
        setup.renderer.root.findDescendantById("skill-inspector-open-reader")!.focus();
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "skill-inspector-open-reader",
        );
        await parsedEnter(setup);
        await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-scrollbox"));
        setup.renderer.root.findDescendantById("reader-scrollbox")!.focus();
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox",
        );
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});
test.serial(
  "RENDER source-filtered Installed Skill enters Reader and returns to filtered list",
  async () => {
    const loads: string[] = [];
    const projection = {
      ...workspaceProjection(),
      installedSkills: readerProjection().installedSkills,
    };
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(projection, {
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              loads.push(request.address.path);
              return readerContentFor(request.address);
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await focusLive(setup, "shell-section-navigation");
      for (const section of ["collections", "sources"] as const) {
        setup.mockInput.pressArrow("down");
        await setup.waitFor(() => {
          const navigation = setup.renderer.root.findDescendantById("shell-section-navigation");
          return (
            navigation instanceof SelectRenderable &&
            navigation.getSelectedOption()?.value === section &&
            setup.renderer.currentFocusedRenderable === navigation
          );
        });
      }
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
      await focusLive(setup, "source-browser");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-command-skills"));
      await focusLive(setup, "source-command-skills");
      await parsedEnter(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      expect(loads).toEqual([]);
      await setup.waitForFrame((frame) => frame.includes("Installed Skills from team-main"));
      const filteredBrowser = mountedSelect(setup, "installed-skill-browser");
      expect(filteredBrowser.options.map((option) => option.value)).toEqual([
        skillAddressKey(readerAddress),
        skillAddressKey(readerSecondAddress),
      ]);
      await enterInstalledAddress(setup, readerAddress);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("skill-inspector-open-reader"),
      );
      await focusLive(setup, "skill-inspector-open-reader");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
      expect(loads).toEqual([readerAddress.path]);
      expect(setup.captureCharFrame()).toContain("guide");
      expect(setup.captureCharFrame()).toContain("needle");
      await escapeReaderToBrowser(setup);
      expect(setup.captureCharFrame()).toContain("Installed Skills from team-main");
      expect(setup.captureCharFrame()).toContain("guide");
      await parsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-command-skills"));
      await parsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
      expect(setup.captureCharFrame()).toContain("team-main");
    } finally {
      setup.renderer.destroy();
    }
  },
);
test.serial("RENDER Source Enter replaces its browser at wide and medium widths", async () => {
  for (const width of [120, 80] as const) {
    const setup = await testRender(
      () => <App core={directSourceCore(workspaceProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.renderOnce();
      await focusLive(setup, "shell-section-tab-skills");
      setup.mockInput.pressKey("ARROW_RIGHT");
      await setup.renderOnce();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-collections",
      );
      setup.mockInput.pressKey("ARROW_RIGHT");
      await setup.renderOnce();
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "shell-section-tab-sources",
      );
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
      await focusLive(setup, "source-browser");
      await parsedEnter(setup);
      await setup.waitFor(
        () =>
          setup.renderer.root.findDescendantById("source-browser") === undefined &&
          !!setup.renderer.root.findDescendantById("source-command-config"),
      );
      await setup.waitForFrame((frame) => frame.includes("Origin"));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-command-config");
      await parsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("source-browser"));
      expect(setup.renderer.root.findDescendantById("source-command-config")).toBeUndefined();
      await focusLive(setup, "source-browser");
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("source-browser");
    } finally {
      setup.renderer.destroy();
    }
  }
});
test.serial(
  "RENDER standard Skills Reader remains a single replacement surface at supported widths",
  async () => {
    for (const width of [120, 80, 79, 43] as const) {
      const setup = await testRender(
        () => (
          <App
            core={directSourceCore(readerProjection(), {
              loadInstalledSkill: async () => readerContent,
            })}
            exit={() => {}}
          />
        ),
        { width, height: 40 },
      );
      try {
        await openReader(setup);
        expect(setup.captureCharFrame()).toContain("guide");
        expect(setup.renderer.root.findDescendantById("workspace-reader-panel")).toBeUndefined();
        expect(setup.renderer.root.findDescendantById("skills-reader-separator")).toBeUndefined();
        const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
        expect(reader).toBeDefined();
        expect(reader?.screenX).toBeGreaterThanOrEqual(0);
        expect((reader?.screenX ?? 0) + (reader?.width ?? 0)).toBeLessThanOrEqual(width);
      } finally {
        setup.renderer.destroy();
      }
    }
  },
);
