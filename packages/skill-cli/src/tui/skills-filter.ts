import type { InstalledSkill } from "./model";

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

function searchableValues(skill: InstalledSkill): readonly string[] {
  return [
    skill.name,
    skill.description,
    skill.address.source,
    skill.address.path,
    `${skill.address.source}/${skill.address.path}`,
    ...skill.collections.flatMap((collection) => [collection.id, collection.entry]),
    ...skill.selectors,
    ...skill.aliases,
    ...(skill.selectorViews.status === "complete"
      ? skill.selectorViews.values.flatMap((view) => [view.selector, view.collection, view.entry])
      : []),
  ];
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
    if (query && !searchableValues(skill).some((value) => matches(value, query))) return false;
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
