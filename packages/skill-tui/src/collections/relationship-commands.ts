import type { ConfigDeclarationOwner } from "@skill-cli/core";
import type { MemberOriginPath } from "@skill-cli/core";
import type { CommandRecord } from "../types";
import type {
  CollectionMemberOriginRow,
  CollectionRelationRow,
  CollectionRelationshipIntent,
} from "./relationship-inspector";

type MembershipSubject = {
  readonly kind: "membership";
  readonly member: Pick<CollectionMemberOriginRow, "name" | "address">;
  readonly origin?: Pick<CollectionMemberOriginRow, "path">["path"];
};

type RelationSubject = {
  readonly kind: "relation";
  readonly relation: CollectionRelationRow;
};

export type RelationshipCommand = CommandRecord & {
  readonly intent?: CollectionRelationshipIntent;
};

const unavailable = (owner: ConfigDeclarationOwner | undefined, link = false) =>
  owner?.contribution
    ? "Unavailable: contributed config"
    : `Unavailable: ${link ? "link owner" : "owner"} unavailable`;

const command = (
  id: string,
  verb: string,
  destination: string,
  enabled: boolean,
  intent?: CollectionRelationshipIntent,
  reason?: string,
  danger = false,
): RelationshipCommand => ({
  id,
  keys: ["enter", "return"],
  verb,
  destination,
  scope: "page",
  enabled,
  ...(reason ? { disabledReason: reason } : {}),
  danger,
  ...(intent ? { intent } : {}),
});

const membershipCommands = (
  collection: string,
  member: MembershipSubject["member"],
  path: MemberOriginPath | undefined,
): readonly RelationshipCommand[] => {
  if (path?.kind === "repository-derived")
    return [
      command("membership.open-skill", "Open Skill", "Installed Skill", true, {
        kind: "collection-open-skill",
        collection,
        address: member.address,
      }),
      command("membership.open-source", "Open Source", "Skill Source", true, {
        kind: "collection-producer",
        collection,
        address: { source: path.source, path: path.path },
      }),
    ];
  if (path?.kind === "via-link") {
    const link = path.links[0];
    const owner = link?.owner;
    const enabled = !!owner;
    const intent = owner
      ? {
          kind: "collection-link" as const,
          collection: link.collection,
          target: link.linkedCollection,
          owner,
        }
      : undefined;
    return [
      command(
        "membership.open-link",
        "Open owning Link",
        "Owning Link",
        enabled,
        intent,
        enabled ? undefined : unavailable(owner, true),
      ),
      command(
        "membership.unlink",
        "Unlink Membership",
        "Review removal",
        enabled && !owner!.contribution,
        intent,
        enabled && !owner!.contribution ? undefined : unavailable(owner, true),
        true,
      ),
    ];
  }
  const owner = path?.kind === "direct" ? path.owner : undefined;
  const enabled = !!owner;
  const openIntent = owner?.contribution
    ? { kind: "collection-contribution" as const, collection, owner }
    : owner
      ? { kind: "collection-open-config" as const, collection, owner }
      : undefined;
  const removalIntent = owner
    ? {
        kind: "collection-direct" as const,
        collection,
        name: member.name,
        address: member.address,
        owner,
      }
    : undefined;
  return [
    command(
      owner?.contribution ? "membership.open-source" : "membership.open-owner",
      owner?.contribution ? "Open Config Source" : "Open owning Config",
      owner?.contribution ? "Config Source" : "Owning Config",
      enabled,
      openIntent,
      enabled ? undefined : unavailable(owner),
    ),
    command(
      "membership.remove",
      "Remove Membership",
      "Review removal",
      enabled && !owner.contribution,
      removalIntent,
      enabled && !owner.contribution ? undefined : unavailable(owner),
      true,
    ),
  ];
};

const relationCommands = (
  collection: string,
  relation: CollectionRelationRow,
): readonly RelationshipCommand[] => {
  const owner = relation.owner;
  const direct = !!owner && !owner.contribution;
  const open = (id: string, verb: string, link = false) =>
    command(
      id,
      verb,
      link ? "Owning Link" : "Owning Config",
      !!owner,
      owner
        ? link && relation.intent?.kind === "collection-link"
          ? {
              kind: "collection-open-link",
              collection: relation.intent.collection,
              target: relation.intent.target,
              owner,
            }
          : {
              kind: "collection-open-config",
              collection,
              owner,
              relationship: relation.kind === "collection-use" ? "use" : "reference",
              ...(relation.intent?.kind === "collection-reference"
                ? {
                    name: relation.intent.name,
                    target: relation.intent.target,
                    description: relation.intent.description,
                  }
                : {}),
            }
        : undefined,
      owner ? undefined : unavailable(owner, link),
    );
  if (relation.kind === "collection-use")
    return [
      open("relationship.open-owner", "Open owning Config"),
      command(
        "relationship.edit-use",
        "Edit Collection Use",
        "Collection Use",
        direct,
        relation.intent?.kind === "collection-use"
          ? {
              kind: "collection-use-edit",
              collection: relation.intent.collection,
              owner: relation.intent.owner,
            }
          : undefined,
        direct ? undefined : unavailable(owner),
      ),
    ];
  if (relation.kind === "collection-reference")
    return [
      open("relationship.open-owner", "Open owning Config"),
      command(
        "relationship.remove-reference",
        "Remove Reference",
        "Review removal",
        direct,
        relation.intent,
        direct ? undefined : unavailable(owner),
        true,
      ),
    ];
  return [
    open("relationship.open-owner", "Open owning Link", true),
    command(
      "relationship.unlink",
      "Unlink Collection",
      "Review removal",
      direct,
      relation.intent,
      direct ? undefined : unavailable(owner, true),
      true,
    ),
  ];
};

export function relationshipCommands(
  collection: string,
  subject: MembershipSubject | RelationSubject,
): readonly RelationshipCommand[] {
  return subject.kind === "membership"
    ? membershipCommands(collection, subject.member, subject.origin)
    : relationCommands(collection, subject.relation);
}
