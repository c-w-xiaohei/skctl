import { expect, test } from "bun:test";
import {
  type BaseRenderable,
  InputRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerAddress,
  readerContent,
  readerProjection,
  readerSecondAddress,
  readerSecondContent,
} from "./installed-reader.fixture";

async function awaitParsedEscape(setup: Awaited<ReturnType<typeof testRender>>) {
  await new Promise<void>((resolve) => {
    const onKeypress = (event: { readonly name: string }) => {
      if (event.name === "escape" || event.name === "esc") {
        setup.renderer.keyInput.off("keypress", onKeypress);
        resolve();
      }
    };
    setup.renderer.keyInput.prependListener("keypress", onKeypress);
    setup.mockInput.pressKey("ESCAPE");
  });
}

const paddedReaderContent = {
  ...readerContent,
  rawText: `${readerContent.rawText}${"padding\n".repeat(80)}`,
  markdownText: `${readerContent.markdownText}${"padding\n".repeat(80)}`,
};

async function loadedReader(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  await Promise.resolve();
  await setup.waitFor(
    () =>
      !!setup.renderer.root
        .findDescendantById("reader-scrollbox")
        ?.getChildren()
        .some((child) => child instanceof MarkdownRenderable),
  );
}

const readerContentFor = (address: { readonly path: string }) =>
  address.path === readerSecondAddress.path ? readerSecondContent : paddedReaderContent;

async function enterFind(setup: Awaited<ReturnType<typeof testRender>>, value: string) {
  setup.renderer.root.findDescendantById("reader-scrollbox")?.focus();
  setup.mockInput.pressKey("/");
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
  await setup.mockInput.pressKeys([...value]);
  setup.mockInput.pressEnter();
  await setup.renderOnce();
}

async function selectReaderControl(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: "reader-find-next" | "reader-raw" | "open-match-raw",
) {
  const control = setup.renderer.root.findDescendantById(id);
  control?.focus();
  expect(control).toBeInstanceOf(SelectRenderable);
  (control as SelectRenderable).selectCurrent();
  await setup.renderOnce();
  await Promise.resolve();
}

function patchScrollTargets() {
  const targets: string[] = [];
  const positions: number[] = [];
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
      scrollTop.set!.call(this, value);
    },
  });
  return {
    targets,
    positions,
    restore: () => {
      ScrollBoxRenderable.prototype.scrollChildIntoView = original;
      Object.defineProperty(ScrollBoxRenderable.prototype, "scrollTop", scrollTop);
    },
  };
}

function topNavigation(setup: Awaited<ReturnType<typeof testRender>>) {
  const visit = (node: BaseRenderable): TabSelectRenderable | undefined => {
    if (
      node instanceof TabSelectRenderable &&
      node.options.some((option) => option.value === "workspace")
    )
      return node;
    for (const child of node.getChildren()) {
      const result = visit(child);
      if (result) return result;
    }
  };
  const navigation = visit(setup.renderer.root);
  expect(navigation).toBeDefined();
  return navigation!;
}

test("RENDER Installed Skill uses structural content and native Reader renderables", async () => {
  const loads: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => {
            loads.push(request);
            return { value: readerContent, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    await setup.renderOnce();
    await setup.renderOnce();
    await setup.waitForFrame((frame) => frame.includes("A rich Installed Skill"));
    expect(loads).toEqual([{ address: readerAddress }]);
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeInstanceOf(
      ScrollBoxRenderable,
    );
    expect(setup.renderer.root.findDescendantById("reader-find")).toBeInstanceOf(InputRenderable);
    const reader = setup.renderer.root.findDescendantById("reader-scrollbox")!;
    expect(reader.getChildren().some((child) => child instanceof MarkdownRenderable)).toBe(true);
    expect(setup.captureCharFrame()).not.toContain("title: Guide");
    reader.focus();
    setup.renderer.root.findDescendantById("reader-scrollbox")?.focus();
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
    const markdown = reader
      .getChildren()
      .find((child) => child instanceof MarkdownRenderable) as MarkdownRenderable;
    await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
    await setup.renderOnce();
    expect(reader.getChildren().filter((child) => child instanceof MarkdownRenderable)).toEqual([
      markdown,
    ]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("1/3"));
    expect(setup.renderer.root.findDescendantById("reader-find-next")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")?.getChildren()).toHaveLength(
      1,
    );
    await awaitParsedEscape(setup);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("reader-find")).toBeInstanceOf(InputRenderable);
    expect(setup.renderer.root.findDescendantById("reader-line-0")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Installed Skill Enter focuses Reader and Escape restores the list at standard and narrow widths", async () => {
  for (const width of [120, 79] as const) {
    const setup = await testRender(
      () => <App core={directSourceCore(readerProjection())} exit={() => {}} />,
      { width, height: 40 },
    );
    try {
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
      await setup.renderOnce();
      await setup.waitForFrame((frame) => frame.includes("A rich Installed Skill"));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
      await awaitParsedEscape(setup);
      await setup.renderOnce();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      if (width < 80) expect(setup.captureCharFrame()).not.toContain("SKILL.md");
    } finally {
      setup.renderer.destroy();
    }
  }
});

test("RENDER Reader navigation reveals matches, preserves native scroll, and gives controls an explicit Tab order", async () => {
  const content = {
    ...readerContent,
    rawText: `${readerContent.rawText}${"padding\n".repeat(40)}`,
    markdownText: `${readerContent.markdownText}${"padding\n".repeat(40)}`,
  };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: content, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    await setup.waitForFrame((frame) => frame.includes("A rich Installed Skill"));
    setup.renderer.root.findDescendantById("reader-scrollbox")?.focus();
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    await setup.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("1/3"));

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-raw");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find-previous");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find-next");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    const scrollbox = setup.renderer.root.findDescendantById(
      "reader-scrollbox",
    ) as ScrollBoxRenderable;
    expect(scrollbox.scrollHeight).toBeGreaterThan(scrollbox.height);

    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-match-raw");
    setup.mockInput.pressKey("TAB", { shift: true });
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find-next");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-match-raw");
    setup.mockInput.pressEnter();
    await Promise.resolve();
    await setup.renderOnce();
    const rawScrollbox = setup.renderer.root.findDescendantById(
      "reader-scrollbox",
    ) as ScrollBoxRenderable;
    expect(rawScrollbox.getRenderable("reader-line-13")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("open-match-raw")).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");

    setup.mockInput.pressKey("PAGEDOWN");
    setup.mockInput.pressKey("END");
    await setup.renderOnce();
    expect(rawScrollbox.scrollHeight).toBeGreaterThan(rawScrollbox.height);
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader ignores unavailable zero native scroll telemetry after opening a raw match", async () => {
  const scroll = patchScrollTargets();
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: paddedReaderContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await loadedReader(setup);
    await enterFind(setup, "needle");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find-next");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("open-match-raw");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    setup.mockInput.pressKey("PAGEDOWN");
    setup.mockInput.pressKey("END");
    await setup.renderOnce();
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    browser.moveDown();
    await Promise.resolve();
    await setup.renderOnce();
    browser.moveUp();
    await Promise.resolve();
    await setup.renderOnce();
    expect(scroll.positions).toContain(15);
  } finally {
    scroll.restore();
    setup.renderer.destroy();
  }
});

test("RENDER Reader find input owns slash characters", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await setup.renderOnce();
    await Promise.resolve();
    await setup.waitForFrame((frame) => frame.includes("A rich Installed Skill"));
    setup.renderer.root.findDescendantById("reader-scrollbox")?.focus();
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
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
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-find");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader restores per-Skill find/raw/match and scroll target across A B A", async () => {
  const scroll = patchScrollTargets();
  const loads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => {
            loads.push(request.address.path);
            return { value: readerContentFor(request.address), diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await loadedReader(setup);
    await enterFind(setup, "needle");
    await selectReaderControl(setup, "reader-find-next");
    await selectReaderControl(setup, "open-match-raw");
    expect(setup.captureCharFrame()).toContain("2/3");
    expect(scroll.targets).toContain("reader-line-15");

    await awaitParsedEscape(setup);
    await setup.renderOnce();
    await Promise.resolve();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    const activeBrowser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(setup.renderer.currentFocusedRenderable).toBe(activeBrowser);
    activeBrowser.moveDown();
    await setup.renderOnce();
    expect(
      (
        setup.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable
      ).getSelectedIndex(),
    ).toBe(1);
    await Promise.resolve();
    await setup.renderOnce();
    expect(loads.at(-1)).toBe("reference");
    expect(
      (
        setup.renderer.root
          .findDescendantById("reader-scrollbox")!
          .getChildren()
          .find((child) => child instanceof MarkdownRenderable)! as MarkdownRenderable
      ).content,
    ).toContain("# Reference");
    const secondFind = setup.renderer.root.findDescendantById("reader-find") as InputRenderable;
    secondFind.focus();
    secondFind.insertText("other");
    secondFind.submit();
    await setup.renderOnce();
    expect(secondFind.value).toBe("other");
    expect(setup.renderer.root.findDescendantById("reader-find-next")).toBeDefined();
    scroll.targets.length = 0;
    scroll.positions.length = 0;
    const returningBrowser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    returningBrowser.moveUp();
    await Promise.resolve();
    await setup.renderOnce();
    expect(loads.at(-1)).toBe("guide");
    await setup.renderOnce();
    expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
      "needle",
    );
    expect(setup.captureCharFrame()).toContain("2/3");
    expect(setup.renderer.root.findDescendantById("reader-line-15")).toBeDefined();
    expect(scroll.positions).toContain(15);
    expect(setup.captureCharFrame()).not.toContain("other 1/1");
  } finally {
    scroll.restore();
    setup.renderer.destroy();
  }
});

test("RENDER Reader state survives destination away and return", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => ({
            value: readerContentFor(request.address),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await loadedReader(setup);
    await enterFind(setup, "needle");
    await selectReaderControl(setup, "reader-find-next");
    await selectReaderControl(setup, "open-match-raw");
    expect(setup.renderer.root.findDescendantById("reader-line-15")).toBeDefined();

    const navigation = topNavigation(setup);
    navigation.moveRight();
    navigation.moveRight();
    navigation.selectCurrent();
    await setup.waitFor(() => topNavigation(setup).getSelectedOption()?.value === "project");
    expect(setup.renderer.root.findDescendantById("config-source-browser")).toBeDefined();
    const returningNavigation = topNavigation(setup);
    returningNavigation.moveLeft();
    returningNavigation.moveLeft();
    returningNavigation.selectCurrent();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    expect((setup.renderer.root.findDescendantById("reader-find") as InputRenderable).value).toBe(
      "needle",
    );
    expect(setup.captureCharFrame()).toContain("2/3");
    expect(setup.renderer.root.findDescendantById("reader-line-15")).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER Reader state survives 120 79 43 80 120 resize sequence", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => ({
            value: readerContentFor(request.address),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 16 },
  );
  try {
    await loadedReader(setup);
    await enterFind(setup, "needle");
    await selectReaderControl(setup, "reader-find-next");
    await selectReaderControl(setup, "open-match-raw");

    for (const width of [120, 79, 43, 80, 120] as const) {
      setup.resize(width, 16);
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
        (browser as SelectRenderable).selectCurrent();
        await setup.renderOnce();
        expect(setup.captureCharFrame()).toContain("needle");
        expect(setup.captureCharFrame()).toContain("2/3");
      }
      if (width === 43) {
        await awaitParsedEscape(setup);
        await setup.renderOnce();
        await Promise.resolve();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
        const restoredBrowser = setup.renderer.root.findDescendantById(
          "installed-skill-browser",
        ) as SelectRenderable;
        restoredBrowser.selectCurrent();
        await setup.renderOnce();
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER source-filtered Installed Skill enters Reader and returns to filtered list", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async (request) => ({
            value: readerContentFor(request.address),
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 24 },
  );
  try {
    await loadedReader(setup);
    const section = setup.renderer.root.findDescendantById("workspace-section-browser")!;
    section.focus();
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("SOURCE TYPE SKILLS CONFIG"));
    setup.renderer.root.findDescendantById("source-browser")?.focus();
    setup.mockInput.pressEnter();
    await setup.waitForFrame((frame) => frame.includes("View Installed Skills"));
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressKey("ARROW_DOWN");
    setup.mockInput.pressEnter();
    await setup.waitForFrame(
      (frame) => frame.includes("Installed Skills from") && frame.includes("team-main"),
    );
    expect(setup.captureCharFrame()).toContain("guide");
    expect(setup.captureCharFrame()).not.toContain("team-config/lark");
    const browser = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    browser.focus();
    browser.selectCurrent();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    await awaitParsedEscape(setup);
    await setup.renderOnce();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    expect(setup.captureCharFrame()).toContain("Installed Skills from");
    expect(setup.captureCharFrame()).toContain("team-main");
    expect(setup.captureCharFrame()).toContain("guide");
  } finally {
    setup.renderer.destroy();
  }
});

test("RENDER standard Skills Reader split has one separator and narrow frames do not", async () => {
  for (const width of [120, 80, 79, 43] as const) {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          })}
          exit={() => {}}
        />
      ),
      { width, height: 40 },
    );
    try {
      await setup.renderOnce();
      await Promise.resolve();
      await setup.waitFor(() =>
        width >= 80
          ? !!setup.renderer.root.findDescendantById("reader-scrollbox") &&
            !!setup.renderer.root.findDescendantById("skills-reader-separator")
          : !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      const browser = setup.renderer.root.findDescendantById("installed-skill-browser");
      expect(browser).toBeDefined();
      expect(setup.captureCharFrame()).toContain("guide");
      expect(!!setup.renderer.root.findDescendantById("skills-reader-separator")).toBe(width >= 80);
      const reader = setup.renderer.root.findDescendantById("reader-scrollbox");
      if (width >= 80) {
        expect(reader?.screenX).toBeGreaterThanOrEqual(0);
        expect((reader?.screenX ?? 0) + (reader?.width ?? 0)).toBeLessThanOrEqual(width);
        const separator = setup.renderer.root.findDescendantById("skills-reader-separator")!;
        expect(separator.screenX).toBeGreaterThanOrEqual(browser!.screenX + browser!.width - 1);
        expect(separator.screenX).toBeLessThanOrEqual(browser!.screenX + browser!.width);
        expect(separator.screenX + separator.width).toBeLessThanOrEqual(reader!.screenX);
        expect(separator.height).toBeGreaterThan(1);
        expect(separator.screenY).toBeLessThanOrEqual(browser!.screenY);
        expect(separator.screenY + separator.height).toBeGreaterThanOrEqual(
          reader!.screenY + reader!.height,
        );
      } else expect(reader).toBeUndefined();
    } finally {
      setup.renderer.destroy();
    }
  }
});
