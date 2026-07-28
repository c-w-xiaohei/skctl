import { expect, test } from "bun:test";
import { SkillCliError } from "../../src/core/api";
import { createTuiEffects } from "../../src/tui/effects";
import { directOwner, directSourceCore, workspaceProjection } from "./direct-source.fixture";

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
  const effects = createTuiEffects(core);
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

test("MGMT-007/008 only applies selected changed paths and never installs added or removes retained paths", async () => {
  const calls: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    checkUpdate: async () => ({
      value: {
        source: "team-main",
        kind: "github",
        exactRevision: "observed-commit",
        changed: [{ path: "review", name: "review", description: "Changed" }],
        added: [{ path: "new", name: "new", description: "New" }],
        removed: [{ path: "old", name: "old", description: "Removed" }],
        unchanged: [{ path: "same", name: "same", description: "Unchanged" }],
      },
      diagnostics: [],
    }),
    update: async (request) => {
      calls.push(request);
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = createTuiEffects(core);
  const observation = await effects.checkUpdate({
    kind: "source-update",
    source: "team-main",
  });
  expect(await effects.update(observation!, [])).toBe(false);
  expect(await effects.update(observation!, ["review"])).toBe(true);
  expect(calls).toEqual([
    {
      source: "team-main",
      paths: ["review"],
      exactRevision: "observed-commit",
    },
  ]);
});

test("Installed Skill update applies only its selected changed root", async () => {
  const calls: unknown[] = [];
  const effects = createTuiEffects(
    directSourceCore(workspaceProjection(), {
      checkUpdate: async () => ({
        value: {
          source: "team-main",
          kind: "github",
          changed: [
            { path: "guide", name: "guide", description: "selected" },
            { path: "other", name: "other", description: "sibling" },
          ],
          added: [{ path: "new", name: "new", description: "new" }],
          removed: [{ path: "gone", name: "gone", description: "removed" }],
          unchanged: [],
        },
        diagnostics: [],
      }),
      update: async (request) => {
        calls.push(request);
        return { value: undefined, diagnostics: [] };
      },
    }),
  );
  const review = await effects.checkUpdate({
    kind: "source-update",
    source: "team-main",
    selectedPath: "guide",
  });
  expect(await effects.update(review!, ["other"])).toBe(false);
  expect(await effects.update(review!, ["guide"])).toBe(true);
  expect(calls).toEqual([{ source: "team-main", paths: ["guide"], exactRevision: undefined }]);
});

test("Installed Skill Rebind passes the explicit replacement root through preview and execution", async () => {
  const calls: unknown[] = [];
  const effects = createTuiEffects(
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
    preview: async () => {
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
    remove: async () => {
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
  const effects = createTuiEffects(core);
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
  const events: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    preview: async (_options) =>
      new Promise((_, reject) => {
        _options?.signal?.addEventListener("abort", () => {
          aborted++;
          reject(new SkillCliError("CANCELLED", "cancelled"));
        });
      }),
  });
  const effects = createTuiEffects(core, (event) => events.push(event));
  const pending = effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  effects.cancel();
  await expect(pending).resolves.toBeUndefined();
  expect(events).toEqual([]);
  expect(aborted).toBe(1);
});

test("MGMT-003 never executes a blocked impact", async () => {
  let removed = false;
  const core = directSourceCore(workspaceProjection(), {
    preview: async () => ({
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
    remove: async () => {
      removed = true;
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = createTuiEffects(core);
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
  const events: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    remove: async () => {
      attempts++;
      if (attempts === 1) throw new SkillCliError("WRITE_FAILED", "disk full");
      return { value: undefined, diagnostics: [] };
    },
  });
  const effects = createTuiEffects(core, (event) => events.push(event));
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(await effects.confirm(review!)).toBe(false);
  expect(await effects.confirm(review!)).toBe(true);
  expect(attempts).toBe(2);
  expect(events).toContainEqual({
    type: "task.settle",
    id: "2",
    status: "disk full",
    error: { code: "WRITE_FAILED", severity: "warning", message: "disk full" },
  });
});

test("STATE-016 cancelled execution preserves review and permits a retry", async () => {
  let attempts = 0;
  const events: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    remove: async (options) => {
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
  const effects = createTuiEffects(core, (event) => events.push(event));
  const review = await effects.review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  const first = effects.confirm(review!);
  effects.cancel();
  expect(await first).toBe(false);
  expect(await effects.confirm(review!)).toBe(true);
  expect(attempts).toBe(2);
  expect(events).toContainEqual({
    type: "task.settle",
    id: "2",
    status: "Operation cancelled",
    error: {
      code: "CANCELLED",
      severity: "warning",
      message: "cancelled by user",
    },
  });
});

test("STATE-023 rejects a preview with a missing or mismatched owner", async () => {
  const events: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    preview: async () => ({
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
  const review = await createTuiEffects(core, (event) => events.push(event)).review({
    kind: "source-removal",
    source: "team-main",
    owner: directOwner,
  });
  expect(review).toBeUndefined();
  expect(events).toContainEqual({
    type: "operation.failure",
    diagnostic: {
      code: "TRANSACTION_CONFLICT",
      severity: "warning",
      message: "Source removal preview no longer matches the selected declaration",
    },
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
  const events: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    discover: (_request, options) =>
      new Promise((resolve) => {
        resolveDiscovery = resolve;
        options?.signal?.addEventListener("abort", () => aborted++);
      }),
  });
  const effects = createTuiEffects(core, (event) => events.push(event));
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
  expect(events).toContainEqual({
    type: "task.start",
    task: {
      id: "1",
      title: "Observing Source",
      cancellationRequested: false,
      semanticOwner: "team-main",
    },
  });
  expect(events).toContainEqual({ type: "task.cancel.request", id: "1" });
});

test("STATE-016 observation cancellation settles with Core's exact CANCELLED diagnostic", async () => {
  const events: unknown[] = [];
  const core = directSourceCore(workspaceProjection(), {
    discover: (_request, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () =>
          reject(new SkillCliError("CANCELLED", "provider stopped")),
        ),
      ),
  });
  const effects = createTuiEffects(core, (event) => events.push(event));
  const pending = effects.discover({ kind: "source-discovery", source: "team-main" });
  effects.cancel();
  expect(await pending).toBeUndefined();
  expect(events).toContainEqual({
    type: "task.settle",
    id: "1",
    status: "Observation cancelled",
    error: { code: "CANCELLED", severity: "warning", message: "provider stopped" },
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
  const effects = createTuiEffects(core);
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
  const events: unknown[] = [];
  const effects = createTuiEffects(
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
    (event) => events.push(event),
  );
  expect(await effects.discover({ kind: "source-discovery", source: "team-main" })).toBeUndefined();
  expect(events).toContainEqual({
    type: "task.settle",
    id: "1",
    status: "Observed Source no longer matches the selected Source",
    error: {
      code: "TRANSACTION_CONFLICT",
      severity: "warning",
      message: "Observed Source no longer matches the selected Source",
    },
  });
  expect(
    (await effects.discover({ kind: "source-discovery", source: "team-main" }))?.observation.source,
  ).toBe("team-main");
});

test("STATE-016/018 successful install after abort wins and refresh failure remains stale success", async () => {
  let resolveInstall:
    | ((value: { readonly value: readonly never[]; readonly diagnostics: [] }) => void)
    | undefined;
  const events: unknown[] = [];
  const effects = createTuiEffects(
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
    (event) => events.push(event),
  );
  const review = await effects.discover({ kind: "source-discovery", source: "team-main" });
  const applying = effects.install(review!, ["review"]);
  effects.cancel();
  resolveInstall!({ value: [], diagnostics: [] });
  expect(await applying).toBe(true);
  expect(events).toContainEqual({
    type: "task.settle",
    id: "2",
    status: "Skills installed; Workspace is stale",
  });
});

test("STATE-016/018 cancelled install retains its observed review and retries without rediscovery", async () => {
  let discovers = 0;
  let installs = 0;
  let refreshes = 0;
  const events: unknown[] = [];
  const effects = createTuiEffects(
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
    (event) => events.push(event),
  );
  const review = await effects.discover({ kind: "source-discovery", source: "team-main" });
  const selectedPaths = ["review"] as const;
  const cancelled = effects.install(review!, selectedPaths);
  effects.cancel();
  expect(await cancelled).toBe(false);
  expect(events).toContainEqual({
    type: "task.settle",
    id: "2",
    status: "Operation cancelled",
    error: { code: "CANCELLED", severity: "warning", message: "install cancelled" },
  });
  expect(await effects.install(review!, selectedPaths)).toBe(true);
  expect({ discovers, installs, refreshes }).toEqual({ discovers: 1, installs: 2, refreshes: 1 });
});
