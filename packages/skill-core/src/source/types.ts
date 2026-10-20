import type * as v from "valibot";
import type * as schema from "./domain.schema";

export type SourceNetwork = Readonly<v.InferOutput<typeof schema.sourceNetworkSchema>>;
export type SourceBindingView = Readonly<v.InferOutput<typeof schema.sourceBindingViewSchema>>;
export type SkillProvenance = Readonly<v.InferOutput<typeof schema.skillProvenanceSchema>>;
export type SkillSourceRef = Readonly<v.InferOutput<typeof schema.skillSourceRefSchema>>;
export type DiscoveredSkillCandidate = Readonly<
  v.InferOutput<typeof schema.discoveredSkillCandidateSchema>
>;
export type DiscoveryObservation = Readonly<
  v.InferOutput<typeof schema.discoveryObservationSchema>
>;
export type SourceFileChange = Readonly<v.InferOutput<typeof schema.sourceFileChangeSchema>>;
export type RegisterSourceRequest = Readonly<
  v.InferOutput<typeof schema.registerSourceRequestSchema>
>;
export type SourceRemovalRequest = Readonly<
  v.InferOutput<typeof schema.sourceRemovalRequestSchema>
>;
export type SourceRemovalImpact = Readonly<v.InferOutput<typeof schema.sourceRemovalImpactSchema>>;
