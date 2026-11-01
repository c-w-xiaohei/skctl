import { expect, test } from "bun:test";
import {
  SkctlError,
  type CollectionRenameImpact,
  type RebindImpact,
  type RegisterSourceRequest,
} from "@skctl/core";
import {
  directOwner,
  directSourceCore,
  testEffects,
  workspaceProjection,
} from "./direct-source.fixture";

const address = { source: "team-main", path: "guide" };
const replacement = { source: "replacement", path: "alternate/guide" };
const rebind: RebindImpact = {
  kind: "rebind",
  address,
  owner: replacement.source,
  ownerPath: replacement.path,
  scope: "captured-workspace",
  limitation: "External projects are not inspected",
  baseline: "opaque-rebind",
  proof: "proven",
  directMemberships: [
    { collection: "team", name: "guide", owner: directOwner, before: address, after: replacement },
  ],
  blockers: [],
  allowed: true,
};
const rename: CollectionRenameImpact = {
  kind: "collection-rename",
  collection: "team",
  target: "new-team",
  scope: "captured-workspace",
  limitation: "External projects are not inspected",
  baseline: "opaque-rename",
  declarations: [directOwner],
  references: [{ kind: "use", owner: directOwner }],
  addresses: [{ before: "team:guide", after: "new-team:guide" }],
  blockers: [],
  allowed: true,
};
const rebindRequest = {
  kind: "rebind" as const,
  address,
  owner: replacement.source,
  ownerPath: replacement.path,
};
const renameRequest = {
  kind: "collection-rename" as const,
  collection: "team",
  target: "new-team",
};
const registration: RegisterSourceRequest = {
  level: "project",
  id: "replacement",
  binding: { kind: "local", path: "/replacement", root: "." },
};
const result = <T>(value: T) => ({ value, diagnostics: [] });

test("rebind confirmation forwards the exact displayed impact without another preview", async () => {
  let previews = 0;
  const submitted: unknown[] = [];
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => {
        previews++;
        return result(rebind);
      },
      rebindSkill: async (_env, request) => {
        submitted.push(request);
        return result(undefined);
      },
    }),
  );
  const review = await effects.reviewInstalled(rebindRequest);
  expect(review?.kind).toBe("rebind");
  if (review?.kind !== "rebind") throw new Error("Expected rebind review");
  expect(await effects.confirmInstalled(review!)).toBe(true);
  expect(previews).toBe(1);
  expect(submitted).toEqual([
    { ...address, owner: replacement.source, ownerPath: replacement.path, reviewedImpact: rebind },
  ]);
  expect((submitted[0] as { reviewedImpact: RebindImpact }).reviewedImpact).toBe(review!.impact);
});

test("rebind conflict consumes stale evidence; a fresh explicit preview is required", async () => {
  let previews = 0;
  let submissions = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => {
        previews++;
        return result(rebind);
      },
      rebindSkill: async () => {
        submissions++;
        throw new SkctlError("CONFIG_CONFLICT", "stale review");
      },
    }),
  );
  const review = await effects.reviewInstalled(rebindRequest);
  expect(await effects.confirmInstalled(review!)).toBe(false);
  expect(await effects.confirmInstalled(review!)).toBe(false);
  expect(submissions).toBe(1);
  expect(previews).toBe(1);
  expect((await effects.reviewInstalled(rebindRequest))?.kind).toBe("rebind");
  expect(previews).toBe(2);
});

test("rename confirmation forwards the displayed impact and rejects reuse after conflict", async () => {
  let previews = 0;
  const submitted: unknown[] = [];
  const core = {
    ...directSourceCore(workspaceProjection()),
    previewCollectionRename: async () => {
      previews++;
      return result(rename);
    },
    renameCollection: async (_env: unknown, request: unknown) => {
      submitted.push(request);
      throw new SkctlError("CONFIG_CONFLICT", "stale review");
    },
  };
  const effects = testEffects(core);
  const review = await effects.previewCollection(renameRequest);
  expect(review?.kind).toBe("collection-rename");
  if (review?.kind !== "collection-rename") throw new Error("Expected rename review");
  expect(await effects.confirmCollection(review!)).toBe(false);
  expect(await effects.confirmCollection(review!)).toBe(false);
  expect(submitted).toEqual([{ collection: "team", target: "new-team", reviewedImpact: rename }]);
  expect((submitted[0] as { reviewedImpact: CollectionRenameImpact }).reviewedImpact).toBe(
    review!.impact,
  );
  expect(previews).toBe(1);
});

test("rename rejects mismatched preview and does not submit blocked impact", async () => {
  let submissions = 0;
  let impact: CollectionRenameImpact = { ...rename, target: "other" };
  const core = {
    ...directSourceCore(workspaceProjection()),
    previewCollectionRename: async () => result(impact),
    renameCollection: async () => {
      submissions++;
      return result(rename);
    },
  };
  const effects = testEffects(core);
  expect(await effects.previewCollection(renameRequest)).toBeUndefined();
  expect(effects.operation.problem()?.code).toBe("TRANSACTION_CONFLICT");
  impact = { ...rename, allowed: false, blockers: [{ reason: "collision", owner: directOwner }] };
  const blocked = await effects.previewCollection(renameRequest);
  expect(blocked).toBeDefined();
  expect(await effects.confirmCollection(blocked!)).toBe(false);
  expect(submissions).toBe(0);
});

test("identity receipt preserves applied outcome when workspace refresh fails", async () => {
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => result(rebind),
      rebindSkill: async () => result(undefined),
      getWorkspace: async () => {
        throw new Error("offline");
      },
    }),
  );
  const review = await effects.reviewInstalled(rebindRequest);
  expect(await effects.applyRebind(review!)).toEqual({ status: "applied", workspace: "stale" });
});

test("identity receipt distinguishes stale evidence and uncertain publication", async () => {
  let error = new SkctlError("CONFIG_CONFLICT", "stale review");
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => result(rebind),
      rebindSkill: async () => {
        throw error;
      },
    }),
  );
  const first = await effects.reviewInstalled(rebindRequest);
  expect(await effects.applyRebind(first!)).toMatchObject({ status: "stale" });
  expect(await effects.applyRebind(first!)).toMatchObject({ status: "blocked" });
  error = new SkctlError("INTERNAL", "unknown outcome");
  const second = await effects.reviewInstalled(rebindRequest);
  expect(await effects.applyRebind(second!)).toMatchObject({ status: "uncertain" });
  expect(await effects.applyRebind(second!)).toMatchObject({ status: "blocked" });
});

test("successful publication after cancellation keeps its applied receipt", async () => {
  let finish!: () => void;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => result(rebind),
      rebindSkill: async () =>
        new Promise((resolve) => {
          finish = () => resolve(result(undefined));
        }),
    }),
  );
  const review = await effects.reviewInstalled(rebindRequest);
  const pending = effects.applyRebind(review!);
  effects.cancel();
  finish();
  expect(await pending).toMatchObject({ status: "applied" });
});

test("concurrent identity apply cannot submit the same review twice", async () => {
  let finish!: () => void;
  let calls = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => result(rebind),
      rebindSkill: async () =>
        new Promise((resolve) => {
          calls++;
          finish = () => resolve(result(undefined));
        }),
    }),
  );
  const review = await effects.reviewInstalled(rebindRequest);
  const pending = effects.applyRebind(review!);
  expect(await effects.applyRebind(review!)).toEqual({ status: "blocked" });
  expect(calls).toBe(1);
  finish();
  expect(await pending).toMatchObject({ status: "applied" });
});

test("rejected cancellation remains uncertain and consumes reviewed evidence", async () => {
  let calls = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => result(rebind),
      rebindSkill: async (_env, _request, options) =>
        new Promise((_, reject) => {
          calls++;
          options?.signal?.addEventListener("abort", () =>
            reject(new SkctlError("CANCELLED", "stop requested")),
          );
        }),
    }),
  );
  const review = await effects.reviewInstalled(rebindRequest);
  const pending = effects.applyRebind(review!);
  effects.cancel();
  expect(await pending).toMatchObject({ status: "uncertain", diagnostic: { code: "CANCELLED" } });
  expect(await effects.applyRebind(review!)).toEqual({ status: "blocked" });
  expect(calls).toBe(1);
});

test("replacement Source registration retains applied receipt when refresh fails", async () => {
  const calls: RegisterSourceRequest[] = [];
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      registerSource: async (_env, request) => {
        calls.push(request);
        return result({ level: "project", file: directOwner.file, changed: true });
      },
      getWorkspace: async () => {
        throw new Error("refresh unavailable");
      },
    }),
  );
  expect(await effects.registerReplacementSource(registration)).toEqual({
    status: "applied",
    workspace: "stale",
  });
  expect(calls).toEqual([registration]);
});

test("replacement Source registration reports rejected cancellation as uncertain without retry", async () => {
  let calls = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      registerSource: async (_env, _request, options) =>
        new Promise((_, reject) => {
          calls++;
          options?.signal?.addEventListener("abort", () =>
            reject(new SkctlError("CANCELLED", "stop requested")),
          );
        }),
    }),
  );
  const pending = effects.registerReplacementSource(registration);
  effects.cancel();
  expect(await pending).toMatchObject({ status: "uncertain", diagnostic: { code: "CANCELLED" } });
  expect(calls).toBe(1);
});

test("replacement Source registration retains applied receipt when cancellation races publication", async () => {
  let finish!: () => void;
  let calls = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      registerSource: async () =>
        new Promise((resolve) => {
          calls++;
          finish = () =>
            resolve(result({ level: "project", file: directOwner.file, changed: true }));
        }),
    }),
  );
  const pending = effects.registerReplacementSource(registration);
  effects.cancel();
  finish();
  expect(await pending).toMatchObject({ status: "applied" });
  expect(calls).toBe(1);
});
