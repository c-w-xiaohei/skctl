/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { SelectRenderable } from "@opentui/core";
import { selectScrollOffset } from "../src/select-scroll";
import { mkdir, writeFile } from "node:fs/promises";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { openMainPage } from "./main-page-controls";
import { enterLive, parsedEscape, waitForReaderBody } from "./reader-test-controls";

function screenshotWorkspace() {
  const base = collectionsSourcesProjection();
  if (base.effective.status !== "complete") throw new Error("Complete fixture required");
  const names = [
    "code-design",
    "component-driven-development",
    "feature-dev",
    "resolve-conflicts",
    "skill-creator",
  ];
  const members = names.map((name) => ({
    name,
    address: { source: "dev-kit", path: `skills/${name}` },
    paths: [
      {
        kind: "repository-derived" as const,
        repository: "c-w-xiaohei/dev-kit",
        source: "dev-kit",
        path: `skills/${name}`,
      },
    ],
  }));
  const collection = {
    ...base.effective.collectionsView[0]!,
    id: "c-w-xiaohei/dev-kit",
    declared: [],
    repository: { derived: true, producers: [{ source: "dev-kit", path: "skills" }] },
    members,
    references: [],
    links: [],
  };
  return {
    ...base,
    installedSkills: Array.from({ length: 209 }, (_, index) => {
      const member = members[index % members.length]!;
      return {
        ...base.installedSkills[0]!,
        ...member,
        owner: { ...base.installedSkills[0]!.owner, source: "dev-kit" },
        name: index < 5 ? member.name : `${member.name}-${index}`,
        address:
          index < 5
            ? member.address
            : { ...member.address, path: `${member.address.path}-${index}` },
        collections: [],
        selectors: [],
        description: "Design and maintain Skills with precise instructions and reusable resources.",
      };
    }),
    effective: {
      ...base.effective,
      collections: [collection.id],
      collectionsView: [collection, ...base.effective.collectionsView.slice(1)],
    },
  };
}

test.each([43, 80, 100, 120, 144])(
  "main page navigation keeps its position at %i columns",
  async (width) => {
    const setup = await testRender(
      () => <App core={directSourceCore(screenshotWorkspace())} exit={() => {}} />,
      { width, height: width === 43 ? 13 : 24 },
    );
    try {
      let geometry: number[] | undefined;
      for (const page of [
        "skills",
        "collections",
        "sources",
        "updates",
        "agent",
        "settings",
        "skills",
      ] as const) {
        await openMainPage(setup, page);
        await setup.flush();
        const nav = setup.renderer.root.findDescendantById("section-nav")!;
        const current = [nav.screenX, nav.screenY, nav.width, nav.height];
        if (geometry) expect(current).toEqual(geometry);
        else geometry = current;
        const controls =
          width < 100
            ? ["shell-pages-select"]
            : ["skills", "collections", "sources", "updates", "agent", "settings"].map(
                (name) => `shell-section-tab-${name}`,
              );
        for (const id of controls) {
          const control = setup.renderer.root.findDescendantById(id)!;
          expect(control.visible).toBe(true);
          expect(control.screenX).toBeGreaterThanOrEqual(nav.screenX);
          expect(control.screenX + control.width).toBeLessThanOrEqual(nav.screenX + nav.width);
        }
        await mkdir("out/layout-clarity", { recursive: true });
        await writeFile(`out/layout-clarity/page-${page}-${width}.txt`, setup.captureCharFrame());
      }
      expect(
        setup.renderer.root.findDescendantById("collection-filter-tree-row-inventory-unassigned"),
      ).toBeUndefined();
    } finally {
      setup.renderer.destroy();
    }
  },
);

for (const width of [144, 120, 100, 80, 43]) {
  test(`Skills names, search and reader fit at ${width} columns`, async () => {
    const setup = await testRender(
      () => <App core={directSourceCore(screenshotWorkspace())} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await openMainPage(setup, "skills");
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
      await setup.flush();
      await mkdir("out/layout-clarity", { recursive: true });
      await writeFile(`out/layout-clarity/skills-${width}.txt`, setup.captureCharFrame());
      for (const id of [
        "skills-list-pane",
        "skills-query",
        "open-skills-filter",
        "skill-reader-pane",
      ]) {
        const control = setup.renderer.root.findDescendantById(id);
        if (!control || !control.visible || !control.width) continue;
        expect(control.screenX + control.width, id).toBeLessThanOrEqual(width);
      }
      expect(setup.captureCharFrame()).toContain("component-driven-development");
      await enterLive(setup, "installed-skill-browser");
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "reader-scrollbox");
      await waitForReaderBody(setup, "skills/code-design");
      await writeFile(`out/layout-clarity/reader-${width}.txt`, setup.captureCharFrame());
      const readerPane = setup.renderer.root.findDescendantById("skill-reader-pane")!;
      expect(readerPane.screenX + readerPane.width).toBeLessThanOrEqual(width);
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("installed-skill-browser"),
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("repository Collection keeps member names readable and actions together", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(screenshotWorkspace())} exit={() => {}} />,
    { width: 144, height: 24 },
  );
  try {
    await openMainPage(setup, "collections");
    await enterLive(setup, "collection-browser");
    await setup.flush();
    await mkdir("out/layout-clarity", { recursive: true });
    await writeFile("out/layout-clarity/collection-144.txt", setup.captureCharFrame());
    const add = setup.renderer.root.findDescendantById("collection-add")!;
    const details = setup.renderer.root.findDescendantById("collection-more")!;
    expect(add.screenY).toBe(details.screenY);
    expect(setup.captureCharFrame()).toContain("component-driven-development");
    await enterLive(setup, "collection-more");
    await enterLive(setup, "collection-current-details");
    expect(setup.captureCharFrame()).toContain("dev-kit");
    await parsedEscape(setup);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("collection-relationships");
  } finally {
    setup.renderer.destroy();
  }
});

test("normal-height inventory and Reader separate identity, actions and navigation", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(screenshotWorkspace())} exit={() => {}} />,
    { width: 144, height: 32 },
  );
  try {
    await openMainPage(setup, "skills");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("reader-tools"));
    await setup.flush();
    const node = (id: string) => setup.renderer.root.findDescendantById(id)!;
    expect(node("skills-query").screenY - node("skills-browser-more").screenY).toBe(1);
    expect(node("reader-collection-actions").screenY - node("reader-identity-row").screenY).toBe(1);
    expect(node("reader-tools").screenY - node("reader-collection-actions").screenY).toBe(1);
    await writeFile("out/layout-clarity/spacing-144.txt", setup.captureCharFrame());
  } finally {
    setup.renderer.destroy();
  }
});

test("Skills wheel scrolls its viewport without changing the current Skill", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(screenshotWorkspace())} exit={() => {}} />,
    { width: 144, height: 32 },
  );
  try {
    await openMainPage(setup, "skills");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("installed-skill-browser"));
    await setup.flush();
    const list = setup.renderer.root.findDescendantById(
      "installed-skill-browser",
    ) as SelectRenderable;
    const selected = list.getSelectedOption()?.value;
    const before = selectScrollOffset(list);
    await setup.mockMouse.scroll(list.screenX + 4, list.screenY + 3, "down");
    await setup.flush();
    expect(selectScrollOffset(list)).toBeGreaterThan(before);
    expect(list.getSelectedOption()?.value).toBe(selected);
    await setup.mockMouse.scroll(list.screenX + 4, list.screenY + 3, "up");
    await setup.flush();
    expect(selectScrollOffset(list)).toBe(before);
    expect(list.getSelectedOption()?.value).toBe(selected);
    await setup.mockMouse.scroll(list.screenX + 4, list.screenY + 3, "down");
    await setup.flush();
    const visibleIndex = selectScrollOffset(list) + 2;
    const visibleSkill = list.options[visibleIndex]!.value;
    await setup.mockMouse.click(list.screenX + 4, list.screenY + 2);
    await setup.flush();
    expect(list.getSelectedOption()?.value).toBe(visibleSkill);
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection filter shows only collection rows with aligned names", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(screenshotWorkspace())} exit={() => {}} />,
    { width: 144, height: 32 },
  );
  try {
    await openMainPage(setup, "skills");
    await openSkillsCollections(setup);
    await setup.flush();
    const tree = setup.renderer.root.findDescendantById("collection-filter-tree")!;
    const children = (node: typeof tree): (typeof tree)[] =>
      node.getChildren().flatMap((child) => [child, ...children(child)]);
    const names = children(tree).filter((node) => node.id.endsWith("-name"));
    expect(names.length).toBeGreaterThan(2);
    expect(names[0]!.screenX).toBe(names[1]!.screenX);
    expect(names[1]!.screenY - names[0]!.screenY).toBe(1);
    expect(names[0]!.screenX - tree.screenX).toBe(3);
  } finally {
    setup.renderer.destroy();
  }
});
import { openSkillsCollections } from "./reader-test-controls";
