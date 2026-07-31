import { expect, test } from "bun:test";
import type { ManagementProjection } from "../../src/core/api";
import { createConfigState } from "../../src/tui/config/state";
import type { ConfigSection } from "../../src/tui/types";
import { workspaceProjection } from "./direct-source.fixture";

const sections: readonly ConfigSection[] = [
  "sources",
  "config-sources",
  "collections",
  "for-agents",
];
const destinations = ["global", "project", "local"] as const;

function projection(section: ConfigSection, values: readonly string[]): ManagementProjection {
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
        collectionUse:
          section === "for-agents"
            ? values.map((collection, index) => ({
                collection,
                owner: { level, file: `/${level}.jsonc`, pointer: `/use/${index}` },
              }))
            : [],
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
