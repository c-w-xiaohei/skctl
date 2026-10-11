import type { InstalledSkill } from "./types";

export interface SkillsFilterState {
  readonly query?: string;
  readonly source?: string;
  readonly filters?: Readonly<Record<string, string>>;
  readonly agentStatus?: "available" | "unavailable";
}

const matches = (value: string, query: string) => value.toLocaleLowerCase().includes(query);

function configValue(skill: InstalledSkill): string | undefined {
  const source = skill.source;
  if (!source) return undefined;
  const owner = source.contribution?.configSource;
  return owner ? `${owner.level} ${owner.pointer}` : source.provenance.level;
}

function searchableValues(
  skill: InstalledSkill,
): readonly { readonly field: string; readonly value: string }[] {
  return [
    { field: "Name", value: skill.name },
    { field: "Description", value: skill.description },
    { field: "Source", value: skill.address.source },
    { field: "Path", value: skill.address.path },
    { field: "Path", value: `${skill.address.source}/${skill.address.path}` },
    ...skill.collections.flatMap((collection) => [
      { field: "Collection", value: collection.id },
      { field: "Collection", value: collection.entry },
    ]),
    ...skill.selectors.map((value) => ({ field: "Selector", value })),
    ...skill.aliases.map((value) => ({ field: "Alias", value })),
    ...(skill.selectorViews.status === "complete"
      ? skill.selectorViews.values.flatMap((view) => [
          { field: "Selector", value: view.selector },
          { field: "Collection", value: view.collection },
          { field: "Collection", value: view.entry },
        ])
      : []),
  ];
}

/** The same match used by filtering, with a short explanation for the result row. */
export function skillSearchMatch(
  skill: InstalledSkill,
  query: string,
  full = false,
): { readonly field: string; readonly value: string } | undefined {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return undefined;
  const match = searchableValues(skill).find(({ value }) => matches(value, needle));
  if (!match) return undefined;
  if (full) return match;
  const value = match.value.replace(/\s+/g, " ");
  const index = value.toLocaleLowerCase().indexOf(needle);
  const start = Math.max(0, index);
  const end = Math.min(value.length, Math.max(start + 100, index + needle.length + 24));
  return {
    field: match.field,
    value: `${start ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`,
  };
}

function matchesDimension(
  skill: InstalledSkill,
  dimension: string,
  value: string,
  agentStatus: SkillsFilterState["agentStatus"],
): boolean {
  if (dimension === "Collection")
    return skill.collections.some((collection) => collection.id === value);
  if (dimension === "Source") return skill.owner.source === value;
  if (dimension === "Config") return configValue(skill) === value;
  if (dimension === "For agents") {
    const available =
      skill.selectorViews.status === "complete" && skill.selectorViews.values.length > 0;
    if (value === "Available") return available;
    if (value === "Not disclosed") return agentStatus === "available" && !available;
    return value === "Unavailable" ? agentStatus === "unavailable" : false;
  }
  if (dimension === "Problems") {
    const unhealthy = skill.owner.health !== "healthy";
    return value === "Has problems" ? unhealthy || skill.problems.length > 0 : false;
  }
  return true;
}

export function filterSkills(
  skills: readonly InstalledSkill[],
  state: SkillsFilterState,
): readonly InstalledSkill[] {
  const query = state.query?.trim().toLocaleLowerCase();
  return skills.filter((skill) => {
    if (state.source && skill.address.source !== state.source) return false;
    if (query && !searchableValues(skill).some(({ value }) => matches(value, query))) return false;
    return Object.entries(state.filters ?? {}).every(([dimension, value]) =>
      value ? matchesDimension(skill, dimension, value, state.agentStatus) : true,
    );
  });
}

export function filterValues(
  skills: readonly InstalledSkill[],
  dimension: string,
  agentStatus?: SkillsFilterState["agentStatus"],
): readonly string[] {
  const values = new Set<string>();
  for (const skill of skills) {
    if (dimension === "Collection")
      skill.collections.forEach((collection) => values.add(collection.id));
    else if (dimension === "Source") values.add(skill.owner.source);
    else if (dimension === "Config") {
      const value = configValue(skill);
      if (value) values.add(value);
    }
  }
  if (dimension === "For agents")
    return agentStatus === "unavailable" ? ["Unavailable"] : ["Available", "Not disclosed"];
  if (dimension === "Problems") return ["Has problems"];
  return [...values].sort();
}
