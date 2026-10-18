import type { ManagedAgentView } from "../catalog/types";
import type { MemberOriginPath } from "../collection/graph";
import type { CollectionView } from "../collection/types";
import type { ConfigLevel, ConfigDeclarationOwner, ConfigSourceView } from "../config/types";
import type { OperationOptions, OperationResult, Diagnostic } from "../shared";
import type { SkillAddress } from "../source/schema";
import type { SourceBindingView, SkillSourceRef } from "../source/types";
import type { SkillMetadata } from "../content/text";

export interface ConfigFileView {
  readonly status: "missing" | "valid" | "invalid" | "unreadable";
  readonly file: string;
  readonly problem?: Diagnostic;
}

export interface ConfigLevelView {
  readonly level: ConfigLevel;
  readonly file: ConfigFileView;
  readonly direct: {
    readonly sources: readonly (Omit<SourceBindingView, "ref"> & {
      readonly ref: SkillSourceRef;
      readonly trackedRef?: string;
    })[];
    readonly configSources: readonly ConfigSourceView[];
    readonly collections: ConfigSourceView["contributed"]["collections"];
    readonly collectionUse: readonly {
      readonly collection: string;
      readonly owner: ConfigDeclarationOwner;
    }[];
    readonly integrations: readonly {
      readonly kind: "opencode";
      readonly owner: ConfigDeclarationOwner;
    }[];
  };
  readonly contributed: {
    readonly sources: readonly SourceBindingView[];
    readonly collections: readonly string[];
  };
}

export type InstalledSkillSelectorViews =
  | {
      readonly status: "complete";
      readonly values: readonly {
        readonly selector: string;
        readonly collection: string;
        readonly entry: string;
        readonly paths: readonly MemberOriginPath[];
        /** Structural Collection Use routes; this does not make a Reference target a direct Use. */
        readonly exposurePaths?: readonly {
          readonly owner: ConfigDeclarationOwner;
          readonly segments: readonly {
            readonly collection: string;
            readonly reference?: { readonly name: string; readonly target: string };
          }[];
        }[];
        readonly useOwners: readonly ConfigDeclarationOwner[];
      }[];
    }
  | { readonly status: "unavailable" };

export interface WorkspaceView {
  readonly project: {
    readonly root: string;
    readonly resolution: "explicit" | "nearest-config" | "git-root" | "global-only";
  };
  readonly configs: readonly ConfigLevelView[];
  readonly effective: {
    readonly sources: readonly SourceBindingView[];
    readonly collections: readonly string[];
    readonly agent: ManagedAgentView;
  } & (
    | {
        readonly status: "complete";
        readonly use: readonly string[];
        readonly managed: boolean;
        readonly collectionsView: readonly CollectionView[];
      }
    | {
        readonly status: "unavailable";
        readonly reasons: readonly Diagnostic[];
      }
  );
  readonly installedSkills: readonly (SkillMetadata & {
    readonly address: SkillAddress;
    readonly owner: {
      readonly source: string;
      readonly health: "healthy" | "missing" | "drifted" | "unresolved-config";
      readonly relevantLocalRoot?: string;
      readonly relevantRemoteRevision?: string;
    };
    readonly source?: SourceBindingView;
    readonly collections: readonly {
      readonly id: string;
      readonly entry: string;
      readonly paths: readonly MemberOriginPath[];
    }[];
    readonly selectors: readonly string[];
    readonly selectorViews: InstalledSkillSelectorViews;
    readonly primary?: string;
    readonly aliases: readonly string[];
    readonly problems: readonly Diagnostic[];
  })[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface WorkspaceCapability {
  get(options?: OperationOptions): Promise<OperationResult<WorkspaceView>>;
}
