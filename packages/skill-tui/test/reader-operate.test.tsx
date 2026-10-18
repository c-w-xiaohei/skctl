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
  openAllInstalledSkills,
  openReaderTab,
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
])("Details is structured, bounded and discloses management at %ix%i", async (width, height) => {
  await mount(width, height);
  await openReaderTab(setup!, 2);
  await setup!.flush();
  const fields = node("reader-details-summary");
  const texts = descendants(fields).filter(
    (child): child is TextRenderable => child instanceof TextRenderable,
  );
  const address = texts.find((child) => child.plainText === "Address")!;
  const value = texts.find((child) => child.plainText === "team-main/guide")!;
  expect(address.screenY).toBe(value.screenY);
  expect(value.screenX).toBeGreaterThan(address.screenX);
  const prose = node("reader-description") as TextRenderable;
  expect(prose.height).toBeLessThanOrEqual(3);
  expect(prose.plainText).toBe(description);
  expect(node("reader-description-toggle")).toBeDefined();
  expect(node("reader-details-manage")).toBeDefined();
  expect(node("reader-details-action-skill-uninstall")).toBeUndefined();
  expect(node("reader-details-action-skill-rebind")).toBeUndefined();
  expect(node("reader-reload")).toBeUndefined();
  await capture(`details-${width}x${height}`);
  await focusLive(setup!, "reader-description-toggle");
  await parsedEnter(setup!);
  await setup!.flush();
  expect((node("reader-description") as TextRenderable).height).toBeGreaterThan(3);
  await parsedEnter(setup!);
  await focusLive(setup!, "reader-details-manage");
  await parsedEnter(setup!);
  await setup!.flush();
  expect(node("reader-details-action-skill-uninstall")).toBeDefined();
  expect(node("reader-reload")).toBeDefined();
  setup!.mockInput.pressArrow("down");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "reader-reload");
  await capture(`manage-${width}x${height}`);
});
test("pointer selects each Reader view immediately without requiring Enter", async () => {
  await mount();
  for (const [value, index] of [
    ["details", 2],
    ["resources", 1],
    ["skill", 0],
  ] as const) {
    const tab = node(`reader-tabs-tab-${value}`);
    await setup!.mockMouse.click(tab.screenX + 2, tab.screenY);
    await setup!.waitFor(() => selectedReaderTab(setup!) === index);
    expect(setup!.renderer.currentFocusedRenderable === tab).toBe(true);
    expect(
      node(
        value === "details"
          ? "reader-details"
          : value === "resources"
            ? "reader-resources-status"
            : "reader-scrollbox",
      ),
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
])("Find has a temporary row without displacing the tabs at %ix%i", async (width, height) => {
  await mount(width, height);
  const tabs = node("reader-views");
  const body = node("reader-scrollbox");
  const tabY = tabs.screenY;
  const bodyY = body.screenY;
  setup!.mockInput.pressKey("/");
  await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "reader-find");
  await setup!.mockInput.pressKeys(["n", "e", "e", "d", "l", "e"]);
  await setup!.flush();
  expect(tabs.visible).toBe(true);
  expect(tabs.screenY).toBe(tabY);
  expect(node("reader-tabs-tab-details").visible).toBe(true);
  expect(body.screenY).toBe(bodyY + 1);
  expect(body.height).toBeGreaterThanOrEqual(2);
  await capture(`find-${width}x${height}`);
  await parsedEscape(setup!);
  await setup!.flush();
  expect(node("reader-scrollbox") === body).toBe(true);
  expect(body.screenY).toBe(bodyY);
  expect(setup!.renderer.currentFocusedRenderable === body).toBe(true);
});
