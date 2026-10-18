import type { SkillAddress } from "../source/schema";
import type { CollectionDeclaration, CollectionReference } from "./schema";
import { SkillCliError } from "../shared";
import { type ConfigDeclarationOwner } from "../config/types";

export interface InstalledIdentity extends SkillAddress {
  readonly name: string;
  readonly repository?: string;
}

export interface CollectionContribution {
  readonly id: string;
  readonly declaration: CollectionDeclaration;
  readonly owner?: ConfigDeclarationOwner;
}
export interface ResolvedCollections {
  readonly members: ReadonlyMap<string, ReadonlyMap<string, SkillAddress>>;
  readonly origins: ReadonlyMap<string, ReadonlyMap<string, readonly MemberOriginPath[]>>;
  readonly references: ReadonlyMap<string, Readonly<Record<string, CollectionReference>>>;
  readonly missing: ReadonlySet<string>;
}
export interface ResolvedMember {
  readonly address: SkillAddress;
  readonly paths: readonly MemberOriginPath[];
}
export type MemberOriginPath =
  | {
      readonly kind: "direct";
      readonly collection: string;
      readonly entryName: string;
      readonly owner?: ConfigDeclarationOwner;
    }
  | {
      readonly kind: "via-link";
      readonly links: readonly {
        readonly collection: string;
        readonly linkedCollection: string;
        readonly owner?: ConfigDeclarationOwner;
      }[];
    }
  | {
      readonly kind: "repository-derived";
      readonly repository: string;
      readonly source: string;
      readonly path: string;
    };
export class CollectionResolutionError extends SkillCliError {
  constructor(
    code: "CONFIG_CONFLICT" | "EXPOSURE_CONFLICT",
    message: string,
    readonly details:
      | { readonly kind: "cycle"; readonly collections: readonly string[] }
      | {
          readonly kind: "conflict";
          readonly name: string;
          readonly existing: ResolvedMember;
          readonly proposed: ResolvedMember;
        },
  ) {
    super(code, message);
  }
}
export interface CollectionUse {
  readonly complete: boolean;
  readonly members: ResolvedCollections["members"];
  readonly reason?: string;
}

/** An opaque tuple key for internal maps; it is not Skill Address shorthand. */
export const skillAddressKey = (address: SkillAddress) =>
  JSON.stringify([address.source, address.path]);

export const sameSkillAddress = (left: SkillAddress, right: SkillAddress) =>
  left.source === right.source && left.path === right.path;

export function resolveCollections(
  collections: readonly CollectionContribution[],
  installed: readonly InstalledIdentity[],
): ResolvedCollections {
  const identityKeys = new Set(installed.map(skillAddressKey));
  const declared = new Map<string, CollectionContribution>();
  for (const contribution of [...collections].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const current = declared.get(contribution.id);
    if (current)
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        `Collection is declared more than once: ${contribution.id}`,
      );
    declared.set(contribution.id, contribution);
  }
  const derived = new Map<string, Map<string, InstalledIdentity>>();
  for (const item of installed) {
    if (!item.repository) continue;
    const members = derived.get(item.repository) ?? new Map<string, InstalledIdentity>();
    const current = members.get(item.name);
    if (current && !sameSkillAddress(current, item))
      throw new SkillCliError("EXPOSURE_CONFLICT", `Collection member conflict: ${item.name}`);
    members.set(item.name, item);
    derived.set(item.repository, members);
  }
  const result = new Map<string, ReadonlyMap<string, SkillAddress>>();
  const origins = new Map<string, ReadonlyMap<string, readonly MemberOriginPath[]>>();
  const missing = new Set<string>();
  const references = new Map<string, Readonly<Record<string, CollectionReference>>>();
  const visiting = new Set<string>();
  const route: string[] = [];
  const resolveOne = (id: string): ReadonlyMap<string, SkillAddress> => {
    const cached = result.get(id);
    if (cached) return cached;
    const contribution = declared.get(id);
    const declaration = contribution?.declaration ?? {};
    if (!contribution && !derived.has(id))
      throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${id}`);
    if (visiting.has(id)) {
      const cycle = [...route.slice(route.indexOf(id)), id];
      throw new CollectionResolutionError(
        "CONFIG_CONFLICT",
        `Collection Links must be acyclic: ${cycle.join(" -> ")}`,
        { kind: "cycle", collections: cycle },
      );
    }
    visiting.add(id);
    route.push(id);
    const members = new Map<string, SkillAddress>();
    const memberOrigins = new Map<string, MemberOriginPath[]>();
    const add = (name: string, address: SkillAddress, paths: readonly MemberOriginPath[]) => {
      const current = members.get(name);
      if (current && !sameSkillAddress(current, address))
        throw new CollectionResolutionError(
          "EXPOSURE_CONFLICT",
          `Collection member conflict: ${name}`,
          {
            kind: "conflict",
            name,
            existing: { address: current, paths: memberOrigins.get(name) ?? [] },
            proposed: { address, paths },
          },
        );
      members.set(name, address);
      const existing = memberOrigins.get(name) ?? [];
      for (const path of paths) {
        const fingerprint = JSON.stringify(path);
        if (!existing.some((candidate) => JSON.stringify(candidate) === fingerprint))
          existing.push(path);
      }
      memberOrigins.set(name, existing);
    };
    for (const [name, address] of Object.entries(declaration.members ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!identityKeys.has(skillAddressKey(address))) missing.add(skillAddressKey(address));
      add(name, address, [
        {
          kind: "direct",
          collection: id,
          entryName: name,
          ...(contribution?.owner
            ? {
                owner: {
                  ...contribution.owner,
                  pointer: `${contribution.owner.pointer}/members/${name}`,
                },
              }
            : {}),
        },
      ]);
    }
    for (const { index, linked } of [...(declaration.links ?? [])]
      .map((linked, index) => ({ linked, index }))
      .sort((left, right) => left.linked.localeCompare(right.linked) || left.index - right.index)) {
      const linkedMembers = resolveOne(linked);
      const linkedOrigins = origins.get(linked)!;
      for (const [name, address] of linkedMembers) {
        add(
          name,
          address,
          (linkedOrigins.get(name) ?? []).map((origin) => ({
            kind: "via-link",
            links: [
              {
                collection: id,
                linkedCollection: linked,
                ...(contribution?.owner
                  ? {
                      owner: {
                        ...contribution.owner,
                        pointer: `${contribution.owner.pointer}/links/${index}`,
                      },
                    }
                  : {}),
              },
              ...(origin.kind === "via-link" ? origin.links : []),
            ],
          })),
        );
      }
    }
    for (const [name, item] of [...(derived.get(id) ?? [])].sort(([a], [b]) => a.localeCompare(b)))
      add(name, { source: item.source, path: item.path }, [
        {
          kind: "repository-derived",
          repository: id,
          source: item.source,
          path: item.path,
        },
      ]);
    visiting.delete(id);
    route.pop();
    result.set(id, members);
    origins.set(id, memberOrigins);
    const declaredReferences = declaration.references ?? {};
    for (const reference of Object.values(declaredReferences))
      if (!declared.has(reference.collection) && !derived.has(reference.collection))
        throw new SkillCliError(
          "REFERENCE_NOT_FOUND",
          `Collection not found: ${reference.collection}`,
        );
    references.set(id, declaredReferences);
    return members;
  };
  for (const id of new Set([...declared.keys(), ...derived.keys()])) resolveOne(id);
  return { members: result, origins, references, missing };
}

export function resolveCollectionUse(
  resolved: ResolvedCollections,
  use: readonly string[],
): CollectionUse {
  if (!use.length)
    return { complete: false, members: new Map(), reason: "Collection Use is absent" };
  const members = new Map<string, ReadonlyMap<string, SkillAddress>>();
  for (const id of use) {
    const collection = resolved.members.get(id);
    if (!collection)
      return { complete: false, members: new Map(), reason: "Collection Use is incomplete" };
    members.set(id, collection);
  }
  for (const collection of members.values())
    for (const address of collection.values())
      if (resolved.missing.has(skillAddressKey(address)))
        return { complete: false, members: new Map(), reason: "Collection Use is incomplete" };
  return { complete: true, members };
}
/** Reference reachability is distinct from Link membership composition. */
export function reachableCollections(
  collections: readonly {
    readonly id: string;
    readonly references: readonly { readonly collection: string }[];
  }[],
  roots: readonly string[],
): ReadonlySet<string> {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const reachable = new Set(roots);
  for (const id of reachable)
    for (const reference of byId.get(id)?.references ?? []) reachable.add(reference.collection);
  return reachable;
}
