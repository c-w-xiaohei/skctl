import { afterEach, expect, test } from "bun:test";
import {
  CodeRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type BaseRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerContent, readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  enterLive,
  openAllInstalledSkills,
  openInstallation,
  parsedEnter,
  parsedEscape,
  selectedReaderTab,
  waitForReaderBody,
} from "./reader-test-controls";
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});
const description =
  "Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. ".repeat(
    5,
  );
const descendants = (node: BaseRenderable): BaseRenderable[] => [
  node,
  ...node.getChildren().flatMap(descendants),
];
const node = (id: string) => setup!.renderer.root.findDescendantById(id)!;
async function mount(width = 144, height = 40) {
  const projection = readerProjection();
  const source = projection.installedSkills[0]!;
  setup = await testRender(
    () => (
      <App
        core={directSourceCore(
          {
            ...projection,
            installedSkills: [{ ...source, description }, ...projection.installedSkills.slice(1)],
          },
          { loadInstalledSkill: async () => readerContent },
        )}
        exit={() => {}}
      />
    ),
    { width, height },
  );
  await openAllInstalledSkills(setup);
  await parsedEnter(setup);
  await waitForReaderBody(setup, "needle in prose");
}
async function capture(name: string) {
  const directory = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!directory) return;
  for (const child of descendants(setup!.renderer.root))
    if (child instanceof CodeRenderable) await child.highlightingDone;
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
])("Installation facts and More actions remain readable at %ix%i", async (width, height) => {
  await mount(width, height);
  await openInstallation(setup!);
  await setup!.flush();
  const fields = node("reader-details-summary");
  const texts = descendants(fields).filter(
    (child): child is TextRenderable => child instanceof TextRenderable,
  );
  expect(texts.map((child) => child.plainText)).toContain("Source: team-main");
  expect(texts.map((child) => child.plainText)).toContain("Path: guide");
  expect((node("reader-details") as ScrollBoxRenderable).viewport.height).toBeGreaterThanOrEqual(6);
  await capture(`details-${width}x${height}`);
  await enterLive(setup!, "reader-more");
  for (const id of [
    "reader-menu-skill-uninstall",
    "reader-menu-skill-rebind",
    "reader-menu-reload",
  ]) {
    const command = await focusLive(setup!, id);
    expect(command.focusable).toBe(true);
    expect(command.screenY).toBeGreaterThanOrEqual(0);
    expect(command.screenY + command.height).toBeLessThanOrEqual(height);
  }
  await capture(`manage-${width}x${height}`);
  await parsedEscape(setup!);
  await parsedEscape(setup!);
  await enterLive(setup!, "reader-description-toggle");
  await setup!.flush();
  expect((node("reader-description") as TextRenderable).plainText).toBe(description);
  await parsedEnter(setup!);
  await setup!.flush();
  expect(!!node("reader-description")).toBe(false);
});
test("pointer selects each Reader view immediately without requiring Enter", async () => {
  await mount();
  for (const [value, index] of [
    ["resources", 1],
    ["skill", 0],
  ] as const) {
    const tab = node(`reader-tabs-tab-${value}`);
    await setup!.mockMouse.click(tab.screenX + 2, tab.screenY);
    await setup!.waitFor(() => selectedReaderTab(setup!) === index);
    expect(setup!.renderer.currentFocusedRenderable === tab).toBe(true);
    expect(
      node(value === "resources" ? "reader-resources-status" : "reader-scrollbox"),
    ).toBeDefined();
  }
});
test("reselecting a view is idempotent and content arrows never jump to Update", async () => {
  await mount();
  const body = node("reader-scrollbox") as ScrollBoxRenderable;
  const tab = node("reader-tabs-tab-skill");
  for (let click = 0; click < 2; click++) {
    await setup!.mockMouse.click(tab.screenX + 2, tab.screenY);
    await setup!.flush();
    expect(setup!.renderer.currentFocusedRenderable === tab).toBe(true);
  }
  await parsedEnter(setup!);
  expect(setup!.renderer.currentFocusedRenderable === body).toBe(true);
  setup!.mockInput.pressArrow("right");
  await setup!.flush();
  expect(setup!.renderer.currentFocusedRenderable === body).toBe(true);
  setup!.mockInput.pressArrow("up");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === tab);
});
test.each([
  [144, 40],
  [43, 13],
])(
  "Content reading keeps its viewport and focus when typing slash at %ix%i",
  async (width, height) => {
    await mount(width, height);
    const tabs = node("reader-views");
    const body = node("reader-scrollbox");
    const tabY = tabs.screenY;
    const bodyY = body.screenY;
    await focusLive(setup!, "reader-scrollbox");
    setup!.mockInput.pressKey("/");
    await setup!.flush();
    expect(tabs.visible).toBe(true);
    expect(tabs.screenY).toBe(tabY);
    expect(!!node("reader-find")).toBe(false);
    expect(!!node("reader-tabs-tab-details")).toBe(false);
    expect(body.height).toBeGreaterThanOrEqual(6);
    await capture(`content-${width}x${height}`);
    expect(node("reader-scrollbox") === body).toBe(true);
    expect(body.screenY).toBe(bodyY);
    expect(setup!.renderer.currentFocusedRenderable === body).toBe(true);
  },
);
