import * as v from "valibot";
import {
  configDeclarationOwnerSchema,
  configSourceContributionRefSchema,
  declarationProvenanceSchema,
  proxyUrlSchema,
} from "../config/schema";
import { configLevelSchema } from "../config/schema";
import { sourceBindingSchema, skillAddressSchema } from "./schema";
import { impactBlockerSchema } from "../collection/domain.schema";

export const sourceNetworkSchema = v.object({ proxy: v.optional(proxyUrlSchema) });
export const sourceBindingViewSchema = v.object({
  id: v.string(),
  kind: v.picklist(["local", "git", "github"]),
  origin: v.string(),
  root: v.string(),
  ref: v.optional(v.string()),
  provenance: declarationProvenanceSchema,
  contribution: v.optional(configSourceContributionRefSchema),
  selectors: v.pipe(v.array(v.string()), v.readonly()),
});
export const skillProvenanceSchema = v.object({
  source: v.string(),
  origin: v.picklist(["local", "git"]),
  declaration: v.optional(declarationProvenanceSchema),
  stability: v.picklist(["mutable-local", "immutable"]),
  revision: v.optional(v.string()),
});
export const skillSourceRefSchema = v.object({
  id: v.string(),
  owner: configDeclarationOwnerSchema,
});
export const discoveredSkillCandidateSchema = v.object({
  path: v.string(),
  name: v.string(),
  description: v.string(),
});
export const discoveryObservationSchema = v.object({
  source: v.string(),
  kind: sourceBindingViewSchema.entries.kind,
  exactRevision: v.optional(v.string()),
  candidates: v.pipe(v.array(discoveredSkillCandidateSchema), v.readonly()),
});
export const sourceFileChangeSchema = v.object({
  path: v.string(),
  status: v.picklist(["added", "modified", "deleted"]),
  before: v.optional(v.object({ bytes: v.number(), executable: v.boolean() })),
  after: v.optional(v.object({ bytes: v.optional(v.number()), executable: v.boolean() })),
  content: v.variant("kind", [
    v.object({ kind: v.literal("text"), before: v.string(), after: v.string() }),
    v.object({
      kind: v.literal("unavailable"),
      reason: v.picklist(["binary", "too-large", "preview-limit"]),
    }),
  ]),
});
export const registerSourceRequestSchema = v.object({
  level: configLevelSchema,
  id: v.string(),
  binding: sourceBindingSchema,
});
export const sourceRemovalRequestSchema = v.object({
  source: v.string(),
  level: v.optional(configLevelSchema),
  expectedOwner: v.optional(configDeclarationOwnerSchema),
});
export const sourceRemovalImpactSchema = v.object({
  kind: v.literal("source-removal"),
  source: v.string(),
  owner: v.optional(configDeclarationOwnerSchema),
  installed: v.pipe(v.array(skillAddressSchema), v.readonly()),
  repairs: v.pipe(
    v.array(
      v.object({
        address: skillAddressSchema,
        actions: v.pipe(v.tuple([v.literal("rebind"), v.literal("uninstall")]), v.readonly()),
      }),
    ),
    v.readonly(),
  ),
  blockers: v.pipe(v.array(impactBlockerSchema), v.readonly()),
  allowed: v.boolean(),
});
