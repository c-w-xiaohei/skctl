import { createSignal } from "solid-js";
import type { ConfigLevelView, ManagementProjection } from "../../core/api";
import { validSections, type ConfigSection, type Destination } from "../types";

type ConfigDestination = Exclude<Destination, "workspace">;
export interface ConfigSnapshot {
  readonly section: ConfigSection;
  readonly selection: Readonly<Record<ConfigSection, string | undefined>>;
}
const initial = (): ConfigSnapshot => ({
  section: "sources",
  selection: {} as Record<ConfigSection, string | undefined>,
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
  if (section === "for-agents") return config.direct.collectionUse.map((item) => item.collection);
  return integrationValues(config);
};

const integrationValues = (_config: ConfigLevelView): readonly string[] => [];

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
        update(destination, (current) => ({ ...current, section }));
    },
    land(destination: ConfigDestination, section: ConfigSection, selection?: string) {
      if (validSections(destination).includes(section))
        update(destination, (current) => ({
          ...current,
          section,
          selection: { ...current.selection, [section]: selection },
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
export type ConfigReadonly = Pick<ConfigState, "snapshot" | "section" | "selection">;
export type ConfigCommands = Omit<ConfigState, keyof ConfigReadonly>;
