import type { WorkspaceView } from "@skctl/core";

export interface UpdateAddress {
  readonly source: string;
  readonly path: string;
}
export type UpdateScopeEntry =
  | { readonly kind: "workspace" }
  | { readonly kind: "source"; readonly source: string }
  | { readonly kind: "collection"; readonly collection: string }
  | { readonly kind: "skill"; readonly address: UpdateAddress };

export interface UpdateScope {
  readonly entry: UpdateScopeEntry;
  readonly addresses: readonly UpdateAddress[];
  readonly sources: readonly string[];
  readonly includesReferences: boolean;
  readonly unavailableReason?: string;
  /** Public facts captured with the original scope for pre-submit drift checks. */
  readonly observed: readonly UpdateObservedSkill[];
}

export interface UpdateObservedSkill {
  readonly address: UpdateAddress;
  readonly ownerSource: string;
  readonly ownerHealth: "healthy" | "missing" | "drifted" | "unresolved-config";
  readonly relevantRemoteRevision?: string;
  readonly binding?: string;
}

const key = (address: UpdateAddress) => `${address.source}\u0000${address.path}`;

export function deriveUpdateScope(projection: WorkspaceView, entry: UpdateScopeEntry): UpdateScope {
  const installed = new Map(projection.installedSkills.map((skill) => [key(skill.address), skill]));
  const installedAddresses = () => [...installed.values()].map((skill) => skill.address);
  if (entry.kind === "workspace")
    return complete(entry, installedAddresses(), false, undefined, projection);
  if (entry.kind === "source")
    return complete(
      entry,
      installedAddresses().filter((address) => address.source === entry.source),
      false,
      undefined,
      projection,
    );
  if (entry.kind === "skill")
    return complete(
      entry,
      installed.has(key(entry.address)) ? [entry.address] : [],
      false,
      installed.has(key(entry.address)) ? undefined : "Skill is no longer installed",
      projection,
    );
  if (projection.effective.status !== "complete")
    return complete(
      entry,
      [],
      false,
      "Collection scope is unavailable until the workspace projection is complete",
      projection,
    );

  const views = new Map(projection.effective.collectionsView.map((view) => [view.id, view]));
  const addresses = new Map<string, UpdateAddress>();
  let includesReferences = false;
  const visit = (id: string, ancestors: ReadonlySet<string>) => {
    const view = views.get(id);
    if (!view || ancestors.has(id)) return;
    for (const member of view.members)
      if (installed.has(key(member.address))) addresses.set(key(member.address), member.address);
    const next = new Set(ancestors);
    next.add(id);
    for (const reference of view.references) {
      includesReferences = true;
      visit(reference.collection, next);
    }
  };
  visit(entry.collection, new Set());
  return complete(
    entry,
    [...addresses.values()],
    includesReferences,
    views.has(entry.collection) ? undefined : "Collection is unavailable",
    projection,
  );
}

function complete(
  entry: UpdateScopeEntry,
  addresses: readonly UpdateAddress[],
  includesReferences: boolean,
  unavailableReason?: string,
  projection?: WorkspaceView,
): UpdateScope {
  const selected = new Set(addresses.map(key));
  const sources = new Map(
    projection?.effective.sources.map((source) => [source.id, JSON.stringify(source)]) ?? [],
  );
  return {
    entry,
    addresses,
    sources: [...new Set(addresses.map((address) => address.source))],
    includesReferences,
    unavailableReason,
    observed:
      projection?.installedSkills
        .filter((skill) => selected.has(key(skill.address)))
        .map((skill) => ({
          address: skill.address,
          ownerSource: skill.owner.source,
          ownerHealth: skill.owner.health,
          relevantRemoteRevision: skill.owner.relevantRemoteRevision,
          binding: sources.get(skill.address.source),
        })) ?? [],
  };
}
