import { expect, test } from "bun:test";
import { SkillCliError } from "@skill-cli/core";
import { createTuiEffects } from "../src/effects";
import {
  directOwner,
  directSourceCore,
  testEffects,
  testProjection,
  workspaceProjection,
} from "./direct-source.fixture";

test("cancelled preview releases its lane, revokes earlier reviews and cannot publish over a replacement", async () => {
  type Preview = Awaited<
    ReturnType<ReturnType<typeof directSourceCore>["management"]["previewSourceRemoval"]>
  >;
  let resolvePreview: ((value: Preview) => void) | undefined;
  let calls = 0;
  const core = directSourceCore(workspaceProjection());
  const impact = await core.management.previewSourceRemoval({ source: "team-main" });
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      previewSourceRemoval: async () => {
        if (++calls === 2)
          return new Promise<Preview>((resolve) => {
            resolvePreview = resolve;
          });
        return impact;
      },
    },
  });
  const intent = { kind: "source-removal" as const, source: "team-main", owner: directOwner };
  const earlier = await effects.review(intent);
  const abandoned = effects.review(intent);
  effects.cancel();
  expect(effects.pending()).toBe(false);
  expect(await effects.confirm(earlier!)).toBe(false);
  const replacement = await effects.review(intent);
  resolvePreview!(impact);
  expect(await abandoned).toBeUndefined();
  expect(await effects.confirm(replacement!)).toBe(true);
});

test("teardown suppresses late foreground preview publication and releases pending identity", async () => {
  const core = directSourceCore(workspaceProjection());
  const impact = await core.management.previewSourceRemoval({ source: "team-main" });
  let resolvePreview: ((value: typeof impact) => void) | undefined;
  const effects = testEffects({
    ...core,
    management: {
      ...core.management,
      previewSourceRemoval: () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    },
  });
  const pending = effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  effects.teardown();
  expect(effects.pending()).toBe(false);
  resolvePreview!(impact);
  expect(await pending).toBeUndefined();
  expect(effects.operation.problem()).toBeUndefined();
});

test("refresh applies only the current initial projection after a replacement refresh aborts its stale request", async () => {
  const requests: {
    readonly resolve: (value: {
      readonly value: ReturnType<typeof workspaceProjection>;
      readonly diagnostics: [];
    }) => void;
    readonly signal?: AbortSignal;
  }[] = [];
  const { projection, operation } = testProjection();
  const accepted = workspaceProjection();
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      get: (options) =>
        new Promise((resolve) => {
          requests.push({ resolve, signal: options?.signal });
        }),
    }),
    operation,
    projection.outcomes,
  );

  const stale = effects.refresh();
  const current = effects.refresh();
  expect(requests).toHaveLength(2);
  expect(requests[0]!.signal?.aborted).toBe(true);

  requests[0]!.resolve({
    value: workspaceProjection({ includeDirect: false }),
    diagnostics: [],
  });
  requests[1]!.resolve({ value: accepted, diagnostics: [] });
  await Promise.all([stale, current]);

  expect(projection.workspace()).toBe(accepted);
});

test("refresh failure reports stale diagnostics without applying a snapshot", async () => {
  const { projection, operation } = testProjection();
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      get: async () => {
        throw new SkillCliError("PROVIDER_UNAVAILABLE", "offline");
      },
    }),
    operation,
    projection.outcomes,
  );

  await effects.refresh();

  expect(projection.workspace()).toBeUndefined();
  expect(projection.refresh()).toBe("stale");
  expect(operation.problem()?.message).toBe("offline");
});

test("MGMT-006 discovers once and installs selected observed paths at the exact revision before one refresh", async () => {
  const calls: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    discover: async (request) => {
      calls.push(["discover", request]);
      return {
        value: {
          source: "team-main",
          kind: "github",
          exactRevision: "reviewed-commit",
          candidates: [{ path: "review", name: "review", description: "Review code" }],
        },
        diagnostics: [],
      };
    },
    install: async (request) => {
      calls.push(["install", request]);
      return { value: [], diagnostics: [] };
    },
    get: async () => {
      calls.push(["workspace"]);
      return { value: workspaceProjection(), diagnostics: [] };
    },
  });
  const effects = testEffects(core);
  const observation = await effects.discover({
    kind: "source-discovery",
    source: "team-main",
  });
  expect(observation?.observation.exactRevision).toBe("reviewed-commit");
  expect(await effects.install(observation!, ["review"])).toBe(true);
  expect(calls).toEqual([
    ["discover", { source: "team-main" }],
    [
      "install",
      {
        source: "team-main",
        paths: ["review"],
        exactRevision: "reviewed-commit",
      },
    ],
    ["workspace"],
  ]);
});

test("Installed Skill Rebind passes the explicit replacement root through preview and execution", async () => {
  const calls: unknown[] = [];
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      previewRebind: async (request) => {
        calls.push(["preview", request]);
        return {
          value: {
            kind: "rebind",
            address: { source: "team-main", path: "guide" },
            owner: "replacement",
            ownerPath: "alternate/guide",
            proof: "proven",
            allowed: true,
          },
          diagnostics: [],
        };
      },
      rebind: async (request) => {
        calls.push(["rebind", request]);
        return { value: undefined, diagnostics: [] };
      },
    }),
  );
  const review = await effects.reviewInstalled({
    kind: "rebind",
    address: { source: "team-main", path: "guide" },
    owner: "replacement",
    ownerPath: "alternate/guide",
  });
  expect(await effects.confirmInstalled(review!)).toBe(true);
  expect(calls).toEqual([
    [
      "preview",
      { source: "team-main", path: "guide", owner: "replacement", ownerPath: "alternate/guide" },
    ],
    [
      "rebind",
      { source: "team-main", path: "guide", owner: "replacement", ownerPath: "alternate/guide" },
    ],
  ]);
});

test("STATE-013/018 previews once, consumes review once, removes once, and refreshes once", async () => {
  const calls: string[] = [];
  const core = directSourceCore(workspaceProjection(), {
    previewSourceRemoval: async () => {
      calls.push("preview");
      return {
        value: {
          kind: "source-removal",
          source: "team-main",
          owner: directOwner,
          installed: [],
          repairs: [],
          blockers: [],
          allowed: true,
        },
        diagnostics: [],
      };
    },
    removeSource: async () => {
      calls.push("remove");
      return { value: undefined, diagnostics: [] };
    },
    get: async () => {
      calls.push("workspace");
      return {
        value: workspaceProjection({ includeDirect: false }),
        diagnostics: [],
      };
    },
  });
  const effects = testEffects(core);
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(calls).toEqual(["preview"]);
  expect(await Promise.all([effects.confirm(review!), effects.confirm(review!)])).toEqual([
    true,
    false,
  ]);
  expect(await effects.confirm(review!)).toBe(false);
  expect(calls).toEqual(["preview", "remove", "workspace"]);
});

test("STATE-016/017 preview cancellation and exact failure remain local without execution", async () => {
  let aborted = 0;
  const core = directSourceCore(workspaceProjection(), {
    previewSourceRemoval: async (_request, options) =>
      new Promise((_, reject) => {
        options?.signal?.addEventListener("abort", () => {
          aborted++;
          reject(new SkillCliError("CANCELLED", "cancelled"));
        });
      }),
  });
  const effects = testEffects(core);
  const pending = effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  effects.cancel();
  await expect(pending).resolves.toBeUndefined();
  expect(effects.operation.problem()).toBeUndefined();
  expect(aborted).toBe(1);
});

test("MGMT-003 never executes a blocked impact", async () => {
  let removed = false;
  const core = directSourceCore(workspaceProjection(), {
    previewSourceRemoval: async () => ({
      value: {
        kind: "source-removal",
        source: "team-main",
        owner: directOwner,
        installed: [{ source: "team-main", path: "review" }],
        repairs: [
          {
            address: { source: "team-main", path: "review" },
            actions: ["rebind", "uninstall"],
          },
        ],
        blockers: [
          {
            reason: "installed",
            address: { source: "team-main", path: "review" },
          },
        ],
        allowed: false,
      },
      diagnostics: [],
    }),
    removeSource: async () => {
      removed = true;
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = testEffects(core);
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(await effects.confirm(review!)).toBe(false);
  expect(removed).toBe(false);
});

test("STATE-017 preserves failed review and permits a retry with the exact error", async () => {
  let attempts = 0;
  const core = directSourceCore(workspaceProjection(), {
    removeSource: async () => {
      attempts++;
      if (attempts === 1) throw new SkillCliError("WRITE_FAILED", "disk full");
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = testEffects(core);
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(await effects.confirm(review!)).toBe(false);
  expect(effects.operation.problem()).toEqual({
    code: "WRITE_FAILED",
    severity: "warning",
    message: "disk full",
  });
  expect(await effects.confirm(review!)).toBe(true);
  expect(attempts).toBe(2);
});

test("STATE-016 cancelled execution preserves review and permits a retry", async () => {
  let attempts = 0;
  const core = directSourceCore(workspaceProjection(), {
    removeSource: async (_request, options) => {
      attempts++;
      if (attempts === 1)
        return new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new SkillCliError("CANCELLED", "cancelled by user")),
          ),
        );
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = testEffects(core);
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  const first = effects.confirm(review!);
  effects.cancel();
  expect(await first).toBe(false);
  expect(effects.operation.problem()).toEqual({
    code: "CANCELLED",
    severity: "warning",
    message: "cancelled by user",
  });
  expect(await effects.confirm(review!)).toBe(true);
  expect(attempts).toBe(2);
});

test("STATE-023 rejects a preview with a missing or mismatched owner", async () => {
  const core = directSourceCore(workspaceProjection(), {
    previewSourceRemoval: async () => ({
      value: {
        kind: "source-removal",
        source: "team-main",
        installed: [],
        repairs: [],
        blockers: [],
        allowed: true,
      },
      diagnostics: [],
    }),
  });
  const effects = testEffects(core);
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(review).toBeUndefined();
  expect(effects.operation.problem()).toEqual({
    code: "TRANSACTION_CONFLICT",
    severity: "warning",
    message: "Source removal preview no longer matches the selected declaration",
  });
});

test("STATE-016 observation success after abort wins while its request remains current", async () => {
  let resolveDiscovery:
    | ((value: {
        readonly value: {
          readonly source: string;
          readonly kind: "github";
          readonly candidates: [];
        };
        readonly diagnostics: [];
      }) => void)
    | undefined;
  let aborted = 0;
  const core = directSourceCore(workspaceProjection(), {
    discover: (_request, options) =>
      new Promise((resolve) => {
        resolveDiscovery = resolve;
        options?.signal?.addEventListener("abort", () => aborted++);
      }),
  });
  const effects = testEffects(core);
  const pending = effects.discover({
    kind: "source-discovery",
    source: "team-main",
  });
  effects.cancel();
  resolveDiscovery!({
    value: { source: "team-main", kind: "github", candidates: [] },
    diagnostics: [],
  });
  expect((await pending)?.observation.source).toBe("team-main");
  expect(aborted).toBe(1);
  expect(effects.operation.notice()).toBe("Observation ready");
});

test("STATE-016 observation cancellation settles with Core's exact CANCELLED diagnostic", async () => {
  const core = directSourceCore(workspaceProjection(), {
    discover: (_request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () =>
          reject(new SkillCliError("CANCELLED", "provider stopped")),
        ),
      ),
  });
  const effects = testEffects(core);
  const pending = effects.discover({ kind: "source-discovery", source: "team-main" });
  effects.cancel();
  expect(await pending).toBeUndefined();
  expect(effects.operation.problem()).toEqual({
    code: "CANCELLED",
    severity: "warning",
    message: "provider stopped",
  });
});

test("STATE-013/017 source apply rejects fabricated reviews and preserves a real review for retry", async () => {
  let installs = 0;
  const core = directSourceCore(workspaceProjection(), {
    discover: async () => ({
      value: {
        source: "team-main",
        kind: "github",
        candidates: [{ path: "review", name: "review", description: "Review" }],
      },
      diagnostics: [],
    }),
    install: async () => {
      installs++;
      throw new SkillCliError("WRITE_FAILED", "disk full");
    },
  });
  const effects = testEffects(core);
  const review = await effects.discover({
    kind: "source-discovery",
    source: "team-main",
  });
  expect(await effects.install({ ...review!, id: "fabricated" }, ["review"])).toBe(false);
  expect(await effects.install(review!, ["review", "review"])).toBe(false);
  expect(await effects.install(review!, ["review"])).toBe(false);
  expect(await effects.install(review!, ["review"])).toBe(false);
  expect(installs).toBe(2);
});

test("STATE-017 mismatched observation retains the operation surface for a retry", async () => {
  let attempts = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      discover: async () => ({
        value: {
          source: ++attempts === 1 ? "other" : "team-main",
          kind: "github",
          candidates: [],
        },
        diagnostics: [],
      }),
    }),
  );
  expect(await effects.discover({ kind: "source-discovery", source: "team-main" })).toBeUndefined();
  expect(effects.operation.problem()).toEqual({
    code: "TRANSACTION_CONFLICT",
    severity: "warning",
    message: "Observed Source no longer matches the selected Source",
  });
  expect(
    (await effects.discover({ kind: "source-discovery", source: "team-main" }))?.observation.source,
  ).toBe("team-main");
});

test("STATE-016/018 successful install after abort wins and refresh failure remains stale success", async () => {
  let resolveInstall:
    | ((value: { readonly value: readonly never[]; readonly diagnostics: [] }) => void)
    | undefined;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      discover: async () => ({
        value: {
          source: "team-main",
          kind: "github",
          exactRevision: "pinned",
          candidates: [{ path: "review", name: "review", description: "Review" }],
        },
        diagnostics: [],
      }),
      install: async () => new Promise((resolve) => (resolveInstall = resolve)),
      get: async () => {
        throw new SkillCliError("PROVIDER_UNAVAILABLE", "refresh unavailable");
      },
    }),
  );
  const review = await effects.discover({ kind: "source-discovery", source: "team-main" });
  const applying = effects.install(review!, ["review"]);
  effects.cancel();
  resolveInstall!({ value: [], diagnostics: [] });
  expect(await applying).toBe(true);
  expect(effects.operation.notice()).toBe("Skills installed; Workspace is stale");
});

test("STATE-016/018 cancelled install retains its observed review and retries without rediscovery", async () => {
  let discovers = 0;
  let installs = 0;
  let refreshes = 0;
  const effects = testEffects(
    directSourceCore(workspaceProjection(), {
      discover: async () => {
        discovers++;
        return {
          value: {
            source: "team-main",
            kind: "github",
            exactRevision: "reviewed",
            candidates: [{ path: "review", name: "review", description: "Review" }],
          },
          diagnostics: [],
        };
      },
      install: (_request, options) => {
        installs++;
        if (installs === 1)
          return new Promise((_, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new SkillCliError("CANCELLED", "install cancelled")),
            ),
          );
        return Promise.resolve({ value: [], diagnostics: [] });
      },
      get: async () => {
        refreshes++;
        return { value: workspaceProjection(), diagnostics: [] };
      },
    }),
  );
  const review = await effects.discover({ kind: "source-discovery", source: "team-main" });
  const selectedPaths = ["review"] as const;
  const cancelled = effects.install(review!, selectedPaths);
  effects.cancel();
  expect(await cancelled).toBe(false);
  expect(effects.operation.problem()).toEqual({
    code: "CANCELLED",
    severity: "warning",
    message: "install cancelled",
  });
  expect(await effects.install(review!, selectedPaths)).toBe(true);
  expect({ discovers, installs, refreshes }).toEqual({ discovers: 1, installs: 2, refreshes: 1 });
});
