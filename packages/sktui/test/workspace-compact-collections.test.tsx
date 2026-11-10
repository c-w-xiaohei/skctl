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
  [144, 40],
  [100, 24],
  [80, 24],
  [43, 13],
])(
  "Collection filter browses a draft, applies on Enter and cancels without changing Skills at %ix%i",
  async (width, height) => {
    await mount(width, height);
    const reader = setup!.renderer.root.findDescendantById("skill-reader-pane")!;
    const readerBounds = [reader.screenX, reader.width];
    expect(!!setup!.renderer.root.findDescendantById("collection-filter-tree")).toBe(false);
    await openSkillsCollections(setup!);
    const tree = setup!.renderer.root.findDescendantById(
      "collection-filter-tree",
    ) as ScrollBoxRenderable;
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === tree);
    if (width >= 100) {
      expect([reader.screenX, reader.width]).toEqual(readerBounds);
      expect(reader.visible).toBe(true);
    }
    const rootName = setup!.renderer.root.findDescendantById(
      `collection-filter-tree-row-${encodeURIComponent(rootKey)}-name`,
    )!;
    await setup!.mockMouse.click(rootName.screenX + 1, rootName.screenY);
    setup!.mockInput.pressArrow("right");
    await setup!.waitFor(() => !!setup!.renderer.root.findDescendantById(selectedId("child")));
    setup!.mockInput.pressArrow("down");
    await setup!.flush();
    expect(
      (setup!.renderer.root.findDescendantById("installed-skill-browser") as SelectRenderable)
        .options,
    ).toHaveLength(2);
    await parsedEnter(setup!);
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
    expect(setup!.renderer.currentFocusedRenderable?.id).toBe("installed-skill-browser");
    await capture(`collections-compact-${width}x${height}`);
    await openSkillsCollections(setup!);
    setup!.mockInput.pressArrow("down");
    await setup!.flush();
    expect(browser.options).toHaveLength(1);
    expect(setup!.renderer.currentFocusedRenderable === tree).toBe(true);
    await parsedEscape(setup!);
    expect(browser.options).toHaveLength(1);
    await openSkillsCollections(setup!);
    setup!.mockInput.pressArrow("down");
    await parsedEnter(setup!);
    await setup!.waitForFrame((frame) => frame.includes("No matching Skills"));
    if (height === 13) {
      const notice = setup!.renderer.root.findDescendantById("skills-empty-state")!;
      const pane = setup!.renderer.root.findDescendantById("skills-list-pane")!;
      expect(notice.screenY).toBeGreaterThan(pane.screenY);
      expect(notice.screenY + notice.height).toBeLessThanOrEqual(pane.screenY + pane.height);
    }
    await openSkillsCollections(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === tree);
    setup!.mockInput.pressArrow("up");
    await parsedEnter(setup!);
    await setup!.waitFor(
      () => !!setup!.renderer.root.findDescendantById("installed-skill-browser"),
    );
    browser = setup!.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    await setup!.waitFor(
      () => setup!.renderer.currentFocusedRenderable?.id === "installed-skill-browser",
    );
    expect(browser.options).toHaveLength(1);
    expect(setup!.captureCharFrame()).toContain("Filter (1)");
    const pane = setup!.renderer.root.findDescendantById("skills-list-pane")!;
    expect(browser.screenY).toBeGreaterThan(pane.screenY);
    expect(browser.screenY + browser.height).toBeLessThanOrEqual(pane.screenY + pane.height);
    await capture(`collections-return-${width}x${height}`);
    await parsedEnter(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
    await parsedEscape(setup!);
    await setup!.waitFor(() => setup!.renderer.currentFocusedRenderable === browser);
    setup!.resize(144, 40);
    await setup!.renderOnce();
    expect(setup!.renderer.root.findDescendantById("collection-filter-tree") === tree).toBe(true);
    expect(setup!.renderer.root.findDescendantById(disclosureId)).toBeDefined();
    expect(setup!.renderer.root.findDescendantById(selectedId("child"))).toBeDefined();
    expect(setup!.renderer.currentFocusedRenderable === browser).toBe(true);
  },
);

test.each(["root", "disclosure", "scrollbar"])(
  "Collection filter preserves its focused %s through resize without changing preview",
  async (kind) => {
    await mount(144, 40, true);
    await openSkillsCollections(setup!);
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
    target.focus();
    expect(setup!.renderer.currentFocusedRenderable === target).toBe(true);
    for (const [width, height] of [
      [100, 24],
      [80, 24],
      [43, 13],
    ]) {
      setup!.resize(width!, height!);
      await setup!.flush();
      expect(tree.focusable).toBe(true);
      expect(setup!.renderer.currentFocusedRenderable?.isDestroyed).toBe(false);
    }
    await parsedEscape(setup!);
    const browser = setup!.renderer.currentFocusedRenderable;
    setup!.resize(144, 40);
    await setup!.renderOnce();
    expect(setup!.renderer.root.findDescendantById("collection-filter-tree") === tree).toBe(true);
    expect(tree.scrollTop).toBeGreaterThanOrEqual(0);
    expect(setup!.renderer.currentFocusedRenderable === browser).toBe(true);
  },
);
import { openSkillsCollections } from "./reader-test-controls";
