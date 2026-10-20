/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { type BaseRenderable } from "@opentui/core";
import { ButtonRenderable } from "@tuiparts/core/button";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as api from "@skctl/core";
import { App } from "../src/app";
import { testEffects } from "./direct-source.fixture";
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
    const priorState = process.env.SKCTL_STATE_DIR;
    const priorCache = process.env.SKTUI_UPDATE_SCHEDULE_DIR;
    process.env.SKCTL_STATE_DIR = join(root, "state");
    process.env.SKTUI_UPDATE_SCHEDULE_DIR = join(root, "update-schedule");
    let setup: Awaited<ReturnType<typeof testRender>> | undefined;
    try {
      await writeFile(join(root, "skctl.jsonc"), "{}\n");
      const local = join(root, "local");
      await mkdir(join(local, "guide"), { recursive: true });
      await writeFile(
        join(local, "guide", "SKILL.md"),
        "---\nname: guide\ndescription: Isolated membership preview\n---\n# Guide\n",
      );
      const environment = { cwd: root, userConfigPath: join(root, "user.jsonc") };
      const core = api;
      await core.registerSource(environment, {
        level: "project",
        id: "local-team",
        binding: { kind: "local", path: local, root: "" },
      });
      await core.installSkills(environment, { source: "local-team", paths: ["guide"] });
      await core.createCollection(environment, { level: "project", collection: "team" });
      await core.addMember(environment, {
        level: "project",
        collection: "team",
        name: "guide",
        address: { source: "local-team", path: "guide" },
      });
      const workspace = (await core.getWorkspace(environment)).value;
      if (workspace.effective.status !== "complete")
        throw new Error("Expected complete real fixture");
      const collection = workspace.effective.collectionsView.find((item) => item.id === "team")!;
      const origin = collection.members[0]!.paths.find((path) => path.kind === "direct")!;
      expect(origin.kind === "direct" && origin.owner?.pointer).toBe(
        "/collections/team/members/guide",
      );
      expect(collection.declared[0]!.pointer).toBe("/collections/team");
      let config = await readFile(join(root, "skctl.jsonc"));
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
      const traced: import("../src/session").TuiCore = {
        ...core,
        getWorkspace: async (...args: Parameters<typeof core.getWorkspace>) => {
          try {
            return await core.getWorkspace(...args);
          } finally {
            workspaceFinished();
          }
        },
        setUse: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        setManagedOpenCode: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        removeSource: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        uninstallSkills: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        removeConfig: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        createCollection: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        removeCollection: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        editMembers: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        addMember: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        removeMember: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        importMembers: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        addReference: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        removeReference: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        setLink: async () => {
          writes++;
          throw new Error("Preview/cancel must not mutate the real fixture");
        },
        previewMembershipBatch: async (...args: Parameters<typeof core.previewMembershipBatch>) => {
          requests.push(args[1]);
          try {
            const receipt = await core.previewMembershipBatch(...args);
            allowed.push(receipt.value.allowed);
            return receipt;
          } finally {
            previewFinished();
          }
        },
      };
      setup = await testRender(
        () => <App core={traced} environment={environment} exit={() => {}} />,
        {
          width: 144,
          height: 40,
        },
      );
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
          await core.removeMember(environment, {
            level: "project",
            collection: "team",
            name: "guide",
            expectedAddress: { source: "local-team", path: "guide" },
          });
          await core.addMember(environment, {
            level: "project",
            collection: "team",
            name: "guide",
            address: { source: "local-team", path: "replacement" },
          });
          config = await readFile(join(root, "skctl.jsonc"));
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
      expect((await readFile(join(root, "skctl.jsonc"))).equals(config)).toBe(true);
      expect((await readFile(join(root, "state", "state.json"))).equals(state)).toBe(true);
    } catch (error) {
      if (setup) console.error(setup.captureCharFrame());
      throw error;
    } finally {
      setup?.renderer.destroy();
      if (priorState === undefined) delete process.env.SKCTL_STATE_DIR;
      else process.env.SKCTL_STATE_DIR = priorState;
      if (priorCache === undefined) delete process.env.SKTUI_UPDATE_SCHEDULE_DIR;
      else process.env.SKTUI_UPDATE_SCHEDULE_DIR = priorCache;
    }
  });
}
test("real Core batch preview and confirm accept NFC-equivalent names and write the canonical name", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/real-membership-nfc-");
  const priorState = process.env.SKCTL_STATE_DIR;
  process.env.SKCTL_STATE_DIR = join(root, "state");
  try {
    await writeFile(join(root, "skctl.jsonc"), "{}\n");
    const local = join(root, "local");
    await mkdir(join(local, "guide"), { recursive: true });
    await writeFile(
      join(local, "guide", "SKILL.md"),
      "---\nname: guide\ndescription: NFC test\n---\n# Guide\n",
    );
    const environment = { cwd: root, userConfigPath: join(root, "user.jsonc") };
    const core = api;
    await core.registerSource(environment, {
      level: "project",
      id: "local-team",
      binding: { kind: "local", path: local, root: "" },
    });
    await core.installSkills(environment, { source: "local-team", paths: ["guide"] });
    await core.createCollection(environment, { level: "project", collection: "team" });
    const decomposed = "cafe\u0301";
    const canonical = decomposed.normalize("NFC");
    const effects = testEffects(core, environment);
    try {
      const review = await effects.previewCollection({
        kind: "membership-batch",
        level: "project",
        collection: "team",
        additions: [{ name: decomposed, address: { source: "local-team", path: "guide" } }],
        removals: [],
      });
      expect(review?.kind).toBe("membership-batch");
      if (review?.kind !== "membership-batch") throw new Error("Expected batch membership review");
      expect(review.impact.allowed).toBe(true);
      expect(await effects.confirmCollection(review)).toBe(true);
      const workspace = (await core.getWorkspace(environment)).value;
      const collection =
        workspace.effective.status === "complete"
          ? workspace.effective.collectionsView.find((item) => item.id === "team")
          : undefined;
      expect(collection?.members).toContainEqual(expect.objectContaining({ name: canonical }));
      expect(collection?.members).not.toContainEqual(expect.objectContaining({ name: decomposed }));
    } finally {
      effects.teardown();
    }
  } finally {
    if (priorState === undefined) delete process.env.SKCTL_STATE_DIR;
    else process.env.SKCTL_STATE_DIR = priorState;
  }
});
