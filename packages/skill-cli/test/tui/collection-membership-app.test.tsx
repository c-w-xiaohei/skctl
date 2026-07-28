import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ManagementProjection, OperationResult } from "../../src/core/api";
import { App } from "../../src/tui/app";
import { directSourceCore, workspaceProjection } from "./direct-source.fixture";

const result = <T,>(value: T): OperationResult<T> => ({ value, diagnostics: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("Workspace Collection create selects a level, blocks duplicate submit, and reselects after refresh", async () => {
  const writing =
    deferred<OperationResult<{ readonly level: "global"; readonly changed: boolean }>>();
  const changes: unknown[] = [];
  let refreshes = 0;
  const projection = workspaceProjection();
  if (projection.effective.status !== "complete") throw new Error("expected complete fixture");
  const effective = projection.effective;
  const created: ManagementProjection = {
    ...projection,
    effective: {
      ...effective,
      collections: ["team"],
      collectionsView: [
        {
          id: "team",
          declared: [{ level: "global", file: "/global.jsonc", pointer: "/collections/team" }],
          repository: { derived: false, producers: [] },
          members: [],
          references: [],
          links: [],
        },
      ],
    },
  };
  const base = directSourceCore(projection);
  const core = {
    ...base,
    workspace: {
      get: async () => {
        refreshes++;
        return result(created);
      },
    },
    configuration: {
      ...base.configuration,
      change: (change: Parameters<typeof base.configuration.change>[0]) => {
        changes.push(change);
        return writing.promise;
      },
    },
  };
  const setup = await testRender(() => <App core={core} exit={() => {}} />, {
    width: 120,
    height: 40,
  });
  try {
    await setup.waitForFrame((frame) => frame.includes("Installed Skills"));
    setup.renderer.root.findDescendantById("workspace-section-browser")?.focus();
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "collection-browser");
    setup.mockInput.pressKey("P", { ctrl: true });
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable?.id === "palette-menu");
    for (let index = 0; index < 4; index++) setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-level",
    );
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-id",
    );
    await setup.mockInput.typeText("team");
    setup.mockInput.pressKey("TAB");
    await setup.waitFor(
      () => setup.renderer.currentFocusedRenderable?.id === "collection-create-choice",
    );
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    setup.mockInput.pressEnter();
    expect(changes).toEqual([{ type: "collection.create", level: "global", collection: "team" }]);
    expect(changes).toHaveLength(1);
    writing.resolve(result({ level: "global", changed: true }));
    await setup.waitForFrame((frame) => frame.includes("team"));
    expect(refreshes).toBe(2);
  } finally {
    setup.renderer.destroy();
  }
});
