import * as v from "valibot";
import { configDeclarationOwnerSchema } from "../config/schema";
import { diagnosticSchema } from "../shared";
import { discoveredSkillCandidateSchema } from "../source/domain.schema";

export const catalogSkillSchema = v.object({
  ...v.omit(discoveredSkillCandidateSchema, ["path"]).entries,
  selector: v.string(),
});
export const managedAgentViewSchema = v.object({
  status: v.picklist(["available", "unavailable"]),
  integration: v.pipe(v.array(configDeclarationOwnerSchema), v.readonly()),
  use: v.pipe(v.array(configDeclarationOwnerSchema), v.readonly()),
  reasons: v.pipe(v.array(diagnosticSchema), v.readonly()),
  catalog: v.pipe(
    v.array(
      v.object({
        ...catalogSkillSchema.entries,
        aliases: v.pipe(v.array(v.string()), v.readonly()),
      }),
    ),
    v.readonly(),
  ),
});
export const browseCatalogRequestSchema = v.object({ collection: v.optional(v.string()) });
export const agentCatalogItemSchema = v.variant("kind", [
  v.object({
    kind: v.literal("collection"),
    id: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  }),
  v.object({ ...catalogSkillSchema.entries, kind: v.literal("skill") }),
]);
export const agentBrowseProjectionSchema = v.variant("status", [
  v.object({
    status: v.literal("available"),
    scope: v.variant("kind", [
      v.object({ kind: v.literal("root") }),
      v.object({ kind: v.literal("collection"), id: v.string() }),
    ]),
    items: v.pipe(v.array(agentCatalogItemSchema), v.readonly()),
  }),
  v.object({ status: v.literal("unavailable"), reason: v.string() }),
]);
export const searchSkillsRequestSchema = v.object({
  ...browseCatalogRequestSchema.entries,
  query: v.string(),
  limit: v.optional(v.number()),
});
export const searchSkillsResultSchema = v.object({
  truncated: v.boolean(),
  results: v.pipe(v.array(catalogSkillSchema), v.readonly()),
});
