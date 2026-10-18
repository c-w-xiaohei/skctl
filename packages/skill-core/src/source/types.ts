import type { ImpactBlocker } from "../collection/types";
import type {
  ConfigLevel,
  DeclarationProvenance,
  ConfigSourceContributionRef,
  ConfigDeclarationOwner,
} from "../config/types";

import type { SkillAddress, SourceBinding } from "./schema";
import type { SkillMetadata } from "../content/text";

export interface SourceBindingView {
  readonly id: string;
  readonly kind: SourceBinding["kind"];
  readonly origin: string;
  readonly root: string;
  readonly ref?: string;
  readonly provenance: DeclarationProvenance;
  readonly contribution?: ConfigSourceContributionRef;
  readonly selectors: readonly string[];
}

export interface SkillProvenance {
  readonly source: string;
  readonly origin: "local" | "git";
  readonly declaration?: DeclarationProvenance;
  readonly stability: "mutable-local" | "immutable";
  readonly revision?: string;
}

export interface SkillSourceRef {
  readonly id: string;
  readonly owner: ConfigDeclarationOwner;
}

export interface DiscoveredSkillCandidate extends SkillMetadata {
  readonly path: string;
}

export interface DiscoveryObservation {
  readonly source: string;
  readonly kind: SourceBinding["kind"];
  readonly exactRevision?: string;
  readonly candidates: readonly DiscoveredSkillCandidate[];
}

export interface RegisterSourceRequest {
  readonly level: ConfigLevel;
  readonly id: string;
  readonly binding: SourceBinding;
}

export interface SourceRemovalRequest {
  readonly source: string;
  readonly level?: ConfigLevel;
  readonly expectedOwner?: ConfigDeclarationOwner;
}

export interface SourceRemovalImpact {
  readonly kind: "source-removal";
  readonly source: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly installed: readonly SkillAddress[];
  readonly repairs: readonly {
    readonly address: SkillAddress;
    readonly actions: readonly ["rebind", "uninstall"];
  }[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
