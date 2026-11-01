import { expect, test } from "bun:test";
import { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { readerProjection } from "./installed-reader.fixture";
import { enterLive, parsedEnter, parsedEscape } from "./reader-test-controls";

function noUse(globalOnly = false, count = 3) {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete workspace");
  const owner = {
    level: globalOnly ? ("global" as const) : ("project" as const),
    file: "/config/skctl.jsonc",
    pointer: "/collections",
  };
  const collections = Array.from({ length: count }, (_, index) => `group-${index}`);
  const use: readonly string[] = [];
  return {
    ...base,
    configs: base.configs.filter((config) => !globalOnly || config.level === "global"),
    effective: {
      ...base.effective,
      managed: true,
      use,
      collections,
      collectionsView: collections.map((id) => ({
        id,
        declared: [{ ...owner, pointer: `${owner.pointer}/${id}` }],
        repository: { derived: false, producers: [] },
        members: [
          {
            name: "guide",
            address: base.installedSkills[0]!.address,
            paths: [
              {
                kind: "direct" as const,
                collection: id,
                entryName: "guide",
                owner: { ...owner, pointer: `${owner.pointer}/${id}/members/guide` },
              },
            ],
          },
        ],
        references: [],
        links: [],
      })),
    },
  };
}

for (const width of [120, 80, 43]) {
  test(`empty Agent catalog chooses Collections directly and cancels back at ${width} columns`, async () => {
    const snapshot = noUse();
    const setup = await testRender(
      () => <App core={directSourceCore(snapshot)} exit={() => {}} />,
      { width, height: 24 },
    );
    try {
      await openMainPage(setup, "agent");
      await setup.waitForFrame((frame) => frame.includes("Choose Collections for agents"));
      expect(setup.renderer.root.findDescendantById("agent-node-pane")).toBeUndefined();
      expect(setup.captureCharFrame()).not.toContain("expand/fold");
      const primary = setup.renderer.root.findDescendantById("skills-setup-primary")!;
      await setup.flush();
      await setup.mockMouse.click(primary.screenX + 2, primary.screenY);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
      const choices = setup.renderer.root.findDescendantById(
        "collection-use-values",
      ) as SelectRenderable;
      expect(choices.options.map((option) => option.value)).toEqual(snapshot.effective.collections);
      expect(choices.height).toBeLessThanOrEqual(8);
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
      );
      setup.resize(width === 43 ? 80 : 43, 24);
      await setup.renderOnce();
      await parsedEnter(setup);
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
      await parsedEnter(setup);
      await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
      await parsedEscape(setup);
      await setup.waitFor(
        () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
      );
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("many Collections reuse the native bounded selection list, not owner-specific recovery controls", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUse(false, 18))} exit={() => {}} />,
    { width: 80, height: 30 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "skills-setup-primary");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
    const choices = setup.renderer.root.findDescendantById(
      "collection-use-values",
    ) as SelectRenderable;
    expect(choices.options).toHaveLength(18);
    expect(choices.height).toBe(8);
    for (let i = 0; i < 17; i++) setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(choices.getSelectedOption()?.value).toBe("group-17");
  } finally {
    setup.renderer.destroy();
  }
});

test("global-only workspaces choose Collections at the existing global Config", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUse(true))} exit={() => {}} />,
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "skills-setup-primary");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
    await parsedEnter(setup);
    await setup.waitForFrame((frame) => frame.includes("Configuration: global"));
    expect(setup.renderer.root.findDescendantById("collection-use-values")).toBeDefined();
  } finally {
    setup.renderer.destroy();
  }
});

test("empty Collections guide member selection and may remain empty after cancellation", async () => {
  const base = noUse();
  const snapshot = {
    ...base,
    effective: {
      ...base.effective,
      collectionsView: base.effective.collectionsView.map((collection) => ({
        ...collection,
        members: [],
      })),
    },
  };
  let writes = 0;
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(snapshot, {
          editMembers: async () => {
            writes++;
            throw new Error("Cancellation must not write members");
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await setup.waitForFrame((frame) => frame.includes("Add Skills to a Collection"));
    await enterLive(setup, "skills-setup-primary");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    await enterLive(setup, "collection-add");
    await enterLive(setup, "collection-action-add-membership");
    await setup.waitForFrame((frame) => frame.includes("Add Skills to group-0"));
    await parsedEscape(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
    expect(writes).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("no Collections opens the existing create form without a navigation-only intermediate page", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(noUse(false, 0))} exit={() => {}} />,
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await setup.waitForFrame((frame) => frame.includes("Organize Skills into a Collection"));
    await enterLive(setup, "skills-setup-primary");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-create-id"));
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
    );
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection choice is reachable without a connected Agent", async () => {
  const base = noUse();
  const current = { ...base, effective: { ...base.effective, managed: false } };
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(current, {
          getWorkspace: async () => ({ value: current, diagnostics: [] }),
        })}
        exit={() => {}}
      />
    ),
    { width: 120, height: 30 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "skills-setup-primary");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
    await parsedEnter(setup);
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-use-values"));
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "skills-setup-primary",
    );
    expect(setup.captureCharFrame()).toContain("Choose Collections for agents");
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection choice previews only checked roots and returns to the catalog without enabling inherited integration again", async () => {
  let current = noUse();
  const written: unknown[] = [];
  const setup = await testRender(
    () => (
      <App
        core={directSourceCore(current, {
          getWorkspace: async () => ({ value: current, diagnostics: [] }),
          setUse: async (_options, request) => {
            written.push(request);
            current = {
              ...current,
              effective: {
                ...current.effective,
                use: request.collections,
                agent: { ...current.effective.agent, status: "available" },
              },
            };
            return {
              value: {
                level: request.level,
                file: "/project/skctl.jsonc",
                changed: true,
                use: { before: [], after: [...request.collections] },
              },
              diagnostics: [],
            };
          },
        })}
        exit={() => {}}
      />
    ),
    { width: 100, height: 24 },
  );
  try {
    await openMainPage(setup, "agent");
    await enterLive(setup, "skills-setup-primary");
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "scope-choices");
    await parsedEnter(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-use-values",
    );
    await setup.mockInput.typeText(" ");
    await enterLive(setup, "collection-use-review");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-review-confirm"),
    );
    expect(written).toEqual([]);
    await setup.waitForFrame((frame) => frame.includes("New: group-0"));
    await enterLive(setup, "collection-review-confirm");
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    expect(written).toEqual([{ level: "project", collections: ["group-0"] }]);
    expect(setup.renderer.root.findDescendantById("skills-setup-pane")).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
