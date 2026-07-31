import { expect, test } from "bun:test";
import { createCollectionsState } from "../../src/tui/collections/state";
import { createConfigState } from "../../src/tui/config/state";
import { createOperationState } from "../../src/tui/operation-state";
import { createProjection } from "../../src/tui/projection";
import { createWorkspaceState } from "../../src/tui/workspace/state";
import { workspaceProjection } from "./direct-source.fixture";

test("unrelated legacy updates do not change durable page snapshots", () => {
  const workspace = createWorkspaceState();
  const collections = createCollectionsState();
  const before = { workspace: workspace.snapshot(), collections: collections.snapshot() };
  expect({ workspace: workspace.snapshot(), collections: collections.snapshot() }).toEqual(before);
});

test("applyProjection synchronously reconciles Config action targets after accepted removals", () => {
  const operation = createOperationState();
  const config = createConfigState();
  const projection = createProjection(operation, {
    workspace: createWorkspaceState(),
    collections: createCollectionsState(),
    config,
  });
  const prior = configSelectionProjection(["first", "removed", "last"]);
  projection.outcomes.applyProjection(prior);

  for (const [section, selected] of [
    ["sources", "removed"],
    ["config-sources", "/configSources/removed"],
    ["collections", "removed"],
    ["for-agents", "removed"],
  ] as const) {
    projection.outcomes.applyProjection(prior);
    config.land("project", section, selected);
    projection.outcomes.applyProjection(configSelectionProjection(["first", "last"]));
    expect(config.selection("project", section)).toBe(
      section === "config-sources" ? "/configSources/last" : "last",
    );
  }
});

function configSelectionProjection(values: readonly string[]) {
  const base = workspaceProjection({ includeDirect: false, includeContribution: false });
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level !== "project"
        ? config
        : {
            ...config,
            direct: {
              ...config.direct,
              sources: values.map((id) => ({
                id,
                kind: "local" as const,
                origin: `/${id}`,
                root: ".",
                provenance: { level: "project" as const },
                selectors: [],
                ref: {
                  id,
                  owner: {
                    level: "project" as const,
                    file: config.file.file,
                    pointer: `/sources/${id}`,
                  },
                },
              })),
              configSources: values.map((id) => ({
                id,
                owner: {
                  level: "project" as const,
                  file: config.file.file,
                  pointer: `/configSources/${id}`,
                },
                binding: { kind: "local" as const, path: "/config", root: "." },
                adoption: { status: "live" as const },
                contributed: { sources: [], collections: [] },
              })),
              collections: values.map((id) => ({
                id,
                owner: {
                  level: "project" as const,
                  file: config.file.file,
                  pointer: `/collections/${id}`,
                },
              })),
              collectionUse: values.map((collection, index) => ({
                collection,
                owner: {
                  level: "project" as const,
                  file: config.file.file,
                  pointer: `/use/${index}`,
                },
              })),
            },
          },
    ),
  };
}
