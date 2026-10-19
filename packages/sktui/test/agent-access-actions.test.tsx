import { expect, test } from "bun:test";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import type { TuiCore } from "../src/effects";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import {
  openAgentAccess,
  press,
  rowId,
  selected,
  settleHighlighting,
  waitForBody,
} from "./agent-access-test-controls";
import {
  enterLive,
  focusLive,
  live,
  openAllInstalledSkills,
  openReaderTab,
  parsedEnter,
  parsedEscape,
} from "./reader-test-controls";
const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/root" };
function projection() {
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
          description: "Root Collection description",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [
            {
              name: "reading",
              collection: "child",
              description:
                "Reference description owned by reading, not child. " +
                "This deliberately long own Reference description remains available in the focused full-text surface. ".repeat(
                  20,
                ),
              owner,
            },
          ],
          links: [],
        },
        {
          id: "child",
          description: "Child Collection description",
          declared: [owner],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
}
type Setup = Awaited<ReturnType<typeof testRender>>;
const rootPathKey = JSON.stringify([["root", null]]);
const referencePathKey = JSON.stringify([
  ["root", null],
  ["child", { name: "reading", target: "child" }],
]);
async function palette(setup: Setup) {
  await enterLive(setup, "shell-more-actions");
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
  await setup.flush();
  return live(setup, "palette-choices") as SelectRenderable;
}
async function choosePaletteAction(setup: Setup, choices: SelectRenderable, id: string) {
  const index = choices.options.findIndex((option) => option.value.id === id);
  expect(index, `Global Actions must expose ${id}`).toBeGreaterThanOrEqual(0);
  const distance = index - choices.getSelectedIndex();
  for (let step = 0; step < Math.abs(distance); step++)
    await press(setup, distance < 0 ? "ARROW_UP" : "ARROW_DOWN");
  expect(choices.getSelectedOption()?.value).toMatchObject({ id, enabled: true });
  await parsedEnter(setup);
  await setup.flush();
}
test("RENDER Agent access Reference full text is adjacent and scrollable; global Actions preserves its exact update scope", async () => {
  let contentLoads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          loadInstalledSkill: async () => {
            contentLoads++;
            throw new Error("Agent access browsing must not read SKILL.md");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 16 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await focusLive(setup, "current-exposure-browser");
    await press(setup, "ARROW_RIGHT");
    expect(tree.content.getChildren()).toHaveLength(2);
    await press(setup, "ARROW_DOWN");
    expect(selected(setup, referencePathKey)).toBe(true);
    expect(setup.captureCharFrame()).toContain("Reference description owned by reading");
    expect(setup.captureCharFrame()).not.toContain("Child Collection description");
    // A tree boundary stays in the tree; Tab changes work regions.
    await press(setup, "ARROW_DOWN");
    expect(setup.renderer.currentFocusedRenderable).toBe(tree);
    await press(setup, "TAB");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("agent-node-description");
    const description = live(setup, "agent-node-description") as ScrollBoxRenderable;
    const pane = setup.renderer.root.findDescendantById("agent-access-pane")!;
    expect(tree.screenY).toBeGreaterThanOrEqual(pane.screenY + 1);
    expect(tree.screenY + tree.height).toBeLessThanOrEqual(pane.screenY + pane.height - 1);
    const preview = live(setup, "agent-node-pane");
    expect(description.screenY).toBeGreaterThan(preview.screenY);
    expect(description.screenY + description.height).toBeLessThan(preview.screenY + preview.height);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Reference description owned by reading, not child");
    await press(setup, "\u001b[6~");
    expect(description.scrollTop).toBeGreaterThan(0);
    expect(setup.renderer.currentFocusedRenderable).toBe(description);
    expect(contentLoads).toBe(0);
    await parsedEscape(setup);
    await setup.flush();
    expect(setup.renderer.currentFocusedRenderable).toBe(tree);
    const choices = await palette(setup);
    // Retain the old Reference-scoped update guarantee, not a workspace-wide fallback.
    await choosePaletteAction(setup, choices, "collection-check-updates");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("updates-browser"));
    setup.resize(144, 24);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Collection child");
    expect(contentLoads).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access Reference Enter stays in the tree and optional Details opens its target Collection", async () => {
  let contentLoads = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(projection(), {
          loadInstalledSkill: async () => {
            contentLoads++;
            throw new Error("Agent access browsing must not read SKILL.md");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 24 },
  );
  try {
    const tree = await openAgentAccess(setup);
    await focusLive(setup, "current-exposure-browser");
    await press(setup, "RETURN");
    expect(tree.content.getChildren()).toHaveLength(2);
    await press(setup, "ARROW_DOWN");
    expect(selected(setup, referencePathKey)).toBe(true);
    // This Reference points to an empty Collection: Enter must not invent children or navigate.
    await press(setup, "RETURN");
    expect(tree.content.getChildren()).toHaveLength(2);
    expect(setup.renderer.currentFocusedRenderable).toBe(tree);
    expect(setup.renderer.root.findDescendantById("collection-detail-pane")).toBeUndefined();
    await enterLive(setup, "agent-access-collection-details");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    await setup.flush();
    const actions = await palette(setup);
    const update = actions.options.find(
      (option) => option.value.id === "collection-check-updates",
    )?.value;
    expect(update).toMatchObject({ enabled: true });
    expect(update.description).toContain("child");
    expect(update.description).not.toContain("root");
    expect(contentLoads).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access Reader Update submits only its current Skill despite other changed Source paths", async () => {
  let snapshot = skillProjection();
  const revision = "d".repeat(40);
  const updates: Parameters<TuiCore["updateSkills"]>[1][] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(snapshot, {
          getWorkspace: async () => ({ value: snapshot, diagnostics: [] }),
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => ({
            address,
            name: address.path,
            description: "",
            rawText: `Body ${address.path}`,
            markdownText: `# ${address.path}\n\nBody ${address.path}`,
          }),
          checkUpdate: async (_environment: import("@skctl/core").CoreOptions, { source }) => ({
            value: {
              source,
              kind: "github",
              exactRevision: revision,
              baseline: "agent-reader-baseline",
              changed: snapshot.installedSkills.map((skill) => ({
                path: skill.address.path,
                name: skill.name,
                description: "",
              })),
              unchanged: [],
              removed: [],
              added: [],
            },
            diagnostics: [],
          }),
          updateSkills: async (_environment: import("@skctl/core").CoreOptions, request) => {
            updates.push(request);
            snapshot = {
              ...snapshot,
              installedSkills: snapshot.installedSkills.map((skill) =>
                request.paths.includes(skill.address.path)
                  ? { ...skill, owner: { ...skill.owner, relevantRemoteRevision: revision } }
                  : skill,
              ),
            };
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 40 },
  );
  try {
    await openAgentAccess(setup);
    await press(setup, "ARROW_RIGHT");
    await selectTreeName(setup, skillKey("reference"));
    await waitForBody(setup, "Body reference");
    await press(setup, "RETURN");
    await enterLive(setup, "reader-action-skill-check-updates");
    await setup.waitForFrame((frame) => frame.includes("Updated 1 Skill"), { maxPasses: 200 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      source: "team-main",
      paths: ["reference"],
      exactRevision: revision,
    });
    expect(updates[0]!.remove ?? []).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
function skillProjection() {
  const base = projection();
  if (base.effective.status !== "complete") throw new Error("expected complete projection");
  const third = {
    ...base.installedSkills[0]!,
    address: { source: "team-main", path: "third" },
    name: "third",
  };
  const installedSkills = [...base.installedSkills, third];
  return {
    ...base,
    installedSkills,
    effective: {
      ...base.effective,
      collectionsView: base.effective.collectionsView.map((collection) =>
        collection.id === "root"
          ? {
              ...collection,
              members: installedSkills.map((skill) => ({
                name: skill.name,
                address: skill.address,
                paths: [],
              })),
            }
          : collection,
      ),
    },
  };
}
const skillKey = (path: string) => JSON.stringify([rootPathKey, "skill", path, "team-main", path]);
async function selectTreeName(setup: Setup, key: string) {
  const name = live(setup, `${rowId(key)}-name`);
  await setup.mockMouse.click(name.screenX, name.screenY);
  await setup.flush();
  expect(selected(setup, key)).toBe(true);
}
test("RENDER Agent access Reader Details targets current B while global batch Actions retains checked A/C", async () => {
  const previews: {
    source: string;
    paths: readonly string[];
  }[] = [];
  const batches: Parameters<TuiCore["previewMembershipBatch"]>[1][] = [];
  let mutations = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(skillProjection(), {
          editMembers: async () => {
            mutations++;
            return {
              value: { level: "project", file: "skctl.jsonc", changed: true },
              diagnostics: [],
            };
          },
          previewMembershipBatch: async (
            _environment: import("@skctl/core").CoreOptions,
            request,
          ) => {
            batches.push(request);
            return {
              value: {
                kind: "membership-batch",
                collection: request.collection,
                decision: { kind: "direct", owner },
                additions: request.additions,
                removals: request.removals,
                affected: [],
                blockers: [],
                effectful: true,
                allowed: true,
              },
              diagnostics: [],
            };
          },
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => ({
            address,
            name: address.path,
            description: "",
            rawText: `Body ${address.path}`,
            markdownText: `# ${address.path}\n\nBody ${address.path}`,
          }),
          previewUninstall: async (_environment: import("@skctl/core").CoreOptions, request) => {
            previews.push(request);
            return {
              value: {
                kind: "uninstall",
                installed: request.paths.map((path) => ({ source: request.source, path })),
                directMemberships: [],
                disappearingSelectors: [],
                retainedSelectors: [],
                blockers: [],
                allowed: true,
              },
              diagnostics: [],
            };
          },
          uninstallSkills: async () => {
            mutations++;
            return { value: undefined, diagnostics: [] };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 144, height: 40 },
  );
  try {
    await openAgentAccess(setup);
    const inventory = await openAllInstalledSkills(setup);
    expect(inventory).toBeInstanceOf(SelectRenderable);
    await press(setup, " ");
    await press(setup, "ARROW_DOWN");
    await press(setup, "ARROW_DOWN");
    await press(setup, " ");
    // The checked set is A/C; entering Agent access must not repurpose it as current B.
    await enterLive(setup, "skills-view-tab-current-exposure");
    await setup.flush();
    await focusLive(setup, "current-exposure-browser");
    await press(setup, "ARROW_RIGHT");
    await selectTreeName(setup, skillKey("reference"));
    await waitForBody(setup, "Body reference");
    await press(setup, "RETURN");
    await openReaderTab(setup, 2);
    await enterLive(setup, "reader-details-manage");
    await enterLive(setup, "reader-details-action-skill-uninstall");
    await setup.waitFor(() => previews.length === 1);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("installed-skill-review-cancel"),
    );
    expect(previews).toEqual([{ source: "team-main", paths: ["reference"] }]);
    expect(mutations).toBe(0);
    await parsedEscape(setup);
    await setup.flush();
    const choices = await palette(setup);
    const current = choices.options.find(
      (option) => option.value.id === "skill-add-to-collection",
    )?.value;
    const batch = choices.options.find(
      (option) => option.value.id === "skill-add-selected-to-collection",
    )?.value;
    expect(current).toMatchObject({ enabled: true });
    expect(batch).toMatchObject({ enabled: true });
    expect(current.description ?? current.destination).toContain("reference");
    expect(batch.description ?? batch.destination).toContain("guide");
    expect(batch.description ?? batch.destination).toContain("third");
    expect(batch.description ?? batch.destination).not.toContain("reference");
    await choosePaletteAction(setup, choices, "skill-add-selected-to-collection");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-handoff-choice"),
    );
    const destinations = (await focusLive(setup, "collection-handoff-choice")) as SelectRenderable;
    const childIndex = destinations.options.findIndex((option) => option.name.includes("child"));
    expect(childIndex).toBeGreaterThanOrEqual(0);
    destinations.setSelectedIndex(childIndex);
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("membership-batch-review"));
    await enterLive(setup, "membership-batch-review");
    try {
      await setup.waitFor(() => batches.length === 1);
      await setup.waitFor(
        () => !!setup.renderer.root.findDescendantById("collection-review-choice"),
      );
    } catch (error) {
      console.error(
        "Membership preview",
        batches,
        setup.renderer.currentFocusedRenderable?.id,
        setup.captureCharFrame(),
      );
      throw error;
    }
    expect(batches[0]!.additions).toEqual([
      { name: "guide", address: { source: "team-main", path: "guide" } },
      { name: "third", address: { source: "team-main", path: "third" } },
    ]);
    expect(batches[0]!.removals).toEqual([]);
    expect(batches[0]!.collection).toBe("child");
    expect(mutations).toBe(0);
    await parsedEscape(setup);
    await setup.flush();
    await focusLive(setup, "current-exposure-browser");
    await selectTreeName(setup, rootPathKey);
    expect(
      setup.renderer.root.findDescendantById("reader-details-action-skill-uninstall"),
    ).toBeUndefined();
    const collectionActions = await palette(setup);
    expect(
      collectionActions.options.some(
        (option) => option.value.id === "skill-uninstall" && option.value.enabled,
      ),
    ).toBe(false);
    expect(
      collectionActions.options.some(
        (option) => option.value.id === "skill-add-to-collection" && option.value.enabled,
      ),
    ).toBe(false);
    expect(
      collectionActions.options.some(
        (option) => option.value.id === "skill-add-selected-to-collection" && option.value.enabled,
      ),
    ).toBe(true);
    expect(previews).toHaveLength(1);
    expect(mutations).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});
test("RENDER Agent access late A content cannot replace selected B or B's Reader action target", async () => {
  type LoadResult = Awaited<ReturnType<TuiCore["loadInstalledSkill"]>>;
  let resolveFirst!: (result: LoadResult) => void;
  const first = new Promise<LoadResult>((resolve) => {
    resolveFirst = resolve;
  });
  const reads: string[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(skillProjection(), {
          loadInstalledSkill: async (
            _environment: import("@skctl/core").CoreOptions,
            { address },
          ) => {
            reads.push(address.path);
            if (address.path === "guide") {
              if (reads.filter((path) => path === "guide").length === 1) return first;
              return {
                address,
                name: address.path,
                description: "",
                rawText: "Fresh A instructions",
                markdownText: "# A\n\nFresh A instructions",
              };
            }
            return {
              address,
              name: address.path,
              description: "",
              rawText: "Current B instructions",
              markdownText: "# B\n\nCurrent B instructions",
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
    await press(setup, "ARROW_RIGHT");
    await selectTreeName(setup, skillKey("guide"));
    await setup.waitFor(() => reads.length === 1);
    await selectTreeName(setup, skillKey("reference"));
    await setup.waitFor(() => reads.length === 2);
    await waitForBody(setup, "Current B instructions");
    resolveFirst({
      address: { source: "team-main", path: "guide" },
      name: "guide",
      description: "",
      rawText: "Late A instructions",
      markdownText: "# A\n\nLate A instructions",
    });
    await setup.flush();
    await settleHighlighting(setup.renderer.root);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Current B instructions");
    expect(setup.captureCharFrame()).not.toContain("Late A instructions");
    expect(selected(setup, skillKey("reference"))).toBe(true);
    const choices = await palette(setup);
    const current = choices.options.find(
      (option) => option.value.id === "skill-add-to-collection",
    )?.value;
    expect(current).toMatchObject({ enabled: true });
    expect(current.description ?? current.destination).toContain("reference");
    expect(reads).toEqual(["guide", "reference"]);
    await parsedEscape(setup);
    await setup.flush();
    await focusLive(setup, "current-exposure-browser");
    await selectTreeName(setup, skillKey("guide"));
    await waitForBody(setup, "Fresh A instructions");
    expect(setup.captureCharFrame()).not.toContain("Current B instructions");
    expect(setup.captureCharFrame()).not.toContain("Late A instructions");
    expect(reads).toEqual(["guide", "reference", "guide"]);
    const freshChoices = await palette(setup);
    const freshCurrent = freshChoices.options.find(
      (option) => option.value.id === "skill-add-to-collection",
    )?.value;
    expect(freshCurrent).toMatchObject({ enabled: true });
    expect(freshCurrent.description ?? freshCurrent.destination).toContain("guide");
    expect(freshCurrent.description ?? freshCurrent.destination).not.toContain("reference");
  } finally {
    setup.renderer.destroy();
  }
});
