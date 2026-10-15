import { expect, test } from "bun:test";
import { buildUpdateScope, createUpdatesState, updateSubmission } from "../src/updates/model";
import { directOwner, workspaceProjection } from "./direct-source.fixture";

function projection() {
  const base = workspaceProjection();
  if (base.effective.status !== "complete") throw new Error("fixture must be complete");
  const address = { source: "team-main", path: "guide" };
  return {
    ...base,
    installedSkills: [
      {
        address,
        name: "guide",
        description: "Guide",
        owner: {
          source: "team-main",
          health: "healthy" as const,
          relevantRemoteRevision: "a".repeat(40),
        },
        collections: [],
        selectors: [],
        selectorViews: { status: "complete" as const, values: [] },
        aliases: [],
        problems: [],
      },
    ],
    effective: {
      ...base.effective,
      collectionsView: [
        {
          id: "root",
          declared: [directOwner],
          repository: { derived: false, producers: [] },
          members: [{ name: "guide", address, paths: [] }],
          references: [],
          links: [],
        },
      ],
    },
  };
}

const observation = (source: string, changed: string[] = []) => ({
  source,
  kind: "github" as const,
  changed: changed.map((path) => ({ path, name: path, description: `${path} change` })),
  added: [{ path: "new", name: "new", description: "new root" }],
  removed: [{ path: "old", name: "old", description: "removed root" }],
  unchanged: [{ path: "same", name: "same", description: "same root" }],
  exactRevision: "a".repeat(40),
});

test("MODEL collection scope follows references, dedupes members, and intersects installed skills", () => {
  const snapshot = projection();
  const complete = snapshot.effective;
  if (complete.status !== "complete") throw new Error("fixture must be complete");
  const collection = complete.collectionsView[0]!;
  const expanded = {
    ...snapshot,
    effective: {
      ...complete,
      collectionsView: [
        {
          ...collection,
          id: "root",
          members: [collection.members[0]!],
          references: [
            {
              name: "child",
              collection: "child",
              description: "child",
              owner: collection.declared[0]!,
            },
          ],
          links: [],
        },
        {
          ...collection,
          id: "child",
          members: [collection.members[0]!],
          references: [
            {
              name: "loop",
              collection: "root",
              description: "loop",
              owner: collection.declared[0]!,
            },
          ],
          links: [],
        },
      ],
    },
  };
  const scope = buildUpdateScope(expanded, { kind: "collection", collection: "root" });
  expect(scope.addresses).toEqual([collection.members[0]!.address]);
  expect(scope.includesReferences).toBe(true);
});

test("MODEL selection only includes observed changed roots; new and removed remain informational", () => {
  const state = createUpdatesState(buildUpdateScope(projection(), { kind: "workspace" }));
  state.observe(observation("team-main", ["guide"]));
  state.toggle({ source: "team-main", path: "new" });
  expect(state.selected()).toEqual([{ source: "team-main", path: "guide" }]);
  state.toggle({ source: "team-main", path: "guide" });
  expect(state.disabledReason()).toBe("Select at least one changed Skill");
});

test("MODEL retry excludes successful sources and submission blocks projection drift", () => {
  const scope = buildUpdateScope(projection(), { kind: "source", source: "team-main" });
  const state = createUpdatesState(scope);
  state.observe(observation("team-main", ["guide"]));
  state.setResult("team-main", "succeeded");
  expect(state.retryable()).toEqual([]);
  state.setResult("team-main", "failed");
  expect(state.retryable()).toEqual([]);
  expect(state.group("team-main")?.committed).toBe(true);
  state.observe(observation("team-main", ["guide"]));
  state.toggle({ source: "team-main", path: "guide" });
  expect(state.selected()).toEqual([{ source: "team-main", path: "guide" }]);
  const changed = workspaceProjection({ includeDirect: false });
  expect(
    updateSubmission(scope, [{ source: "team-main", path: "guide" }], changed).reason,
  ).toContain("no longer installed");
});

test("MODEL preserves custom exclusions, prunes stale rechecks, and excludes succeeded groups from submit", () => {
  const state = createUpdatesState(buildUpdateScope(projection(), { kind: "workspace" }));
  state.observe(observation("team-main", ["guide"]));
  state.toggle({ source: "team-main", path: "guide" });
  state.observe(observation("team-main", ["guide", "newly-changed"]));
  expect(state.selected()).toEqual([]);
  state.toggle({ source: "team-main", path: "guide" });
  state.observe(observation("team-main", []));
  expect(state.selected()).toEqual([]);
  state.observe(observation("team-main", ["guide"]));
  state.setResult("team-main", "succeeded");
  expect(state.eligible()).toEqual([]);
  expect(state.disabledReason()).toBe("Select at least one changed Skill");
});

test("MODEL keeps a committed batch fact when a later check fails", () => {
  const state = createUpdatesState(buildUpdateScope(projection(), { kind: "workspace" }));
  state.observe(observation("team-main", ["guide"]));
  state.setResult("team-main", "succeeded");
  state.applyCheck({
    source: "team-main",
    status: "failed",
    error: "upstream unavailable",
    stale: true,
  });
  expect(state.group("team-main")).toMatchObject({ status: "failed", committed: true });
  expect(state.eligible()).toEqual([]);
});

test("MODEL rederives collection display membership without autoauthorizing a newly added member", () => {
  const original = projection();
  const state = createUpdatesState(
    buildUpdateScope(original, { kind: "collection", collection: "root" }),
  );
  state.observe(observation("team-main", ["guide"]));
  state.toggle({ source: "team-main", path: "guide" });
  const revised = {
    ...original,
    installedSkills: [
      ...original.installedSkills,
      {
        ...original.installedSkills[0]!,
        address: { source: "team-main", path: "replacement" },
        name: "replacement",
      },
    ],
    effective: {
      ...original.effective,
      collectionsView: original.effective.collectionsView.map((view) => ({
        ...view,
        members: [
          { name: "replacement", address: { source: "team-main", path: "replacement" }, paths: [] },
        ],
      })),
    },
  };
  const fresh = buildUpdateScope(revised, { kind: "collection", collection: "root" });
  state.reconcileCurrentScope(fresh);
  expect(state.scope.addresses).toEqual([{ source: "team-main", path: "replacement" }]);
  expect(state.selected()).toEqual([]);
  state.observe(observation("team-main", ["replacement"]));
  expect(state.selected()).toEqual([]);
  state.toggle({ source: "team-main", path: "replacement" });
  expect(state.selected()).toEqual([{ source: "team-main", path: "replacement" }]);
});

test("MODEL submission blocks owner, binding, and fresh collection-scope drift", () => {
  const scope = buildUpdateScope(projection(), { kind: "collection", collection: "root" });
  const selected = [{ source: "team-main", path: "guide" }];
  const unhealthy = {
    ...projection(),
    installedSkills: [
      {
        ...projection().installedSkills[0]!,
        owner: { source: "team-main", health: "drifted" as const },
      },
    ],
  };
  expect(updateSubmission(scope, selected, unhealthy).reason).toContain("unhealthy");
  const bindingChanged = projection();
  if (bindingChanged.effective.status !== "complete") throw new Error("fixture must be complete");
  const bindingChangedProjection = {
    ...bindingChanged,
    effective: {
      ...bindingChanged.effective,
      sources: [{ ...bindingChanged.effective.sources[0]!, origin: "https://example.test/other" }],
    },
  };
  expect(updateSubmission(scope, selected, bindingChangedProjection).reason).toContain(
    "binding changed",
  );
  const scopeChanged = projection();
  if (scopeChanged.effective.status !== "complete") throw new Error("fixture must be complete");
  const scopeChangedProjection = {
    ...scopeChanged,
    effective: {
      ...scopeChanged.effective,
      collectionsView: [{ ...scopeChanged.effective.collectionsView[0]!, members: [] }],
    },
  };
  expect(updateSubmission(scope, selected, scopeChangedProjection).reason).toContain(
    "current update scope",
  );
});

test("MODEL submission blocks public installed remote revision changes including missing-present transitions", () => {
  const original = projection();
  const scope = buildUpdateScope(original, { kind: "source", source: "team-main" });
  const selected = [{ source: "team-main", path: "guide" }];
  const changedRevision = {
    ...original,
    installedSkills: [
      {
        ...original.installedSkills[0]!,
        owner: { ...original.installedSkills[0]!.owner, relevantRemoteRevision: "b".repeat(40) },
      },
    ],
  };
  expect(updateSubmission(scope, selected, changedRevision).reason).toContain(
    "installed revision changed",
  );
  const missingRevision = {
    ...original,
    installedSkills: [
      {
        ...original.installedSkills[0]!,
        owner: { source: "team-main", health: "healthy" as const },
      },
    ],
  };
  expect(updateSubmission(scope, selected, missingRevision).reason).toContain(
    "installed revision changed",
  );
});
