import type { SkillAddress, WorkspaceView } from "@skctl/core";
import type { UpdateIssue } from "./state";

export type UpdateAddress = SkillAddress;
export type UpdateScopeEntry =
  | { readonly kind: "workspace" }
  | { readonly kind: "selected"; readonly addresses: readonly UpdateAddress[] }
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
  readonly observed: readonly (Pick<
    WorkspaceView["installedSkills"][number],
    "address" | "owner"
  > & {
    readonly binding?: string;
  })[];
}

const key = (address: UpdateAddress) => `${address.source}\u0000${address.path}`;

export function deriveUpdateScope(projection: WorkspaceView, entry: UpdateScopeEntry): UpdateScope {
  const installed = new Map(projection.installedSkills.map((skill) => [key(skill.address), skill]));
  let addresses = [...installed.values()].map((skill) => skill.address);
  let includesReferences = false;
  let unavailableReason: string | undefined;
  if (entry.kind === "source")
    addresses = addresses.filter((address) => address.source === entry.source);
  else if (entry.kind === "selected") {
    addresses = [...new Map(entry.addresses.map((address) => [key(address), address])).values()];
    if (!addresses.length) unavailableReason = "No Skills selected";
    else if (addresses.some((address) => !installed.has(key(address))))
      unavailableReason = "Selected Skills are no longer installed";
  } else if (entry.kind === "skill") {
    addresses = installed.has(key(entry.address)) ? [entry.address] : [];
    if (!addresses.length) unavailableReason = "Skill is no longer installed";
  } else if (entry.kind === "collection" && projection.effective.status !== "complete") {
    addresses = [];
    unavailableReason =
      "Collection scope is unavailable until the workspace projection is complete";
  } else if (entry.kind === "collection" && projection.effective.status === "complete") {
    const views = new Map(projection.effective.collectionsView.map((view) => [view.id, view]));
    const members = new Map<string, UpdateAddress>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      const view = views.get(id);
      if (!view || visited.has(id)) return;
      visited.add(id);
      for (const member of view.members)
        if (installed.has(key(member.address))) members.set(key(member.address), member.address);
      for (const reference of view.references) {
        includesReferences = true;
        visit(reference.collection);
      }
    };
    visit(entry.collection);
    addresses = [...members.values()];
    if (!views.has(entry.collection)) unavailableReason = "Collection is unavailable";
  }
  const selected = new Set(addresses.map(key));
  const bindings = new Map(
    projection.effective.sources.map((source) => [source.id, JSON.stringify(source)]),
  );
  return {
    entry,
    addresses,
    sources: [...new Set(addresses.map((address) => address.source))],
    includesReferences,
    unavailableReason,
    observed: projection.installedSkills
      .filter((skill) => selected.has(key(skill.address)))
      .map((skill) => ({
        address: skill.address,
        owner: { ...skill.owner },
        binding: bindings.get(skill.address.source),
      })),
  };
}

export function updateSubmission(
  scope: UpdateScope,
  selected: readonly UpdateAddress[],
  projection: WorkspaceView,
): { readonly reason: string; readonly issue?: UpdateIssue } | { readonly scope: UpdateScope } {
  const fresh = deriveUpdateScope(projection, scope.entry);
  if (fresh.unavailableReason) return { reason: `${fresh.unavailableReason}; check updates again` };
  const original = new Map(scope.observed.map((skill) => [key(skill.address), skill]));
  const current = new Map(projection.installedSkills.map((skill) => [key(skill.address), skill]));
  for (const address of selected) {
    const before = original.get(key(address));
    const now = current.get(key(address));
    if (!before || !now)
      return {
        reason: `${address.source}/${address.path} is no longer installed; check updates again`,
      };
    if (!fresh.addresses.some((item) => key(item) === key(address)))
      return {
        reason: `${address.source}/${address.path} is outside the current update scope; check updates again`,
      };
    if (now.owner.source !== before.owner.source || now.owner.health !== "healthy")
      return {
        reason: `${address.source}/${address.path} ownership changed or is unhealthy; check updates again`,
        issue: { kind: "ownership", address },
      };
    if (now.owner.relevantRemoteRevision !== before.owner.relevantRemoteRevision)
      return {
        reason: `${address.source}/${address.path} installed revision changed; check updates again`,
      };
    const binding = projection.effective.sources.find((source) => source.id === address.source);
    if (before.binding !== (binding ? JSON.stringify(binding) : undefined))
      return { reason: `${address.source} binding changed; check updates again` };
  }
  return { scope: fresh };
}
