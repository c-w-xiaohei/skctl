import type { CollectionRelationshipIntent } from "./relationship-inspector";

export interface CollectionTableColumn {
  readonly key: string;
  readonly label: string;
}

export interface CollectionTableRow<T = unknown> {
  readonly key: string;
  readonly value: string;
  readonly domain: T;
  readonly cells: readonly string[];
  readonly destination: "Membership details" | "Relationship details" | "Collection details";
}

export const collectionEntryColumns: readonly CollectionTableColumn[] = [
  { key: "name", label: "Name" },
  { key: "skill", label: "Skill" },
  { key: "origin", label: "Origin" },
];

export const collectionRelationColumns: readonly CollectionTableColumn[] = [
  { key: "kind", label: "Kind" },
  { key: "target", label: "Target" },
  { key: "owner", label: "Owner" },
  { key: "effect", label: "Effect" },
];

export type CollectionEntryDomain = {
  readonly name: string;
  readonly address: { readonly source: string; readonly path: string };
};

export type CollectionRelationDomain = {
  readonly intent?: CollectionRelationshipIntent;
};

export const collectionOptionText = (row: CollectionTableRow): string =>
  `${row.cells.join("  ")} -> ${row.destination}`;
