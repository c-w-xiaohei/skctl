import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  SelectRenderable,
  MarkdownRenderable,
  CodeRenderable,
  type Renderable,
} from "@opentui/core";
import { mkdir, writeFile } from "node:fs/promises";
import { CollectionHandoffOverlay } from "../src/operations/choices";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  enterLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";

for (const width of [120, 43]) {
  test(`Main Skill and reference share Markdown layout at ${width}`, async () => {
    const markdown =
      '# Runtime\n\nOrdinary document prose.\n\n```json\n{"construct": "incremental paid-media contribution and operating quality under declared business constraints"}\n```';
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => ({ ...readerContent, markdownText: markdown }),
            listInstalledResources: async () => [{ path: "runtime.md", kind: "file" }],
            readInstalledResource: async () => ({
              kind: "text",
              path: "runtime.md",
              format: "markdown",
              text: markdown,
            }),
          })}
          exit={() => {}}
        />
      ),
      { width, height: 40 },
    );
    const descendants = (node: Renderable): Renderable[] =>
      node.getChildren().flatMap((child) => [child, ...descendants(child)]);
    const capture = (id: string) => {
      const node = descendants(setup.renderer.root.findDescendantById(id)!).find(
        (node) => node instanceof MarkdownRenderable,
      )!;
      const codes = descendants(node).filter(
        (node): node is CodeRenderable => node instanceof CodeRenderable,
      );
      expect(codes.every((code) => code.wrapMode === "word")).toBe(true);
      return setup
        .captureCharFrame()
        .split("\n")
        .slice(node.screenY, node.screenY + node.height)
        .map((line) => line.slice(node.screenX, node.screenX + node.width).trimEnd());
    };
    try {
      await openAllInstalledSkills(setup);
      await enterLive(setup, "installed-skill-browser");
      await waitForReaderBody(setup, "Ordinary document prose");
      const main = capture("reader-scrollbox");
      await openReaderTab(setup, 1);
      await enterLive(setup, "resource-browser");
      await waitForReaderBody(setup, "Ordinary document prose");
      expect(capture("resource-content")).toEqual(main);
      await mkdir("out/reader-clarity", { recursive: true });
      await writeFile(`out/reader-clarity/shared-markdown-${width}.txt`, setup.captureCharFrame());
    } finally {
      setup.renderer.destroy();
    }
  });
  test(`Empty Collection picker explains the next action at ${width}`, async () => {
    let creates = 0;
    let cancels = 0;
    const setup = await testRender(
      () => (
        <CollectionHandoffOverlay
          choices={[]}
          onSelect={() => {}}
          onCreate={() => {
            creates++;
          }}
          onClose={() => {
            cancels++;
          }}
        />
      ),
      { width, height: 13 },
    );
    try {
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("No available Collection");
      expect(setup.renderer.root.findDescendantById("collection-handoff-choice")).toBeUndefined();
      await enterLive(setup, "collection-handoff-create");
      expect(creates).toBe(1);
      await enterLive(setup, "collection-handoff-cancel");
      expect(cancels).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });
  test(`Collection picker renders candidates and exact selection at ${width}`, async () => {
    const choices = [
      { collection: "engineering", level: "project" as const },
      { collection: "engineering", level: "global" as const },
    ];
    const selected: unknown[] = [];
    const setup = await testRender(
      () => (
        <CollectionHandoffOverlay
          choices={choices}
          onSelect={(choice) => selected.push(choice)}
          onCreate={() => {}}
          onClose={() => {}}
        />
      ),
      { width, height: width === 43 ? 13 : 32 },
    );
    try {
      await setup.flush();
      const list = setup.renderer.root.findDescendantById(
        "collection-handoff-choice",
      ) as SelectRenderable;
      expect(list.height).toBeGreaterThan(0);
      expect(setup.captureCharFrame()).toContain("engineering");
      expect(setup.captureCharFrame()).toContain("Cancel");
      list.selectedIndex = 1;
      await enterLive(setup, "collection-handoff-choice");
      expect(selected).toEqual([choices[1]]);
      await mkdir("out/reader-clarity", { recursive: true });
      await writeFile(`out/reader-clarity/collections-${width}.txt`, setup.captureCharFrame());
    } finally {
      setup.renderer.destroy();
    }
  });

  test(`Resource file owns the reading viewport and returns to its selection at ${width}`, async () => {
    const reads: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(readerProjection(), {
            loadInstalledSkill: async () => readerContent,
            listInstalledResources: async () => [
              { path: "references", kind: "directory" },
              { path: "references/runtime.md", kind: "file" },
              { path: "scripts/check.ts", kind: "file" },
            ],
            readInstalledResource: async (_env, request) => {
              reads.push(request.path);
              return {
                kind: "text",
                path: request.path,
                format: "markdown",
                text: '<!-- GENERATED FILE: internal note -->\n\n# Runtime\n\nResource instructions\n\n## Snapshot\n\n```json\n{"comment": "<!-- keep this example -->"}\n```',
              };
            },
          })}
          exit={() => {}}
        />
      ),
      { width, height: width === 43 ? 13 : 32 },
    );
    try {
      await openAllInstalledSkills(setup);
      await enterLive(setup, "installed-skill-browser");
      await openReaderTab(setup, 1);
      await enterLive(setup, "resource-browser");
      await setup.flush();
      expect(reads).toEqual([]);
      const directory = setup.renderer.root.findDescendantById(
        "resource-browser",
      ) as SelectRenderable;
      expect(directory.options.map((option) => option.value)).toEqual(["references/runtime.md"]);
      await enterLive(setup, "resource-browser");
      await waitForReaderBody(setup, "Resource instructions");
      expect(reads).toEqual(["references/runtime.md"]);
      expect(setup.captureCharFrame()).not.toContain("GENERATED FILE");
      expect(setup.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
      await mkdir("out/reader-clarity", { recursive: true });
      await writeFile(`out/reader-clarity/resource-${width}.txt`, setup.captureCharFrame());
      setup.mockInput.pressKey("END");
      await setup.flush();
      await waitForReaderBody(setup, "keep this example");
      await parsedEscape(setup);
      await setup.flush();
      const list = setup.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
      expect(list.getSelectedOption()?.value).toBe("references/runtime.md");
      expect(setup.renderer.currentFocusedRenderable).toBe(list);
      await parsedEscape(setup);
      await setup.flush();
      const root = setup.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
      expect(root.getSelectedOption()?.value).toBe("references");
    } finally {
      setup.renderer.destroy();
    }
  });
}
