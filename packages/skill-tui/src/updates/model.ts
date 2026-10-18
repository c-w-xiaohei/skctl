import type { WorkspaceView } from "@skill-cli/core";
import { deriveUpdateScope, type UpdateAddress, type UpdateScopeEntry } from "./scope";
import { createUpdatesState, type UpdateIssue } from "./state";
export { deriveUpdateScope as buildUpdateScope, createUpdatesState };
export type { UpdateAddress, UpdateScopeEntry };

export function updateSubmission(
  scope: ReturnType<typeof deriveUpdateScope>,
  selected: readonly UpdateAddress[],
  projection: WorkspaceView,
):
  | { readonly reason: string; readonly issue?: UpdateIssue }
  | { readonly addresses: readonly UpdateAddress[] } {
  const fresh = deriveUpdateScope(projection, scope.entry);
  if (fresh.unavailableReason) return { reason: `${fresh.unavailableReason}; check updates again` };
  const original = new Map(
    scope.observed.map((skill) => [`${skill.address.source}\u0000${skill.address.path}`, skill]),
  );
  const current = new Map(
    projection.installedSkills.map((skill) => [
      `${skill.address.source}\u0000${skill.address.path}`,
      skill,
    ]),
  );
  for (const address of selected) {
    const id = `${address.source}\u0000${address.path}`;
    const before = original.get(id);
    const now = current.get(id);
    if (!before || !now)
      return {
        reason: `${address.source}/${address.path} is no longer installed; check updates again`,
      };
    if (!fresh.addresses.some((item) => `${item.source}\u0000${item.path}` === id))
      return {
        reason: `${address.source}/${address.path} is outside the current update scope; check updates again`,
      };
    if (now.owner.source !== before.ownerSource || now.owner.health !== "healthy")
      return {
        reason: `${address.source}/${address.path} ownership changed or is unhealthy; check updates again`,
        issue: { kind: "ownership", address } satisfies UpdateIssue,
      };
    if (now.owner.relevantRemoteRevision !== before.relevantRemoteRevision)
      return {
        reason: `${address.source}/${address.path} installed revision changed; check updates again`,
      };
    const currentBinding = projection.effective.sources.find(
      (source) => source.id === address.source,
    );
    if (before.binding !== (currentBinding ? JSON.stringify(currentBinding) : undefined))
      return { reason: `${address.source} binding changed; check updates again` };
  }
  return { addresses: selected };
}
