/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { type BaseRenderable } from "@opentui/core";
import { ButtonRenderable } from "@tuiparts/core/button";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSkillCliCore } from "../../skill-core/src/create-core";
import { App } from "../src/app";
import { enterLive, focusLive } from "./reader-test-controls";

function findManage(root: BaseRenderable): ButtonRenderable | undefined {
  for (const child of root.getChildren()) {
    if (
      child instanceof ButtonRenderable &&
      child.id.includes("guide") &&
      child.id.includes(".manage")
    )
      return child;
    const nested = findManage(child);
    if (nested) return nested;
  }
}

for (const entry of ["single", "checked", "stale-address"] as const) {
  test(`real Core ${entry} Membership preview resolves member origin to declaration owner without writes`, async () => {
    await mkdir("/tmp/opencode", { recursive: true });
    const root = await mkdtemp("/tmp/opencode/real-membership-preview-");
    const priorState = process.env.SKILL_CLI_STATE_DIR;
    const priorCache = process.env.SKILL_TUI_UPDATE_CACHE_DIR;
    process.env.SKILL_CLI_STATE_DIR = join(root, "state");
    process.env.SKILL_TUI_UPDATE_CACHE_DIR = join(root, "update-cache");
    let setup: Awaited<ReturnType<typeof testRender>> | undefined;
    try {
      await writeFile(join(root, "skill-cli.jsonc"), "{}\n");
      const local = join(root, "local");
      await mkdir(join(local, "guide"), { recursive: true });
      await writeFile(
        join(local, "guide", "SKILL.md"),
        "---\nname: guide\ndescription: Isolated membership preview\n---\n# Guide\n",
      );
      const core = createSkillCliCore({ cwd: root, userConfigPath: join(root, "user.jsonc") });
      await core.configuration.change({
        type: "source.register",
        level: "project",
        id: "local-team",
        binding: { kind: "local", path: local, root: "" },
      });
      await core.management.install({ source: "local-team", paths: ["guide"] });
      await core.configuration.change({
        type: "collection.create",
        level: "project",
        collection: "team",
      });
      await core.configuration.change({
        type: "collection.member.set",
        level: "project",
        collection: "team",
        name: "guide",
        address: { source: "local-team", path: "guide" },
      });
      const workspace = (await core.workspace.get()).value;
      if (workspace.effective.status !== "complete")
        throw new Error("Expected complete real fixture");
      const collection = workspace.effective.collectionsView.find((item) => item.id === "team")!;
      const origin = collection.members[0]!.paths.find((path) => path.kind === "direct")!;
      expect(origin.kind === "direct" && origin.owner?.pointer).toBe(
        "/collections/team/members/guide",
      );
      expect(collection.declared[0]!.pointer).toBe("/collections/team");
      let config = await readFile(join(root, "skill-cli.jsonc"));
      const state = await readFile(join(root, "state", "state.json"));
      const requests: unknown[] = [];
      const allowed: boolean[] = [];
      let previewFinished!: () => void;
      const previewDone = new Promise<void>((resolve) => {
        previewFinished = resolve;
      });
      let writes = 0;
      let workspaceFinished!: () => void;
      const workspaceDone = new Promise<void>((resolve) => {
        workspaceFinished = resolve;
      });
      const traced = {
        ...core,
        workspace: {
          get: async (...args: Parameters<typeof core.workspace.get>) => {
            try {
              return await core.workspace.get(...args);
            } finally {
              workspaceFinished();
            }
          },
        },
        configuration: {
          ...core.configuration,
          change: async () => {
            writes++;
            throw new Error("Preview/cancel must not mutate the real fixture");
          },
          previewMembershipBatch: async (
            ...args: Parameters<typeof core.configuration.previewMembershipBatch>
          ) => {
            requests.push(args[0]);
            try {
              const receipt = await core.configuration.previewMembershipBatch(...args);
              allowed.push(receipt.value.allowed);
              return receipt;
            } finally {
              previewFinished();
            }
          },
        },
      };
      setup = await testRender(() => <App core={traced} exit={() => {}} />, {
        width: 144,
        height: 40,
      });
      await workspaceDone;
      await setup.flush();
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("shell-section-tab-collections"),
      );
      await enterLive(setup, "shell-section-tab-collections");
      await setup.waitFor(() => setup!.captureCharFrame().includes("C team"));
      await enterLive(setup, "collection-browser");
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("collection-relationships"),
      );
      await setup.flush();
      if (entry !== "checked") {
        const manage = findManage(setup.renderer.root);
        expect(manage).toBeDefined();
        await enterLive(setup, manage!.id);
        if (entry === "stale-address") {
          // An isolated competing edit after display, not a TUI write.
          await core.configuration.change({
            type: "collection.member.remove",
            level: "project",
            collection: "team",
            name: "guide",
            expectedAddress: { source: "local-team", path: "guide" },
          });
          await core.configuration.change({
            type: "collection.member.set",
            level: "project",
            collection: "team",
            name: "guide",
            address: { source: "local-team", path: "replacement" },
          });
          config = await readFile(join(root, "skill-cli.jsonc"));
        }
        await enterLive(setup, "membership.remove");
      } else {
        await focusLive(setup, "collection-relationships");
        await setup.mockInput.typeText(" ");
        await setup.flush();
        await enterLive(setup, "remove-from-collection");
        await enterLive(setup, "membership-removal-plan-continue");
      }
      await previewDone;
      await setup.flush();
      await setup.waitFor(
        () => !!setup!.renderer.root.findDescendantById("collection-review-choice"),
      );
      await setup.flush();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        level: "project",
        collection: "team",
        additions: [],
        removals: [{ name: "guide", expectedAddress: { source: "local-team", path: "guide" } }],
        expectedOwner: collection.declared[0],
      });
      expect(allowed).toEqual([entry !== "stale-address"]);
      if (entry === "stale-address") {
        expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
        expect(setup.captureCharFrame()).toContain("Operation is blocked");
      } else
        expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeDefined();
      expect(setup.captureCharFrame()).toContain("Remove: guide local-team/guide");
      expect(setup.captureCharFrame()).toContain("/collections/team");
      await enterLive(setup, "collection-review-choice");
      await setup.flush();
      expect(setup.renderer.root.findDescendantById("collection-review-confirm")).toBeUndefined();
      if (entry !== "checked") {
        expect(setup.renderer.currentFocusedRenderable?.id).toBe("membership.remove");
        expect(
          setup.renderer.root.findDescendantById("collection-membership-inspector"),
        ).toBeDefined();
      } else {
        expect(
          setup.renderer.root.findDescendantById("collection-relationships-row-guide%3A0"),
        ).toBeDefined();
        expect(setup.captureCharFrame()).toContain("1 origins checked");
      }
      expect(writes).toBe(0);
      expect((await readFile(join(root, "skill-cli.jsonc"))).equals(config)).toBe(true);
      expect((await readFile(join(root, "state", "state.json"))).equals(state)).toBe(true);
    } catch (error) {
      if (setup) console.error(setup.captureCharFrame());
      throw error;
    } finally {
      setup?.renderer.destroy();
      if (priorState === undefined) delete process.env.SKILL_CLI_STATE_DIR;
      else process.env.SKILL_CLI_STATE_DIR = priorState;
      if (priorCache === undefined) delete process.env.SKILL_TUI_UPDATE_CACHE_DIR;
      else process.env.SKILL_TUI_UPDATE_CACHE_DIR = priorCache;
    }
  });
}
