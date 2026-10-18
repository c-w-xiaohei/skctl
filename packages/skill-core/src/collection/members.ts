import { SkillCliError } from "../shared";
import type { MemberEditRequest } from "./types";
import { sameSkillAddress } from "./graph";
import { type SkillAddress } from "../source/schema";
import { parseNameSegment, parseQualifiedName } from "./names";

export function normalizeMemberEdit(request: MemberEditRequest) {
  parseQualifiedName(request.collection);
  const additions = request.additions.map((entry) => ({
    ...entry,
    name: parseNameSegment(entry.name),
  }));
  const removals = request.removals.map((entry) => ({
    ...entry,
    name: parseNameSegment(entry.name),
  }));
  const names = new Set<string>();
  for (const entry of [...additions, ...removals]) {
    if (names.has(entry.name))
      throw new SkillCliError(
        "INVALID_ARGUMENT",
        "Membership batch cannot contain duplicate entry names",
      );
    names.add(entry.name);
  }
  return { ...request, additions, removals };
}

/** Both preview and publication edit the direct declaration, never a provenance projection. */
export function editMembers(
  current: Readonly<Record<string, SkillAddress>>,
  request: ReturnType<typeof normalizeMemberEdit>,
) {
  for (const entry of request.removals) {
    const address = current[entry.name];
    if (!address)
      throw new SkillCliError(
        "INVALID_ARGUMENT",
        `Membership "${entry.name}" is not directly declared in Collection "${request.collection}"`,
      );
    if (!sameSkillAddress(address, entry.expectedAddress))
      throw new SkillCliError("CONFIG_CONFLICT", "Membership changed after preview");
  }
  for (const entry of request.additions) {
    const address = current[entry.name];
    if (address && !sameSkillAddress(address, entry.address))
      throw new SkillCliError("CONFIG_CONFLICT", "Membership entry name is already in use");
  }
  const members = { ...current };
  for (const entry of request.removals) delete members[entry.name];
  for (const entry of request.additions) members[entry.name] = entry.address;
  const changed =
    Object.keys(current).length !== Object.keys(members).length ||
    Object.entries(current).some(
      ([name, address]) => !members[name] || !sameSkillAddress(address, members[name]),
    );
  return { members, changed };
}

export function importMembers(
  current: Readonly<Record<string, SkillAddress>>,
  source: MemberEditRequest["additions"],
) {
  const additions: { name: string; address: SkillAddress }[] = [];
  const skipped: { name: string; address: SkillAddress }[] = [];
  const conflicts: { name: string; existing: SkillAddress; proposed: SkillAddress }[] = [];
  for (const member of source) {
    const existing = current[member.name];
    if (!existing) additions.push(member);
    else if (sameSkillAddress(existing, member.address)) skipped.push(member);
    else conflicts.push({ name: member.name, existing, proposed: member.address });
  }
  return { additions, skipped, conflicts };
}
