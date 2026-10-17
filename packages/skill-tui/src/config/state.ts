import { createSignal } from "solid-js";
import type { ConfigLevelView, ManagementProjection } from "@skill-cli/core";
import { validSections, type ConfigSection, type Destination } from "../types";

type ConfigDestination = Exclude<Destination, "workspace">;
export const configDeclarationOwnerKey = (owner: {
  readonly level: string;
  readonly file: string;
  readonly pointer: string;
  readonly namespace?: string;
  readonly contribution?: unknown;
}): string =>
  JSON.stringify([owner.level, owner.file, owner.pointer, owner.namespace, owner.contribution]);
export interface ConfigSnapshot {
  readonly section: ConfigSection;
  readonly selection: Readonly<Record<ConfigSection, string | undefined>>;
  readonly integrationSurface: "list" | "inspector" | "catalog-entry";
  readonly integrationCatalogSelection?: string;
  readonly configSourceSurface: "list" | "inspector";
}
const initial = (): ConfigSnapshot => ({
  section: "sources",
  selection: {} as Record<ConfigSection, string | undefined>,
  integrationSurface: "list",
  configSourceSurface: "list",
});

const valuesFor = (
  projection: ManagementProjection | undefined,
  destination: ConfigDestination,
  section: ConfigSection,
): readonly string[] => {
  const config = projection?.configs.find((item) => item.level === destination);
  if (!config) return [];
  if (section === "sources")
    return [...config.direct.sources, ...config.contributed.sources].map((item) => item.id);
  if (section === "config-sources")
    return config.direct.configSources.map((item) => item.owner.pointer);
  if (section === "collections")
    return [...config.direct.collections.map((item) => item.id), ...config.contributed.collections];
  return projection
    ? integrationValues(projection, config)
    : config.direct.integrations.map((item) => item.owner.pointer);
};

const integrationValues = (
  projection: ManagementProjection,
  config: ConfigLevelView,
): readonly string[] => [
  ...config.direct.integrations.map((item) => configDeclarationOwnerKey(item.owner)),
  ...(projection.effective.agent.integration ?? [])
    .filter(
      (owner) =>
        !config.direct.integrations.some(
          (item) => configDeclarationOwnerKey(item.owner) === configDeclarationOwnerKey(owner),
        ),
    )
    .map((owner) => configDeclarationOwnerKey(owner)),
];

const nearest = (
  selected: string | undefined,
  current: readonly string[],
  previous: readonly string[],
): string | undefined => {
  if (current.length === 0) return undefined;
  if (selected && current.includes(selected)) return selected;
  const priorIndex = selected ? previous.indexOf(selected) : -1;
  return current[priorIndex < 0 ? 0 : Math.min(priorIndex, current.length - 1)];
};

export function createConfigState() {
  const [snapshots, setSnapshots] = createSignal<Record<ConfigDestination, ConfigSnapshot>>({
    global: initial(),
    project: initial(),
    local: initial(),
  });
  const snapshot = (destination: ConfigDestination) => snapshots()[destination];
  const update = (
    destination: ConfigDestination,
    change: (current: ConfigSnapshot) => ConfigSnapshot,
  ) =>
    setSnapshots((current) => {
      const next = change(current[destination]);
      return JSON.stringify(next) === JSON.stringify(current[destination])
        ? current
        : { ...current, [destination]: next };
    });
  return {
    snapshot,
    restore(destination: ConfigDestination, next: ConfigSnapshot) {
      setSnapshots((current) => ({ ...current, [destination]: structuredClone(next) }));
    },
    section: (destination: ConfigDestination) => snapshot(destination).section,
    selection: (destination: ConfigDestination, section = snapshot(destination).section) =>
      snapshot(destination).selection[section],
    select(destination: ConfigDestination, selection?: string) {
      update(destination, (current) => ({
        ...current,
        selection: { ...current.selection, [current.section]: selection },
      }));
    },
    selectSection(destination: ConfigDestination, section: ConfigSection) {
      if (validSections(destination).includes(section))
        update(destination, (current) => ({
          ...current,
          section,
          ...(section === "integrations"
            ? {}
            : {
                integrationSurface: "list",
                integrationCatalogSelection: undefined,
                configSourceSurface: "list",
              }),
        }));
    },
    land(destination: ConfigDestination, section: ConfigSection, selection?: string) {
      if (validSections(destination).includes(section))
        update(destination, (current) => ({
          ...current,
          section,
          selection: { ...current.selection, [section]: selection },
          ...(section === "integrations"
            ? {}
            : {
                integrationSurface: "list",
                integrationCatalogSelection: undefined,
                configSourceSurface: "list",
              }),
        }));
    },
    configSourceSurface: (destination: ConfigDestination) =>
      snapshot(destination).configSourceSurface,
    openConfigSourceInspector(destination: ConfigDestination) {
      update(destination, (current) => ({ ...current, configSourceSurface: "inspector" }));
    },
    backConfigSourceSurface(destination: ConfigDestination) {
      update(destination, (current) => ({ ...current, configSourceSurface: "list" }));
    },
    integrationSurface: (destination: ConfigDestination) =>
      snapshot(destination).integrationSurface,
    integrationCatalogSelection: (destination: ConfigDestination) =>
      snapshot(destination).integrationCatalogSelection,
    selectIntegrationCatalogEntry(destination: ConfigDestination, selector: string) {
      update(destination, (current) =>
        current.integrationSurface === "inspector"
          ? { ...current, integrationCatalogSelection: selector }
          : current,
      );
    },
    openIntegrationInspector(destination: ConfigDestination) {
      update(destination, (current) => ({
        ...current,
        integrationSurface: "inspector",
        integrationCatalogSelection: undefined,
      }));
    },
    openIntegrationCatalogEntry(destination: ConfigDestination, selector: string) {
      update(destination, (current) => ({
        ...current,
        integrationSurface: "catalog-entry",
        integrationCatalogSelection: selector,
      }));
    },
    backIntegrationSurface(destination: ConfigDestination) {
      update(destination, (current) => ({
        ...current,
        integrationSurface: current.integrationSurface === "catalog-entry" ? "inspector" : "list",
        integrationCatalogSelection:
          current.integrationSurface === "catalog-entry"
            ? current.integrationCatalogSelection
            : undefined,
      }));
    },
    closeIntegrationSurface(destination: ConfigDestination) {
      update(destination, (current) => ({
        ...current,
        integrationSurface: "list",
        integrationCatalogSelection: undefined,
      }));
    },
    reconcile(previous: ManagementProjection | undefined, current: ManagementProjection) {
      setSnapshots((snapshots) => {
        let changed = false;
        const next = { ...snapshots };
        for (const destination of ["global", "project", "local"] as const) {
          const snapshot = snapshots[destination];
          const selection = { ...snapshot.selection };
          let destinationChanged = false;
          for (const section of validSections(destination) as readonly ConfigSection[]) {
            const reconciled = nearest(
              selection[section],
              valuesFor(current, destination, section),
              valuesFor(previous, destination, section),
            );
            if (reconciled !== selection[section]) {
              selection[section] = reconciled;
              changed = true;
              destinationChanged = true;
            }
          }
          if (destinationChanged) next[destination] = { ...snapshot, selection };
        }
        return changed ? next : snapshots;
      });
    },
  };
}

export type ConfigState = ReturnType<typeof createConfigState>;
export type ConfigReadonly = Pick<
  ConfigState,
  | "snapshot"
  | "section"
  | "selection"
  | "integrationSurface"
  | "integrationCatalogSelection"
  | "configSourceSurface"
  | "selectIntegrationCatalogEntry"
  | "openIntegrationInspector"
  | "openIntegrationCatalogEntry"
  | "backIntegrationSurface"
  | "closeIntegrationSurface"
  | "openConfigSourceInspector"
  | "backConfigSourceSurface"
>;
