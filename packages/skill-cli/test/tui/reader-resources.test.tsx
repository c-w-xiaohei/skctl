import { expect, test } from "bun:test";
import {
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  TabSelectRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../../src/tui/app";
import { SkillCliError } from "../../src/core/api";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerAddress,
  readerContent,
  readerProjection,
  readerResources,
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
  await Promise.resolve();
  await setup.renderOnce();
}

async function openResources(setup: Awaited<ReturnType<typeof testRender>>) {
  await setup.renderOnce();
  await Promise.resolve();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
  setup.mockInput.pressKey("TAB", { shift: true });
  await setup.renderOnce();
  await setup.waitFor(
    () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
  );
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-tabs");
  setup.mockInput.pressKey("ARROW_RIGHT");
  setup.mockInput.pressKey("TAB");
  await setup.renderOnce();
  await setup.waitFor(
    () =>
      (
        setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
      ).getSelectedIndex() === 1,
  );
  await setup.renderOnce();
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
}

async function openResourcesWithKeys(setup: Awaited<ReturnType<typeof testRender>>) {
  await openResources(setup);
}

test.serial(
  "RENDER Resources lists exact structural descriptors with mounted pending and empty states",
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
      await openResources(setup);
      expect(calls).toEqual([{ address: readerAddress }]);
      await setup.waitForFrame((frame) => frame.includes("Loading resources"));
      resolveList!({ value: readerResources, diagnostics: [] });
      await setup.waitForFrame(
        (frame) =>
          frame.includes("docs  directory") &&
          frame.includes("bin/run  file 4 bytes executable") &&
          frame.includes("submodule  gitlink deadbeef"),
      );
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
      await openResources(empty);
      await empty.waitForFrame((frame) => frame.includes("No supporting resources"));
    } finally {
      empty.renderer.destroy();
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
      await setup.waitForFrame((frame) => frame.includes("docs/guide.md  file 12 bytes"));
      const browser = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      await setup.mockMouse.click(browser.screenX + 1, browser.screenY + 1);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(
        () =>
          (
            setup.renderer.root.findDescendantById("resource-browser") as SelectRenderable
          )?.getSelectedIndex() === 1,
      );
      setup.mockInput.pressEnter();
      await setup.waitFor(() => calls.length === 1);
      expect(calls).toEqual([{ address: readerAddress, path: "docs/guide.md" }]);
      expect(
        (setup.renderer.root.findDescendantById("resource-content") as ScrollBoxRenderable)
          .getChildren()
          .some((child) => child instanceof MarkdownRenderable),
      ).toBe(true);

      await awaitParsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === 2);
      setup.mockInput.pressEnter();
      await setup.waitFor(() => calls.length === 2);
      expect(setup.renderer.root.findDescendantById("resource-line-0")).toBeDefined();

      await awaitParsedEscape(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === 3);
      setup.mockInput.pressEnter();
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
      const browser = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === 1);
      setup.mockInput.pressEnter();
      await setup.flush();
      await setup.waitFor(() => calls.length === 1);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-retry"));
      await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: resource moved"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
      setup.mockInput.pressKey("TAB");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-retry");
      setup.mockInput.pressEnter();
      await setup.waitFor(() => calls.length === 2);
      await setup.waitForFrame((frame) => frame.includes("Loading resource content"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
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
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
      expect(calls).toEqual([
        { address: readerAddress, path: "docs/guide.md" },
        { address: readerAddress, path: "docs/guide.md" },
      ]);
      setup.resize(79, 24);
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("reader-tabs"));
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
      setup.mockInput.pressEnter();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
      await awaitParsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      expect(setup.renderer.root.findDescendantById("reader-tabs")).toBeDefined();
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
      await openResources(setup);
      await setup.flush();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-retry"));
      await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: list moved"));
      const retry = setup.renderer.root.findDescendantById("resource-retry") as SelectRenderable;
      await setup.mockMouse.click(retry.screenX, retry.screenY);
      setup.mockInput.pressEnter();
      await setup.waitFor(() => calls.length === 2);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      await setup.waitForFrame((frame) => frame.includes("docs/guide.md  file 12 bytes"));
      expect(calls).toEqual([{ address: readerAddress }, { address: readerAddress }]);
    } finally {
      setup.renderer.destroy();
    }
  },
);

test.serial(
  "RENDER Resources uses returned formats, keeps false executable metadata, and keyboard entry gates non-files",
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
      await setup.waitForFrame((frame) => frame.includes("plain.md  file not executable"));
      const browser = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      await setup.waitFor(() => browser.getSelectedOption()?.value === "docs");
      await setup.mockMouse.click(browser.screenX + 1, browser.screenY + 1);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      expect(setup.renderer.currentFocusedRenderable).toBe(browser);
      for (let index = 0; index < 3; index++) {
        setup.mockInput.pressEnter();
        await setup.renderOnce();
        expect(reads).toEqual([]);
        setup.mockInput.pressArrow("down");
        await setup.waitFor(() => browser.getSelectedIndex() === index + 1);
      }
      expect(reads).toEqual([]);
      setup.mockInput.pressEnter();
      await setup.waitForFrame((frame) => frame.includes("plain text"));
      expect(reads).toEqual([{ address: readerAddress, path: "plain.md" }]);
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
      expect(markdown.renderer.currentFocusedRenderable?.id).toBe("resource-browser");
      markdown.mockInput.pressEnter();
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
  "RENDER Resources clears old content on failed new reads and reaches Retry with Tab",
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
      setup.resize(79, 24);
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("reader-tabs"));
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      setup.mockInput.pressEnter();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      const browser = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      await setup.waitFor(() => browser.getSelectedOption()?.value === "docs");
      await setup.mockMouse.click(browser.screenX + 1, browser.screenY + 1);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedIndex() === 1);
      setup.mockInput.pressEnter();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await setup.waitForFrame((frame) => frame.includes("old resource"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
      await awaitParsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      await setup.renderOnce();
      const remounted = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      expect(setup.renderer.currentFocusedRenderable).toBe(remounted);
      setup.mockInput.pressArrow("down");
      await setup.waitFor(
        () =>
          (
            setup.renderer.root.findDescendantById("resource-browser") as SelectRenderable
          ).getSelectedIndex() === 2,
      );
      setup.mockInput.pressEnter();
      await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: new resource moved"));
      expect(setup.captureCharFrame()).not.toContain("old resource");
      setup.mockInput.pressKey("TAB", { shift: true });
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
      setup.mockInput.pressKey("TAB");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-retry");
      setup.mockInput.pressEnter();
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
      const resourceBrowser = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      await setup.waitFor(() => resourceBrowser.getSelectedOption()?.value === "guide");
      setup.mockInput.pressEnter();
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(
        (
          setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
        ).getSelectedIndex(),
      ).toBe(1);

      const browser = setup.renderer.root.findDescendantById(
        "installed-skill-browser",
      ) as SelectRenderable;
      setup.mockInput.pressKey("TAB", { shift: true });
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      setup.mockInput.pressArrow("down");
      await setup.waitFor(() => browser.getSelectedOption()?.value === "team-main/reference");
      setup.mockInput.pressEnter();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
      expect(
        (
          setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
        ).getSelectedIndex(),
      ).toBe(0);
      expect(reads).toEqual(["guide"]);
      setup.mockInput.pressKey("TAB", { shift: true });
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      setup.mockInput.pressKey("TAB");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-tabs");
      setup.mockInput.pressArrow("right");
      setup.mockInput.pressKey("TAB");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-browser");
      setup.mockInput.pressEnter();
      await setup.waitFor(() => reads.includes("reference"));
      setup.mockInput.pressKey("TAB", { shift: true });
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      setup.mockInput.pressArrow("up");
      await setup.waitFor(() => browser.getSelectedOption()?.value === "team-main/guide");
      setup.mockInput.pressEnter();
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
      expect(
        (
          setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
        ).getSelectedIndex(),
      ).toBe(1);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(reads).toEqual(["guide", "reference"]);
      expect(
        (
          setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
        ).getSelectedIndex(),
      ).toBe(1);

      setup.resize(79, 24);
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("reader-tabs"));
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      setup.resize(120, 40);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
      expect(
        (
          setup.renderer.root.findDescendantById("reader-tabs") as TabSelectRenderable
        ).getSelectedIndex(),
      ).toBe(1);
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
