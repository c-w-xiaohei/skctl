import { expect, test } from "bun:test";
import type { WorkspaceView } from "@skctl/core";
import { createConfigState } from "../src/config/state";
import type { ConfigSection } from "../src/types";
import { workspaceProjection } from "./direct-source.fixture";

const sections: readonly ConfigSection[] = ["sources", "config-sources", "collections"];
const destinations = ["global", "project", "local"] as const;

function projection(section: ConfigSection, values: readonly string[]): WorkspaceView {
  const base = workspaceProjection({ includeDirect: false, includeContribution: false });
  return {
    ...base,
    configs: destinations.map((level) => ({
      level,
      file: { status: "valid" as const, file: `/${level}.jsonc` },
      direct: {
        sources:
          section === "sources"
            ? values.map((id) => ({
                id,
                kind: "local" as const,
                origin: `/${id}`,
                root: ".",
                provenance: { level },
                selectors: [],
                ref: { id, owner: { level, file: `/${level}.jsonc`, pointer: `/sources/${id}` } },
              }))
            : [],
        configSources:
          section === "config-sources"
            ? values.map((pointer) => ({
                id: pointer.slice(1),
                owner: { level, file: `/${level}.jsonc`, pointer },
                binding: { kind: "local" as const, path: "/config", root: "." },
                adoption: { status: "live" as const },
                contributed: { sources: [], collections: [] },
              }))
            : [],
        collections:
          section === "collections"
            ? values.map((id) => ({
                id,
                owner: { level, file: `/${level}.jsonc`, pointer: `/collections/${id}` },
              }))
            : [],
        collectionUse: [],
        integrations: [],
      },
      contributed: { sources: [], collections: [] },
    })),
  };
}

const valuesFor = (section: ConfigSection) =>
  section === "config-sources"
    ? ["/configSources/first", "/configSources/removed", "/configSources/last"]
    : ["first", "removed", "last"];

test("ConfigState reconciles every visible Config selection by level and section", () => {
  for (const destination of destinations) {
    for (const section of sections) {
      const values = valuesFor(section);
      const state = createConfigState();
      state.land(destination, section, values[0]);
      state.reconcile(projection(section, values), projection(section, [values[0]!, values[2]!]));
      expect(state.selection(destination, section)).toBe(values[0]);

      state.select(destination, values[1]);
      state.reconcile(projection(section, values), projection(section, [values[0]!, values[2]!]));
      expect(state.selection(destination, section)).toBe(values[2]);

      state.select(destination, values[2]);
      state.reconcile(projection(section, values), projection(section, []));
      expect(state.selection(destination, section)).toBeUndefined();
    }
  }
});

test("ConfigState preserves Config Source selection when leaving its inspector", () => {
  const state = createConfigState();
  state.land("project", "config-sources", "/configSources/team");
  state.openConfigSourceInspector("project");
  expect(state.configSourceSurface("project")).toBe("inspector");
  state.backConfigSourceSurface("project");
  expect(state.configSourceSurface("project")).toBe("list");
  expect(state.selection("project", "config-sources")).toBe("/configSources/team");
});

test("Settings snapshots preserve scope-specific browser levels and exact declarations", () => {
  const state = createConfigState();
  expect(state.snapshot("global").browserLevel).toBe("categories");
  state.land("project", "config-sources", "/configSources/team");
  state.openConfigSourceInspector("project");
  const saved = structuredClone(state.snapshot("project"));
  state.showDeclarations("project");
  state.showCategories("project");
  expect(state.selection("project")).toBe("/configSources/team");
  expect(state.snapshot("global").browserLevel).toBe("categories");
  state.restore("project", saved);
  expect(state.snapshot("project")).toEqual(saved);
  expect(state.snapshot("project").browserLevel).toBe("object");
  state.showDeclarations("project");
  expect(state.configSourceSurface("project")).toBe("list");
});
