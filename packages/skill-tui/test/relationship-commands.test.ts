import { expect, test } from "bun:test";
import {
  relationshipCommands,
  type RelationshipCommand,
} from "../src/collections/relationship-commands";
import type { CollectionRelationRow } from "../src/collections/relationship-inspector";

const owner = { level: "project" as const, file: "/project.jsonc", pointer: "/collections/team" };
const address = { source: "team", path: "guide" };

test("direct Membership exposes its owner and review-backed removal command", () => {
  expect(
    relationshipCommands("team", {
      kind: "membership",
      member: { name: "guide", address },
      origin: { kind: "direct", collection: "team", entryName: "guide", owner },
    }),
  ).toEqual([
    expect.objectContaining({
      id: "membership.open-owner",
      verb: "Open owning Config",
      destination: "Owning Config",
      danger: false,
      enabled: true,
    }),
    expect.objectContaining({
      id: "membership.remove",
      verb: "Remove Membership",
      destination: "Review removal",
      danger: true,
      enabled: true,
      intent: { kind: "collection-direct", collection: "team", name: "guide", address, owner },
    }),
  ]);
});

test("membership provenance selects the stable ordinary and disabled danger records", () => {
  const contributed = {
    ...owner,
    contribution: {
      configSource: { level: "global" as const, file: "/global.jsonc", pointer: "/sources/team" },
      declaration: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/collections/team",
      },
    },
  };
  const direct = relationshipCommands("team", {
    kind: "membership",
    member: { name: "guide", address },
    origin: { kind: "direct", collection: "team", entryName: "guide", owner: contributed },
  });
  expect(
    direct.map(({ id, verb, destination, danger, enabled, disabledReason }) => ({
      id,
      verb,
      destination,
      danger,
      enabled,
      disabledReason,
    })),
  ).toEqual([
    {
      id: "membership.open-source",
      verb: "Open Config Source",
      destination: "Config Source",
      danger: false,
      enabled: true,
      disabledReason: undefined,
    },
    {
      id: "membership.remove",
      verb: "Remove Membership",
      destination: "Review removal",
      danger: true,
      enabled: false,
      disabledReason: "Unavailable: contributed config",
    },
  ]);
  const repository = relationshipCommands("team", {
    kind: "membership",
    member: { name: "guide", address },
    origin: { kind: "repository-derived", repository: "org/team", source: "team", path: "guide" },
  });
  expect(repository.map((item) => item.id)).toEqual([
    "membership.open-skill",
    "membership.open-source",
  ]);
  const missing = relationshipCommands("team", {
    kind: "membership",
    member: { name: "guide", address },
    origin: { kind: "direct", collection: "team", entryName: "guide" },
  });
  expect(missing.map((item) => item.disabledReason)).toEqual([
    "Unavailable: owner unavailable",
    "Unavailable: owner unavailable",
  ]);
  const link = relationshipCommands("team", {
    kind: "membership",
    member: { name: "guide", address },
    origin: { kind: "via-link", links: [] },
  });
  expect(link.map((item) => item.disabledReason)).toEqual([
    "Unavailable: link owner unavailable",
    "Unavailable: link owner unavailable",
  ]);
});

test("Collection Use, Reference, and Link preserve current relationship intents", () => {
  const use = {
    kind: "collection-use" as const,
    label: "Collection Use",
    owner,
    effect: "1 selector",
    intent: { kind: "collection-use" as const, collection: "team", owner },
  };
  const reference = {
    kind: "collection-reference" as const,
    label: "Reference docs",
    target: "docs",
    owner,
    effect: "0 Skills",
    intent: {
      kind: "collection-reference" as const,
      collection: "team",
      name: "docs",
      target: "docs",
      description: "Docs",
      owner,
    },
  };
  const link = {
    kind: "collection-link" as const,
    label: "Link docs",
    target: "docs",
    owner,
    effect: "1 selector",
    intent: { kind: "collection-link" as const, collection: "team", target: "docs", owner },
  };
  expect(
    relationshipCommands("team", { kind: "relation", relation: use }).map((item) => [
      item.id,
      item.enabled,
      item.intent,
    ]),
  ).toEqual([
    ["relationship.open-owner", true, expect.anything()],
    ["relationship.edit-use", true, { kind: "collection-use-edit", collection: "team", owner }],
  ]);
  expect(relationshipCommands("team", { kind: "relation", relation: reference })[1]).toMatchObject({
    id: "relationship.remove-reference",
    verb: "Remove Reference",
    destination: "Review removal",
    danger: true,
    enabled: true,
    intent: reference.intent,
  });
  expect(relationshipCommands("team", { kind: "relation", relation: link })[1]).toMatchObject({
    id: "relationship.unlink",
    verb: "Unlink Collection",
    destination: "Review removal",
    danger: true,
    enabled: true,
    intent: link.intent,
  });
  for (const relation of [
    { ...use, owner: undefined, intent: undefined },
    { ...reference, owner: undefined, intent: undefined },
    { ...link, owner: undefined, intent: undefined },
  ])
    expect(
      relationshipCommands("team", { kind: "relation", relation }).every(
        (item) => !item.enabled && item.disabledReason?.includes("owner unavailable"),
      ),
    ).toBe(true);
});

test("command matrix retains every command field and legal danger boundary", () => {
  const contributed = {
    ...owner,
    contribution: {
      configSource: { level: "global" as const, file: "/global.jsonc", pointer: "/sources/team" },
      declaration: {
        level: "global" as const,
        file: "/global.jsonc",
        pointer: "/collections/team",
      },
    },
  };
  const direct = { kind: "direct" as const, collection: "team", entryName: "guide", owner };
  const contributedDirect = { ...direct, owner: contributed };
  const missing = { kind: "direct" as const, collection: "team", entryName: "guide" };
  const via = (linkOwner?: typeof owner) => ({
    kind: "via-link" as const,
    links: linkOwner ? [{ collection: "team", linkedCollection: "shared", owner: linkOwner }] : [],
  });
  const relation = (
    kind: CollectionRelationRow["kind"],
    relationOwner: typeof owner | typeof contributed | undefined,
  ): CollectionRelationRow => ({
    kind,
    label: kind,
    target: "shared",
    owner: relationOwner,
    effect: "Effect",
    ...(relationOwner
      ? kind === "collection-use"
        ? { intent: { kind: "collection-use" as const, collection: "team", owner: relationOwner } }
        : kind === "collection-reference"
          ? {
              intent: {
                kind: "collection-reference" as const,
                collection: "team",
                name: "docs",
                target: "shared",
                description: "Docs",
                owner: relationOwner,
              },
            }
          : {
              intent: {
                kind: "collection-link" as const,
                collection: "team",
                target: "shared",
                owner: relationOwner,
              },
            }
      : {}),
  });
  type MatrixCase = {
    readonly name: string;
    readonly subject: Parameters<typeof relationshipCommands>[1];
    readonly expected: readonly RelationshipCommand[];
  };
  const rows: readonly MatrixCase[] = [
    {
      name: "Membership direct",
      subject: { kind: "membership" as const, member: { name: "guide", address }, origin: direct },
      expected: [
        {
          id: "membership.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-open-config", collection: "team", owner },
        },
        {
          id: "membership.remove",
          keys: ["enter", "return"],
          verb: "Remove Membership",
          destination: "Review removal",
          scope: "page",
          enabled: true,
          danger: true,
          intent: { kind: "collection-direct", collection: "team", name: "guide", address, owner },
        },
      ],
    },
    {
      name: "Membership contributed",
      subject: {
        kind: "membership" as const,
        member: { name: "guide", address },
        origin: contributedDirect,
      },
      expected: [
        {
          id: "membership.open-source",
          keys: ["enter", "return"],
          verb: "Open Config Source",
          destination: "Config Source",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-contribution", collection: "team", owner: contributed },
        },
        {
          id: "membership.remove",
          keys: ["enter", "return"],
          verb: "Remove Membership",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: contributed config",
          danger: true,
          intent: {
            kind: "collection-direct",
            collection: "team",
            name: "guide",
            address,
            owner: contributed,
          },
        },
      ],
    },
    {
      name: "Membership ownerless",
      subject: { kind: "membership" as const, member: { name: "guide", address }, origin: missing },
      expected: [
        {
          id: "membership.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: owner unavailable",
          danger: false,
        },
        {
          id: "membership.remove",
          keys: ["enter", "return"],
          verb: "Remove Membership",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: owner unavailable",
          danger: true,
        },
      ],
    },
    {
      name: "Membership repository-derived",
      subject: {
        kind: "membership" as const,
        member: { name: "guide", address },
        origin: {
          kind: "repository-derived" as const,
          repository: "org/team",
          source: "team",
          path: "guide",
        },
      },
      expected: [
        {
          id: "membership.open-skill",
          keys: ["enter", "return"],
          verb: "Open Skill",
          destination: "Installed Skill",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-open-skill", collection: "team", address },
        },
        {
          id: "membership.open-source",
          keys: ["enter", "return"],
          verb: "Open Source",
          destination: "Skill Source",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-producer", collection: "team", address },
        },
      ],
    },
    {
      name: "Membership via Link direct",
      subject: {
        kind: "membership" as const,
        member: { name: "guide", address },
        origin: via(owner),
      },
      expected: [
        {
          id: "membership.open-link",
          keys: ["enter", "return"],
          verb: "Open owning Link",
          destination: "Owning Link",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-link", collection: "team", target: "shared", owner },
        },
        {
          id: "membership.unlink",
          keys: ["enter", "return"],
          verb: "Unlink Membership",
          destination: "Review removal",
          scope: "page",
          enabled: true,
          danger: true,
          intent: { kind: "collection-link", collection: "team", target: "shared", owner },
        },
      ],
    },
    {
      name: "Membership via Link contributed",
      subject: {
        kind: "membership" as const,
        member: { name: "guide", address },
        origin: via(contributed),
      },
      expected: [
        {
          id: "membership.open-link",
          keys: ["enter", "return"],
          verb: "Open owning Link",
          destination: "Owning Link",
          scope: "page",
          enabled: true,
          danger: false,
          intent: {
            kind: "collection-link",
            collection: "team",
            target: "shared",
            owner: contributed,
          },
        },
        {
          id: "membership.unlink",
          keys: ["enter", "return"],
          verb: "Unlink Membership",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: contributed config",
          danger: true,
          intent: {
            kind: "collection-link",
            collection: "team",
            target: "shared",
            owner: contributed,
          },
        },
      ],
    },
    {
      name: "Membership via Link ownerless",
      subject: { kind: "membership" as const, member: { name: "guide", address }, origin: via() },
      expected: [
        {
          id: "membership.open-link",
          keys: ["enter", "return"],
          verb: "Open owning Link",
          destination: "Owning Link",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: link owner unavailable",
          danger: false,
        },
        {
          id: "membership.unlink",
          keys: ["enter", "return"],
          verb: "Unlink Membership",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: link owner unavailable",
          danger: true,
        },
      ],
    },
    {
      name: "Use direct",
      subject: { kind: "relation" as const, relation: relation("collection-use", owner) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: true,
          danger: false,
          intent: {
            kind: "collection-open-config",
            collection: "team",
            owner,
            relationship: "use",
          },
        },
        {
          id: "relationship.edit-use",
          keys: ["enter", "return"],
          verb: "Edit Collection Use",
          destination: "Collection Use",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-use-edit", collection: "team", owner },
        },
      ],
    },
    {
      name: "Use contributed",
      subject: { kind: "relation" as const, relation: relation("collection-use", contributed) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: true,
          danger: false,
          intent: {
            kind: "collection-open-config",
            collection: "team",
            owner: contributed,
            relationship: "use",
          },
        },
        {
          id: "relationship.edit-use",
          keys: ["enter", "return"],
          verb: "Edit Collection Use",
          destination: "Collection Use",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: contributed config",
          danger: false,
          intent: { kind: "collection-use-edit", collection: "team", owner: contributed },
        },
      ],
    },
    {
      name: "Use ownerless",
      subject: { kind: "relation" as const, relation: relation("collection-use", undefined) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: owner unavailable",
          danger: false,
        },
        {
          id: "relationship.edit-use",
          keys: ["enter", "return"],
          verb: "Edit Collection Use",
          destination: "Collection Use",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: owner unavailable",
          danger: false,
        },
      ],
    },
    {
      name: "Reference direct",
      subject: { kind: "relation" as const, relation: relation("collection-reference", owner) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: true,
          danger: false,
          intent: {
            kind: "collection-open-config",
            collection: "team",
            owner,
            relationship: "reference",
            name: "docs",
            target: "shared",
            description: "Docs",
          },
        },
        {
          id: "relationship.remove-reference",
          keys: ["enter", "return"],
          verb: "Remove Reference",
          destination: "Review removal",
          scope: "page",
          enabled: true,
          danger: true,
          intent: {
            kind: "collection-reference",
            collection: "team",
            name: "docs",
            target: "shared",
            description: "Docs",
            owner,
          },
        },
      ],
    },
    {
      name: "Reference contributed",
      subject: {
        kind: "relation" as const,
        relation: relation("collection-reference", contributed),
      },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: true,
          danger: false,
          intent: {
            kind: "collection-open-config",
            collection: "team",
            owner: contributed,
            relationship: "reference",
            name: "docs",
            target: "shared",
            description: "Docs",
          },
        },
        {
          id: "relationship.remove-reference",
          keys: ["enter", "return"],
          verb: "Remove Reference",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: contributed config",
          danger: true,
          intent: {
            kind: "collection-reference",
            collection: "team",
            name: "docs",
            target: "shared",
            description: "Docs",
            owner: contributed,
          },
        },
      ],
    },
    {
      name: "Reference ownerless",
      subject: { kind: "relation" as const, relation: relation("collection-reference", undefined) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Config",
          destination: "Owning Config",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: owner unavailable",
          danger: false,
        },
        {
          id: "relationship.remove-reference",
          keys: ["enter", "return"],
          verb: "Remove Reference",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: owner unavailable",
          danger: true,
        },
      ],
    },
    {
      name: "Link direct",
      subject: { kind: "relation" as const, relation: relation("collection-link", owner) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Link",
          destination: "Owning Link",
          scope: "page",
          enabled: true,
          danger: false,
          intent: { kind: "collection-open-link", collection: "team", target: "shared", owner },
        },
        {
          id: "relationship.unlink",
          keys: ["enter", "return"],
          verb: "Unlink Collection",
          destination: "Review removal",
          scope: "page",
          enabled: true,
          danger: true,
          intent: { kind: "collection-link", collection: "team", target: "shared", owner },
        },
      ],
    },
    {
      name: "Link contributed",
      subject: { kind: "relation" as const, relation: relation("collection-link", contributed) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Link",
          destination: "Owning Link",
          scope: "page",
          enabled: true,
          danger: false,
          intent: {
            kind: "collection-open-link",
            collection: "team",
            target: "shared",
            owner: contributed,
          },
        },
        {
          id: "relationship.unlink",
          keys: ["enter", "return"],
          verb: "Unlink Collection",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: contributed config",
          danger: true,
          intent: {
            kind: "collection-link",
            collection: "team",
            target: "shared",
            owner: contributed,
          },
        },
      ],
    },
    {
      name: "Link ownerless",
      subject: { kind: "relation" as const, relation: relation("collection-link", undefined) },
      expected: [
        {
          id: "relationship.open-owner",
          keys: ["enter", "return"],
          verb: "Open owning Link",
          destination: "Owning Link",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: link owner unavailable",
          danger: false,
        },
        {
          id: "relationship.unlink",
          keys: ["enter", "return"],
          verb: "Unlink Collection",
          destination: "Review removal",
          scope: "page",
          enabled: false,
          disabledReason: "Unavailable: link owner unavailable",
          danger: true,
        },
      ],
    },
  ] as const;
  for (const { name, subject, expected } of rows)
    expect(relationshipCommands("team", subject), name).toEqual(expected);
});
