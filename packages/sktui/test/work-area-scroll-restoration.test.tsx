import { expect, test } from "bun:test";
import { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { WorkspaceView } from "@skctl/core";
import { App } from "../src/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";
import { enterLive, focusLive, parsedEscape } from "./reader-test-controls";

function exposureProjection(): WorkspaceView {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("expected complete fixture");
  const owner = {
    level: "project" as const,
    file: "/workspace/skctl/skctl.jsonc",
    pointer: "/collections/root",
  };
  const collections = Array.from({ length: 41 }, (_, index) => ({
    id: index === 0 ? "root" : `root-${index}`,
    declared: [owner],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  }));
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collectionUse: [{ collection: "root", owner }],
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      managed: true,
      agent: { ...base.effective.agent, status: "available" },
      use: ["root"],
      collections: collections.map((collection) => collection.id),
      collectionsView: [
        {
          ...collections[0]!,
          references: Array.from({ length: 13 }, (_, index) => ({
            name: `child-${index}`,
            collection: `root-${index + 1}`,
            description: `Child ${index}`,
            owner,
          })),
        },
        ...collections.slice(1),
      ],
    },
  };
}

test("RENDER Current Exposure restores its native path, offset, and browser focus after Collection route return", async () => {
  const setup = await testRender(
    () => <App core={directSourceCore(exposureProjection())} exit={() => {}} />,
    { width: 120, height: 24 },
  );
  try {
    await setup.flush();
    const browser = (await focusLive(setup, "current-exposure-browser")) as ScrollBoxRenderable;
    setup.mockInput.pressArrow("right");
    await setup.flush();
    for (let index = 0; index < 9; index++) {
      setup.mockInput.pressArrow("down");
      await setup.flush();
    }
    const title = (setup.renderer.root.findDescendantById("agent-node-title") as TextRenderable)
      .plainText;
    const scroll = browser.scrollTop;
    await enterLive(setup, "agent-access-collection-details");
    await setup.waitFor(
      () => !!setup.renderer.root.findDescendantById("collection-tabs-tab-entries"),
    );
    expect(!!setup.renderer.root.findDescendantById("current-exposure-browser")).toBe(false);
    await parsedEscape(setup);
    await setup.flush();
    await setup.waitFor(() => !!setup.renderer.root.findDescendantById("current-exposure-browser"));
    const restored = setup.renderer.root.findDescendantById(
      "current-exposure-browser",
    ) as ScrollBoxRenderable;
    expect(restored.scrollTop).toBe(scroll);
    expect(
      (setup.renderer.root.findDescendantById("agent-node-title") as TextRenderable).plainText,
    ).toBe(title);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("agent-access-collection-details");
  } finally {
    setup.renderer.destroy();
  }
});
