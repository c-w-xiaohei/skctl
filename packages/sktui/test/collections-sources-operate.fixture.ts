import type { CollectionView, WorkspaceView } from "@skctl/core";
import { readerProjection } from "./installed-reader.fixture";

export const operateCollectionOwner = {
  level: "project" as const,
  file: "/workspace/skctl/skctl.jsonc",
  pointer: "/collections/team",
};

/** Core-shaped input; visible lists/counts/eligibility remain production derivations. */
export function collectionsSourcesProjection(): WorkspaceView {
  const base = readerProjection();
  if (base.effective.status !== "complete") throw new Error("Expected complete fixture");
  const empty = (id: string): CollectionView => ({
    id,
    declared: [{ ...operateCollectionOwner, pointer: `/collections/${id}` }],
    repository: { derived: false, producers: [] },
    members: [],
    references: [],
    links: [],
  });
  const team: CollectionView = {
    ...empty("team"),
    description:
      "Review and write with the team. Read installed Skills or follow the documentation collection.",
    members: base.installedSkills.map((skill) => ({
      name: skill.name,
      address: skill.address,
      paths: [
        {
          kind: "direct" as const,
          collection: "team",
          entryName: skill.name,
          owner: {
            ...operateCollectionOwner,
            pointer: `${operateCollectionOwner.pointer}/members/${skill.name}`,
          },
        },
      ],
    })),
    references: [
      {
        name: "docs",
        collection: "docs",
        description: "Team documentation",
        owner: {
          ...operateCollectionOwner,
          pointer: `${operateCollectionOwner.pointer}/references/docs`,
        },
      },
    ],
  };
  const collections = [
    team,
    empty("docs"),
    ...Array.from({ length: 26 }, (_, i) => empty(`collection-${String(i + 1).padStart(2, "0")}`)),
  ];
  return {
    ...base,
    configs: base.configs.map((config) =>
      config.level === "project"
        ? {
            ...config,
            direct: {
              ...config.direct,
              collections: collections.map((collection) => ({
                id: collection.id,
                owner: collection.declared[0]!,
              })),
            },
          }
        : config,
    ),
    effective: {
      ...base.effective,
      collections: collections.map((collection) => collection.id),
      collectionsView: collections,
    },
    installedSkills: base.installedSkills.map((skill) => ({
      ...skill,
      selectorViews: { status: "complete", values: [] },
      collections: [
        {
          id: team.id,
          entry: skill.name,
          paths: team.members.find((member) => member.name === skill.name)!.paths,
        },
      ],
    })),
  };
}
