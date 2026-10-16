import { afterEach, expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { App } from "../src/app";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import { createWorkspaceState } from "../src/workspace/state";
import { directOwner, directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  expectSharedReturn,
  focusLive,
  openAllInstalledSkills,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});

test("Source Installed Skills opens the Skills region and Back can restore Collection browsing", () => {
  const state = createWorkspaceState();
  state.selectSkillsView("all-installed-skills");
  state.setCollectionBrowserOpen(true);
  const origin = state.snapshot();
  state.showInstalledSkillsFromSource("team-main");
  expect(state.collectionBrowserOpen()).toBe(false);
  expect(state.sourceFilter()).toBe("team-main");
  state.restore(origin);
  expect(state.collectionBrowserOpen()).toBe(true);
  expect(state.sourceFilter()).toBeUndefined();
});

const rootKey = collectionFilterPathKey({ segments: [{ collection: "root" }] });
const disclosureId = `collection-filter-tree-row-${encodeURIComponent(rootKey)}-disclosure`;
const selectedId = (collection: string) =>
  `collection-filter-tree-row-${encodeURIComponent(collectionFilterPathKey({ segments: [{ collection: "root" }, { collection, reference: { name: collection, target: collection } }] }))}-name`;

function projection(dense = false) {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  const view = (id: string, members = base.installedSkills, children: string[] = []) => ({
    id,
    description: `${id} description`,
    declared: [directOwner],
    repository: { derived: false, producers: [] },
    members: members.map((skill) => ({ name: skill.name, address: skill.address, paths: [] })),
    links: [],
    references: children.map((collection) => ({
      name: collection,
      collection,
      description: collection,
      owner: directOwner,
    })),
  });
  const collectionsView = [
    view("root", [], ["child", "empty"]),
    view("child", [base.installedSkills[1]!]),
    view("empty", []),
    ...Array.from({ length: dense ? 50 : 0 }, (_, i) => view(`zz-${i}`, [])),
  ];
  return {
    ...base,
    effective: {
      ...base.effective,
      collectionsView,
      collections: collectionsView.map((view) => view.id),
    },
  };
}

async function mount(width: number, height: number, dense = false) {
  setup = await testRender(
    () => <App core={directSourceCore(projection(dense))} exit={() => {}} />,
    { width, height },
  );
  await openAllInstalledSkills(setup);
}

async function capture(name: string) {
  const directory = process.env.QUIET_UPDATE_CAPTURE_DIR;
  if (!directory) return;
  await setup!.flush();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.txt`), setup!.captureCharFrame());
}

test.each([
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "compact Collection hierarchy remains reachable and returns to Skills at %ix%i",
  async (width, height) => {
    await mount(width, height);
    const tree = setup!.renderer.root.findDescendantById(
      "collection-filter-tree",
    ) as ScrollBoxRenderable;
    await focusLive(setup!, "open-collection-browser");
    await parsedEnter(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === tree);
    const rootName = setup!.renderer.root.findDescendantById(
      `collection-filter-tree-row-${encodeURIComponent(rootKey)}-name`,
    )!;
    await setup!.mockMouse.click(rootName.screenX + 1, rootName.screenY);
    await parsedEnter(setup!);
    await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById(selectedId("child")));
    const child = setup!.renderer.root.findDescendantById(selectedId("child"))!;
    setup!.mockInput.pressArrow("down");
    await setup!.waitFor(
      () =>
        (setup!.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable)
          ?.options.length === 1,
    );
    let browser = setup!.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    expect(browser.options).toHaveLength(1);
    expect(browser.getSelectedOption()?.value).toBe(JSON.stringify(["team-main", "reference"]));
    await setup!.waitForFrame((frame) => frame.includes("root / child"));
    await expectSharedReturn(setup!, "Back to Skills");
    await capture(`collections-compact-${width}x${height}`);
    setup!.mockInput.pressArrow("down");
    await setup!.waitFor(() => !setup!.renderer.root.findDescendantById("installed-skill-browser"));
    expect(setup!.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    expect(setup!.renderer.currentFocusedRenderable).toBe(tree);
    await parsedEscape(setup!);
    await setup!.waitForFrame((frame) => frame.includes("No matching Skills"));
    if (height === 13) {
      const notice = setup!.renderer.root.findDescendantById("skills-empty-state")!;
      const pane = setup!.renderer.root.findDescendantById("skills-list-pane")!;
      expect(notice.screenY + notice.height).toBeLessThanOrEqual(pane.screenY + pane.height - 1);
    }
    await focusLive(setup!, "open-collection-browser");
    await parsedEnter(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === tree);
    setup!.mockInput.pressArrow("up");
    await setup!.waitFor(
      () => !!setup!.renderer.root.findDescendantById("installed-skill-browser"),
    );
    browser = setup!.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    await parsedEscape(setup!);
    await setup!.waitFor(
      () => setup!.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(browser.options).toHaveLength(1);
    expect(setup!.renderer.root.findDescendantById("clear-skills-filter-collection")).toBeDefined();
    const pane = setup!.renderer.root.findDescendantById("skills-list-pane")!;
    expect(browser.screenY).toBeGreaterThan(pane.screenY);
    expect(browser.screenY + browser.height).toBeLessThanOrEqual(pane.screenY + pane.height - 1);
    await capture(`collections-return-${width}x${height}`);
    await parsedEnter(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    await parsedEscape(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === browser);
    setup!.resize(144, 40);
    await setup!.renderOnce();
    expect(setup!.renderer.root.findDescendantById("collection-filter-tree")).toBe(tree);
    expect(setup!.renderer.root.findDescendantById(disclosureId)).toBeDefined();
    expect(setup!.renderer.root.findDescendantById(selectedId("child"))).toBe(child);
    expect(setup!.renderer.currentFocusedRenderable).toBe(browser);
  },
);

test.each(["root", "disclosure", "scrollbar"])(
  "responsive hiding moves focused Collection %s to a usable visible region",
  async (kind) => {
    await mount(144, 40, true);
    await focusLive(setup!, "collection-filter-tree");
    const tree = setup!.renderer.root.findDescendantById(
      "collection-filter-tree",
    ) as ScrollBoxRenderable;
    const target =
      kind === "root"
        ? tree
        : kind === "scrollbar"
          ? tree.verticalScrollBar
          : setup!.renderer.root.findDescendantById(disclosureId)!;
    tree.scrollTo(8);
    await setup!.renderOnce();
    const saved = tree.scrollTop;
    target.focus();
    expect(setup!.renderer.currentFocusedRenderable).toBe(target);
    for (const [width, height] of [
      [100, 24],
      [80, 24],
      [43, 13],
    ]) {
      setup!.resize(width!, height!);
      await setup!.waitFor(
        () => setup!.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
      );
      expect(tree.focusable).toBe(false);
      await setup!.waitForFrame((frame) => frame.includes("Enter read"));
    }
    const browser = setup!.renderer.currentFocusedRenderable;
    setup!.resize(144, 40);
    await setup!.renderOnce();
    expect(setup!.renderer.root.findDescendantById("collection-filter-tree")).toBe(tree);
    expect(tree.scrollTop).toBe(saved);
    expect(setup!.renderer.currentFocusedRenderable).toBe(browser);
  },
);
