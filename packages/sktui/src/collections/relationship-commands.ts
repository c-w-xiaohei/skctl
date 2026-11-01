import type { ConfigDeclarationOwner } from "@skctl/core";
import type { MemberOriginPath } from "@skctl/core";
import type { CommandRecord } from "../types";
import type {
  CollectionMemberOriginRow,
  CollectionRelationRow,
  CollectionRelationshipIntent,
} from "./relationship-inspector";

type MembershipSubject = {
  readonly kind: "membership";
  readonly member: Pick<CollectionMemberOriginRow, "name" | "address"> & {
    readonly available?: boolean;
  };
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
  const skillAvailable = member.available ?? true;
  const openSkill = command(
    "membership.open-skill",
    "Open Skill",
    "Installed Skill",
    skillAvailable,
    skillAvailable
      ? {
          kind: "collection-open-skill",
          collection,
          address: member.address,
        }
      : undefined,
    skillAvailable ? undefined : "Unavailable: installed Skill unavailable",
  );
  if (path?.kind === "repository-derived")
    return [
      openSkill,
      command("membership.open-source", "Open Source", "Skill Source", true, {
        kind: "collection-producer",
        collection,
        address: { source: path.source, path: path.path },
      }),
    ];
  if (path?.kind === "via-link") {
    const link = path.links[0];
    const owner = link?.owner;
    const enabled = !!link;
    const openIntent = link
      ? {
          kind: "collection-open-collection" as const,
          collection,
          target: link.linkedCollection,
        }
      : undefined;
    return [
      openSkill,
      command(
        "membership.open-link",
        "Open source Collection",
        "Source Collection",
        enabled,
        openIntent,
        enabled ? undefined : unavailable(owner, true),
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
    openSkill,
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
      command(
        "relationship.open-collection",
        "Open Collection",
        relation.target ?? "Collection target unavailable",
        !!relation.target && relation.targetAvailable !== false,
        relation.target
          ? { kind: "collection-open-collection", collection, target: relation.target }
          : undefined,
        relation.target && relation.targetAvailable !== false
          ? undefined
          : "Referenced Collection is unavailable",
      ),
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
  const commands =
    subject.kind === "membership"
      ? membershipCommands(collection, subject.member, subject.origin)
      : relationCommands(collection, subject.relation);
  const ownerText = (owner: ConfigDeclarationOwner | undefined): string => {
    if (!owner) return "Owner unavailable";
    const location = [owner.level, owner.file, owner.pointer].filter(Boolean).join(" ");
    const source = owner.contribution?.configSource;
    return source
      ? `${location}\nContributed by ${[source.level, source.file, source.pointer].filter(Boolean).join(" ")}`
      : location;
  };
  const owner =
    subject.kind === "relation"
      ? subject.relation.owner
      : subject.origin?.kind === "direct"
        ? subject.origin.owner
        : subject.origin?.kind === "via-link"
          ? subject.origin.links[0]?.owner
          : undefined;
  const memberObject =
    subject.kind === "membership"
      ? `${collection}:${subject.origin?.kind === "direct" ? subject.origin.entryName : subject.member.name}\n${subject.member.address.source}/${subject.member.address.path}`
      : undefined;
  const relationObject =
    subject.kind === "relation"
      ? subject.relation.kind === "collection-use"
        ? `${collection} Collection Use`
        : `${collection} / ${subject.relation.label}${subject.relation.target ? ` → ${subject.relation.target}` : ""}`
      : undefined;
  const screens: Record<string, string> = {
    "membership.open-skill": "Installed Skill",
    "membership.open-source":
      subject.kind === "membership" && subject.origin?.kind === "repository-derived"
        ? "Source workspace"
        : "Config Source",
    "membership.open-owner": "Owning Config",
    "membership.open-link": "Collection workspace",
    "membership.remove": "Membership removal review",
    "relationship.open-owner":
      subject.kind === "relation" && subject.relation.kind === "collection-link"
        ? "Owning Link"
        : "Owning Config",
    "relationship.edit-use": "Collection Use editor",
    "relationship.open-collection": "Collection workspace",
    "relationship.remove-reference": "Reference removal review",
    "relationship.unlink": "Link removal review",
  };
  return commands.map((record) => {
    const isLink = record.id === "membership.open-link";
    const link =
      subject.kind === "membership" && subject.origin?.kind === "via-link"
        ? subject.origin.links[0]
        : undefined;
    const object =
      isLink && link
        ? link.linkedCollection
        : record.id === "membership.open-skill" && subject.kind === "membership"
          ? `${subject.member.address.source}/${subject.member.address.path}`
          : record.id === "membership.open-source" &&
              subject.kind === "membership" &&
              subject.origin?.kind === "repository-derived"
            ? subject.origin.source
            : record.id === "membership.open-source" && owner?.contribution
              ? ownerText(owner.contribution.configSource)
              : (record.id === "membership.open-owner" ||
                    record.id === "relationship.open-owner") &&
                  owner &&
                  !(subject.kind === "relation" && subject.relation.kind === "collection-link")
                ? ownerText(owner)
                : record.id === "relationship.open-collection" && subject.kind === "relation"
                  ? subject.relation.target
                  : (memberObject ?? relationObject);
    const wholeLink = record.id === "relationship.unlink";
    const scopeText = wholeLink
      ? `Stops including this Collection and affects its contributed members.\n${ownerText(owner)}`
      : record.id === "membership.open-skill" ||
          (record.id === "membership.open-source" &&
            subject.kind === "membership" &&
            subject.origin?.kind === "repository-derived")
        ? undefined
        : ownerText(owner);
    return {
      ...record,
      ...(object ? { object } : {}),
      ...(scopeText ? { scopeText } : {}),
      opens: screens[record.id],
      group: "member" as const,
    };
  });
}
