import * as v from "valibot";
import { skillAddressSchema as address } from "../source/schema";
import { configDeclarationOwnerSchema as owner } from "../config/schema";
import { impactBlockerSchema, membershipAffectedSchema } from "../collection/domain.schema";
import {
  discoveredSkillCandidateSchema,
  sourceBindingViewSchema,
  sourceFileChangeSchema,
} from "../source/domain.schema";

export const uninstallImpactSchema = v.object({
  kind: v.literal("uninstall"),
  installed: v.pipe(v.array(address), v.readonly()),
  directMemberships: v.pipe(v.array(owner), v.readonly()),
  disappearingSelectors: v.pipe(v.array(membershipAffectedSchema), v.readonly()),
  retainedSelectors: v.pipe(v.array(membershipAffectedSchema), v.readonly()),
  blockers: v.pipe(v.array(impactBlockerSchema), v.readonly()),
  allowed: v.boolean(),
});
export const rebindImpactSchema = v.object({
  kind: v.literal("rebind"),
  address,
  owner: v.string(),
  ownerPath: v.string(),
  proof: v.picklist(["proven", "distinct", "unprovable"]),
  allowed: v.boolean(),
});
const candidates = v.pipe(v.array(discoveredSkillCandidateSchema), v.readonly());
export const updateObservationSchema = v.object({
  source: v.string(),
  kind: sourceBindingViewSchema.entries.kind,
  baseline: v.string(),
  exactRevision: v.optional(v.string()),
  observedAt: v.optional(v.number()),
  refreshError: v.optional(v.string()),
  changed: candidates,
  added: candidates,
  removed: candidates,
  unchanged: candidates,
});
export const updatePreviewSchema = v.variant("status", [
  v.object({ address, status: v.literal("unavailable"), reason: v.literal("local-live-content") }),
  v.object({
    address,
    status: v.literal("ready"),
    installedRevision: v.optional(v.string()),
    targetRevision: v.string(),
    removed: v.boolean(),
    files: v.pipe(v.array(sourceFileChangeSchema), v.readonly()),
  }),
]);
export const rebindRequestSchema = v.object({
  ...address.entries,
  owner: v.string(),
  ownerPath: v.optional(v.string()),
});
export const installedSelectionSchema = v.object({
  source: v.string(),
  paths: v.pipe(v.array(v.string()), v.readonly()),
});
export const installRequestSchema = v.object({
  ...installedSelectionSchema.entries,
  exactRevision: v.optional(v.string()),
});
export const updateRequestSchema = v.object({
  ...installRequestSchema.entries,
  remove: v.optional(installedSelectionSchema.entries.paths),
  expectedBaseline: v.optional(v.string()),
});
