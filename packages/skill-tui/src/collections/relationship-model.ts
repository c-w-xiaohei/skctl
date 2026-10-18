import type {
  CollectionView,
  ConfigDeclarationOwner,
  WorkspaceView,
  MemberOriginPath,
} from "@skill-cli/core";
import type { CollectionRelationRow } from "./relationship-inspector";

const ownerText = (owner: ConfigDeclarationOwner): string =>
  `${owner.level} ${owner.file} ${owner.pointer}`;
const ownerKey = (owner: ConfigDeclarationOwner): string =>
  JSON.stringify([owner.level, owner.file, owner.pointer, owner.namespace, owner.contribution]);
const relationKey = (
  kind: CollectionRelationRow["kind"],
  collection: string,
  target: string | undefined,
  owner: ConfigDeclarationOwner | undefined,
  name?: string,
): string => JSON.stringify([kind, collection, name, target, owner ? ownerKey(owner) : undefined]);

export const collectionRelationRows = (
  collectionId: string,
  projection: WorkspaceView,
): readonly CollectionRelationRow[] => {
  const effective = projection.effective;
  if (effective.status !== "complete") return [];
  const collection = effective.collectionsView.find((item) => item.id === collectionId);
  if (!collection) return [];
  const allSelectors = projection.installedSkills.flatMap((skill) =>
    skill.selectorViews.status === "complete" ? skill.selectorViews.values : [],
  );
  const selectors = allSelectors.filter((view) => view.collection === collectionId);
  const useOwners = [
    ...new Map(
      [
        ...selectors.flatMap((view) => view.useOwners),
        ...projection.configs.flatMap((config) =>
          config.direct.collectionUse
            .filter((use) => use.collection === collectionId)
            .map((use) => use.owner),
        ),
      ].map((owner) => [ownerKey(owner), owner]),
    ).values(),
  ];
  const rows: CollectionRelationRow[] = useOwners.map((owner) => ({
    key: relationKey("collection-use", collectionId, collectionId, owner),
    kind: "collection-use",
    label: "Collection Use",
    owner,
    effect: `${selectors.length} selector${selectors.length === 1 ? "" : "s"} exposed`,
    intent: { kind: "collection-use", collection: collectionId, owner },
  }));
  if (effective.use.includes(collectionId) && useOwners.length === 0)
    rows.push({
      key: relationKey("collection-use", collectionId, collectionId, undefined),
      kind: "collection-use",
      label: "Collection Use",
      target: collectionId,
      effect: "Owner unavailable · read-only",
    });
  rows.push(
    ...collection.references.map((reference) => ({
      key: relationKey(
        "collection-reference",
        collectionId,
        reference.collection,
        reference.owner,
        reference.name,
      ),
      kind: "collection-reference" as const,
      label: `Reference ${reference.name}`,
      target: reference.collection,
      targetAvailable: effective.collectionsView.some((item) => item.id === reference.collection),
      owner: reference.owner,
      effect: "Browse referenced Collection",
      intent: {
        kind: "collection-reference" as const,
        collection: collectionId,
        name: reference.name,
        target: reference.collection,
        description: reference.description,
        owner: reference.owner,
      },
    })),
    ...collection.links.map((link) => {
      const linkedSelectors = allSelectors.filter((view) =>
        view.paths.some(
          (path) =>
            path.kind === "via-link" &&
            path.links.some(
              (item) =>
                item.collection === collectionId && item.linkedCollection === link.collection,
            ),
        ),
      );
      return {
        key: relationKey("collection-link", collectionId, link.collection, link.owner),
        kind: "collection-link" as const,
        label: `Link ${link.collection}`,
        target: link.collection,
        owner: link.owner,
        effect: `${linkedSelectors.length} selector${linkedSelectors.length === 1 ? "" : "s"} exposed`,
        intent: {
          kind: "collection-link" as const,
          collection: collectionId,
          target: link.collection,
          owner: link.owner,
        },
      };
    }),
  );
  return rows;
};

export const pathText = (path: MemberOriginPath): string =>
  path.kind === "direct"
    ? path.owner?.contribution
      ? `${path.owner.level} / ${path.owner.contribution.configSource.pointer}`
      : (path.owner?.level ?? "Direct")
    : path.kind === "repository-derived"
      ? `Repository ${path.source}/${path.path}`
      : `via ${path.links.map((link) => link.linkedCollection).join(" -> ")}`;

export const compactAddress = (address: {
  readonly source: string;
  readonly path: string;
}): string => {
  const value = `${address.source}/${address.path}`;
  if (value.length <= 24) return value;
  const leaf = address.path.split("/").at(-1) ?? address.path;
  return `${address.source}/.../${leaf}`;
};

export interface CollectionRemovalRow {
  readonly key: string;
  readonly name: string;
  readonly address: { readonly source: string; readonly path: string };
  readonly path?: MemberOriginPath;
}

export const collectionRemovalPlan = (
  collection: Pick<CollectionView, "id" | "declared">,
  rows: readonly CollectionRemovalRow[],
) => {
  const removals = rows
    .filter(
      (
        row,
      ): row is CollectionRemovalRow & {
        readonly path: Extract<MemberOriginPath, { readonly kind: "direct" }>;
      } => row.path?.kind === "direct" && !!row.path.owner && !row.path.owner.contribution,
    )
    .flatMap((row) => {
      const owner = row.path!.owner!;
      const declaration = collection.declared.find(
        (candidate) =>
          !candidate.contribution &&
          candidate.level === owner.level &&
          candidate.file === owner.file &&
          candidate.namespace === owner.namespace &&
          owner.pointer === `${candidate.pointer}/members/${row.path!.entryName}`,
      );
      return declaration ? [{ ...row, entryName: row.path!.entryName, owner: declaration }] : [];
    });
  const grouped = new Map<string, { owner: ConfigDeclarationOwner; rows: typeof removals }>();
  for (const row of removals) {
    const key = ownerKey(row.owner);
    const rows = grouped.get(key)?.rows ?? [];
    rows.push(row);
    grouped.set(key, { owner: row.owner, rows });
  }
  const ownerGroups = [...grouped.values()];
  const explanations = rows.flatMap((row) => {
    const path = row.path;
    if (!path) return [`${row.name}: Origin unavailable`];
    if (path.kind === "direct" && !path.owner)
      return [`${row.name}: Direct Membership owner unavailable`];
    if (path.kind === "direct" && path.owner?.contribution)
      return [
        `${row.name}: Config Source ${ownerText(path.owner.contribution.configSource)} owns this contribution`,
      ];
    if (path.kind === "repository-derived")
      return [
        `${row.name}: Repository ${path.repository} (${path.source}/${path.path}) owns this entry`,
      ];
    if (path.kind === "via-link") {
      const link = path.links[0];
      return [
        `${row.name}: Link ${link ? `${link.collection} -> ${link.linkedCollection}` : "owner unavailable"} owns this entry`,
      ];
    }
    return [];
  });
  return {
    collection: collection.id,
    rows,
    removals,
    ownerGroups,
    explanations,
    executable: ownerGroups.length === 1 && removals.length > 0,
  };
};
