import { expect, test } from "bun:test";
import { SkillCliError, type ConfigurationCapability } from "@skill-cli/core";
import {
  directSourceCore,
  testEffects as createTuiEffects,
  workspaceProjection,
} from "./direct-source.fixture";

const configuration = (overrides: Partial<ConfigurationCapability>): ConfigurationCapability => ({
  change: async () => ({ value: { level: "project", changed: true }, diagnostics: [] }),
  previewMembershipBatch: async (request) => ({
    value: {
      kind: "membership-batch",
      collection: request.collection,
      decision: {
        kind: "direct",
        owner: {
          level: request.level ?? "project",
          file: "skill-cli.jsonc",
          pointer: "/collections/team",
        },
      },
      additions: request.additions,
      removals: request.removals,
      affected: [],
      blockers: [],
      effectful: true,
      allowed: true,
    },
    diagnostics: [],
  }),
  previewAddToCollection: async (request) => ({
    value: {
      kind: "add-to-collection",
      collection: request.collection,
      address: request.address,
      decision: {
        kind: "direct",
        owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      },
      intent: {
        owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
        stableEntryName: request.name,
        address: request.address,
      },
      existing: [],
      blockers: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  previewMembershipRemoval: async () => ({
    value: {
      kind: "membership-removal",
      collection: "team",
      name: "review",
      decision: {
        kind: "direct",
        owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      },
      affected: [],
      retained: [],
      disappearing: [],
      linkActions: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  previewImport: async (request) => ({
    value: {
      kind: "collection-import",
      source: "from",
      destination: request.into,
      owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      additions: [],
      skipped: [],
      conflicts: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  previewReference: async () => ({
    value: {
      kind: "reference",
      collection: "team",
      name: "docs",
      referencedCollection: "docs",
      description: "Docs",
      owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      decision: {
        kind: "direct",
        owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      },
      exposure: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  previewLinkChange: async (request) => ({
    value: {
      kind: "link-change",
      collection: request.collection,
      target: request.target,
      owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      linked: request.linked,
      members: [],
      disappearingSelectors: [],
      retainedSelectors: [],
      blockers: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  previewCollectionUse: async (request) => ({
    value: {
      kind: "collection-use",
      owner: { level: request.level, file: "skill-cli.jsonc", pointer: "/use" },
      oldCollections: [],
      newCollections: request.collections,
      affectedSelectors: [],
      newlyExposed: [],
      removedAtOwner: [],
      retained: [],
      alternateOwners: [],
      currentComplete: false,
      proposedComplete: true,
      blockers: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  previewCollectionRemoval: async (request) => ({
    value: {
      kind: "collection-removal",
      owner: { level: request.level, file: "skill-cli.jsonc", pointer: "/collections/team" },
      decision: {
        kind: "direct",
        owner: { level: request.level, file: "skill-cli.jsonc", pointer: "/collections/team" },
      },
      repository: { derived: false, producers: [] },
      disappearingSelectors: [],
      retainedSelectors: [],
      blockers: [],
      allowed: true,
    },
    diagnostics: [],
  }),
  ...overrides,
});

test("membership batch previews and publishes one atomic same-owner delta", async () => {
  const calls: unknown[] = [];
  const affected = [
    { selector: "linked:review", address: { source: "team-main", path: "review" }, paths: [] },
  ];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewMembershipBatch: async (request) => {
          calls.push(["preview", request]);
          const result = await configuration({}).previewMembershipBatch(request);
          return { ...result, value: { ...result.value, affected } };
        },
        change: async (change) => {
          calls.push(["change", change]);
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
      get: async () => {
        calls.push(["workspace"]);
        return { value: workspaceProjection(), diagnostics: [] };
      },
    }),
  );
  const review = await effects.previewMembershipBatch({
    kind: "membership-batch",
    level: "project",
    collection: "team",
    additions: [
      { name: "review", address: { source: "team-main", path: "review" } },
      { name: "reference", address: { source: "team-main", path: "reference" } },
    ],
    removals: [{ name: "old", expectedAddress: { source: "team-main", path: "old" } }],
  });
  expect(review?.kind).toBe("membership-batch");
  if (review?.kind === "membership-batch")
    expect(await effects.confirmCollection(review)).toBe(true);
  expect(calls).toEqual([
    [
      "preview",
      {
        level: "project",
        collection: "team",
        additions: [
          { name: "review", address: { source: "team-main", path: "review" } },
          { name: "reference", address: { source: "team-main", path: "reference" } },
        ],
        removals: [{ name: "old", expectedAddress: { source: "team-main", path: "old" } }],
      },
    ],
    [
      "change",
      {
        type: "collection.members.change",
        level: "project",
        collection: "team",
        additions: [
          { name: "review", address: { source: "team-main", path: "review" } },
          { name: "reference", address: { source: "team-main", path: "reference" } },
        ],
        removals: [{ name: "old", expectedAddress: { source: "team-main", path: "old" } }],
        reviewedAffected: affected,
      },
    ],
    ["workspace"],
  ]);
});

test("membership batch rejects an allowed impact from a different same-level declaration owner", async () => {
  let changes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewMembershipBatch: async (request) => ({
          value: {
            kind: "membership-batch",
            collection: request.collection,
            decision: {
              kind: "direct",
              owner: { level: "project", file: "other.jsonc", pointer: "/collections/team" },
            },
            additions: request.additions,
            removals: request.removals,
            affected: [],
            blockers: [],
            effectful: true,
            allowed: true,
          },
          diagnostics: [],
        }),
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  expect(
    await effects.previewMembershipBatch({
      kind: "membership-batch",
      level: "project",
      collection: "team",
      expectedOwner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
      additions: [{ name: "review", address: { source: "team-main", path: "review" } }],
      removals: [],
    }),
  ).toBeUndefined();
  expect(changes).toBe(0);
  expect(effects.operation.problem()).toEqual({
    code: "TRANSACTION_CONFLICT",
    severity: "warning",
    message: "Collection preview no longer matches the selected structural intent",
  });
});

test("a CANCELLED membership batch preview leaves its exact additions retryable without a change", async () => {
  let previews = 0;
  let changes = 0;
  const intent = {
    kind: "membership-batch" as const,
    level: "project" as const,
    collection: "team",
    expectedOwner: {
      level: "project" as const,
      file: "skill-cli.jsonc",
      pointer: "/collections/team",
    },
    additions: [
      { name: "guide-entry", address: { source: "team-main", path: "guide" } },
      { name: "review", address: { source: "team-main", path: "review" } },
    ],
    removals: [],
  };
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewMembershipBatch: async (request) => {
          previews++;
          if (previews === 1) throw new SkillCliError("CANCELLED", "preview cancelled");
          return {
            value: {
              kind: "membership-batch",
              collection: request.collection,
              decision: {
                kind: "direct",
                owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
              },
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
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  expect(await effects.previewMembershipBatch(intent)).toBeUndefined();
  const review = await effects.previewMembershipBatch(intent);
  expect(review?.intent).toEqual(intent);
  expect({ previews, changes }).toEqual({ previews: 2, changes: 0 });
  expect(effects.operation.problem()).toBeUndefined();
});

test("collection membership preview and change use exact typed payloads then refresh once", async () => {
  const calls: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewAddToCollection: async (request) => {
          calls.push(["preview", request]);
          return {
            value: {
              kind: "add-to-collection",
              collection: request.collection,
              address: request.address,
              decision: {
                kind: "direct",
                owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
              },
              intent: {
                owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
                stableEntryName: request.name,
                address: request.address,
              },
              existing: [],
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          };
        },
        change: async (change) => {
          calls.push(["change", change]);
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
      get: async () => {
        calls.push(["workspace"]);
        return { value: workspaceProjection(), diagnostics: [] };
      },
    }),
  );
  const review = await effects.previewAddToCollection({
    kind: "add-to-collection",
    level: "project",
    collection: "team",
    address: { source: "team-main", path: "review" },
    name: "review",
  });
  expect(await effects.confirmCollection(review!)).toBe(true);
  expect(calls).toEqual([
    [
      "preview",
      {
        level: "project",
        collection: "team",
        address: { source: "team-main", path: "review" },
        name: "review",
      },
    ],
    [
      "change",
      {
        type: "collection.member.set",
        level: "project",
        collection: "team",
        name: "review",
        address: { source: "team-main", path: "review" },
      },
    ],
    ["workspace"],
  ]);
});

test("collection previews reject duplicate, cancel once, suppress late completion, and permit retry", async () => {
  let aborts = 0;
  let resolve:
    | ((value: Awaited<ReturnType<ConfigurationCapability["previewCollectionUse"]>>) => void)
    | undefined;
  const core = directSourceCore(workspaceProjection(), {
    configuration: configuration({
      previewCollectionUse: (_request, options) =>
        new Promise((response) => {
          resolve = response;
          options?.signal?.addEventListener("abort", () => aborts++);
        }),
    }),
  });
  const effects = createTuiEffects(core);
  const pending = effects.previewCollectionUse({
    kind: "collection-use",
    level: "project",
    collections: ["team"],
  });
  expect(
    await effects.previewCollectionUse({
      kind: "collection-use",
      level: "project",
      collections: ["team"],
    }),
  ).toBeUndefined();
  effects.cancel();
  resolve!({
    value: {
      kind: "collection-use",
      owner: { level: "project", file: "", pointer: "/use" },
      oldCollections: [],
      newCollections: ["team"],
      affectedSelectors: [],
      newlyExposed: [],
      removedAtOwner: [],
      retained: [],
      alternateOwners: [],
      currentComplete: false,
      proposedComplete: true,
      blockers: [],
      allowed: true,
    },
    diagnostics: [],
  });
  expect(await pending).toBeUndefined();
  expect(aborts).toBe(1);
});

test("a CANCELLED collection preview leaves the exact draft intent retryable", async () => {
  let previews = 0;
  const intent = {
    kind: "collection-use" as const,
    level: "project" as const,
    collections: ["team"],
  };
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewCollectionUse: async (request) => {
          previews++;
          if (previews === 1) throw new SkillCliError("CANCELLED", "preview cancelled");
          return {
            value: {
              kind: "collection-use",
              owner: { level: request.level, file: "skill-cli.jsonc", pointer: "/use" },
              oldCollections: [],
              newCollections: request.collections,
              affectedSelectors: [],
              newlyExposed: [],
              removedAtOwner: [],
              retained: [],
              alternateOwners: [],
              currentComplete: false,
              proposedComplete: true,
              blockers: [],
              allowed: true,
            },
            diagnostics: [],
          };
        },
      }),
    }),
  );
  expect(await effects.previewCollectionUse(intent)).toBeUndefined();
  const review = await effects.previewCollectionUse(intent);
  expect(review?.kind).toBe("collection-use");
  expect(previews).toBe(2);
  expect(effects.operation.problem()).toBeUndefined();
});

test("a CANCELLED collection execution retains the live review and blocks duplicate changes", async () => {
  let changes = 0;
  let refreshes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        change: async () => {
          changes++;
          if (changes === 1) throw new SkillCliError("CANCELLED", "write cancelled");
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
      get: async () => {
        refreshes++;
        return { value: workspaceProjection(), diagnostics: [] };
      },
    }),
  );
  const review = await effects.previewCollectionUse({
    kind: "collection-use",
    level: "project",
    collections: ["team"],
  });
  if (review?.kind !== "collection-use") throw new Error("expected collection use review");
  expect(await effects.confirmCollection(review)).toBe(false);
  expect(
    await Promise.all([effects.confirmCollection(review), effects.confirmCollection(review)]),
  ).toEqual([true, false]);
  expect({ changes, refreshes }).toEqual({ changes: 2, refreshes: 1 });
});

test("collection previews reject structurally mismatched impacts and refresh failure is stale mutation success", async () => {
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewLinkChange: async () => ({
          value: {
            kind: "link-change",
            collection: "team",
            target: "docs",
            linked: false,
            members: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          },
          diagnostics: [],
        }),
      }),
      get: async () => {
        throw new SkillCliError("PROVIDER_UNAVAILABLE", "offline");
      },
    }),
  );
  expect(
    await effects.previewLinkChange({
      kind: "link-change",
      level: "project",
      collection: "team",
      target: "docs",
      linked: true,
    }),
  ).toBeUndefined();
  expect(effects.operation.problem()).toEqual({
    code: "TRANSACTION_CONFLICT",
    severity: "warning",
    message: "Collection preview no longer matches the selected structural intent",
  });
});

test("membership removal requires the exact level and affected address before one change", async () => {
  const calls: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewMembershipRemoval: async (request) => ({
          value: {
            kind: "membership-removal",
            collection: request.collection,
            name: request.name,
            decision: {
              kind: "direct",
              owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
            },
            affected: [
              {
                selector: "team:review",
                address: { source: "team-main", path: "review" },
                paths: [],
              },
            ],
            retained: [],
            disappearing: [],
            linkActions: [],
            allowed: true,
          },
          diagnostics: [],
        }),
        change: async (change) => {
          calls.push(change);
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  expect(
    await effects.previewMembershipRemoval({
      kind: "membership-removal",
      level: "global",
      collection: "team",
      name: "review",
      expectedAddress: { source: "team-main", path: "review" },
    }),
  ).toBeUndefined();
  const review = await effects.previewMembershipRemoval({
    kind: "membership-removal",
    level: "project",
    collection: "team",
    name: "review",
    expectedAddress: { source: "team-main", path: "review" },
  });
  expect(review?.kind).toBe("membership-removal");
  if (review?.kind === "membership-removal")
    expect(await effects.confirmCollection(review)).toBe(true);
  expect(calls).toEqual([
    {
      type: "collection.member.remove",
      level: "project",
      collection: "team",
      name: "review",
      expectedAddress: { source: "team-main", path: "review" },
    },
  ]);
});

test("membership add and removal record complete preview, mutation, and refresh payloads", async () => {
  const calls: unknown[] = [];
  const defaults = configuration({});
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewAddToCollection: async (request, options) => {
          calls.push({ kind: "preview-add", request });
          return defaults.previewAddToCollection(request, options);
        },
        previewMembershipRemoval: async (request, _options) => {
          calls.push({ kind: "preview-member-remove", request });
          return {
            value: {
              kind: "membership-removal",
              collection: request.collection,
              name: request.name,
              decision: {
                kind: "direct",
                owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
              },
              affected: [
                {
                  selector: "team:review",
                  address: { source: "team-main", path: "review" },
                  paths: [],
                },
              ],
              retained: [],
              disappearing: [],
              linkActions: [],
              allowed: true,
            },
            diagnostics: [],
          };
        },
        change: async (change) => {
          calls.push({ kind: "change", change });
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
      get: async () => {
        calls.push({ kind: "workspace" });
        return { value: workspaceProjection(), diagnostics: [] };
      },
    }),
  );
  const add = await effects.previewAddToCollection({
    kind: "add-to-collection",
    level: "project",
    collection: "team",
    address: { source: "team-main", path: "review" },
    name: "review",
  });
  if (add?.kind === "add-to-collection") expect(await effects.confirmCollection(add)).toBe(true);
  expect(calls).toEqual([
    {
      kind: "preview-add",
      request: {
        level: "project",
        collection: "team",
        address: { source: "team-main", path: "review" },
        name: "review",
      },
    },
    {
      kind: "change",
      change: {
        type: "collection.member.set",
        level: "project",
        collection: "team",
        name: "review",
        address: { source: "team-main", path: "review" },
      },
    },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const removal = await effects.previewMembershipRemoval({
    kind: "membership-removal",
    level: "project",
    collection: "team",
    name: "review",
    expectedAddress: { source: "team-main", path: "review" },
  });
  if (removal?.kind === "membership-removal")
    expect(await effects.confirmCollection(removal)).toBe(true);
  expect(calls).toEqual([
    {
      kind: "preview-member-remove",
      request: { level: "project", collection: "team", name: "review" },
    },
    {
      kind: "change",
      change: {
        type: "collection.member.remove",
        level: "project",
        collection: "team",
        name: "review",
        expectedAddress: { source: "team-main", path: "review" },
      },
    },
    { kind: "workspace" },
  ]);
});

test("add membership binds the exact Core-authorized stable name", async () => {
  let changes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  const review = await effects.previewAddToCollection({
    kind: "add-to-collection",
    level: "project",
    collection: "team",
    address: { source: "team-main", path: "review" },
    name: "review",
  });
  expect(review?.kind).toBe("add-to-collection");
  if (review?.kind === "add-to-collection")
    expect(review.impact.intent?.stableEntryName).toBe("review");
  expect(changes).toBe(0);
});

test("add membership executes only the live Core-authorized intent", async () => {
  let changes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  const review = await effects.previewAddToCollection({
    kind: "add-to-collection",
    level: "project",
    collection: "team",
    address: { source: "team-main", path: "review" },
    name: "review",
  });
  if (review?.kind !== "add-to-collection") throw new Error("expected add review");
  const substituted = {
    ...review,
    intent: {
      ...review.intent,
      name: "custom",
      address: { source: "other", path: "other" },
    },
  };
  expect(await effects.confirmCollection(substituted)).toBe(false);
  expect(await effects.confirmCollection(review)).toBe(true);
  expect(changes).toBe(1);
});

test("repository-derived add review truthfully exposes a create-direct-contribution next step", async () => {
  let changes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewAddToCollection: async (request) => ({
          value: {
            kind: "add-to-collection",
            collection: request.collection,
            address: request.address,
            decision: {
              kind: "repository-derived",
              producers: [{ source: "repo", path: "skill" }],
            },
            createDirectContribution: {
              collection: request.collection,
              eligibleLevels: ["global", "project", "local"],
            },
            existing: [],
            blockers: [],
            allowed: false,
          },
          diagnostics: [],
        }),
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  const review = await effects.previewAddToCollection({
    kind: "add-to-collection",
    level: "project",
    collection: "team",
    address: { source: "team-main", path: "review" },
    name: "review",
  });
  expect(review?.kind).toBe("add-to-collection");
  if (review?.kind === "add-to-collection") {
    expect(review.impact.intent).toBeUndefined();
    expect(review.impact.createDirectContribution).toEqual({
      collection: "team",
      eligibleLevels: ["global", "project", "local"],
    });
    expect(await effects.confirmCollection(review)).toBe(false);
  }
  expect(changes).toBe(0);
});

test("add membership rejects mismatched direct and authorized declaration owners", async () => {
  let changes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewAddToCollection: async (request) => ({
          value: {
            kind: "add-to-collection",
            collection: request.collection,
            address: request.address,
            decision: {
              kind: "direct",
              owner: { level: "project", file: "other.jsonc", pointer: "/collections/team" },
            },
            intent: {
              owner: { level: "project", file: "skill-cli.jsonc", pointer: "/collections/team" },
              stableEntryName: request.name,
              address: request.address,
            },
            existing: [],
            blockers: [],
            allowed: true,
          },
          diagnostics: [],
        }),
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  expect(
    await effects.previewAddToCollection({
      kind: "add-to-collection",
      level: "project",
      collection: "team",
      address: { source: "team-main", path: "review" },
      name: "review",
    }),
  ).toBeUndefined();
  expect(changes).toBe(0);
});

test("link preview rejects an allowed impact without its direct owner", async () => {
  let changes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        previewLinkChange: async (request) => ({
          value: {
            kind: "link-change",
            collection: request.collection,
            target: request.target,
            linked: request.linked,
            members: [],
            disappearingSelectors: [],
            retainedSelectors: [],
            blockers: [],
            allowed: true,
          },
          diagnostics: [],
        }),
        change: async () => {
          changes++;
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  expect(
    await effects.previewLinkChange({
      kind: "link-change",
      level: "project",
      collection: "team",
      target: "docs",
      linked: true,
    }),
  ).toBeUndefined();
  expect(changes).toBe(0);
});

test("every remaining collection intent emits its exact ConfigChange once", async () => {
  const calls: unknown[] = [];
  const defaults = configuration({});
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        change: async (change) => {
          calls.push({ kind: "change", change });
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
        previewImport: async (request, options) => {
          calls.push({ kind: "preview-import", request });
          return defaults.previewImport(request, options);
        },
        previewReference: async (request, options) => {
          calls.push({ kind: "preview-reference", request });
          return defaults.previewReference(request, options);
        },
        previewLinkChange: async (request, options) => {
          calls.push({ kind: "preview-link", request });
          return defaults.previewLinkChange(request, options);
        },
        previewCollectionUse: async (request, options) => {
          calls.push({ kind: "preview-use", request });
          return defaults.previewCollectionUse(request, options);
        },
        previewCollectionRemoval: async (request, options) => {
          calls.push({ kind: "preview-removal", request });
          return defaults.previewCollectionRemoval(request, options);
        },
      }),
      get: async () => {
        calls.push({ kind: "workspace" });
        return { value: workspaceProjection(), diagnostics: [] };
      },
    }),
  );
  expect(
    await effects.createCollection({
      kind: "collection-create",
      level: "project",
      collection: "new",
    }),
  ).toBe(true);
  expect(calls).toEqual([
    { kind: "change", change: { type: "collection.create", level: "project", collection: "new" } },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const imported = await effects.previewImport({
    kind: "collection-import",
    level: "project",
    from: "from",
    into: "team",
  });
  if (imported?.kind === "collection-import")
    expect(await effects.confirmCollection(imported)).toBe(true);
  expect(calls).toEqual([
    { kind: "preview-import", request: { level: "project", from: "from", into: "team" } },
    {
      kind: "change",
      change: { type: "collection.import", level: "project", from: "from", into: "team" },
    },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const reference = await effects.previewReference({
    kind: "reference",
    level: "project",
    collection: "team",
    name: "docs",
    target: "docs",
    description: "Docs",
  });
  if (reference?.kind === "reference")
    expect(await effects.confirmCollection(reference)).toBe(true);
  expect(calls).toEqual([
    {
      kind: "preview-reference",
      request: {
        level: "project",
        collection: "team",
        name: "docs",
        target: "docs",
        description: "Docs",
        remove: undefined,
      },
    },
    {
      kind: "change",
      change: {
        type: "collection.reference.set",
        level: "project",
        collection: "team",
        name: "docs",
        target: "docs",
        description: "Docs",
      },
    },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const referenceRemoval = await effects.previewReference({
    kind: "reference",
    level: "project",
    collection: "team",
    name: "docs",
    target: "docs",
    description: "Docs",
    remove: true,
  });
  if (referenceRemoval?.kind === "reference")
    expect(await effects.confirmCollection(referenceRemoval)).toBe(true);
  expect(calls).toEqual([
    {
      kind: "preview-reference",
      request: {
        level: "project",
        collection: "team",
        name: "docs",
        target: "docs",
        description: "Docs",
        remove: true,
      },
    },
    {
      kind: "change",
      change: {
        type: "collection.reference.remove",
        level: "project",
        collection: "team",
        name: "docs",
        expected: { collection: "docs", description: "Docs" },
      },
    },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const link = await effects.previewLinkChange({
    kind: "link-change",
    level: "project",
    collection: "team",
    target: "docs",
    linked: true,
  });
  if (link?.kind === "link-change") expect(await effects.confirmCollection(link)).toBe(true);
  expect(calls).toEqual([
    {
      kind: "preview-link",
      request: { level: "project", collection: "team", target: "docs", linked: true },
    },
    {
      kind: "change",
      change: {
        type: "collection.link.set",
        level: "project",
        collection: "team",
        target: "docs",
        linked: true,
      },
    },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const linkRemoval = await effects.previewLinkChange({
    kind: "link-change",
    level: "project",
    collection: "team",
    target: "docs",
    linked: false,
  });
  if (linkRemoval?.kind === "link-change")
    expect(await effects.confirmCollection(linkRemoval)).toBe(true);
  expect(calls).toEqual([
    {
      kind: "preview-link",
      request: { level: "project", collection: "team", target: "docs", linked: false },
    },
    {
      kind: "change",
      change: {
        type: "collection.link.set",
        level: "project",
        collection: "team",
        target: "docs",
        linked: false,
      },
    },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const use = await effects.previewCollectionUse({
    kind: "collection-use",
    level: "project",
    collections: ["team"],
  });
  if (use?.kind === "collection-use") expect(await effects.confirmCollection(use)).toBe(true);
  expect(calls).toEqual([
    { kind: "preview-use", request: { level: "project", collections: ["team"] } },
    { kind: "change", change: { type: "use.set", level: "project", collections: ["team"] } },
    { kind: "workspace" },
  ]);
  calls.length = 0;
  const removal = await effects.previewCollectionRemoval({
    kind: "collection-removal",
    level: "project",
    collection: "team",
  });
  if (removal?.kind === "collection-removal")
    expect(await effects.confirmCollection(removal)).toBe(true);
  expect(calls).toEqual([
    { kind: "preview-removal", request: { level: "project", collection: "team" } },
    { kind: "change", change: { type: "collection.remove", level: "project", collection: "team" } },
    { kind: "workspace" },
  ]);
});

test("collection execute retries after failure and a late mutation success refreshes once", async () => {
  let attempts = 0;
  let resolveChange:
    | ((value: {
        readonly value: { readonly level: "project"; readonly changed: true };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  let refreshes = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        change: () => {
          attempts++;
          if (attempts === 1) throw new SkillCliError("WRITE_FAILED", "disk full");
          if (attempts === 2)
            return new Promise((resolve) => {
              resolveChange = resolve;
            });
          return Promise.resolve({
            value: { level: "project" as const, changed: true as const },
            diagnostics: [],
          });
        },
      }),
      get: async () => {
        refreshes++;
        throw new SkillCliError("PROVIDER_UNAVAILABLE", "offline");
      },
    }),
  );
  const review = await effects.previewCollectionUse({
    kind: "collection-use",
    level: "project",
    collections: ["team"],
  });
  if (review?.kind !== "collection-use") throw new Error("expected collection use review");
  expect(await effects.confirmCollection(review)).toBe(false);
  const applying = effects.confirmCollection(review);
  effects.cancel();
  resolveChange!({ value: { level: "project", changed: true }, diagnostics: [] });
  expect(await applying).toBe(true);
  expect({ attempts, refreshes }).toEqual({ attempts: 2, refreshes: 1 });
  expect(effects.operation.notice()).toBe("Collection updated; Workspace is stale");
});

test("unified Collection preview keeps the latest exact live review across named and unified entry points", async () => {
  const changes: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      configuration: configuration({
        change: async (change) => {
          changes.push(change);
          return { value: { level: "project", changed: true }, diagnostics: [] };
        },
      }),
    }),
  );
  const previous = await effects.previewCollectionUse({
    kind: "collection-use",
    level: "project",
    collections: ["old"],
  });
  const current = await effects.previewCollection({
    kind: "collection-use",
    level: "project",
    collections: ["team"],
  });
  if (!previous || !current) throw new Error("expected both reviews");
  expect(await effects.confirmCollection(previous)).toBe(false);
  expect(await effects.confirmCollection({ ...current })).toBe(false);
  expect(await effects.confirmCollection(current)).toBe(true);
  expect(await effects.confirmCollection(current)).toBe(false);
  expect(changes).toEqual([{ type: "use.set", level: "project", collections: ["team"] }]);
});
