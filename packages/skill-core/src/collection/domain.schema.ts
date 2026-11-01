import * as v from "valibot";
import {
  configDeclarationOwnerSchema as owner,
  configLevelSchema,
  configWriteResultSchema,
} from "../config/schema";
import { skillAddressSchema as address } from "../source/schema";
import { collectionSchema, referenceSchema } from "./schema";

export const memberOriginPathSchema = v.variant("kind", [
  v.object({
    kind: v.literal("direct"),
    collection: v.string(),
    entryName: v.string(),
    owner: v.optional(owner),
  }),
  v.object({
    kind: v.literal("via-link"),
    links: v.pipe(
      v.array(
        v.object({
          collection: v.string(),
          linkedCollection: v.string(),
          owner: v.optional(owner),
        }),
      ),
      v.readonly(),
    ),
  }),
  v.object({
    kind: v.literal("repository-derived"),
    repository: v.string(),
    source: v.string(),
    path: v.string(),
  }),
]);
const paths = v.pipe(v.array(memberOriginPathSchema), v.readonly());
export const resolvedMemberSchema = v.object({ address, paths });
export const installedIdentitySchema = v.object({
  ...address.entries,
  name: v.string(),
  repository: v.optional(v.string()),
});
const repository = v.object({
  derived: v.boolean(),
  producers: v.pipe(v.array(address), v.readonly()),
});
const members = v.pipe(
  v.array(v.object({ ...resolvedMemberSchema.entries, name: v.string() })),
  v.readonly(),
);
export const collectionViewSchema = v.object({
  id: v.string(),
  description: v.optional(v.string()),
  instructions: collectionSchema.entries.instructions,
  declared: v.pipe(v.array(owner), v.readonly()),
  repository,
  members,
  references: v.pipe(
    v.array(v.object({ ...referenceSchema.entries, name: v.string(), owner })),
    v.readonly(),
  ),
  links: v.pipe(v.array(v.object({ collection: v.string(), owner })), v.readonly()),
});
export const impactBlockerSchema = v.union([
  v.object({ reason: v.literal("installed"), address }),
  v.object({ reason: v.literal("membership"), owner }),
  v.object({ reason: v.picklist(["use", "reference", "link"]), owner: v.optional(owner) }),
  v.object({ reason: v.literal("cycle"), collections: v.pipe(v.array(v.string()), v.readonly()) }),
  v.object({
    reason: v.literal("conflict"),
    name: v.optional(v.string()),
    existing: resolvedMemberSchema,
    proposed: resolvedMemberSchema,
  }),
  v.object({
    reason: v.literal("incomplete"),
    owner: v.optional(owner),
    collections: v.optional(v.pipe(v.array(v.string()), v.readonly())),
    installed: v.optional(v.pipe(v.array(address), v.readonly())),
  }),
]);
const blockers = v.pipe(v.array(impactBlockerSchema), v.readonly());
export const identityWorkspaceSchema = v.object({
  scope: v.literal("captured-workspace"),
  limitation: v.string(),
  baseline: v.string(),
});
export const collectionRenameRequestSchema = v.object({
  collection: v.string(),
  target: v.string(),
});
export const collectionRenameImpactSchema = v.object({
  ...identityWorkspaceSchema.entries,
  kind: v.literal("collection-rename"),
  collection: v.string(),
  target: v.string(),
  declarations: v.pipe(v.array(owner), v.readonly()),
  references: v.pipe(
    v.array(v.object({ kind: v.picklist(["use", "reference", "link"]), owner })),
    v.readonly(),
  ),
  addresses: v.pipe(v.array(v.object({ before: v.string(), after: v.string() })), v.readonly()),
  blockers: v.pipe(
    v.array(
      v.object({
        reason: v.picklist([
          "incomplete",
          "missing",
          "collision",
          "repository-derived",
          "immutable",
        ]),
        owner: v.optional(owner),
      }),
    ),
    v.readonly(),
  ),
  allowed: v.boolean(),
});
export const reviewedCollectionRenameRequestSchema = v.object({
  ...collectionRenameRequestSchema.entries,
  reviewedImpact: collectionRenameImpactSchema,
});
export const membershipAffectedSchema = v.object({
  ...resolvedMemberSchema.entries,
  selector: v.string(),
});
const affected = v.pipe(v.array(membershipAffectedSchema), v.readonly());
export const collectionEditDecisionSchema = v.variant("kind", [
  v.object({ kind: v.literal("direct"), owner }),
  v.object({ kind: v.literal("contributed"), owner }),
  v.object({ kind: v.literal("repository-derived"), producers: repository.entries.producers }),
  v.object({ kind: v.literal("via-link"), paths }),
  v.object({ kind: v.literal("missing") }),
]);
export const collectionRequestSchema = v.object({
  level: configLevelSchema,
  collection: v.string(),
  expectedOwner: v.optional(owner),
});
export const createCollectionRequestSchema = v.object({
  level: configLevelSchema,
  collection: v.string(),
  description: collectionSchema.entries.description,
});
export const setCollectionContentRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  description: v.optional(v.nullable(v.unwrap(collectionSchema.entries.description))),
  instructions: v.optional(v.nullable(v.unwrap(collectionSchema.entries.instructions))),
});
export const addMemberRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  name: v.string(),
  address,
});
export const removeMemberRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  name: v.string(),
  expectedAddress: v.optional(address),
});
export const memberEditRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  additions: v.pipe(v.array(v.object({ name: v.string(), address })), v.readonly()),
  removals: v.pipe(v.array(v.object({ name: v.string(), expectedAddress: address })), v.readonly()),
});
export const reviewedMemberEditRequestSchema = v.object({
  ...memberEditRequestSchema.entries,
  reviewedAffected: affected,
});
export const importMembersRequestSchema = v.object({
  level: configLevelSchema,
  from: v.string(),
  into: v.string(),
});
export const addReferenceRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  name: v.string(),
  target: v.string(),
  description: v.string(),
});
export const removeReferenceRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  name: v.string(),
  expected: v.optional(referenceSchema),
});
export const setLinkRequestSchema = v.object({
  ...collectionRequestSchema.entries,
  target: v.string(),
  linked: v.boolean(),
});
export const setUseRequestSchema = v.object({
  level: configLevelSchema,
  collections: v.pipe(v.array(v.string()), v.readonly()),
});
export const useCollectionRequestSchema = v.object({
  level: configLevelSchema,
  collection: v.string(),
});
export const useWriteResultSchema = v.object({
  ...configWriteResultSchema.entries,
  use: v.object({
    before: setUseRequestSchema.entries.collections,
    after: setUseRequestSchema.entries.collections,
  }),
});
export const linkChangeImpactSchema = v.object({
  kind: v.literal("link-change"),
  collection: v.string(),
  target: v.string(),
  owner: v.optional(owner),
  linkedOwner: v.optional(owner),
  linked: v.boolean(),
  members,
  disappearingSelectors: affected,
  retainedSelectors: affected,
  blockers,
  allowed: v.boolean(),
});
export const addToCollectionImpactSchema = v.object({
  kind: v.literal("add-to-collection"),
  collection: v.string(),
  address,
  decision: collectionEditDecisionSchema,
  intent: v.optional(v.object({ owner, stableEntryName: v.string(), address })),
  createDirectContribution: v.optional(
    v.object({
      collection: v.string(),
      eligibleLevels: v.pipe(v.array(configLevelSchema), v.readonly()),
    }),
  ),
  existing: members,
  blockers,
  allowed: v.boolean(),
});
export const membershipRemovalImpactSchema = v.object({
  kind: v.literal("membership-removal"),
  collection: v.string(),
  name: v.string(),
  decision: collectionEditDecisionSchema,
  affected,
  retained: v.pipe(v.array(v.object({ selector: v.string(), paths })), v.readonly()),
  disappearing: affected,
  linkActions: v.pipe(v.array(v.object({ owner: v.optional(owner), paths })), v.readonly()),
  allowed: v.boolean(),
});
export const membershipBatchImpactSchema = v.object({
  kind: v.literal("membership-batch"),
  collection: v.string(),
  decision: collectionEditDecisionSchema,
  additions: memberEditRequestSchema.entries.additions,
  removals: memberEditRequestSchema.entries.removals,
  affected,
  blockers,
  effectful: v.boolean(),
  allowed: v.boolean(),
});
export const importImpactSchema = v.object({
  kind: v.literal("collection-import"),
  source: v.string(),
  destination: v.string(),
  owner: v.optional(owner),
  additions: memberEditRequestSchema.entries.additions,
  skipped: memberEditRequestSchema.entries.additions,
  conflicts: blockers,
  allowed: v.boolean(),
});
export const referenceImpactSchema = v.object({
  kind: v.literal("reference"),
  collection: v.string(),
  name: v.string(),
  referencedCollection: v.string(),
  description: v.string(),
  owner: v.optional(owner),
  decision: collectionEditDecisionSchema,
  allowed: v.boolean(),
});
export const collectionUseImpactSchema = v.object({
  kind: v.literal("collection-use"),
  owner,
  oldCollections: setUseRequestSchema.entries.collections,
  newCollections: setUseRequestSchema.entries.collections,
  affectedSelectors: affected,
  newlyExposed: affected,
  removedAtOwner: affected,
  retained: v.pipe(
    v.array(
      v.object({
        selector: v.string(),
        address,
        alternateOwners: v.pipe(v.array(owner), v.readonly()),
      }),
    ),
    v.readonly(),
  ),
  alternateOwners: v.pipe(v.array(owner), v.readonly()),
  currentComplete: v.boolean(),
  proposedComplete: v.boolean(),
  blockers,
  allowed: v.boolean(),
});
export const collectionRemovalImpactSchema = v.object({
  kind: v.literal("collection-removal"),
  owner: v.optional(owner),
  decision: v.optional(
    v.variant("kind", [
      collectionEditDecisionSchema.options[0],
      collectionEditDecisionSchema.options[1],
      collectionEditDecisionSchema.options[2],
      collectionEditDecisionSchema.options[4],
    ]),
  ),
  repository,
  disappearingSelectors: affected,
  retainedSelectors: affected,
  blockers,
  allowed: v.boolean(),
});
export const collectionInspectionSchema = v.object({
  ...v.pick(collectionViewSchema, [
    "id",
    "description",
    "instructions",
    "declared",
    "members",
    "references",
    "links",
  ]).entries,
  catalogPreview: v.object({
    skills: v.number(),
    linkedSkills: v.number(),
    collections: v.number(),
  }),
  disclosure: v.object({
    available: v.boolean(),
    useRoot: v.boolean(),
    referenceReachable: v.boolean(),
  }),
});
