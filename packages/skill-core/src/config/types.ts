import type { ImpactBlocker } from "../collection/types";

import type { SkillAddress, SourceBinding } from "../source/schema";
import type { SourceBindingView } from "../source/types";

export type ConfigLevel = "global" | "project" | "local";

export interface DeclarationProvenance {
  readonly level: ConfigLevel;
  readonly file?: string;
  readonly pointer?: string;
  readonly namespace?: string;
}

export interface ConfigSourceContributionRef {
  readonly configSource: ConfigDeclarationOwner;
  readonly declaration: DeclarationProvenance;
}

export interface ConfigDeclarationOwner extends DeclarationProvenance {
  readonly file: string;
  readonly pointer: string;
  readonly contribution?: ConfigSourceContributionRef;
}

export interface ConfigWriteResult {
  /** Publication completed; diagnostic refresh warnings do not undo this result. */
  readonly level: ConfigLevel;
  readonly file: string;
  readonly changed: boolean;
}

export interface ConfigSourceView {
  readonly id: string;
  readonly owner: ConfigDeclarationOwner;
  readonly binding: SourceBinding;
  readonly adoption:
    | { readonly status: "live" }
    | { readonly status: "not-adopted" }
    | { readonly status: "adopted"; readonly commit: string };
  readonly contributed: {
    readonly sources: readonly SourceBindingView[];
    readonly collections: readonly {
      readonly id: string;
      readonly owner: ConfigDeclarationOwner;
    }[];
  };
}

export interface ConfigSourceContributionImpact {
  readonly sources: readonly {
    readonly id: string;
    readonly owner: ConfigDeclarationOwner;
    readonly binding: Pick<SourceBindingView, "kind" | "origin" | "root" | "ref">;
  }[];
  readonly collections: ConfigSourceView["contributed"]["collections"];
}

export interface ConfigSourceDeltaImpact {
  readonly addedSources: ConfigSourceContributionImpact["sources"];
  readonly changedSources: ConfigSourceContributionImpact["sources"];
  readonly removedSources: ConfigSourceContributionImpact["sources"];
  readonly addedCollections: ConfigSourceContributionImpact["collections"];
  readonly changedCollections: ConfigSourceContributionImpact["collections"];
  readonly removedCollections: ConfigSourceContributionImpact["collections"];
}

export interface ConfigSourceImpact {
  readonly kind: "config-source-adopt" | "config-source-forget" | "config-source-removal";
  readonly id: string;
  readonly owner: ConfigDeclarationOwner;
  readonly binding: ConfigSourceView["binding"];
  readonly currentAppliedCommit?: string;
  readonly exactRevision?: string;
  readonly declarationRetained: boolean;
  readonly contributions: ConfigSourceContributionImpact;
  readonly delta: ConfigSourceDeltaImpact;
  readonly affectedInstalled: readonly SkillAddress[];
  readonly disappearingSelectors: readonly string[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export interface ConfigSourceObservation {
  readonly id: string;
  readonly kind: SourceBinding["kind"];
  readonly exactRevision?: string;
  readonly contributions: ConfigSourceContributionImpact;
}

export interface AdoptConfigRequest {
  readonly id: string;
  readonly exactRevision: string;
  readonly observation?: ConfigSourceObservation;
}

export interface ManagedOpenCodeRequest {
  readonly level: ConfigLevel;
  readonly managed: boolean;
}
