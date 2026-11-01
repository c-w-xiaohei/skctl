import { expect, test } from "bun:test";
import { SkctlError } from "@skctl/core";
import {
  directSourceCore,
  testEffects as createTuiEffects,
  workspaceProjection,
} from "./direct-source.fixture";
const address = { source: "team-main", path: "guide" };
test("Rebind rejects absolute and traversal replacement paths before previewing Core", async () => {
  let previews = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => {
        previews++;
        throw new Error("must not call Core");
      },
    }),
  );
  expect(
    await effects.reviewInstalled({
      kind: "rebind",
      address,
      owner: "replacement",
      ownerPath: "/absolute/guide",
    }),
  ).toBeUndefined();
  expect(
    await effects.reviewInstalled({
      kind: "rebind",
      address,
      owner: "replacement",
      ownerPath: "other/../guide",
    }),
  ).toBeUndefined();
  expect(previews).toBe(0);
});
test("Rebind rejects a stale preview whose structural request no longer matches", async () => {
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async () => ({
        value: {
          kind: "rebind",
          address,
          owner: "replacement",
          ownerPath: "different/root",
          proof: "proven",
          scope: "captured-workspace",
          limitation: "External projects are not inspected",
          baseline: "baseline",
          directMemberships: [],
          blockers: [],
          allowed: true,
        },
        diagnostics: [],
      }),
    }),
  );
  expect(
    await effects.reviewInstalled({
      kind: "rebind",
      address,
      owner: "replacement",
      ownerPath: "alternate/guide",
    }),
  ).toBeUndefined();
  expect(effects.operation.problem()).toEqual({
    code: "TRANSACTION_CONFLICT",
    severity: "warning",
    message: "Rebind preview no longer matches the selected structural address",
  });
});
test("Uninstall rejects a stale preview whose installed structural address differs", async () => {
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      previewUninstall: async () => ({
        value: {
          kind: "uninstall",
          installed: [{ source: "team-main", path: "other" }],
          directMemberships: [],
          disappearingSelectors: [],
          retainedSelectors: [],
          blockers: [],
          allowed: true,
        },
        diagnostics: [],
      }),
    }),
  );
  expect(await effects.reviewInstalled({ kind: "uninstall", address })).toBeUndefined();
  expect(effects.operation.problem()).toEqual({
    code: "TRANSACTION_CONFLICT",
    severity: "warning",
    message: "Uninstall preview no longer matches the selected structural address",
  });
});
test("Installed Skill execution is duplicate-safe and cancellation settles the current review", async () => {
  let aborts = 0;
  let executions = 0;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      uninstallSkills: async (_environment: import("@skctl/core").CoreOptions, _request, options) =>
        new Promise((_, reject) => {
          executions++;
          options?.signal?.addEventListener("abort", () => {
            aborts++;
            reject(new SkctlError("CANCELLED", "uninstall cancelled"));
          });
        }),
    }),
  );
  const review = await effects.reviewInstalled({ kind: "uninstall", address });
  expect(review).toBeDefined();
  const pending = effects.confirmInstalled(review!);
  expect(await effects.confirmInstalled(review!)).toBe(false);
  effects.cancel();
  expect(await pending).toBe(false);
  expect(executions).toBe(1);
  expect(aborts).toBe(1);
  expect(effects.operation.problem()).toEqual({
    code: "CANCELLED",
    severity: "warning",
    message: "uninstall cancelled",
  });
});
test("Rebind settles only after the one coherent refresh succeeds", async () => {
  const rebound = workspaceProjection({ includeDirect: false, includeContribution: false });
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      getWorkspace: async () => ({ value: rebound, diagnostics: [] }),
      previewRebind: async () => ({
        value: {
          kind: "rebind",
          address,
          owner: "replacement",
          ownerPath: "alternate/guide",
          proof: "proven",
          scope: "captured-workspace",
          limitation: "External projects are not inspected",
          baseline: "baseline",
          directMemberships: [],
          blockers: [],
          allowed: true,
        },
        diagnostics: [],
      }),
    }),
  );
  const review = await effects.reviewInstalled({
    kind: "rebind",
    address,
    owner: "replacement",
    ownerPath: "alternate/guide",
  });
  expect(await effects.confirmInstalled(review!)).toBe(true);
  expect(effects.operation.notice()).toBe("Skill rebound");
});
test("Rebind preview retry repeats one exact structural request after a failure", async () => {
  const calls: unknown[] = [];
  let attempt = 0;
  const request = {
    kind: "rebind" as const,
    address,
    owner: "replacement",
    ownerPath: "alternate/guide",
  };
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async (_environment: import("@skctl/core").CoreOptions, value) => {
        calls.push(value);
        if (attempt++ === 0) throw new SkctlError("PROVIDER_UNAVAILABLE", "offline");
        return {
          value: {
            kind: "rebind",
            address,
            owner: "replacement",
            ownerPath: "alternate/guide",
            proof: "proven",
            scope: "captured-workspace",
            limitation: "External projects are not inspected",
            baseline: "baseline",
            directMemberships: [],
            blockers: [],
            allowed: true,
          },
          diagnostics: [],
        };
      },
    }),
  );
  expect(await effects.reviewInstalled(request)).toBeUndefined();
  const review = await effects.reviewInstalled(request);
  expect(review?.kind).toBe("rebind");
  if (review?.kind === "rebind") expect(review.impact.proof).toBe("proven");
  expect(calls).toEqual([
    { source: "team-main", path: "guide", owner: "replacement", ownerPath: "alternate/guide" },
    { source: "team-main", path: "guide", owner: "replacement", ownerPath: "alternate/guide" },
  ]);
});
test("Cancelled Installed Skill preview suppresses a late successful review", async () => {
  let resolve!: (value: {
    readonly value: {
      readonly kind: "uninstall";
      readonly installed: readonly (typeof address)[];
      readonly directMemberships: readonly [];
      readonly disappearingSelectors: readonly [];
      readonly retainedSelectors: readonly [];
      readonly blockers: readonly [];
      readonly allowed: true;
    };
    readonly diagnostics: readonly [];
  }) => void;
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      previewUninstall: async () =>
        new Promise((resolvePreview) => {
          resolve = resolvePreview;
        }),
    }),
  );
  const pending = effects.reviewInstalled({ kind: "uninstall", address });
  effects.cancel();
  resolve({
    value: {
      kind: "uninstall",
      installed: [address],
      directMemberships: [],
      disappearingSelectors: [],
      retainedSelectors: [],
      blockers: [],
      allowed: true,
    },
    diagnostics: [],
  });
  expect(await pending).toBeUndefined();
});
