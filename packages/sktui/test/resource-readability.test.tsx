import { afterEach, expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
  waitForReaderBody,
} from "./reader-test-controls";
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});
const path = "references/topics/05-ai-products.md";
const unicodePath = "references/用户研究/界面布局/终端阅读体验/操作指南.md";
const resources = [
  { path: "README.md", kind: "file" as const, size: 2174, executable: false },
  { path: "references", kind: "directory" as const },
  { path, kind: "file" as const, size: 14175, executable: false },
  { path: "bin/check", kind: "file" as const, size: 1893, executable: true },
  ...Array.from({ length: 45 }, (_, index) => ({
    path: `references/research/topic-${index}/README.md`,
    kind: "file" as const,
    size: 1058,
    executable: false,
  })),
  { path: unicodePath, kind: "file" as const, size: 1058, executable: false },
];
async function mount(width: number, height: number) {
  const reads: string[] = [];
  const acquisitions: string[] = [];
  setup = await testRender(
    () => (
      <App
        core={directSourceCore(readerProjection(), {
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => ({
            address,
            name: address.path,
            description: "Guide",
            rawText: "# Guide",
            markdownText: "# Guide",
          }),
          listInstalledResources: async () => resources,
          readInstalledResource: async (
            _environment: import("@skctl/core").CoreOptions,
            request,
          ) => {
            reads.push(request.path);
            return {
              kind: "text",
              path: request.path,
              text: `# Resource heading\n\n${"Resource prose.\n\n".repeat(30)}`,
              format: "markdown",
            };
          },
          updateSkills: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
            acquisitions.push(source);
            throw new Error("Resource browsing must not update Skills");
          },
          discoverSkills: async (_environment: import("@skctl/core").CoreOptions, { source }) => {
            acquisitions.push(source);
            throw new Error("Resource browsing must not acquire content");
          },
        })}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await openAllInstalledSkills(setup);
  await parsedEnter(setup);
  await openReaderTab(setup, 1);
  await setup.waitFor(() => !!setup!.renderer.root.findDescendantById("resource-browser"));
  await setup.flush();
  await focusLive(setup, "resource-browser");
  return { reads, acquisitions };
}
async function capture(name: string) {
  const directory = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!directory) return;
  await setup!.flush();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup!.captureCharFrame());
  await writeFile(join(directory, `${name}.json`), JSON.stringify(setup!.captureSpans(), null, 2));
}
test.each([
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])("Resources prioritizes paths and the opened document at %ix%i", async (width, height) => {
  const { reads, acquisitions } = await mount(width, height);
  const browser = setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
  expect(browser.options.map((option) => option.value)).toEqual(
    resources.map((resource) => resource.path),
  );
  expect(browser.options[0]!.name.trim()).toBe("README.md");
  expect(browser.options[1]!.name.trim()).toBe("references/");
  expect(new Set(browser.options.map((option) => option.name.trim())).size).toBe(resources.length);
  expect(setup!.captureCharFrame()).not.toContain("not executable");
  expect(setup!.captureCharFrame()).not.toContain(" bytes");
  const summary = setup!.renderer.root.findDescendantById(
    "reader-resources-summary",
  ) as TextRenderable;
  expect(summary.plainText).toBe(`${resources.length} resources`);
  expect(
    (setup!.renderer.root.findDescendantById("reader-resource-info") as TextRenderable).plainText,
  ).toBe("2.1 KiB");
  expect(summary.plainText).not.toContain("Enter");
  await capture(`resources-list-${width}x${height}`);
  for (let index = 1; index <= 2; index++) {
    setup!.mockInput.pressArrow("down");
    await setup!.waitFor(() => browser.getSelectedIndex() === index);
  }
  expect(browser.getSelectedOption()?.value).toBe(path);
  await parsedEnter(setup!);
  await waitForReaderBody(setup!, "Resource heading");
  expect(reads).toEqual([path]);
  const body = setup!.renderer.root.findDescendantById("resource-content") as ScrollBoxRenderable;
  const back = setup!.renderer.root.findDescendantById("route-back")!;
  expect(setup!.renderer.root.findDescendantById("reader-resource-path")).toBeUndefined();
  expect(back.screenY).toBeLessThan(body.screenY);
  expect(body.viewport.height).toBeGreaterThanOrEqual(6);
  await focusLive(setup!, "resource-content");
  setup!.mockInput.pressArrow("down");
  await setup!.flush();
  await setup!.waitForFrame((frame) => frame.includes("Resource prose."));
  expect(setup!.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
  await capture(`resources-reading-${width}x${height}`);
  await parsedEscape(setup!);
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "resource-browser");
  await setup!.flush();
  expect(
    (
      setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable
    ).getSelectedOption()?.value,
  ).toBe(path);
  expect(reads).toEqual([path]);
  expect(acquisitions).toEqual([]);
});
test("compact return restores a deeply scrolled resource, and a positive executable flag is contextual only", async () => {
  const { reads, acquisitions } = await mount(43, 13);
  const browser = setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
  browser.setSelectedIndex(3);
  await setup!.flush();
  expect(
    (setup!.renderer.root.findDescendantById("reader-resource-info") as TextRenderable).plainText,
  ).toContain("Executable");
  browser.setSelectedIndex(40);
  await setup!.flush();
  const selected = browser.getSelectedOption()!.value as string;
  expect(browser.getSelectedOption()!.name).toContain("README.md");
  await parsedEnter(setup!);
  await waitForReaderBody(setup!, "Resource heading");
  await parsedEscape(setup!);
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "resource-browser");
  await setup!.flush();
  const returned = setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
  expect(returned.getSelectedOption()?.value).toBe(selected);
  expect(returned.getSelectedIndex()).toBe(40);
  expect(setup!.captureCharFrame()).toContain("topic-36/README.md");
  returned.setSelectedIndex(resources.length - 1);
  await setup!.flush();
  const unicodeLabel = returned.getSelectedOption()!.name.trimEnd();
  expect(unicodeLabel.endsWith("/操作指南.md")).toBe(true);
  expect(Bun.stringWidth(unicodeLabel)).toBeLessThanOrEqual(returned.width - 5);
  await parsedEnter(setup!);
  await waitForReaderBody(setup!, "Resource heading");
  expect(reads.at(-1)).toBe(unicodePath);
  await parsedEscape(setup!);
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "resource-browser");
  expect(
    (
      setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable
    ).getSelectedOption()?.value,
  ).toBe(unicodePath);
  expect(reads).toEqual([selected, unicodePath]);
  expect(acquisitions).toEqual([]);
});
test("wide reading keeps the opened path and restores list selection on return", async () => {
  const { reads } = await mount(144, 40);
  const browser = setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
  browser.setSelectedIndex(2);
  await parsedEnter(setup!);
  await waitForReaderBody(setup!, "Resource prose.");
  expect(setup!.renderer.root.findDescendantById("resource-browser")).toBeUndefined();
  await setup!.flush();
  expect(reads).toEqual([path]);
  await parsedEscape(setup!);
  await setup!.flush();
  const returned = setup!.renderer.root.findDescendantById("resource-browser") as SelectRenderable;
  expect(returned.getSelectedOption()?.value).toBe(path);
});
