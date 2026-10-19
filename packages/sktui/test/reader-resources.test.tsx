import { expect, test } from "bun:test";
import { SelectRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { SkctlError } from "@skctl/core";
import { directSourceCore } from "./direct-source.fixture";
import {
  readerAddress,
  readerContent,
  readerProjection,
  readerResources,
} from "./installed-reader.fixture";
import {
  focusLive,
  enterInstalledAddress,
  enterLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";
type Setup = Awaited<ReturnType<typeof testRender>>;
async function resourceBrowser(setup: Setup) {
  await setup.waitFor(() => {
    const browser = setup.renderer.root.findDescendantById("resource-browser");
    return browser instanceof SelectRenderable && browser.height > 0;
  });
  const browser = live(setup, "resource-browser");
  if (!(browser instanceof SelectRenderable)) throw new Error("Expected native resource list");
  return browser;
}
async function chooseResource(setup: Setup, path: string) {
  const browser = await resourceBrowser(setup);
  await focusLive(setup, "resource-browser");
  const paths = browser.options.map((option) => option.value);
  const target = paths.indexOf(path);
  expect(paths[target]).toBe(path);
  const start = browser.getSelectedIndex();
  expect(start >= 0 && start < paths.length, "Resource selection index is in range").toBe(true);
  const direction = target >= start ? 1 : -1;
  for (let step = 0; step < Math.abs(target - start); step++) {
    const current = await resourceBrowser(setup);
    const index = start + step * direction;
    const nextIndex = index + direction;
    expect([
      current.getSelectedIndex(),
      current.getSelectedOption()?.value,
      setup.renderer.currentFocusedRenderable === current,
    ]).toEqual([index, paths[index], true]);
    const expectedPath = paths[nextIndex]!;
    setup.mockInput.pressKey(direction > 0 ? "ARROW_DOWN" : "ARROW_UP");
    await setup.waitFor(() => {
      const next = setup.renderer.root.findDescendantById("resource-browser");
      return (
        next instanceof SelectRenderable &&
        !next.isDestroyed &&
        !!next.parent &&
        setup.renderer.currentFocusedRenderable === next &&
        next.getSelectedIndex() === nextIndex &&
        next.getSelectedOption()?.value === expectedPath
      );
    });
  }
  expect(
    (await resourceBrowser(setup)).getSelectedOption()?.value,
    `Selected resource is ${path}`,
  ).toBe(path);
}
async function openSelectedResource(setup: Setup, path: string) {
  await chooseResource(setup, path);
  await parsedEnter(setup);
}
async function openResources(setup: Setup) {
  await openAllInstalledSkills(setup);
  await enterInstalledAddress(setup, readerAddress);
  if (selectedReaderTab(setup) !== 1) await openReaderTab(setup, 1);
  expect(selectedReaderTab(setup)).toBe(1);
}
test.serial(
  "RENDER Resources lists paths with selected structural information, pending and empty states",
  async () => {
    let resolveList: ((value: typeof readerResources) => void) | undefined;
    const calls: unknown[] = [];
    let listSignal: AbortSignal | undefined;
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: (
              _environment: import("@skctl/core").CoreOptions,
              request,
              options,
            ) => {
              calls.push(request);
              listSignal = options?.signal;
              if (calls.length > 1)
                throw new Error("Pending Resources entry started a second list request");
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
      expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
      await enterLive(setup, "reader-tabs-tab-resources");
      expect(calls).toEqual([{ address: readerAddress }]);
      expect(listSignal?.aborted).toBe(false);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-resources-status");
      resolveList!(readerResources);
      await setup.waitForFrame((frame) => frame.includes("docs/") && frame.includes("bin/run"));
      const browser = await resourceBrowser(setup);
      expect(calls).toEqual([{ address: readerAddress }]);
      expect(browser.height).toBeGreaterThan(8);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable === browser);
      expect(browser.screenY).toBeGreaterThanOrEqual(0);
      expect(browser.screenY + browser.height).toBeLessThanOrEqual(setup.renderer.height - 1);
      expect(browser.getSelectedOption()?.value).toBe("docs");
      expect(browser.options.map((option) => option.value)).toEqual(
        readerResources.map((resource) => resource.path),
      );
      const info = () => {
        const target = live(setup, "reader-resource-info");
        if (!(target instanceof TextRenderable)) throw new Error("Expected resource metadata text");
        return target.plainText;
      };
      expect(info()).toBe("Directory");
      await chooseResource(setup, "bin/run");
      await setup.waitFor(() => info() === "Executable · 4 B");
      expect(info()).toBe("Executable · 4 B");
      await chooseResource(setup, "submodule");
      await setup.waitFor(() => info() === "Gitlink");
      expect(info()).toBe("Gitlink");
      await setup.waitForFrame((frame) => frame.includes("Gitlink"));
      expect(setup.captureCharFrame()).toContain("submodule");
      expect(setup.captureCharFrame()).not.toContain("deadbeef");
    } finally {
      setup.renderer.destroy();
    }
    const empty = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async () => [],
          })}
          exit={() => {}}
        />
      ),
      { width: 120, height: 40 },
    );
    try {
      await openResources(empty);
      await empty.waitForFrame((frame) => frame.includes("No supporting resources"));
      expect(empty.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
    } finally {
      empty.renderer.destroy();
    }
  },
);
test.serial(
  "RENDER Resources renders Core-returned Markdown, text, and binary results at exact paths",
  async () => {
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async () => [
              ...readerResources,
              { path: "guide", kind: "file" },
            ],
            readInstalledResource: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              calls.push(request);
              if (request.path === "docs/guide.md" || request.path === "guide")
                return {
                  kind: "text",
                  path: request.path,
                  text: "# Resource heading",
                  format: "markdown",
                };
              if (request.path === "bin/run")
                return {
                  kind: "text",
                  path: request.path,
                  text: "#!/bin/sh\necho hi",
                  format: "text",
                };
              return {
                kind: "not-text",
                path: request.path,
                reason: "binary",
                metadata: { path: request.path, kind: "file", size: 8 },
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
      await openSelectedResource(setup, "docs/guide.md");
      await setup.waitFor(() => calls.length === 1);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await focusLive(setup, "resource-content");
      expect(calls).toEqual([{ address: readerAddress, path: "docs/guide.md" }]);
      await waitForReaderBody(setup, "Resource heading");
      expect(setup.captureCharFrame()).not.toContain("# Resource heading");
      setup.mockInput.pressArrow("left");
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("resource-content"));
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("resource-browser");
      await openSelectedResource(setup, "bin/run");
      await setup.waitFor(() => calls.length === 2);
      await setup.waitForFrame((frame) => frame.includes("#!/bin/sh") && frame.includes("echo hi"));
      await focusLive(setup, "resource-content");
      await parsedEscape(setup);
      await openSelectedResource(setup, "blob.bin");
      await setup.waitFor(() => calls.length === 3);
      await setup.waitForFrame((frame) => frame.includes("Cannot preview binary resource"));
      expect(setup.captureCharFrame()).toContain("blob.bin  file 8 bytes");
      await focusLive(setup, "resource-content");
      await parsedEscape(setup);
      await openSelectedResource(setup, "guide");
      await waitForReaderBody(setup, "Resource heading");
      expect(setup.captureCharFrame()).not.toContain("# Resource heading");
      expect(calls).toEqual(
        ["docs/guide.md", "bin/run", "blob.bin", "guide"].map((path) => ({
          address: readerAddress,
          path,
        })),
      );
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
      | ((value: { kind: "text"; path: string; text: string; format: "text" }) => void)
      | undefined;
    const calls: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async () => readerResources,
            readInstalledResource: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              calls.push(request);
              attempts++;
              if (attempts === 1) throw new SkctlError("RESOURCE_NOT_FOUND", "resource moved");
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
      await setup.waitForFrame((frame) => frame.includes("Loading resource content"));
      resolveRetry!({ kind: "text", path: "docs/guide.md", text: "recovered", format: "text" });
      await setup.waitForFrame((frame) => frame.includes("recovered"));
      expect(calls).toEqual([
        { address: readerAddress, path: "docs/guide.md" },
        { address: readerAddress, path: "docs/guide.md" },
      ]);
      setup.resize(79, 24);
      await setup.flush();
      expect(!!setup.renderer.root.findDescendantById("resource-browser")).toBe(false);
      expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
      await focusLive(setup, "resource-content");
      await parsedEscape(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-browser"));
      expect((await resourceBrowser(setup)).getSelectedOption()?.value).toBe("docs/guide.md");
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
    const reads: unknown[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              calls.push(request);
              attempts++;
              if (attempts === 1) throw new SkctlError("RESOURCE_NOT_FOUND", "list moved");
              return readerResources;
            },
            readInstalledResource: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              reads.push(request);
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
      await focusLive(setup, "resource-retry");
      await parsedEnter(setup);
      await setup.waitFor(() => calls.length === 2);
      await setup.waitForFrame((frame) => frame.includes("docs/guide.md"));
      expect(calls).toEqual([{ address: readerAddress }, { address: readerAddress }]);
      expect(reads).toEqual([]);
    } finally {
      setup.renderer.destroy();
    }
  },
);
test.serial(
  "RENDER Resources delegates non-files to Core and presents unsupported results without file content",
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
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async () => resources,
            readInstalledResource: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              reads.push(request);
              const descriptor = resources.find((resource) => resource.path === request.path)!;
              if (descriptor.kind !== "file")
                return {
                  kind: "not-text" as const,
                  path: request.path,
                  reason: "unsupported" as const,
                  metadata: descriptor,
                };
              return {
                kind: "text" as const,
                path: request.path,
                text: "plain text",
                format: "text" as const,
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
      await setup.waitForFrame((frame) => frame.includes("plain.md"));
      expect(setup.captureCharFrame()).not.toContain("not executable");
      expect(setup.captureCharFrame()).not.toContain("deadbeef");
      for (const path of ["docs", "link", "submodule"]) {
        await chooseResource(setup, path);
        await parsedEnter(setup);
        await setup.waitForFrame((frame) => frame.includes("Cannot preview unsupported resource"));
        expect(setup.renderer.root.findDescendantById("resource-line-0")).toBeDefined();
        await focusLive(setup, "resource-content");
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
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async () => readerResources,
            readInstalledResource: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              reads.push(request);
              if (request.path === "docs/guide.md")
                return {
                  kind: "text" as const,
                  path: request.path,
                  text: "old resource",
                  format: "text" as const,
                };
              if (reads.length === 2)
                throw new SkctlError("RESOURCE_NOT_FOUND", "new resource moved");
              return {
                kind: "text" as const,
                path: request.path,
                text: "retried",
                format: "text" as const,
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
      await openSelectedResource(setup, "docs/guide.md");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      await setup.waitForFrame((frame) => frame.includes("old resource"));
      await enterLive(setup, "route-back");
      await setup.waitFor(() => !setup.renderer.root.findDescendantById("resource-content"));
      expect((await resourceBrowser(setup)).getSelectedOption()?.value).toBe("docs/guide.md");
      expect(selectedReaderTab(setup)).toBe(1);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("resource-browser");
      await openSelectedResource(setup, "bin/run");
      await setup.waitForFrame((frame) => frame.includes("RESOURCE_NOT_FOUND: new resource moved"));
      expect(setup.captureCharFrame()).not.toContain("old resource");
      await focusLive(setup, "resource-retry");
      await parsedEnter(setup);
      await setup.waitForFrame((frame) => frame.includes("retried"));
      expect(reads).toEqual(
        ["docs/guide.md", "bin/run", "bin/run"].map((path) => ({ address: readerAddress, path })),
      );
    } finally {
      setup.renderer.destroy();
    }
  },
);
test.serial(
  "RENDER Resources retains native tab and content through physical A B A and resize",
  async () => {
    const reads: unknown[] = [];
    const lists: unknown[] = [];
    const expectedReads = [
      { address: readerAddress, path: "guide" },
      { address: { source: "team-main", path: "reference" }, path: "guide" },
    ];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, request) =>
              request.address.path === "reference"
                ? {
                    ...readerContent,
                    address: request.address,
                    name: "reference",
                    markdownText: "# Reference",
                  }
                : readerContent,
            listInstalledResources: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              lists.push(request);
              return [{ path: "guide", kind: "file" }];
            },
            readInstalledResource: async (
              _environment: import("@skctl/core").CoreOptions,
              request,
            ) => {
              reads.push(request);
              return {
                kind: "text" as const,
                path: request.path,
                text: `# ${request.address.path} resource`,
                format: "markdown" as const,
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
      await openSelectedResource(setup, "guide");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(selectedReaderTab(setup)).toBe(1);
      await enterLive(setup, "route-back");
      expect(setup.renderer.root.findDescendantById("resource-browser")).toBeDefined();
      await parsedEscape(setup);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
      expect(setup.renderer.root.findDescendantById("reader-views")).toBeDefined();
      await enterInstalledAddress(setup, { source: "team-main", path: "reference" });
      await setup.waitFor(() => selectedReaderTab(setup) === 0);
      await setup.waitFor(() => {
        const identity = live(setup, "reader-identity");
        return identity instanceof TextRenderable && identity.plainText === "reference";
      });
      await waitForReaderBody(setup, "Reference");
      await openReaderTab(setup, 2);
      await setup.waitForFrame((frame) => /Address\s+team-main\/reference/.test(frame));
      await openReaderTab(setup, 1);
      await openSelectedResource(setup, "guide");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(selectedReaderTab(setup)).toBe(1);
      await waitForReaderBody(setup, "reference resource");
      expect(reads).toEqual(expectedReads);
      await enterLive(setup, "route-back");
      await parsedEscape(setup);
      await enterInstalledAddress(setup, readerAddress);
      await setup.waitFor(() => selectedReaderTab(setup) === 0);
      await setup.waitFor(() => {
        const identity = live(setup, "reader-identity");
        return identity instanceof TextRenderable && identity.plainText === "guide";
      });
      await openReaderTab(setup, 1);
      expect((await resourceBrowser(setup)).getSelectedOption()?.value).toBe("guide");
      await openSelectedResource(setup, "guide");
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("resource-content"));
      expect(selectedReaderTab(setup)).toBe(1);
      await waitForReaderBody(setup, "guide resource");
      expect(reads).toEqual(expectedReads);
      expect(lists).toEqual(
        [readerAddress, { source: "team-main", path: "reference" }].map((address) => ({ address })),
      );
      await focusLive(setup, "resource-content");
      setup.resize(79, 24);
      await setup.flush();
      expect(selectedReaderTab(setup)).toBe(1);
      setup.resize(120, 40);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "resource-content");
      expect(selectedReaderTab(setup)).toBe(1);
      await setup.waitForFrame((frame) => frame.includes("guide resource"));
      expect(reads).toEqual(expectedReads);
    } finally {
      setup.renderer.destroy();
    }
  },
);
