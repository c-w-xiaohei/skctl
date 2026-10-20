import type * as v from "valibot";
import type * as schema from "./domain.schema";

export type CatalogSkill = Readonly<v.InferOutput<typeof schema.catalogSkillSchema>>;
export type ManagedAgentView = Readonly<v.InferOutput<typeof schema.managedAgentViewSchema>>;
export type BrowseCatalogRequest = Readonly<
  v.InferOutput<typeof schema.browseCatalogRequestSchema>
>;
export type AgentCatalogItem = Readonly<v.InferOutput<typeof schema.agentCatalogItemSchema>>;
export type AgentBrowseProjection = Readonly<
  v.InferOutput<typeof schema.agentBrowseProjectionSchema>
>;
export type SearchSkillsRequest = Readonly<v.InferOutput<typeof schema.searchSkillsRequestSchema>>;
export type SearchSkillsResult = Readonly<v.InferOutput<typeof schema.searchSkillsResultSchema>>;
