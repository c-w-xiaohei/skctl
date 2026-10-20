import type * as v from "valibot";
import type * as schema from "./domain.schema";
import type {
  configLevelSchema,
  declarationProvenanceSchema,
  configSourceContributionRefSchema,
  configWriteResultSchema,
} from "./schema";
export type { ConfigDeclarationOwner } from "./schema";

export type ConfigLevel = v.InferOutput<typeof configLevelSchema>;
export type DeclarationProvenance = Readonly<v.InferOutput<typeof declarationProvenanceSchema>>;
export type ConfigSourceContributionRef = Readonly<
  v.InferOutput<typeof configSourceContributionRefSchema>
>;
export type ConfigWriteResult = Readonly<v.InferOutput<typeof configWriteResultSchema>>;
export type ConfigSourceView = Readonly<v.InferOutput<typeof schema.configSourceViewSchema>>;
export type ConfigSourceContributionImpact = Readonly<
  v.InferOutput<typeof schema.configSourceContributionImpactSchema>
>;
export type ConfigSourceDeltaImpact = Readonly<
  v.InferOutput<typeof schema.configSourceDeltaImpactSchema>
>;
export type ConfigSourceImpact = Readonly<v.InferOutput<typeof schema.configSourceImpactSchema>>;
export type ConfigSourceObservation = Readonly<
  v.InferOutput<typeof schema.configSourceObservationSchema>
>;
export type AdoptConfigRequest = Readonly<v.InferOutput<typeof schema.adoptConfigRequestSchema>>;
export type ManagedOpenCodeRequest = Readonly<
  v.InferOutput<typeof schema.managedOpenCodeRequestSchema>
>;
