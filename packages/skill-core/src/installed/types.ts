import type { ImpactBlocker, MembershipAffected } from "../collection/types";
import type { ConfigDeclarationOwner } from "../config/types";
import type {
  ResourceDescriptor,
  LoadedInstalledSkill,
  InstalledResourceResult,
} from "../content/types";
import type { OperationOptions, Operation } from "../shared";
import type { SkillAddress, SourceBinding } from "../source/schema";
import type { DiscoveredSkillCandidate } from "../source/types";

export interface UninstallImpact {
  readonly kind: "uninstall";
  readonly installed: readonly SkillAddress[];
  readonly directMemberships: readonly ConfigDeclarationOwner[];
  readonly disappearingSelectors: readonly MembershipAffected[];
  readonly retainedSelectors: readonly MembershipAffected[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}

export interface RebindImpact {
  readonly kind: "rebind";
  readonly address: SkillAddress;
  readonly owner: string;
  readonly ownerPath: string;
  readonly proof: "proven" | "distinct" | "unprovable";
  readonly allowed: boolean;
}

export interface UpdateObservation {
  readonly source: string;
  readonly kind: SourceBinding["kind"];
  /** Installed-comparison snapshot; retain and pass to reviewed updates unchanged. */
  readonly baseline: string;
  readonly exactRevision?: string;
  readonly changed: readonly DiscoveredSkillCandidate[];
  readonly added: readonly DiscoveredSkillCandidate[];
  readonly removed: readonly DiscoveredSkillCandidate[];
  readonly unchanged: readonly DiscoveredSkillCandidate[];
}

export interface UpdateFileChange {
  /** Path relative to this Skill Root, not the Source or workspace. */
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly before?: { readonly bytes: number; readonly executable: boolean };
  /** Byte size may be unknown when content was not acquired under the preview limit. */
  readonly after?: { readonly bytes?: number; readonly executable: boolean };
  readonly content:
    | { readonly kind: "text"; readonly before: string; readonly after: string }
    | { readonly kind: "unavailable"; readonly reason: "binary" | "too-large" | "preview-limit" };
}

export type UpdatePreview = {
  readonly address: SkillAddress;
} & (
  | { readonly status: "unavailable"; readonly reason: "local-live-content" }
  | {
      readonly status: "ready";
      readonly installedRevision?: string;
      readonly targetRevision: string;
      readonly removed: boolean;
      readonly files: readonly UpdateFileChange[];
    }
);

export interface RebindRequest extends SkillAddress {
  readonly owner: string;
  readonly ownerPath?: string;
}

export interface InstalledSelection {
  readonly source: string;
  readonly paths: readonly string[];
}

export interface InstallRequest extends InstalledSelection {
  readonly exactRevision?: string;
}

export interface UpdateRequest extends InstallRequest {
  readonly remove?: readonly string[];
  readonly expectedBaseline?: string;
}

export interface InstalledCapability {
  load(
    request: { readonly address: SkillAddress },
    options?: OperationOptions,
  ): Promise<LoadedInstalledSkill>;
  listResources(
    request: { readonly address: SkillAddress },
    options?: OperationOptions,
  ): Promise<readonly ResourceDescriptor[]>;
  read(
    request: { readonly address: SkillAddress; readonly path: string },
    options?: OperationOptions,
  ): Promise<InstalledResourceResult>;
  previewUninstall: Operation<InstalledSelection, UninstallImpact>;
  previewRebind: Operation<RebindRequest, RebindImpact>;
  install: Operation<InstallRequest, readonly DiscoveredSkillCandidate[]>;
  uninstall: Operation<InstalledSelection>;
  rebind: Operation<RebindRequest>;
  checkUpdate: Operation<{ readonly source: string }, UpdateObservation>;
  previewUpdate: Operation<
    SkillAddress & {
      readonly exactRevision?: string;
      readonly expectedBaseline: string;
    },
    UpdatePreview
  >;
  updateBaseline: Operation<{ readonly source: string }, string>;
  update: Operation<UpdateRequest>;
}
