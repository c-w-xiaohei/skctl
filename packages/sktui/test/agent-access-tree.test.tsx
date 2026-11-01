import { expect, test } from "bun:test";
import { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { ButtonRenderable } from "@tuiparts/core/button";
import { App } from "../src/app";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { live, parsedEscape } from "./reader-test-controls";
import { openAgentAccess, press, rowId, selected, waitForBody } from "./agent-access-test-controls";
const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/root" };
function projection(childSkillCount = 0) {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete projection");
  return {
    ...base,
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" as const },
      use: ["root"],
      collectionsView: [
        {
          id: "root",
          description: "Root description",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [
            { name: "guide-entry", address: { source: "team-main", path: "guide" }, paths: [] },
          ],
          references: [{ name: "child", collection: "child", description: "Child route", owner }],
          links: [],
        },
        {
          id: "child",
          description: "Child description",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: Array.from({ length: childSkillCount }, (_, index) => ({
            name: `child-skill-${index}`,
            address: { source: "team-main", path: "guide" },
            paths: [],
          })),
          references: [],
          links: [],
        },
      ],
    },
  };
}
type Setup = Awaited<ReturnType<typeof testRender>>;
const rows = (tree: ScrollBoxRenderable) => tree.content.getChildren();
async function clickPart(setup: Setup, key: string, part: "name" | "disclosure", cell = 0) {
  const target = live(setup, `${rowId(key)}-${part}`);
  await setup.mockMouse.click(target.screenX + cell, target.screenY);
  await setup.flush();
}
function readingCore(childSkillCount = 0, reads: string[] = []) {
  return directSourceCore(projection(childSkillCount), {
    loadInstalledSkill: async (_environment: import("@skctl/core").CoreOptions, { address }) => {
      reads.push(`${address.source}/${address.path}`);
      return {
        address,
        name: address.path,
        description: "",
        rawText: "Installed guide body",
        markdownText: "# Guide\n\nInstalled guide body",
      };
    },
  });
}
const rootPathKey = JSON.stringify([["root", null]]);
const childPathKey = JSON.stringify([
  ["root", null],
  ["child", { name: "child", target: "child" }],
]);
const skillRowKey = (pathKey: string, entry: string) =>
  JSON.stringify([pathKey, "skill", entry, "team-main", "guide"]);
test("Agent selection never shows another Skill body before activation", async () => {
  const base = projection();
  const effective = base.effective;
  const fixture = {
    ...base,
    effective: {
      ...effective,
      collectionsView: effective.collectionsView.map((item) =>
        item.id !== "root"
          ? item
          : {
              ...item,
              members: [
                ...item.members,
                {
                  name: "reference-entry",
                  address: { source: "team-main", path: "reference" },
                  paths: [],
                },
              ],
            },
      ),
    },
  };
  const reads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(fixture, {
          loadInstalledSkill: async (_env, { address }) => {
            reads.push(address.path);
            return {
              address,
              name: address.path,
              description: "",
              rawText: `Body ${address.path}`,
              markdownText: `Body ${address.path}`,
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 40 },
  );
  try {
    await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "disclosure");
    await clickPart(setup, skillRowKey(rootPathKey, "guide-entry"), "name");
    await press(setup, "RETURN");
    await waitForBody(setup, "Body guide");
    await parsedEscape(setup);
    const before = [...reads];
    const reference = JSON.stringify([
      rootPathKey,
      "skill",
      "reference-entry",
      "team-main",
      "reference",
    ]);
    await clickPart(setup, reference, "name");
    expect(reads).toEqual(before);
    expect(setup.captureCharFrame()).not.toContain("Body guide");
    await press(setup, "RETURN");
    await waitForBody(setup, "Body reference");
    expect(reads.filter((path) => path === "reference")).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access opens with folded Use roots and Right reveals one layer", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection(1))} exit={() => {}} />,
    { width: 144, height: 40 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    expect(setup.renderer.root.findDescendantById("installed-skill-browser")).toBeUndefined();
    // Compare native identity without asking the assertion formatter to traverse
    // the renderer's cyclic object graph on failure.
    expect(
      setup.renderer.currentFocusedRenderable === tree,
      `before Enter: ${setup.renderer.currentFocusedRenderable?.id}`,
    ).toBe(true);
    expect(rows(tree).map((row) => row.id)).toEqual([rowId(rootPathKey)]);
    expect(selected(setup, rootPathKey)).toBe(true);
    expect(setup.captureCharFrame()).toContain("Root description");
    expect(setup.captureCharFrame()).toContain("Enter expand");
    await press(setup, "ARROW_RIGHT");
    expect(rows(tree).map((row) => row.id)).toEqual([
      rowId(rootPathKey),
      rowId(childPathKey),
      rowId(skillRowKey(rootPathKey, "guide-entry")),
    ]);
    expect(
      setup.renderer.root.findDescendantById(rowId(skillRowKey(childPathKey, "child-skill-0"))),
    ).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access disclosure has three real Button cells and never opens a Collection", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 80, height: 40 },
  );
  try {
    const tree = await openAgentAccess(setup);
    const disclosure = live(setup, `${rowId(rootPathKey)}-disclosure`);
    expect(disclosure).toBeInstanceOf(ButtonRenderable);
    expect(disclosure.width).toBe(3);
    for (let cell = 0; cell < 3; cell++) {
      await clickPart(setup, rootPathKey, "disclosure", cell);
      expect(rows(tree)).toHaveLength(cell === 1 ? 1 : 3);
      expect(selected(setup, rootPathKey)).toBe(true);
      expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
      expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeUndefined();
    }
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access name click only selects and Collection Enter toggles in place", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    expect(rows(tree)).toHaveLength(1);
    await press(setup, "RETURN");
    expect(rows(tree)).toHaveLength(3);
    expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeUndefined();
    await press(setup, "RETURN");
    expect(rows(tree)).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});
test("Agent Skill activation opens the exact cached content and Back restores its tree row", async () => {
  const reads: string[] = [];
  const mutations: string[] = [];
  const core = {
    ...readingCore(12, reads),
    installSkills: async () => {
      mutations.push("install");
      throw new Error("Unexpected install");
    },
    updateSkills: async () => {
      mutations.push("update");
      throw new Error("Unexpected update");
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 144,
    height: 40,
  });
  try {
    await setup.waitFor(() => reads.length === 1);
    await waitForBody(setup, "Installed guide body");
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    const startupReads = [...reads];
    await press(setup, "ARROW_RIGHT");
    expect(reads).toEqual(startupReads);
    await press(setup, "ARROW_DOWN");
    expect(selected(setup, childPathKey)).toBe(true);
    expect(reads).toEqual(startupReads);
    await press(setup, "ARROW_DOWN");
    expect(selected(setup, skillRowKey(rootPathKey, "guide-entry"))).toBe(true);
    expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
    expect(reads).toEqual(startupReads);
    const scroll = tree.scrollTop;
    await press(setup, "RETURN");
    await waitForBody(setup, "Installed guide body");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    expect(
      (live(setup, "reader-identity") as import("@opentui/core").TextRenderable).plainText,
    ).toBe("guide");
    expect(reads).toEqual(["team-main/guide"]);
    expect(mutations).toEqual([]);
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "current-exposure-browser",
    );
    const restored = live(setup, "current-exposure-browser") as ScrollBoxRenderable;
    expect(selected(setup, skillRowKey(rootPathKey, "guide-entry"))).toBe(true);
    expect(restored.scrollTop).toBe(scroll);
    await press(setup, "RETURN");
    await waitForBody(setup, "Installed guide body");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    expect(reads).toEqual(["team-main/guide"]);
    expect(mutations).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access tree consumes leaf Right and root Left while Skill Left returns its parent", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    await press(setup, "ARROW_RIGHT");
    await press(setup, "END");
    await press(setup, "ARROW_RIGHT");
    expect(selected(setup, skillRowKey(rootPathKey, "guide-entry"))).toBe(true);
    await press(setup, "ARROW_DOWN");
    expect(selected(setup, skillRowKey(rootPathKey, "guide-entry"))).toBe(true);
    expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
    await press(setup, "ARROW_LEFT");
    expect(selected(setup, rootPathKey)).toBe(true);
    await press(setup, "ARROW_LEFT");
    expect(rows(tree)).toHaveLength(1);
    await press(setup, "ARROW_LEFT");
    await press(setup, "ARROW_UP");
    expect(selected(setup, rootPathKey)).toBe(true);
    expect(setup.renderer.currentFocusedRenderable === tree).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access collapsing a root glyph with its direct Skill selected selects the root", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    await press(setup, "ARROW_RIGHT");
    await press(setup, "END");
    expect(selected(setup, skillRowKey(rootPathKey, "guide-entry"))).toBe(true);
    await clickPart(setup, rootPathKey, "disclosure");
    expect(rows(tree)).toHaveLength(1);
    expect(selected(setup, rootPathKey)).toBe(true);
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("agent-access-pane")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access collapsing a Reference glyph with its direct Skill selected returns to that Reference", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection(12))} exit={() => {}} />,
    { width: 80, height: 40 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    await press(setup, "ARROW_RIGHT");
    await press(setup, "ARROW_DOWN");
    await press(setup, "ARROW_RIGHT");
    expect(rows(tree)).toHaveLength(15);
    await press(setup, "ARROW_DOWN");
    await press(setup, "ARROW_DOWN");
    expect(selected(setup, skillRowKey(childPathKey, "child-skill-1"))).toBe(true);
    await clickPart(setup, childPathKey, "disclosure");
    expect(rows(tree)).toHaveLength(3);
    expect(selected(setup, childPathKey)).toBe(true);
    expect(setup.renderer.root.findDescendantById("reader-scrollbox")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access Escape restores a non-root Skill path, tree scroll and expansion without another content read", async () => {
  const reads: string[] = [];
  const setup = await testRender(() => <App core={readingCore(12, reads)} exit={() => {}} />, {
    width: 144,
    height: 16,
  });
  try {
    const tree = await openAgentAccess(setup);
    await clickPart(setup, rootPathKey, "name");
    await press(setup, "ARROW_RIGHT");
    await press(setup, "ARROW_DOWN");
    await press(setup, "ARROW_RIGHT");
    // The final root member follows all lexically sorted Reference children.
    await press(setup, "END");
    await press(setup, "ARROW_UP");
    const selectedKey = skillRowKey(childPathKey, "child-skill-9");
    expect(selected(setup, selectedKey)).toBe(true);
    const selectedScroll = tree.scrollTop;
    expect(selectedScroll).toBeGreaterThan(0);
    const readsBefore = [...reads];
    await press(setup, "RETURN");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("reader-scrollbox");
    await parsedEscape(setup);
    await setup.flush();
    const restored = live(setup, "current-exposure-browser") as ScrollBoxRenderable;
    expect(setup.renderer.currentFocusedRenderable === restored).toBe(true);
    expect(selected(setup, selectedKey)).toBe(true);
    expect(rows(restored)).toHaveLength(15);
    expect(restored.scrollTop).toBe(selectedScroll);
    expect(reads).toEqual(readsBefore);
    expect(reads).toEqual(["team-main/guide"]);
  } finally {
    setup.renderer.destroy();
  }
});
