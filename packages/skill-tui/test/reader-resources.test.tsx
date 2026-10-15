import { expect, test } from "bun:test";
import {
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TextRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { SkillCliError } from "@skill-cli/core";
import { skillAddressKey } from "../src/types";
import { directSourceCore, openReaderFromInspector } from "./direct-source.fixture";
import {
  readerAddress,
  readerContent,
  readerProjection,
  readerResources,
} from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
} from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function resourceBrowser(setup: Setup) {
  await setup.waitFor(() => {
    const browser = setup.renderer.root.findDescendantById("resource-browser");
    return browser instanceof SelectRenderable && browser.height > 0;
  });
  return (await focusLive(setup, "resource-browser")) as SelectRenderable;
}

async function chooseResource(setup: Setup, path: string) {
  let browser = await resourceBrowser(setup);
  const target = browser.options.findIndex((option) => option.value === path);
  expect(target, `Expected resource browser to expose ${path}`).toBeGreaterThanOrEqual(0);
  if (browser.getSelectedIndex() === target && browser.options.length > 1) {
    setup.mockInput.pressKey(target === 0 ? "ARROW_DOWN" : "ARROW_UP");
    await setup.renderOnce();
    browser = await resourceBrowser(setup);
  }
  while (browser.getSelectedIndex() !== target) {
    const next = browser.getSelectedIndex() + (browser.getSelectedIndex() < target ? 1 : -1);
    setup.mockInput.pressKey(next > browser.getSelectedIndex() ? "ARROW_DOWN" : "ARROW_UP");
    await setup.renderOnce();
    browser = await resourceBrowser(setup);
    await setup.waitFor(() => browser.getSelectedIndex() === next);
  }
  expect(browser.getSelectedOption()?.value, `Selected structural resource is ${path}`).toBe(path);
  const focused = await resourceBrowser(setup);
  expect(focused.getSelectedOption()?.value, `Live selected structural resource is ${path}`).toBe(
    path,
  );
  return focused;
}

async function openSelectedResource(setup: Setup, path: string) {
  await chooseResource(setup, path);
  await parsedEnter(setup);
}

async function awaitParsedEscape(setup: Setup) {
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
  await Promise.resolve();
  await setup.renderOnce();
}

async function openResources(setup: Setup, allowUnsettled = false) {
  await openAllInstalledSkills(setup);
  await openReaderFromInspector(setup);
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
  if (selectedReaderTab(setup) !== 1) await openReaderTab(setup, 1);
  expect(selectedReaderTab(setup), "Resources tab remains selected after remount").toBe(1);
  if (allowUnsettled)
    await setup.waitFor(
      () =>
        !!setup.renderer.root.findDescendantById("resource-browser") ||
        !!setup.renderer.root.findDescendantById("resource-retry") ||
        setup.captureCharFrame().includes("Loading resources") ||
        setup.captureCharFrame().includes("No supporting resources"),
    );
  else {
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
    await setup.renderOnce();
    await resourceBrowser(setup);
  }
}

async function openResourcesWithKeys(setup: Setup) {
  await openResources(setup);
  await resourceBrowser(setup);
}

async function backToResources(setup: Setup) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-resource-back"));
  await focusLive(setup, "reader-resource-back");
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
  await resourceBrowser(setup);
}

test.serial("RENDER resource content exposes the Back command record", async () => {
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
          listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          readInstalled: async (request) => ({
            value: { kind: "text", path: request.path, text: "resource", format: "text" },
            diagnostics: [],
          }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 40 },
  );
  try {
    await openResources(setup);
    await openSelectedResource(setup, "docs/guide.md");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
    await setup.renderOnce();
    expect(setup.renderer.root.findDescendantById("reader-resource-back")).toBeDefined();
    await focusLive(setup, "resource-content");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("resource-content");
  } finally {
    setup.renderer.destroy();
  }
});

test.serial(
  "RENDER Resources lists paths with selected structural information, pending and empty states",
  async () => {
    let resolveList:
      | ((value: { value: typeof readerResources; diagnostics: [] }) => void)
      | undefined;
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: (request) => {
              calls.push(request);
              return new Promise((resolve) => {
                resolveList = resolve;
              });
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(setup, true);
      expect(calls).toEqual([{ address: readerAddress }]);
      await setup.waitForFrame((frame) => frame.includes("Loading resources"));
      resolveList!({ value: readerResources, diagnostics: [] });
      await setup.waitForFrame((frame) => frame.includes("docs/") && frame.includes("bin/run"));
      const browser = await resourceBrowser(setup);
      expect(browser.options.map((option) => option.value)).toEqual(
        readerResources.map((resource) => resource.path),
      );
      expect(
        (setup.renderer.root.findDescendantById("reader-resource-info") as TextRenderable)
          .plainText,
      ).toBe("Directory");
      await chooseResource(setup, "bin/run");
      expect(
        (setup.renderer.root.findDescendantById("reader-resource-info") as TextRenderable)
          .plainText,
      ).toBe("Executable · 4 B");
      await chooseResource(setup, "submodule");
      expect(
        (setup.renderer.root.findDescendantById("reader-resource-info") as TextRenderable)
          .plainText,
      ).toBe("Gitlink");
      expect(setup.captureCharFrame()).not.toContain("deadbeef");
    } finally {
      setup.renderer.destroy();
    }

    const empty = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({ value: [], diagnostics: [] }),
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(empty, true);
      await empty.waitForFrame((frame) => frame.includes("No supporting resources"));
    } finally {
      empty.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources uses the remaining Reader height with selection indicators",
  async () => {
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(setup);
      const browser = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      expect(browser.height).toBeGreaterThan(8);
      expect(browser.showSelectionIndicator).toBe(true);
      expect(browser.showScrollIndicator).toBe(true);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("resource-browser");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources reads only files and renders returned Markdown, text, and not-text results",
  async () => {
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
            readInstalled: async (request) => {
              calls.push(request);
              if (request.path === "docs/guide.md")
                return {
                  value: {
                    kind: "text",
                    path: request.path,
                    text: "# Resource heading",
                    format: "markdown",
                  },
                  diagnostics: [],
                };
              if (request.path === "bin/run")
                return {
                  value: {
                    kind: "text",
                    path: request.path,
                    text: "#!/bin/sh\necho hi",
                    format: "text",
                  },
                  diagnostics: [],
                };
              return {
                value: {
                  kind: "not-text",
                  path: request.path,
                  reason: "binary",
                  metadata: { path: request.path, kind: "file", size: 8 },
                },
                diagnostics: [],
              };
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(setup);
      await setup.flush();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      const browser = await resourceBrowser(setup);
      expect(browser.options.find((option) => option.value === "docs/guide.md")?.value).toBe(
        "docs/guide.md",
      );
      await openSelectedResource(setup, "docs/guide.md");
      await setup.waitFor(() => calls.length === 1);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await focusLive(setup, "resource-content");
      expect(calls).toEqual([{ address: readerAddress, path: "docs/guide.md" }]);
      expect(
        (setup.renderer.root.findDescendantById("resource-content") as ScrollBoxRenderable)
          .getChildren()
          .some((child) => child instanceof MarkdownRenderable),
      ).toBe(true);

      await backToResources(setup);
      await openSelectedResource(setup, "bin/run");
      await setup.waitFor(() => calls.length === 2);
      expect(setup.renderer.root.findDescendantById("resource-line-0")).toBeDefined();

      await backToResources(setup);
      await openSelectedResource(setup, "blob.bin");
      await setup.waitFor(() => calls.length === 3);
      await setup.waitForFrame((frame) => frame.includes("Cannot preview binary resource"));
      expect(setup.captureCharFrame()).toContain("blob.bin  file 8 bytes");
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources retry the exact failed request and narrow Escape backs from content to list",
  async () => {
    let attempts = 0;
    let resolveRetry:
      | ((value: {
          value: { kind: "text"; path: string; text: string; format: "text" };
          diagnostics: [];
        }) => void)
      | undefined;
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
            readInstalled: async (request) => {
              calls.push(request);
              attempts++;
              if (attempts === 1) throw new SkillCliError("RESOURCE_NOT_FOUND", "resource moved");
              return new Promise((resolve) => {
                resolveRetry = resolve;
              });
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(setup);
      await chooseResource(setup, "docs/guide.md");
      await parsedEnter(setup);
      expect(calls).toEqual([{ address: readerAddress, path: "docs/guide.md" }]);
      expect(setup.renderer.root.findDescendantById("resource-retry")).toBeDefined();
      expect(setup.captureCharFrame()).toContain("RESOURCE_NOT_FOUND: resource moved");
      await focusLive(setup, "resource-retry");
      await parsedEnter(setup);
      expect(calls).toEqual([
        { address: readerAddress, path: "docs/guide.md" },
        { address: readerAddress, path: "docs/guide.md" },
      ]);
      expect(setup.renderer.root.findDescendantById("resource-content")).toBeDefined();
      resolveRetry!({
        value: {
          kind: "text",
          path: "docs/guide.md",
          text: "recovered",
          format: "text",
        },
        diagnostics: [],
      });
      await setup.waitForFrame((frame) => frame.includes("recovered"));
      expect(calls).toEqual([
        { address: readerAddress, path: "docs/guide.md" },
        { address: readerAddress, path: "docs/guide.md" },
      ]);
      setup.resize(79, 24);
      await setup.renderOnce();
      expect(!!setup.renderer.root.findDescendantById("resource-browser")).toBe(false);
      expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources retries a failed structural list without reading content",
  async () => {
    let attempts = 0;
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async (request) => {
              calls.push(request);
              attempts++;
              if (attempts === 1) throw new SkillCliError("RESOURCE_NOT_FOUND", "list moved");
              return { value: readerResources, diagnostics: [] };
            },
            readInstalled: async () => {
              throw new Error("list retry must not read content");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(setup, true);
      await setup.flush();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-retry"));
      await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: list moved"));
      await focusLive(setup, "resource-retry");
      await parsedEnter(setup);
      await setup.waitFor(() => calls.length === 2);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      expect(
        (await resourceBrowser(setup)).options.some((option) => option.value === "docs/guide.md"),
      ).toBe(true);
      expect(calls).toEqual([{ address: readerAddress }, { address: readerAddress }]);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources uses returned formats, omits ordinary executable metadata, and keyboard entry gates non-files",
  async () => {
    const reads: unknown[] = [];
    const resources = [
      { path: "docs", kind: "directory" as const },
      { path: "link", kind: "symlink" as const },
      { path: "submodule", kind: "gitlink" as const, gitlinkCommit: "deadbeef" },
      { path: "plain.md", kind: "file" as const, executable: false },
    ];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({ value: resources, diagnostics: [] }),
            readInstalled: async (request) => {
              reads.push(request);
              const descriptor = resources.find((resource) => resource.path === request.path)!;
              if (descriptor.kind !== "file")
                return {
                  value: {
                    kind: "not-text" as const,
                    path: request.path,
                    reason: "unsupported" as const,
                    metadata: descriptor,
                  },
                  diagnostics: [],
                };
              return {
                value: {
                  kind: "text" as const,
                  path: request.path,
                  text: "plain text",
                  format: "text" as const,
                },
                diagnostics: [],
              };
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResourcesWithKeys(setup);
      await setup.waitForFrame((frame) => frame.includes("plain.md"));
      expect(setup.captureCharFrame()).not.toContain("not executable");
      for (const path of ["docs", "link", "submodule"]) {
        await chooseResource(setup, path);
        await parsedEnter(setup);
        await setup.waitForFrame((frame) => frame.includes("Cannot preview unsupported resource"));
        expect(setup.renderer.root.findDescendantById("resource-line-0")).toBeDefined();
        await parsedEscape(setup);
        await setup.waitFor(
          () => setup.renderer.currentFocusedRenderable?.id === "resource-browser",
        );
      }
      await openSelectedResource(setup, "plain.md");
      await setup.waitForFrame((frame) => frame.includes("plain text"));
      expect(reads).toEqual(
        ["docs", "link", "submodule", "plain.md"].map((path) => ({ address: readerAddress, path })),
      );
      expect(setup.renderer.root.findDescendantById("resource-line-0")).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }

    const markdown = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({
              value: [{ path: "guide", kind: "file", executable: true }],
              diagnostics: [],
            }),
            readInstalled: async (request) => ({
              value: {
                kind: "text",
                path: request.path,
                text: "# Markdown by result",
                format: "markdown",
              },
              diagnostics: [],
            }),
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResourcesWithKeys(markdown);
      await openSelectedResource(markdown, "guide");
      await markdown.waitFor(() => !!markdown.renderer.root.findDescendantById("resource-content"));
      expect(
        (markdown.renderer.root.findDescendantById("resource-content") as ScrollBoxRenderable)
          .getChildren()
          .some((child) => child instanceof MarkdownRenderable),
      ).toBe(true);
    } finally {
      markdown.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources clears old content on failed new reads and retries through its command",
  async () => {
    const reads: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async () => ({ value: readerContent, diagnostics: [] }),
            listInstalledResources: async () => ({ value: readerResources, diagnostics: [] }),
            readInstalled: async (request) => {
              reads.push(request);
              if (request.path === "docs/guide.md")
                return {
                  value: {
                    kind: "text" as const,
                    path: request.path,
                    text: "old resource",
                    format: "text" as const,
                  },
                  diagnostics: [],
                };
              if (reads.length === 2)
                throw new SkillCliError("RESOURCE_NOT_FOUND", "new resource moved");
              return {
                value: {
                  kind: "text" as const,
                  path: request.path,
                  text: "retried",
                  format: "text" as const,
                },
                diagnostics: [],
              };
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResourcesWithKeys(setup);
      await openSelectedResource(setup, "docs/guide.md");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await setup.waitForFrame((frame) => frame.includes("old resource"));
      await backToResources(setup);
      await openSelectedResource(setup, "bin/run");
      await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: new resource moved"));
      expect(setup.captureCharFrame()).not.toContain("old resource");
      await focusLive(setup, "resource-retry");
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("retried"));
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources retains native tab and content through physical A B A and resize",
  async () => {
    const reads: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalled: async (request) => ({
              value:
                request.address.path === "reference"
                  ? {
                      ...readerContent,
                      address: request.address,
                      name: "reference",
                      markdownText: "# Reference",
                    }
                  : readerContent,
              diagnostics: [],
            }),
            listInstalledResources: async () => ({
              value: [{ path: "guide", kind: "file" }],
              diagnostics: [],
            }),
            readInstalled: async (request) => {
              reads.push(request.address.path);
              return {
                value: {
                  kind: "text" as const,
                  path: request.path,
                  text: `# ${request.address.path} resource`,
                  format: "markdown" as const,
                },
                diagnostics: [],
              };
            },
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResourcesWithKeys(setup);
      await openSelectedResource(setup, "guide");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(selectedReaderTab(setup)).toBe(1);

      await backToResources(setup);
      expect(setup.renderer.root.findDescendantById("resource-browser")).toBeDefined();
      await awaitParsedEscape(setup);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      const skills = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      await focusLive(setup, "installed-skill-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => skills.getSelectedOption()?.value === '["team-main","reference"]');
      await setup.waitFor(() => selectedReaderTab(setup) === 0);
      await setup.waitFor(
        () =>
          (setup.renderer.root.findDescendantById("reader-identity") as TextRenderable)
            ?.plainText === "reference",
      );
      await setup.waitForFrame((frame) => frame.includes("Reference"));
      await openReaderTab(setup, 2);
      await setup.waitForFrame((frame) => /Address\s+team-main\/reference/.test(frame));
      await openResourcesWithKeys(setup);
      await openSelectedResource(setup, "guide");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(selectedReaderTab(setup)).toBe(1);
      expect(reads).toEqual(["guide", "reference"]);
      await setup.waitFor(() => reads.includes("reference"));
      await backToResources(setup);
      await awaitParsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      const guideSkills = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      await focusLive(setup, "installed-skill-browser");
      setup.mockInput.pressArrow("up");
      await setup.waitFor(
        () =>
          guideSkills.getSelectedOption()?.value ===
          skillAddressKey({ source: "team-main", path: "guide" }),
      );
      await setup.waitFor(() => selectedReaderTab(setup) === 0);
      await setup.waitFor(
        () =>
          (setup.renderer.root.findDescendantById("reader-identity") as TextRenderable)
            ?.plainText === "guide",
      );
      await openResourcesWithKeys(setup);
      await openSelectedResource(setup, "guide");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(selectedReaderTab(setup)).toBe(1);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(reads).toEqual(["guide", "reference"]);
      expect(selectedReaderTab(setup)).toBe(1);

      setup.resize(79, 24);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-views"));
      setup.resize(120, 40);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await setup.renderOnce();
      await setup.waitFor(() => selectedReaderTab(setup) === 1);
      await focusLive(setup, "resource-content");
      expect(selectedReaderTab(setup)).toBe(1);
      expect(
        (setup.renderer.root.findDescendantById("resource-content") as ScrollBoxRenderable)
          .getChildren()
          .some((child) => child instanceof MarkdownRenderable),
      ).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  },
);
