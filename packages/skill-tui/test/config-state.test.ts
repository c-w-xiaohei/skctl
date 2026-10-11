import { expect, test } from "bun:test";
import type { ManagementProjection } from "@skill-cli/core";
import { configDeclarationOwnerKey, createConfigState } from "../src/config/state";
import type { ConfigSection } from "../src/types";
import { workspaceProjection } from "./direct-source.fixture";

const sections: readonly ConfigSection[] = [
  "sources",
  "config-sources",
  "collections",
  "integrations",
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
        collectionUse: [],
        integrations:
          section === "integrations"
            ? values.map((pointer) => ({
                kind: "opencode" as const,
                owner: { level, file: `/${level}.jsonc`, pointer },
              }))
            : [],
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
      expect(state.selection(destination, section)).toBe(
        section === "integrations"
          ? configDeclarationOwnerKey({
              level: destination,
              file: `/${destination}.jsonc`,
              pointer: values[0]!,
            })
          : values[0],
      );

      state.select(
        destination,
        section === "integrations"
          ? configDeclarationOwnerKey({
              level: destination,
              file: `/${destination}.jsonc`,
              pointer: values[1]!,
            })
          : values[1],
      );
      state.reconcile(projection(section, values), projection(section, [values[0]!, values[2]!]));
      expect(state.selection(destination, section)).toBe(
        section === "integrations"
          ? configDeclarationOwnerKey({
              level: destination,
              file: `/${destination}.jsonc`,
              pointer: values[2]!,
            })
          : values[2],
      );

      state.select(
        destination,
        section === "integrations"
          ? configDeclarationOwnerKey({
              level: destination,
              file: `/${destination}.jsonc`,
              pointer: values[2]!,
            })
          : values[2],
      );
      state.reconcile(projection(section, values), projection(section, []));
      expect(state.selection(destination, section)).toBeUndefined();
    }
  }
});

test("ConfigState keeps the selected integration inspector surface separate from row selection", () => {
  const state = createConfigState();
  const owner = { level: "project", file: "/project.jsonc", pointer: "/agents/opencode" };
  state.land("project", "integrations", configDeclarationOwnerKey(owner));

  expect(state.integrationSurface("project")).toBe("list");
  state.openIntegrationInspector("project");
  expect(state.integrationSurface("project")).toBe("inspector");
  expect(state.selection("project", "integrations")).toBe(configDeclarationOwnerKey(owner));

  state.selectIntegrationCatalogEntry("project", "team:guide");
  expect(state.integrationSurface("project")).toBe("inspector");
  expect(state.integrationCatalogSelection("project")).toBe("team:guide");
  state.openIntegrationCatalogEntry("project", "team:guide");
  expect(state.integrationSurface("project")).toBe("catalog-entry");
  expect(state.integrationCatalogSelection("project")).toBe("team:guide");

  state.closeIntegrationSurface("project");
  expect(state.integrationSurface("project")).toBe("list");
  expect(state.integrationCatalogSelection("project")).toBeUndefined();
});
