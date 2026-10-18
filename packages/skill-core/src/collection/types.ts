import type { MemberOriginPath, ResolvedMember } from "./graph";
import type { ConfigLevel, ConfigDeclarationOwner, ConfigWriteResult } from "../config/types";
import type { Operation } from "../shared";
import type { SkillAddress } from "../source/schema";
import type { CollectionReference } from "./schema";

export interface CollectionView {
  readonly id: string;
  readonly description?: string;
  readonly declared: readonly ConfigDeclarationOwner[];
  readonly repository: {
    readonly derived: boolean;
    readonly producers: readonly SkillAddress[];
  };
  readonly members: readonly (ResolvedMember & {
    readonly name: string;
  })[];
  readonly references: readonly (CollectionReference & {
    readonly name: string;
    readonly owner: ConfigDeclarationOwner;
  })[];
  readonly links: readonly {
    readonly collection: string;
    readonly owner: ConfigDeclarationOwner;
  }[];
}

export interface UseWriteResult extends ConfigWriteResult {
  readonly use: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
}

export type ImpactBlocker =
  | {
      readonly reason: "installed";
      readonly address: SkillAddress;
    }
  | { readonly reason: "membership"; readonly owner: ConfigDeclarationOwner }
  | {
      readonly reason: "use" | "reference" | "link";
      readonly owner?: ConfigDeclarationOwner;
    }
  | { readonly reason: "cycle"; readonly collections: readonly string[] }
  | {
      readonly reason: "conflict";
      readonly name?: string;
      readonly existing: ResolvedMember;
      readonly proposed: ResolvedMember;
    }
  | {
      readonly reason: "incomplete";
      readonly owner?: ConfigDeclarationOwner;
      readonly collections?: readonly string[];
      readonly installed?: readonly SkillAddress[];
    };

export interface LinkChangeImpact {
  readonly kind: "link-change";
  readonly collection: string;
  readonly target: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly linkedOwner?: ConfigDeclarationOwner;
  readonly linked: boolean;
  readonly members: CollectionView["members"];
  readonly disappearingSelectors: readonly MembershipAffected[];
  readonly retainedSelectors: readonly MembershipAffected[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export type CollectionEditDecision =
  | { readonly kind: "direct"; readonly owner: ConfigDeclarationOwner }
  | { readonly kind: "contributed"; readonly owner: ConfigDeclarationOwner }
  | {
      readonly kind: "repository-derived";
      readonly producers: readonly SkillAddress[];
    }
  | {
      readonly kind: "via-link";
      readonly paths: readonly MemberOriginPath[];
    }
  | { readonly kind: "missing" };

export interface AddToCollectionImpact {
  readonly kind: "add-to-collection";
  readonly collection: string;
  readonly address: SkillAddress;
  readonly decision: CollectionEditDecision;
  readonly intent?: {
    readonly owner: ConfigDeclarationOwner;
    readonly stableEntryName: string;
    readonly address: SkillAddress;
  };
  readonly createDirectContribution?: {
    readonly collection: string;
    readonly eligibleLevels: readonly ConfigLevel[];
  };
  readonly existing: CollectionView["members"];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export interface MembershipRemovalImpact {
  readonly kind: "membership-removal";
  readonly collection: string;
  readonly name: string;
  readonly decision: CollectionEditDecision;
  readonly affected: readonly MembershipAffected[];
  readonly retained: readonly {
    readonly selector: string;
    readonly paths: readonly MemberOriginPath[];
  }[];
  readonly disappearing: readonly MembershipAffected[];
  readonly linkActions: readonly {
    readonly owner?: ConfigDeclarationOwner;
    readonly paths: readonly MemberOriginPath[];
  }[];
  readonly allowed: boolean;
}

export interface MembershipAffected extends ResolvedMember {
  readonly selector: string;
}

export interface MembershipBatchImpact {
  readonly kind: "membership-batch";
  readonly collection: string;
  readonly decision: CollectionEditDecision;
  readonly additions: MemberEditRequest["additions"];
  readonly removals: MemberEditRequest["removals"];
  readonly affected: readonly MembershipAffected[];
  readonly blockers: readonly ImpactBlocker[];
  readonly effectful: boolean;
  readonly allowed: boolean;
}

export interface ImportImpact {
  readonly kind: "collection-import";
  readonly source: string;
  readonly destination: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly additions: MemberEditRequest["additions"];
  readonly skipped: MemberEditRequest["additions"];
  readonly conflicts: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export interface ReferenceImpact {
  readonly kind: "reference";
  readonly collection: string;
  readonly name: string;
  readonly referencedCollection: string;
  readonly description: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly decision: CollectionEditDecision;
  readonly allowed: boolean;
}

export interface CollectionUseImpact {
  readonly kind: "collection-use";
  readonly owner: ConfigDeclarationOwner;
  readonly oldCollections: readonly string[];
  readonly newCollections: readonly string[];
  readonly affectedSelectors: readonly MembershipAffected[];
  readonly newlyExposed: readonly MembershipAffected[];
  readonly removedAtOwner: readonly MembershipAffected[];
  readonly retained: readonly {
    readonly selector: string;
    readonly address: SkillAddress;
    readonly alternateOwners: readonly ConfigDeclarationOwner[];
  }[];
  readonly alternateOwners: readonly ConfigDeclarationOwner[];
  readonly currentComplete: boolean;
  readonly proposedComplete: boolean;
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export interface CollectionRemovalImpact {
  readonly kind: "collection-removal";
  readonly owner?: ConfigDeclarationOwner;
  readonly decision?: Exclude<CollectionEditDecision, { readonly kind: "via-link" }>;
  readonly repository: CollectionView["repository"];
  readonly disappearingSelectors: readonly MembershipAffected[];
  readonly retainedSelectors: readonly MembershipAffected[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export interface CollectionInspection extends Pick<
  CollectionView,
  "id" | "declared" | "members" | "references" | "links"
> {
  readonly catalogPreview: {
    readonly skills: number;
    readonly linkedSkills: number;
    readonly collections: number;
  };
  readonly disclosure: {
    readonly available: boolean;
    readonly useRoot: boolean;
    readonly referenceReachable: boolean;
  };
}

export interface CollectionRequest {
  readonly level: ConfigLevel;
  readonly collection: string;
  /** Selected direct declaration location, checked again under the write lock. */
  readonly expectedOwner?: ConfigDeclarationOwner;
}

export interface AddMemberRequest extends CollectionRequest {
  readonly name: string;
  readonly address: SkillAddress;
}

export interface RemoveMemberRequest extends CollectionRequest {
  readonly name: string;
  readonly expectedAddress?: SkillAddress;
}

export interface MemberEditRequest extends CollectionRequest {
  readonly additions: readonly { readonly name: string; readonly address: SkillAddress }[];
  readonly removals: readonly { readonly name: string; readonly expectedAddress: SkillAddress }[];
}

export interface ReviewedMemberEditRequest extends MemberEditRequest {
  /** Compared using selector/address/origin-path equivalence, not a workspace version. */
  readonly reviewedAffected: readonly MembershipAffected[];
}

export interface ImportMembersRequest {
  readonly level: ConfigLevel;
  readonly from: string;
  readonly into: string;
}

export interface AddReferenceRequest extends CollectionRequest {
  readonly name: string;
  readonly target: string;
  readonly description: string;
}

export interface RemoveReferenceRequest extends CollectionRequest {
  readonly name: string;
  readonly expected?: CollectionReference;
}

export interface SetLinkRequest extends CollectionRequest {
  readonly target: string;
  readonly linked: boolean;
}

export interface SetUseRequest {
  readonly level: ConfigLevel;
  readonly collections: readonly string[];
}

export interface UseCollectionRequest {
  readonly level: ConfigLevel;
  readonly collection: string;
}

export interface CollectionsCapability {
  inspect: Operation<
    { readonly collection: string; readonly level?: ConfigLevel },
    CollectionInspection
  >;
  create: Operation<Pick<CollectionRequest, "level" | "collection">, ConfigWriteResult>;
  remove: Operation<CollectionRequest, ConfigWriteResult>;
  addMember: Operation<AddMemberRequest, ConfigWriteResult>;
  removeMember: Operation<RemoveMemberRequest, ConfigWriteResult>;
  editMembers: Operation<ReviewedMemberEditRequest, ConfigWriteResult>;
  importMembers: Operation<ImportMembersRequest, ConfigWriteResult>;
  addReference: Operation<AddReferenceRequest, ConfigWriteResult>;
  removeReference: Operation<RemoveReferenceRequest, ConfigWriteResult>;
  setLink: Operation<SetLinkRequest, ConfigWriteResult>;
  previewAddMember: Operation<
    Omit<AddMemberRequest, "level"> & { readonly level?: ConfigLevel },
    AddToCollectionImpact
  >;
  previewRemoveMember: Operation<
    Omit<RemoveMemberRequest, "level"> & { readonly level?: ConfigLevel },
    MembershipRemovalImpact
  >;
  previewMemberEdit: Operation<MemberEditRequest, MembershipBatchImpact>;
  previewImportMembers: Operation<ImportMembersRequest, ImportImpact>;
  previewAddReference: Operation<AddReferenceRequest, ReferenceImpact>;
  previewRemoveReference: Operation<RemoveReferenceRequest, ReferenceImpact>;
  previewSetLink: Operation<SetLinkRequest, LinkChangeImpact>;
  previewRemoval: Operation<CollectionRequest, CollectionRemovalImpact>;
}

export interface UseCapability {
  set: Operation<SetUseRequest, UseWriteResult>;
  add: Operation<UseCollectionRequest, UseWriteResult>;
  remove: Operation<UseCollectionRequest, UseWriteResult>;
  previewSet: Operation<SetUseRequest, CollectionUseImpact>;
}
