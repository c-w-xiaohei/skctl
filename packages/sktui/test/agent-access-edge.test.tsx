import { expect, test } from "bun:test";
import { BoxRenderable, ScrollBoxRenderable, type BaseRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  focusLive,
  live,
  openInstallation,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
import { openAgentAccess, press, rowId, selected, waitForBody } from "./agent-access-test-controls";
const rootPathKey = JSON.stringify([["root", null]]);
const itemName = (index: number) => `edge-skill-${String(index).padStart(3, "0")}`;
const itemKey = (index: number) =>
  JSON.stringify([rootPathKey, "skill", itemName(index), "team-main", `edge/${index}`]);
const longDescription =
  "A deliberately long description available in Reader Details instead of " +
  "causing the Agent access tree to grow or move when a different skill is selected.";
/** Canonical management facts, not pre-rendered tree rows or hand-authored display options. */
function canonicalManagementProjection() {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete projection");
  const installedSkills = Array.from({ length: 120 }, (_, index) => {
    const template = base.installedSkills[0]!;
    const name = itemName(index);
    const path = `edge/${index}`;
    return {
      ...template,
      address: { source: "team-main", path },
      name,
      description: longDescription,
      owner: { ...template.owner, source: "team-main", health: "healthy" as const },
    };
  });
  return {
    ...base,
    installedSkills,
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["root"],
      collectionsView: [
        {
          id: "root",
          description: "Root collection description",
          declared: [
            { level: "project" as const, file: "/project.jsonc", pointer: "/collections/root" },
          ],
          repository: { derived: false, producers: [] },
          members: installedSkills.map((skill) => ({
            name: skill.name,
            address: skill.address,
            paths: [],
          })),
          references: [],
          links: [],
        },
      ],
    },
  };
}
function scrolledDisclosureProjection() {
  const base = canonicalManagementProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete projection");
  const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/root" };
  const root = base.effective.collectionsView[0]!;
  const referenced = {
    id: "disclosure-target",
    description: "Referenced branch",
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [
      {
        name: "nested-skill",
        address: base.installedSkills[0]!.address,
        paths: [],
      },
    ],
    references: [],
    links: [],
  };
  return {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: [
        {
          ...root,
          references: [
            ...Array.from({ length: 119 }, (_, index) => ({
              name: `route-${String(index).padStart(3, "0")}`,
              collection: `absent-${index}`,
              description: "Unavailable reference",
              owner,
            })),
            {
              name: "zz-final-route",
              collection: referenced.id,
              description: "Scrollable disclosure target",
              owner,
            },
          ],
        },
        referenced,
      ],
    },
  };
}
const rows = (tree: ScrollBoxRenderable) => tree.content.getChildren();
function treeFailure(
  setup: Awaited<ReturnType<typeof testRender>>,
  tree: ScrollBoxRenderable,
  step: string,
) {
  return new Error(
    [
      `Agent access Tree input step failed: ${step}`,
      `focus=${setup.renderer.currentFocusedRenderable?.id ?? "none"}`,
      `selectedRow=${rows(tree).find((row) => (row as BoxRenderable).backgroundColor.a > 0)?.id ?? "none"}`,
      `scrollOffset=${tree.scrollTop}`,
      `visibleRows=${rows(tree).length}`,
      "frame:",
      setup.captureCharFrame(),
    ].join("\n"),
  );
}
async function waitForTreeState(
  setup: Awaited<ReturnType<typeof testRender>>,
  tree: ScrollBoxRenderable,
  predicate: () => boolean,
  step: string,
) {
  try {
    await setup.waitFor(() => predicate() && setup.renderer.currentFocusedRenderable === tree);
  } catch {
    throw treeFailure(setup, tree, step);
  }
}
function expectTreeFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  tree: ScrollBoxRenderable,
  requiredText: readonly string[],
) {
  const frame = setup.captureCharFrame();
  const missing = requiredText.filter((text) => !frame.includes(text));
  if (missing.length)
    throw new Error(
      `${treeFailure(setup, tree, `frame missing ${missing.join(", ")}`).message}\nframe:\n${frame}`,
    );
  return frame;
}
async function selectByNativeArrows(
  setup: Awaited<ReturnType<typeof testRender>>,
  tree: ScrollBoxRenderable,
  targetIndex: number,
) {
  const current = rows(tree).findIndex((row) => (row as BoxRenderable).backgroundColor.a > 0);
  expect(current).toBeGreaterThanOrEqual(0);
  const distance = targetIndex - current;
  expect(Math.abs(distance)).toBeLessThanOrEqual(rows(tree).length);
  const direction = distance < 0 ? "up" : "down";
  for (let step = 0; step < Math.abs(distance); step++) {
    await focusLive(setup, "current-exposure-browser");
    const expectedIndex = current + (step + 1) * (direction === "down" ? 1 : -1);
    await press(setup, direction === "down" ? "ARROW_DOWN" : "ARROW_UP");
    await waitForTreeState(
      setup,
      tree,
      () => (rows(tree)[expectedIndex] as BoxRenderable).backgroundColor.a > 0,
      `Arrow ${direction} to Tree row ${expectedIndex}`,
    );
  }
}
for (const viewport of [
  { width: 43, height: 13, label: "narrow" },
  { width: 80, height: 16, label: "low-height" },
]) {
  // Hundreds of parsed key/frame round trips run under the fixed one-CPU runner;
  // this is a correctness journey, not a five-second performance benchmark.
  test(`RENDER Agent access keeps the 120-skill native keyboard journey usable at ${viewport.label} viewport`, async () => {
    const contentLoads: string[] = [];
    let installs = 0;
    const mutations: string[] = [];
    const setup = await testRender(
      () => (
        <App
          core={directSourceCore(canonicalManagementProjection(), {
            loadInstalledSkill: async (
              _environment: import("@skctl/core").CoreOptions,
              { address },
            ) => {
              contentLoads.push(address.path);
              return {
                address,
                name: address.path,
                description: longDescription,
                rawText: `Installed body ${address.path}`,
                markdownText: `# ${address.path}\n\nInstalled body ${address.path}`,
              };
            },
            installSkills: async () => {
              installs++;
              throw new Error("browsing Agent access must not install");
            },
            updateSkills: async () => {
              mutations.push("update");
              throw new Error("direct reading must not update");
            },
            discoverSkills: async () => {
              mutations.push("discover");
              throw new Error("direct reading must not acquire Source content");
            },
          })}
          exit={() => {}}
        />
      ),
      { width: viewport.width, height: viewport.height },
    );
    try {
      const tree = await openAgentAccess(setup);
      expect(rows(tree).map((row) => row.id)).toEqual([rowId(rootPathKey)]);
      // Installed inventory may already have loaded its first current Skill.
      expect(contentLoads.every((path) => path === "edge/0")).toBe(true);
      const startupLoads = [...contentLoads];
      await focusLive(setup, "current-exposure-browser");
      await press(setup, "ARROW_RIGHT");
      await waitForTreeState(
        setup,
        tree,
        () => rows(tree).length === 121,
        "Right to expand Use root",
      );
      expect(contentLoads).toEqual(startupLoads);
      const expandedTreeHeight = tree.height;
      await selectByNativeArrows(setup, tree, 120);
      await setup.waitFor(() => tree.scrollTop > 0);
      expect(selected(setup, itemKey(119))).toBe(true);
      expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
      // Browsing rows does not read or mutate the selected Skills.
      expect(contentLoads).toEqual(startupLoads);
      expect(installs).toBe(0);
      expect(mutations).toEqual([]);
      await setup.flush();
      expectTreeFrame(setup, tree, [itemName(119)]);
      expect(live(setup, `${rowId(rootPathKey)}-disclosure`)).toBeInstanceOf(ButtonRenderable);
      expect(rows(tree).every((row) => row.height === 1)).toBe(true);
      expect(tree.height).toBeGreaterThanOrEqual(1);
      const pane = setup.renderer.root.findDescendantById("agent-access-pane")!;
      expect(tree.screenY).toBeGreaterThanOrEqual(pane.screenY + 1);
      expect(tree.screenY + tree.height).toBeLessThanOrEqual(pane.screenY + pane.height);
      const selectedRow = live(setup, rowId(itemKey(119)));
      expect(selectedRow.screenY).toBeGreaterThanOrEqual(tree.viewport.screenY);
      expect(selectedRow.screenY).toBeLessThan(tree.viewport.screenY + tree.viewport.height);
      expect(tree.height).toBe(expandedTreeHeight);
      const selectedScroll = tree.scrollTop;
      await focusLive(setup, "current-exposure-browser");
      await parsedEnter(setup);
      await setup.flush();
      expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
      await waitForBody(setup, "Installed body edge/119");
      expect(contentLoads).toEqual([...startupLoads, "edge/119"]);
      await openInstallation(setup);
      const metadata = live(setup, "reader-details") as ScrollBoxRenderable;
      await focusLive(setup, "reader-details");
      expect(metadata.viewport.height).toBeGreaterThan(0);
      const text = (node: BaseRenderable): string =>
        ["plainText" in node ? String(node.plainText) : "", ...node.getChildren().map(text)].join(
          "\n",
        );
      expect(text(metadata)).toContain("Source: team-main");
      expect(text(metadata)).toContain("Path: edge/119");
      expect(contentLoads).toEqual([...startupLoads, "edge/119"]);
      expect(installs).toBe(0);
      expect(mutations).toEqual([]);
      await parsedEscape(setup);
      await parsedEscape(setup);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("current-exposure-browser"),
      );
      const restored = live(setup, "current-exposure-browser") as ScrollBoxRenderable;
      await setup.flush();
      expect(selected(setup, itemKey(119))).toBe(true);
      expectTreeFrame(setup, restored, [itemName(119)]);
      expect(rows(restored)).toHaveLength(121);
      expect(restored.scrollTop).toBe(selectedScroll);
      expect(setup.renderer.currentFocusedRenderable === restored).toBe(true);
      expect(restored.height).toBeGreaterThanOrEqual(1);
      expect(contentLoads).toEqual([...startupLoads, "edge/119"]);
      expect(installs).toBe(0);
      expect(mutations).toEqual([]);
    } finally {
      setup.renderer.destroy();
    }
  }, 30000);
}
test("RENDER Agent access after scrolling distinguishes a row press from its exact disclosure glyph", async () => {
  let contentLoads = 0;
  let installs = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(scrolledDisclosureProjection(), {
          loadInstalledSkill: async () => {
            contentLoads++;
            throw new Error("content must remain unloaded");
          },
          checkUpdate: async () => {
            throw new Error("browsing Agent access must not check updates");
          },
          installSkills: async () => {
            installs++;
            throw new Error("browsing Agent access must not install");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    const tree = await openAgentAccess(setup);
    const initialLoads = contentLoads;
    await focusLive(setup, "current-exposure-browser");
    await press(setup, "ARROW_RIGHT");
    await waitForTreeState(
      setup,
      tree,
      () => rows(tree).length === 241,
      "Right to expand Use root",
    );
    const finalPathKey = JSON.stringify([
      ["root", null],
      ["disclosure-target", { name: "zz-final-route", target: "disclosure-target" }],
    ]);
    const finalRouteIndex = rows(tree).findIndex((row) => row.id === rowId(finalPathKey));
    expect(finalRouteIndex).toBeGreaterThanOrEqual(0);
    await selectByNativeArrows(setup, tree, finalRouteIndex);
    await setup.waitFor(() => tree.scrollTop > 0);
    const name = live(setup, `${rowId(finalPathKey)}-name`);
    expect(name.screenY).toBeGreaterThanOrEqual(tree.viewport.screenY);
    expect(name.screenY).toBeLessThan(tree.viewport.screenY + tree.viewport.height);
    await setup.mockMouse.click(name.screenX, name.screenY);
    await setup.flush();
    expect(selected(setup, finalPathKey)).toBe(true);
    expect(setup.renderer.currentFocusedRenderable).toBe(tree);
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
    expect(rows(tree)).toHaveLength(241);
    expect(contentLoads).toBe(initialLoads);
    expect(installs).toBe(0);
    const disclosure = live(setup, `${rowId(finalPathKey)}-disclosure`);
    expect(disclosure).toBeInstanceOf(ButtonRenderable);
    expect(disclosure.width).toBe(3);
    await setup.mockMouse.click(disclosure.screenX + 2, disclosure.screenY);
    await setup.flush();
    expect(rows(tree)).toHaveLength(242);
    expect(selected(setup, finalPathKey)).toBe(true);
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("skill-inspector")).toBeUndefined();
    expect(contentLoads).toBe(initialLoads);
    expect(installs).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
}, 30000);
