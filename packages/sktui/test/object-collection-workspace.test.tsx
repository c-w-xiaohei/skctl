/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app";
import { openMainPage } from "./main-page-controls";
import { directSourceCore } from "./direct-source.fixture";
import { collectionsSourcesProjection } from "./collections-sources-operate.fixture";
import { collectionFilterPathKey } from "../src/collections/collection-filter-tree";
import { parsedEnter, parsedEscape, focusLive } from "./reader-test-controls";

type Setup = Awaited<ReturnType<typeof testRender>>;

async function clickVisible(setup: Setup, id: string) {
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById(id));
  const control = setup.renderer.root.findDescendantById(id)!;
  expect(control.width).toBeGreaterThan(0);
  expect(control.height).toBeGreaterThan(0);
  await setup.mockMouse.click(control.screenX + 1, control.screenY);
  await setup.flush();
}

async function openCollection(setup: Setup) {
  await openMainPage(setup, "collections");
  const key = collectionFilterPathKey({ segments: [{ collection: "team" }] });
  await clickVisible(setup, `collection-browser-row-${encodeURIComponent(key)}`);
  await parsedEnter(setup);
  await setup.waitFor(() => !!setup.renderer.root.findDescendantById("collection-detail-pane"));
  await setup.flush();
}

function projection() {
  const workspace = collectionsSourcesProjection();
  if (workspace.effective.status !== "complete") throw new Error("Expected complete fixture");
  return {
    ...workspace,
    effective: {
      ...workspace.effective,
      collections: ["team", "docs"],
      collectionsView: workspace.effective.collectionsView.filter((item) =>
        ["team", "docs"].includes(item.id),
      ),
    },
  };
}

test("Collection workspace exposes member tasks and stable views without per-row management", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await openCollection(setup);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Contents");
    expect(frame).toContain("Instructions");
    expect(frame).toContain("Settings");
    expect(frame).toContain("Add…");
    expect(frame).toContain("More…");
    expect(frame).not.toContain("Manage…");
    await clickVisible(setup, "collection-more");
    expect(setup.captureCharFrame()).toContain("Details…");
  } finally {
    setup.renderer.destroy();
  }
});

test("Collection Settings is reachable through its visible tab and exposes declaration management", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openCollection(setup);
    await clickVisible(setup, "collection-tabs-tab-settings");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Configuration details");
    expect(frame).toContain("Include Collection");
    expect(frame).toContain("Copy Skills");
    expect(frame).not.toContain("Remove declaration");
    await clickVisible(setup, "collection-configuration-details");
    expect(setup.captureCharFrame()).toContain("Remove declaration");
  } finally {
    setup.renderer.destroy();
  }
});

test("Settings previews removal of the selected declaration owner", async () => {
  const workspace = projection();
  if (workspace.effective.status !== "complete") throw new Error("Expected complete fixture");
  const globalOwner = {
    level: "global" as const,
    file: "/home/test/skctl.jsonc",
    pointer: "/collections/team",
  };
  const team = workspace.effective.collectionsView.find((item) => item.id === "team")!;
  const input = {
    ...workspace,
    configs: workspace.configs.map((config) =>
      config.level === "global"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: [...config.direct.collections, { id: "team", owner: globalOwner }],
            },
          }
        : config,
    ),
    effective: {
      ...workspace.effective,
      collectionsView: workspace.effective.collectionsView.map((item) =>
        item.id === "team" ? { ...item, declared: [...team.declared, globalOwner] } : item,
      ),
    },
  };
  const previews: unknown[] = [];
  const core = directSourceCore(input, {
    previewCollectionRemoval: async (_environment, request) => {
      previews.push(request);
      return {
        value: {
          kind: "collection-removal",
          owner: globalOwner,
          decision: { kind: "direct", owner: globalOwner },
          repository: { derived: false, producers: [] },
          disappearingSelectors: [],
          retainedSelectors: [],
          blockers: [],
          allowed: true,
        },
        diagnostics: [],
      };
    },
  });
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await openCollection(setup);
    await clickVisible(setup, "collection-tabs-tab-settings");
    const key = encodeURIComponent(
      `${globalOwner.level}:${globalOwner.file}:${globalOwner.pointer}`,
    );
    await clickVisible(setup, "collection-configuration-details");
    await clickVisible(setup, `collection-remove-declaration-${key}`);
    await setup.waitFor(() => previews.length === 1);
    expect(previews[0]).toMatchObject({ level: "global", collection: "team" });
  } finally {
    setup.renderer.destroy();
  }
});

test("Settings Actions does not offer commands for an unselected relationship", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(projection())} exit={() => {}} />,
    { width: 120, height: 30 },
  );
  try {
    await openCollection(setup);
    await clickVisible(setup, "collection-tabs-tab-settings");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const ids = choices.options.map((option) => option.value.id);
    expect(ids).not.toContain("relationship.open-collection");
    expect(ids).not.toContain("relationship.remove-reference");
  } finally {
    setup.renderer.destroy();
  }
});

test("Back from a Settings relationship returns focus to the inspected relationship", async () => {
  const workspace = projection();
  const controlId = "collection-current-details";
  const setup = await testRender(() => <App core={directSourceCore(workspace)} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await openCollection(setup);
    setup.renderer.root.findDescendantById("collection-relationships")!.focus();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    await setup.flush();
    await clickVisible(setup, "collection-more");
    await clickVisible(setup, controlId);
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-relation-inspector"),
    );
    await parsedEscape(setup);
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-relationships",
    );
    expect(setup.captureCharFrame()).toContain("docs");
  } finally {
    setup.renderer.destroy();
  }
});

test("Description and Settings restore their own scroll positions after switching views", async () => {
  const workspace = projection();
  if (workspace.effective.status !== "complete") throw new Error("Expected complete fixture");
  const input = {
    ...workspace,
    effective: {
      ...workspace.effective,
      collectionsView: workspace.effective.collectionsView.map((item) =>
        item.id !== "team"
          ? item
          : {
              ...item,
              instructions: Array.from(
                { length: 50 },
                (_, index) => `Instruction line ${index}`,
              ).join("\n"),
              declared: Array.from({ length: 15 }, (_, index) => ({
                ...item.declared[0]!,
                pointer: `/collections/team-${index}`,
              })),
            },
      ),
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(input)} exit={() => {}} />, {
    width: 80,
    height: 24,
  });
  try {
    await openCollection(setup);
    await clickVisible(setup, "collection-tabs-tab-description");
    const description = setup.renderer.root.findDescendantById(
      "collection-description",
    ) as ScrollBoxRenderable;
    for (let i = 0; i < 5; i++)
      await setup.mockMouse.scroll(
        description.viewport.screenX + 2,
        description.viewport.screenY + 1,
        "down",
      );
    await setup.flush();
    const descriptionOffset = description.scrollTop;
    expect(descriptionOffset).toBeGreaterThan(0);
    await clickVisible(setup, "collection-tabs-tab-settings");
    await clickVisible(setup, "collection-configuration-details");
    const settings = setup.renderer.root.findDescendantById(
      "collection-settings",
    ) as ScrollBoxRenderable;
    await focusLive(setup, "collection-settings");
    setup.mockInput.pressKey("END");
    await setup.flush();
    const settingsOffset = settings.scrollTop;
    expect(settingsOffset).toBeGreaterThan(0);
    await clickVisible(setup, "collection-tabs-tab-description");
    expect(
      (setup.renderer.root.findDescendantById("collection-description") as ScrollBoxRenderable)
        .scrollTop,
    ).toBe(descriptionOffset);
    await clickVisible(setup, "collection-tabs-tab-settings");
    expect(
      (setup.renderer.root.findDescendantById("collection-settings") as ScrollBoxRenderable)
        .scrollTop,
    ).toBe(settingsOffset);
  } finally {
    setup.renderer.destroy();
  }
});

test("Removing a linked member identifies the owning Link and its full scope in Actions", async () => {
  const workspace = projection();
  if (workspace.effective.status !== "complete") throw new Error("Expected complete fixture");
  const team = workspace.effective.collectionsView.find((item) => item.id === "team")!;
  const input = {
    ...workspace,
    effective: {
      ...workspace.effective,
      collectionsView: workspace.effective.collectionsView.map((item) =>
        item.id !== "team"
          ? item
          : {
              ...item,
              members: [
                {
                  ...team.members[0]!,
                  paths: [
                    {
                      kind: "via-link" as const,
                      links: [
                        { collection: "team", linkedCollection: "docs", owner: team.declared[0]! },
                      ],
                    },
                  ],
                },
              ],
            },
      ),
    },
  };
  const setup = await testRender(() => <App core={directSourceCore(input)} exit={() => {}} />, {
    width: 120,
    height: 30,
  });
  try {
    await openCollection(setup);
    expect(setup.captureCharFrame()).not.toContain("Remove Link");
    setup.mockInput.pressKey("p", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-choices");
    const choices = setup.renderer.currentFocusedRenderable as SelectRenderable;
    const command = choices.options.find(
      (option) => option.value.id === "membership.unlink",
    )?.value;
    expect(command).toBeUndefined();
  } finally {
    setup.renderer.destroy();
  }
});
