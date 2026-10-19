import type { CollectionView, ConfigDeclarationOwner, WorkspaceView } from "@skctl/core";
import { sameSkillAddress, skillAddressKey } from "@skctl/core";

export interface CollectionFilter {
  readonly query?: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly agentUse?: readonly string[];
  readonly installedSkills?: WorkspaceView["installedSkills"];
}

export const collectionFilterDimensions = [
  "Contains Skill",
  "Config",
  "Exposure",
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
        (member) => skillAddressKey(member.address) === values["Contains Skill"],
      );
    const hasConfig =
      !values.Config || collection.declared.some((owner) => owner.level === values.Config);
    const exposure =
      !values.Exposure ||
      (filter.agentUse?.includes(collection.id) ?? false) === (values.Exposure === "Included");
    const problems =
      !values.Problems ||
      collection.members.some(
        (member) =>
          filter.installedSkills?.some(
            (skill) => sameSkillAddress(skill.address, member.address) && skill.problems.length > 0,
          ) ?? false,
      ) ===
        (values.Problems === "Has problems");
    return (
      hasSkill &&
      hasConfig &&
      exposure &&
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
          collection.members.map((member) => skillAddressKey(member.address)),
        ),
      ),
    ].sort();
  if (dimension === "Config")
    return [
      ...new Set(
        collections.flatMap((collection) => collection.declared.map((owner) => owner.level)),
      ),
    ].sort();
  if (dimension === "Exposure") return collectionAgentValues;
  return collectionProblemValues;
}
