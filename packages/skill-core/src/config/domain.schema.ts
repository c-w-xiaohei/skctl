import * as v from "valibot";
import { configDeclarationOwnerSchema as owner } from "./schema";
import { skillAddressSchema, sourceBindingSchema } from "../source/schema";
import { sourceBindingViewSchema } from "../source/domain.schema";
import { impactBlockerSchema } from "../collection/domain.schema";

const collections = v.pipe(v.array(v.object({ id: v.string(), owner })), v.readonly());
export const configSourceViewSchema = v.object({
  id: v.string(),
  owner,
  binding: sourceBindingSchema,
  adoption: v.variant("status", [
    v.object({ status: v.literal("live") }),
    v.object({ status: v.literal("not-adopted") }),
    v.object({ status: v.literal("adopted"), commit: v.string() }),
  ]),
  contributed: v.object({
    sources: v.pipe(v.array(sourceBindingViewSchema), v.readonly()),
    collections,
  }),
});
export const configSourceContributionImpactSchema = v.object({
  sources: v.pipe(
    v.array(
      v.object({
        id: v.string(),
        owner,
        binding: v.pick(sourceBindingViewSchema, ["kind", "origin", "root", "ref"]),
      }),
    ),
    v.readonly(),
  ),
  collections,
});
const sources = configSourceContributionImpactSchema.entries.sources;
export const configSourceDeltaImpactSchema = v.object({
  addedSources: sources,
  changedSources: sources,
  removedSources: sources,
  addedCollections: collections,
  changedCollections: collections,
  removedCollections: collections,
});
export const configSourceImpactSchema = v.object({
  kind: v.picklist(["config-source-adopt", "config-source-forget", "config-source-removal"]),
  id: v.string(),
  owner,
  binding: sourceBindingSchema,
  currentAppliedCommit: v.optional(v.string()),
  exactRevision: v.optional(v.string()),
  declarationRetained: v.boolean(),
  contributions: configSourceContributionImpactSchema,
  delta: configSourceDeltaImpactSchema,
  affectedInstalled: v.pipe(v.array(skillAddressSchema), v.readonly()),
  disappearingSelectors: v.pipe(v.array(v.string()), v.readonly()),
  blockers: v.pipe(v.array(impactBlockerSchema), v.readonly()),
  allowed: v.boolean(),
});
export const configSourceObservationSchema = v.object({
  id: v.string(),
  kind: sourceBindingViewSchema.entries.kind,
  exactRevision: v.optional(v.string()),
  contributions: configSourceContributionImpactSchema,
});
export const adoptConfigRequestSchema = v.object({
  id: v.string(),
  exactRevision: v.string(),
  observation: v.optional(configSourceObservationSchema),
});
