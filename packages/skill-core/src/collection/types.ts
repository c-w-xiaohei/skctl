import type * as v from "valibot";
import type * as schema from "./domain.schema";

export type CollectionView = Readonly<v.InferOutput<typeof schema.collectionViewSchema>>;
export type UseWriteResult = Readonly<v.InferOutput<typeof schema.useWriteResultSchema>>;
export type ImpactBlocker = Readonly<v.InferOutput<typeof schema.impactBlockerSchema>>;
export type LinkChangeImpact = Readonly<v.InferOutput<typeof schema.linkChangeImpactSchema>>;
export type CollectionEditDecision = Readonly<
  v.InferOutput<typeof schema.collectionEditDecisionSchema>
>;
export type AddToCollectionImpact = Readonly<
  v.InferOutput<typeof schema.addToCollectionImpactSchema>
>;
export type MembershipRemovalImpact = Readonly<
  v.InferOutput<typeof schema.membershipRemovalImpactSchema>
>;
export type MembershipAffected = Readonly<v.InferOutput<typeof schema.membershipAffectedSchema>>;
export type MembershipBatchImpact = Readonly<
  v.InferOutput<typeof schema.membershipBatchImpactSchema>
>;
export type ImportImpact = Readonly<v.InferOutput<typeof schema.importImpactSchema>>;
export type ReferenceImpact = Readonly<v.InferOutput<typeof schema.referenceImpactSchema>>;
export type CollectionUseImpact = Readonly<v.InferOutput<typeof schema.collectionUseImpactSchema>>;
export type CollectionRemovalImpact = Readonly<
  v.InferOutput<typeof schema.collectionRemovalImpactSchema>
>;
export type CollectionInspection = Readonly<
  v.InferOutput<typeof schema.collectionInspectionSchema>
>;
export type CollectionRequest = Readonly<v.InferOutput<typeof schema.collectionRequestSchema>>;
export type AddMemberRequest = Readonly<v.InferOutput<typeof schema.addMemberRequestSchema>>;
export type RemoveMemberRequest = Readonly<v.InferOutput<typeof schema.removeMemberRequestSchema>>;
export type MemberEditRequest = Readonly<v.InferOutput<typeof schema.memberEditRequestSchema>>;
export type ReviewedMemberEditRequest = Readonly<
  v.InferOutput<typeof schema.reviewedMemberEditRequestSchema>
>;
export type ImportMembersRequest = Readonly<
  v.InferOutput<typeof schema.importMembersRequestSchema>
>;
export type AddReferenceRequest = Readonly<v.InferOutput<typeof schema.addReferenceRequestSchema>>;
export type RemoveReferenceRequest = Readonly<
  v.InferOutput<typeof schema.removeReferenceRequestSchema>
>;
export type SetLinkRequest = Readonly<v.InferOutput<typeof schema.setLinkRequestSchema>>;
export type SetUseRequest = Readonly<v.InferOutput<typeof schema.setUseRequestSchema>>;
export type UseCollectionRequest = Readonly<
  v.InferOutput<typeof schema.useCollectionRequestSchema>
>;
