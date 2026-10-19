import { expect, test } from "bun:test";

import { testEffects, directSourceCore, workspaceProjection } from "./direct-source.fixture";
const owner = { level: "project" as const, file: "skctl.jsonc", pointer: "/collections/team" };
const calls: unknown[] = [];
test("collection batch review passes its reviewed impact to editMembers once", async () => {
  calls.length = 0;
  const base = directSourceCore(workspaceProjection());
  const collections: typeof base = {
    ...base,
    previewMembershipBatch: async (_environment: import("@skctl/core").CoreOptions, request) => ({
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
    }),
    editMembers: async (_environment: import("@skctl/core").CoreOptions, request) => {
      calls.push({ method: "editMembers", request });
      return { value: { level: "project", file: owner.file, changed: true }, diagnostics: [] };
    },
  };
  const effects = testEffects({ ...base, ...collections });
  const review = await effects.previewCollection({
    kind: "membership-batch",
    level: "project",
    collection: "team",
    additions: [{ name: "guide", address: { source: "team-main", path: "guide" } }],
    removals: [],
  });
  if (review?.kind !== "membership-batch") throw new Error("Expected membership review");
  expect(await effects.confirmCollection(review)).toBe(true);
  expect(calls).toEqual([
    {
      method: "editMembers",
      request: {
        level: "project",
        collection: "team",
        additions: [{ name: "guide", address: { source: "team-main", path: "guide" } }],
        removals: [],
        reviewedAffected: [],
      },
    },
  ]);
});
test("batch review snapshots its intent before preview and confirms the same additions and removals", async () => {
  calls.length = 0;
  const base = directSourceCore(workspaceProjection());
  let resolvePreview!: (value: Awaited<ReturnType<typeof base.previewMembershipBatch>>) => void;
  let observed: Parameters<typeof base.previewMembershipBatch>[1] | undefined;
  const started = Promise.withResolvers<void>();
  const collections: typeof base = {
    ...base,
    previewMembershipBatch: (_environment: import("@skctl/core").CoreOptions, request) => {
      observed = request;
      started.resolve();
      return new Promise((resolve) => {
        resolvePreview = resolve;
      });
    },
    editMembers: async (_environment: import("@skctl/core").CoreOptions, request) => {
      calls.push({ method: "editMembers", request });
      return { value: { level: "project", file: owner.file, changed: true }, diagnostics: [] };
    },
  };
  const effects = testEffects({ ...base, ...collections });
  const additions = [{ name: "guide", address: { source: "team-main", path: "guide" } }];
  const removals = [{ name: "old", expectedAddress: { source: "team-main", path: "old" } }];
  const intent = {
    kind: "membership-batch" as const,
    level: "project" as const,
    collection: "team",
    additions,
    removals,
  };
  const pending = effects.previewCollection(intent);
  await started.promise;
  additions[0]!.name = "mutated-during-preview";
  removals[0]!.name = "mutated-during-preview";
  if (!observed) throw new Error("Expected preview request");
  expect(observed.additions[0]?.name).toBe("guide");
  expect(observed.removals[0]?.name).toBe("old");
  resolvePreview({
    value: {
      kind: "membership-batch",
      collection: "team",
      decision: { kind: "direct", owner },
      additions: observed.additions,
      removals: observed.removals,
      affected: [],
      blockers: [],
      effectful: true,
      allowed: true,
    },
    diagnostics: [],
  });
  const review = await pending;
  if (review?.kind !== "membership-batch") throw new Error("Expected membership review");
  additions[0]!.name = "mutated-after-preview";
  removals[0]!.name = "mutated-after-preview";
  expect(await effects.confirmCollection(review)).toBe(true);
  expect(calls).toEqual([
    {
      method: "editMembers",
      request: {
        level: "project",
        collection: "team",
        additions: [{ name: "guide", address: { source: "team-main", path: "guide" } }],
        removals: [{ name: "old", expectedAddress: { source: "team-main", path: "old" } }],
        reviewedAffected: [],
      },
    },
  ]);
  effects.teardown();
});
test("Use review commits through UseCapability and only the live review", async () => {
  calls.length = 0;
  const base = directSourceCore(workspaceProjection());
  const use: typeof base = {
    ...base,
    previewCollectionUse: async (_environment: import("@skctl/core").CoreOptions, request) => ({
      value: {
        kind: "collection-use",
        owner: { ...owner, pointer: "/use" },
        oldCollections: [],
        newCollections: request.collections,
        affectedSelectors: [],
        newlyExposed: [],
        removedAtOwner: [],
        retained: [],
        alternateOwners: [],
        currentComplete: true,
        proposedComplete: true,
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    }),
    setUse: async (_environment: import("@skctl/core").CoreOptions, request) => {
      calls.push({ method: "use.set", request });
      return {
        value: {
          level: "project",
          file: owner.file,
          changed: true,
          use: { before: [], after: [...request.collections] },
        },
        diagnostics: [],
      };
    },
  };
  const effects = testEffects({ ...base, ...use });
  const review = await effects.previewCollection({
    kind: "collection-use",
    level: "project",
    collections: ["team"],
  });
  if (review?.kind !== "collection-use") throw new Error("Expected Use review");
  expect(await effects.confirmCollection({ ...review })).toBe(false);
  expect(await effects.confirmCollection(review)).toBe(true);
  expect(calls).toEqual([
    { method: "use.set", request: { level: "project", collections: ["team"] } },
  ]);
});
test("collection creation bypasses preview and invokes create with its named request", async () => {
  calls.length = 0;
  const base = directSourceCore(workspaceProjection());
  const collections: typeof base = {
    ...base,
    createCollection: async (_environment: import("@skctl/core").CoreOptions, request) => {
      calls.push({ method: "create", request });
      return { value: { level: request.level, file: owner.file, changed: true }, diagnostics: [] };
    },
  };
  const effects = testEffects({ ...base, ...collections });
  expect(
    await effects.createCollection({
      kind: "collection-create",
      level: "project",
      collection: "new",
    }),
  ).toBe(true);
  expect(calls).toEqual([{ method: "create", request: { level: "project", collection: "new" } }]);
});
