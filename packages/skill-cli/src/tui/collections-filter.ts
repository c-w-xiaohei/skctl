import type { CollectionView, ConfigDeclarationOwner, ManagementProjection } from "../core/api";

export interface CollectionFilter {
  readonly query?: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly agentUse?: readonly string[];
  readonly installedSkills?: ManagementProjection["installedSkills"];
}

export const collectionFilterDimensions = [
  "Contains Skill",
  "Config",
  "For agents",
  "Problems",
] as const;
export type CollectionFilterDimension = (typeof collectionFilterDimensions)[number];
export const collectionAgentValues = ["Included", "Excluded"] as const;
export const collectionProblemValues = ["Has problems", "No problems"] as const;

const ownerText = (owner: ConfigDeclarationOwner) =>
  `${owner.level} ${owner.file} ${owner.pointer} ${owner.contribution?.configSource.pointer ?? ""}`;

const facts = (collection: CollectionView) =>
  [
    collection.id,
    ...collection.declared.map(ownerText),
    ...collection.repository.producers.map((producer) => `${producer.source}/${producer.path}`),
    ...collection.members.flatMap((member) => [
      member.name,
      `${member.address.source}/${member.address.path}`,
    ]),
    ...collection.references.flatMap((reference) => [
      reference.name,
      reference.collection,
      reference.description,
      ownerText(reference.owner),
    ]),
    ...collection.links.flatMap((link) => [link.collection, ownerText(link.owner)]),
  ].join("\n");

export function filterCollections(
  collections: readonly CollectionView[],
  filter: CollectionFilter,
): readonly CollectionView[] {
  const query = filter.query?.toLocaleLowerCase() ?? "";
  return collections.filter((collection) => {
    const values = filter.filters;
    const hasSkill =
      !values["Contains Skill"] ||
      collection.members.some(
        (member) => `${member.address.source}/${member.address.path}` === values["Contains Skill"],
      );
    const hasConfig =
      !values.Config || collection.declared.some((owner) => owner.level === values.Config);
    const forAgents =
      !values["For agents"] ||
      (filter.agentUse?.includes(collection.id) ?? false) === (values["For agents"] === "Included");
    const problems =
      !values.Problems ||
      collection.members.some(
        (member) =>
          filter.installedSkills?.some(
            (skill) =>
              skill.address.source === member.address.source &&
              skill.address.path === member.address.path &&
              skill.problems.length > 0,
          ) ?? false,
      ) ===
        (values.Problems === "Has problems");
    return (
      hasSkill &&
      hasConfig &&
      forAgents &&
      problems &&
      (!query || facts(collection).toLocaleLowerCase().includes(query))
    );
  });
}

export function collectionFilterValues(
  dimension: CollectionFilterDimension,
  collections: readonly CollectionView[],
): readonly string[] {
  if (dimension === "Contains Skill")
    return [
      ...new Set(
        collections.flatMap((collection) =>
          collection.members.map((member) => `${member.address.source}/${member.address.path}`),
        ),
      ),
    ].sort();
  if (dimension === "Config")
    return [
      ...new Set(
        collections.flatMap((collection) => collection.declared.map((owner) => owner.level)),
      ),
    ].sort();
  if (dimension === "For agents") return collectionAgentValues;
  return collectionProblemValues;
}

export const collectionContributionText = (collection: CollectionView): string => {
  const values = [
    ...collection.declared.map((owner) =>
      owner.contribution
        ? `${owner.level} / ${owner.contribution.configSource.pointer}`
        : owner.level,
    ),
    ...(collection.repository.derived ? ["Repository"] : []),
  ];
  return values.length ? values.join(" + ") : "Empty";
};
