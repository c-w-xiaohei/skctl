import { createSignal } from "solid-js";
import type { WorkspaceView } from "@skctl/core";
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
  readonly configSourceSurface: "list" | "inspector";
  readonly browserLevel: "categories" | "declarations" | "object";
  readonly scrolls: Readonly<Record<string, number>>;
}
const initial = (): ConfigSnapshot => ({
  section: "sources",
  selection: {} as Record<ConfigSection, string | undefined>,
  configSourceSurface: "list",
  browserLevel: "categories",
  scrolls: {},
});

const valuesFor = (
  projection: WorkspaceView | undefined,
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
  return [];
};

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
    setScroll(destination: ConfigDestination, key: string, offset: number) {
      if ((snapshot(destination).scrolls[key] ?? 0) === offset) return;
      update(destination, (current) => ({
        ...current,
        scrolls: { ...current.scrolls, [key]: offset },
      }));
    },
    showCategories(destination: ConfigDestination) {
      update(destination, (current) => ({
        ...current,
        browserLevel: "categories",
        configSourceSurface: "list",
      }));
    },
    showDeclarations(destination: ConfigDestination) {
      update(destination, (current) => ({
        ...current,
        browserLevel: "declarations",
        configSourceSurface: "list",
      }));
    },
    openObject(destination: ConfigDestination) {
      update(destination, (current) => ({ ...current, browserLevel: "object" }));
    },
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
          configSourceSurface: "list",
          browserLevel: current.section === section ? current.browserLevel : "declarations",
        }));
    },
    land(destination: ConfigDestination, section: ConfigSection, selection?: string) {
      if (validSections(destination).includes(section))
        update(destination, (current) => ({
          ...current,
          section,
          selection: { ...current.selection, [section]: selection },
          configSourceSurface: "list",
          browserLevel: "object",
        }));
    },
    configSourceSurface: (destination: ConfigDestination) =>
      snapshot(destination).configSourceSurface,
    openConfigSourceInspector(destination: ConfigDestination) {
      update(destination, (current) => ({
        ...current,
        configSourceSurface: "inspector",
        browserLevel: "object",
      }));
    },
    backConfigSourceSurface(destination: ConfigDestination) {
      update(destination, (current) => ({ ...current, configSourceSurface: "list" }));
    },
    reconcile(previous: WorkspaceView | undefined, current: WorkspaceView) {
      setSnapshots((snapshots) => {
        let changed = false;
        const next = { ...snapshots };
        for (const destination of ["global", "project", "local"] as const) {
          const snapshot = snapshots[destination];
          const selection = { ...snapshot.selection };
          let destinationChanged = false;
          for (const section of validSections(destination) as readonly ConfigSection[]) {
            if (section === "integrations") continue;
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
  | "setScroll"
  | "showCategories"
  | "showDeclarations"
  | "openObject"
  | "section"
  | "selection"
  | "configSourceSurface"
  | "openConfigSourceInspector"
  | "backConfigSourceSurface"
>;
