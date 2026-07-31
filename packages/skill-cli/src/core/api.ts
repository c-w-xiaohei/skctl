export interface CoreFactoryOptions {
  readonly cwd: string;
  readonly project?: string;
  readonly userConfigPath?: string;
  readonly sourceTransport?: (url: string) => string | undefined;
  readonly githubApiBaseUrl?: string;
}
export interface OperationOptions {
  readonly signal?: AbortSignal;
}
export interface OperationResult<T> {
  readonly value: T;
  readonly diagnostics: readonly Diagnostic[];
}
export interface Diagnostic {
  readonly code: string;
  readonly severity: "info" | "warning";
  readonly message: string;
  readonly location?: { readonly file: string; readonly pointer?: string };
  readonly related?: readonly {
    readonly message: string;
    readonly file?: string;
    readonly pointer?: string;
  }[];
  readonly suggestion?: string;
  readonly subject?:
    | { readonly kind: "config"; readonly owner: ConfigDeclarationOwner }
    | {
        readonly kind: "installed-skill";
        readonly address: { readonly source: string; readonly path: string };
      };
}
export type SkillCliErrorCode =
  | "INVALID_ARGUMENT"
  | "PROJECT_NOT_FOUND"
  | "CONFIG_SYMLINK"
  | "CONFIG_PARSE_FAILED"
  | "CONFIG_INVALID"
  | "CONFIG_CONFLICT"
  | "REBIND_UNPROVABLE"
  | "LOCK_TIMEOUT"
  | "LOCK_CORRUPT"
  | "LOCK_LOST"
  | "SOURCE_NOT_FOUND"
  | "NO_SKILLS_FOUND"
  | "DUPLICATE_SKILL_NAME"
  | "REFERENCE_NOT_FOUND"
  | "SKILL_NOT_FOUND"
  | "AGENT_IDENTITY_REQUIRED"
  | "EXPOSURE_CONFLICT"
  | "RESOURCE_NOT_FOUND"
  | "INVALID_RESOURCE_PATH"
  | "TEXT_TOO_LARGE"
  | "INVALID_UTF8"
  | "UNSUPPORTED_ENTRY"
  | "PINNED_COMMIT_UNAVAILABLE"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INTEGRITY_FAILED"
  | "DESTINATION_EXISTS"
  | "ATOMIC_PUBLICATION_UNSUPPORTED"
  | "WRITE_FAILED"
  | "SPAWN_FAILED"
  | "CANCELLED"
  | "CLEANUP_FAILED"
  | "TRANSACTION_CONFLICT"
  | "INTERNAL";
export class SkillCliError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(
    readonly code: SkillCliErrorCode,
    message: string,
    diagnostics: readonly Diagnostic[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillCliError";
    this.diagnostics = diagnostics;
  }
}
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
export interface SourceBindingView {
  readonly id: string;
  readonly kind: "local" | "git" | "github";
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
export interface SelectedSkillView {
  readonly selector: string;
  readonly name: string;
  readonly description: string;
  readonly provenance: SkillProvenance;
}
export interface ConfigDeclarationOwner {
  readonly level: ConfigLevel;
  readonly file: string;
  readonly pointer: string;
  readonly namespace?: string;
  readonly contribution?: ConfigSourceContributionRef;
}
export interface SkillSourceRef {
  readonly id: string;
  readonly owner: ConfigDeclarationOwner;
}
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
    })[];
    readonly configSources: readonly ConfigSourceView[];
    readonly collections: readonly {
      readonly id: string;
      readonly owner: ConfigDeclarationOwner;
    }[];
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
export interface ConfigSourceView {
  readonly id: string;
  readonly owner: ConfigDeclarationOwner;
  readonly binding:
    | { readonly kind: "local"; readonly path: string; readonly root: string }
    | {
        readonly kind: "git" | "github";
        readonly origin: string;
        readonly root: string;
        readonly ref: string;
      };
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
export interface CollectionView {
  readonly id: string;
  readonly declared: readonly ConfigDeclarationOwner[];
  readonly repository: {
    readonly derived: boolean;
    readonly producers: readonly { readonly source: string; readonly path: string }[];
  };
  readonly members: readonly {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly references: readonly {
    readonly name: string;
    readonly collection: string;
    readonly description: string;
    readonly owner: ConfigDeclarationOwner;
  }[];
  readonly links: readonly {
    readonly collection: string;
    readonly owner: ConfigDeclarationOwner;
  }[];
}
export interface ManagedAgentView {
  readonly status: "available" | "unavailable";
  readonly integration: readonly ConfigDeclarationOwner[];
  readonly use: readonly ConfigDeclarationOwner[];
  readonly reasons: readonly Diagnostic[];
  readonly catalog: readonly {
    readonly selector: string;
    readonly name: string;
    readonly description: string;
    readonly aliases: readonly string[];
  }[];
}
export type InstalledSkillSelectorViews =
  | {
      readonly status: "complete";
      readonly values: readonly {
        readonly selector: string;
        readonly collection: string;
        readonly entry: string;
        readonly paths: readonly import("./collections").MemberOriginPath[];
        readonly useOwners: readonly ConfigDeclarationOwner[];
      }[];
    }
  | { readonly status: "unavailable" };
export interface ManagementProjection {
  readonly project: {
    readonly root: string;
    readonly resolution: "explicit" | "nearest-config" | "git-root" | "global-only";
  };
  readonly configs: readonly ConfigLevelView[];
  readonly effective:
    | {
        readonly status: "complete";
        readonly sources: readonly SourceBindingView[];
        readonly collections: readonly string[];
        readonly use: readonly string[];
        readonly managed: boolean;
        readonly collectionsView: readonly CollectionView[];
        readonly agent: ManagedAgentView;
      }
    | {
        readonly status: "unavailable";
        readonly reasons: readonly Diagnostic[];
        readonly sources: readonly SourceBindingView[];
        readonly collections: readonly string[];
        readonly agent: ManagedAgentView;
      };
  readonly installedSkills: readonly {
    readonly address: { readonly source: string; readonly path: string };
    readonly name: string;
    readonly description: string;
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
      readonly paths: readonly import("./collections").MemberOriginPath[];
    }[];
    readonly selectors: readonly string[];
    readonly selectorViews: InstalledSkillSelectorViews;
    readonly primary?: string;
    readonly aliases: readonly string[];
    readonly problems: readonly Diagnostic[];
  }[];
  readonly diagnostics: readonly Diagnostic[];
}
export type WorkspaceView = ManagementProjection;
export type ConfigChange =
  | {
      readonly type: "source.register";
      readonly level: ConfigLevel;
      readonly id: string;
      readonly binding:
        | {
            readonly kind: "local";
            readonly path: string;
            readonly root: string;
          }
        | {
            readonly kind: "git";
            readonly origin: string;
            readonly root: string;
            readonly ref: string;
          }
        | {
            readonly kind: "github";
            readonly owner?: string;
            readonly repository?: string;
            readonly origin: string;
            readonly root: string;
            readonly ref: string;
          };
    }
  | {
      readonly type: "config-source.register";
      readonly level: ConfigLevel;
      readonly id: string;
      readonly binding:
        | {
            readonly kind: "local";
            readonly path: string;
            readonly root: string;
          }
        | {
            readonly kind: "git";
            readonly origin: string;
            readonly root: string;
            readonly ref: string;
          }
        | {
            readonly kind: "github";
            readonly owner?: string;
            readonly repository?: string;
            readonly origin: string;
            readonly root: string;
            readonly ref: string;
          };
    }
  | { readonly type: "collection.create"; readonly level: ConfigLevel; readonly collection: string }
  | { readonly type: "collection.remove"; readonly level: ConfigLevel; readonly collection: string }
  | {
      readonly type: "collection.member.set";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly address: { readonly source: string; readonly path: string };
    }
  | {
      readonly type: "collection.member.remove";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly expectedAddress?: { readonly source: string; readonly path: string };
    }
  | {
      readonly type: "collection.import";
      readonly level: ConfigLevel;
      readonly from: string;
      readonly into: string;
    }
  | {
      readonly type: "collection.reference.set";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly target: string;
      readonly description: string;
    }
  | {
      readonly type: "collection.reference.remove";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly expected?: { readonly collection: string; readonly description: string };
    }
  | {
      readonly type: "collection.link.set";
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly target: string;
      readonly linked: boolean;
    }
  | {
      readonly type: "use.set";
      readonly level: ConfigLevel;
      readonly collections: readonly string[];
    }
  | { readonly type: "use.add"; readonly level: ConfigLevel; readonly collection: string }
  | { readonly type: "use.remove"; readonly level: ConfigLevel; readonly collection: string }
  | {
      readonly type: "agent.managed.set";
      readonly level: ConfigLevel;
      readonly managed: boolean;
    };
export interface ConfigurationChangeResult {
  readonly level: ConfigLevel;
  readonly file?: string;
  readonly changed: boolean;
  readonly use?: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
}
export type ImpactBlocker =
  | {
      readonly reason: "installed";
      readonly address: { readonly source: string; readonly path: string };
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
      readonly existing: {
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: readonly import("./collections").MemberOriginPath[];
      };
      readonly proposed: {
        readonly address: { readonly source: string; readonly path: string };
        readonly paths: readonly import("./collections").MemberOriginPath[];
      };
    }
  | {
      readonly reason: "incomplete";
      readonly owner?: ConfigDeclarationOwner;
      readonly collections?: readonly string[];
      readonly installed?: readonly { readonly source: string; readonly path: string }[];
    };
export interface SourceRemovalImpact {
  readonly kind: "source-removal";
  readonly source: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly installed: readonly { readonly source: string; readonly path: string }[];
  readonly repairs: readonly {
    readonly address: { readonly source: string; readonly path: string };
    readonly actions: readonly ["rebind", "uninstall"];
  }[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
export interface UninstallImpact {
  readonly kind: "uninstall";
  readonly installed: readonly { readonly source: string; readonly path: string }[];
  readonly directMemberships: readonly ConfigDeclarationOwner[];
  readonly disappearingSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly retainedSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
export interface RebindImpact {
  readonly kind: "rebind";
  readonly address: { readonly source: string; readonly path: string };
  readonly owner: string;
  readonly ownerPath: string;
  readonly proof: "proven" | "distinct" | "unprovable";
  readonly allowed: boolean;
}
export interface LinkChangeImpact {
  readonly kind: "link-change";
  readonly collection: string;
  readonly target: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly linkedOwner?: ConfigDeclarationOwner;
  readonly linked: boolean;
  readonly members: readonly {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly disappearingSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly retainedSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
export type CollectionEditDecision =
  | { readonly kind: "direct"; readonly owner: ConfigDeclarationOwner }
  | { readonly kind: "contributed"; readonly owner: ConfigDeclarationOwner }
  | {
      readonly kind: "repository-derived";
      readonly producers: readonly { readonly source: string; readonly path: string }[];
    }
  | {
      readonly kind: "via-link";
      readonly paths: readonly import("./collections").MemberOriginPath[];
    }
  | { readonly kind: "missing" };
export interface AddToCollectionImpact {
  readonly kind: "add-to-collection";
  readonly collection: string;
  readonly address: { readonly source: string; readonly path: string };
  readonly decision: CollectionEditDecision;
  readonly intent?: {
    readonly owner: ConfigDeclarationOwner;
    readonly stableEntryName: string;
    readonly address: { readonly source: string; readonly path: string };
  };
  readonly createDirectContribution?: {
    readonly collection: string;
    readonly eligibleLevels: readonly ConfigLevel[];
  };
  readonly existing: readonly {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
export interface MembershipRemovalImpact {
  readonly kind: "membership-removal";
  readonly collection: string;
  readonly name: string;
  readonly decision: CollectionEditDecision;
  readonly affected: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly retained: readonly {
    readonly selector: string;
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly disappearing: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly linkActions: readonly {
    readonly owner?: ConfigDeclarationOwner;
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly allowed: boolean;
}
export interface ImportImpact {
  readonly kind: "collection-import";
  readonly source: string;
  readonly destination: string;
  readonly owner?: ConfigDeclarationOwner;
  readonly additions: readonly {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
  }[];
  readonly skipped: readonly {
    readonly name: string;
    readonly address: { readonly source: string; readonly path: string };
  }[];
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
  readonly exposure: readonly never[];
  readonly allowed: boolean;
}
export interface CollectionUseImpact {
  readonly kind: "collection-use";
  readonly owner: ConfigDeclarationOwner;
  readonly oldCollections: readonly string[];
  readonly newCollections: readonly string[];
  readonly affectedSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly newlyExposed: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly removedAtOwner: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly retained: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
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
  readonly repository: {
    readonly derived: boolean;
    readonly producers: readonly { readonly source: string; readonly path: string }[];
  };
  readonly disappearingSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly retainedSelectors: readonly {
    readonly selector: string;
    readonly address: { readonly source: string; readonly path: string };
    readonly paths: readonly import("./collections").MemberOriginPath[];
  }[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
export interface ConfigSourceContributionImpact {
  readonly sources: readonly {
    readonly id: string;
    readonly owner: ConfigDeclarationOwner;
    readonly binding: Pick<SourceBindingView, "kind" | "origin" | "root" | "ref">;
  }[];
  readonly collections: readonly { readonly id: string; readonly owner: ConfigDeclarationOwner }[];
}
export interface ConfigSourceDeltaImpact {
  readonly addedSources: readonly ConfigSourceContributionImpact["sources"][number][];
  readonly changedSources: readonly ConfigSourceContributionImpact["sources"][number][];
  readonly removedSources: readonly ConfigSourceContributionImpact["sources"][number][];
  readonly addedCollections: readonly ConfigSourceContributionImpact["collections"][number][];
  readonly changedCollections: readonly ConfigSourceContributionImpact["collections"][number][];
  readonly removedCollections: readonly ConfigSourceContributionImpact["collections"][number][];
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
  readonly affectedInstalled: readonly { readonly source: string; readonly path: string }[];
  readonly disappearingSelectors: readonly string[];
  readonly blockers: readonly ImpactBlocker[];
  readonly allowed: boolean;
}
export interface BrowseCatalogRequest {
  readonly collection?: string;
}
export type AgentCatalogItem =
  | {
      readonly kind: "collection";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
    }
  | {
      readonly kind: "skill";
      readonly selector: string;
      readonly name: string;
      readonly description: string;
    };
export type AgentBrowseProjection =
  | {
      readonly status: "available";
      readonly scope:
        | { readonly kind: "root" }
        | { readonly kind: "collection"; readonly id: string };
      readonly items: readonly AgentCatalogItem[];
    }
  | { readonly status: "unavailable"; readonly reason: string };
export interface SearchSkillsRequest {
  readonly query: string;
  readonly limit?: number;
  readonly collection?: string;
}
export interface SearchSkillResult {
  readonly kind: "skill";
  readonly rank: number;
  readonly selector: string;
  readonly name: string;
  readonly description: string;
}
export interface SearchSkillsResult {
  readonly query: string;
  readonly results: readonly SearchSkillResult[];
}
export interface SkillTarget {
  readonly selector: string;
}
export interface LoadSkillRequest extends SkillTarget {}
export interface ListResourcesRequest extends SkillTarget {}
export interface ReadResourceRequest extends SkillTarget {
  readonly path: string;
}
export interface DownloadResourceRequest extends SkillTarget {
  readonly path: string;
  readonly output: string;
  readonly force: boolean;
}
export interface RunSkillRequest extends SkillTarget {
  readonly argv: readonly [string, ...string[]];
}
export interface LoadedSkill {
  readonly selector: string;
  readonly name: string;
  readonly description: string;
  readonly path: "SKILL.md";
  readonly text: string;
  readonly provenance: SkillProvenance;
}
export interface ResourceDescriptor {
  readonly path: string;
  readonly kind: "file" | "symlink" | "gitlink" | "directory";
  readonly size?: number;
  readonly executable?: boolean;
  readonly gitlinkCommit?: string;
}
export interface ReadResourceResult extends SkillTarget {
  readonly path: string;
  readonly text: string;
  readonly provenance: SkillProvenance;
}
export interface DownloadResourceResult extends SkillTarget {
  readonly path: string;
  readonly output: string;
  readonly bytesWritten: number;
  readonly provenance: SkillProvenance;
}
export interface RunSkillResult extends SkillTarget {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly cancelled: boolean;
}
export interface WorkspaceCapability {
  get(options?: OperationOptions): Promise<OperationResult<WorkspaceView>>;
}
export interface ConfigurationCapability {
  change(
    change: ConfigChange,
    options?: OperationOptions,
  ): Promise<OperationResult<ConfigurationChangeResult>>;
  previewAddToCollection(
    request: {
      readonly level?: ConfigLevel;
      readonly collection: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly name: string;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<AddToCollectionImpact>>;
  previewMembershipRemoval(
    request: { readonly level?: ConfigLevel; readonly collection: string; readonly name: string },
    options?: OperationOptions,
  ): Promise<OperationResult<MembershipRemovalImpact>>;
  previewImport(
    request: { readonly level: ConfigLevel; readonly from: string; readonly into: string },
    options?: OperationOptions,
  ): Promise<OperationResult<ImportImpact>>;
  previewReference(
    request: {
      readonly level?: ConfigLevel;
      readonly collection: string;
      readonly name: string;
      readonly target: string;
      readonly description: string;
      readonly remove?: boolean;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<ReferenceImpact>>;
  previewLinkChange(
    request: {
      readonly level: ConfigLevel;
      readonly collection: string;
      readonly target: string;
      readonly linked: boolean;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<LinkChangeImpact>>;
  previewCollectionUse(
    request: { readonly level: ConfigLevel; readonly collections: readonly string[] },
    options?: OperationOptions,
  ): Promise<OperationResult<CollectionUseImpact>>;
  previewCollectionRemoval(
    request: { readonly level: ConfigLevel; readonly collection: string },
    options?: OperationOptions,
  ): Promise<OperationResult<CollectionRemovalImpact>>;
}
export interface DiscoveredSkillCandidate {
  readonly path: string;
  readonly name: string;
  readonly description: string;
}
export interface DiscoveryObservation {
  readonly source: string;
  readonly kind: "local" | "git" | "github";
  readonly exactRevision?: string;
  readonly candidates: readonly DiscoveredSkillCandidate[];
}
export interface UpdateObservation {
  readonly source: string;
  readonly kind: "local" | "git" | "github";
  readonly exactRevision?: string;
  readonly changed: readonly DiscoveredSkillCandidate[];
  readonly added: readonly DiscoveredSkillCandidate[];
  readonly removed: readonly DiscoveredSkillCandidate[];
  readonly unchanged: readonly DiscoveredSkillCandidate[];
}
export interface ConfigSourceObservation {
  readonly id: string;
  readonly kind: "local" | "git" | "github";
  readonly exactRevision?: string;
  readonly contributions: ConfigSourceContributionImpact;
}
export interface ManagementCapability {
  previewSourceRemoval(
    request: { readonly source: string },
    options?: OperationOptions,
  ): Promise<OperationResult<SourceRemovalImpact>>;
  removeSource(
    request: { readonly source: string },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
  previewUninstall(
    request: { readonly source: string; readonly paths: readonly string[] },
    options?: OperationOptions,
  ): Promise<OperationResult<UninstallImpact>>;
  previewRebind(
    request: {
      readonly source: string;
      readonly path: string;
      readonly owner: string;
      readonly ownerPath?: string;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<RebindImpact>>;
  previewAdoptConfig(
    request: {
      readonly id: string;
      readonly exactRevision: string;
      readonly observation?: ConfigSourceObservation;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<ConfigSourceImpact>>;
  previewForgetConfig(
    request: { readonly id: string },
    options?: OperationOptions,
  ): Promise<OperationResult<ConfigSourceImpact>>;
  previewRemoveConfig(
    request: { readonly id: string },
    options?: OperationOptions,
  ): Promise<OperationResult<ConfigSourceImpact>>;
  forgetConfig(
    request: { readonly id: string },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
  gc(options?: OperationOptions): Promise<OperationResult<void>>;
  adoptConfig(
    request: {
      readonly id: string;
      readonly exactRevision?: string;
      readonly observation?: ConfigSourceObservation;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
  observeConfig(
    request: { readonly id: string },
    options?: OperationOptions,
  ): Promise<OperationResult<ConfigSourceObservation>>;
  removeConfig(
    request: { readonly id: string },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
  discover(
    request: { readonly source: string },
    options?: OperationOptions,
  ): Promise<OperationResult<DiscoveryObservation>>;
  install(
    request: {
      readonly source: string;
      readonly paths: readonly string[];
      readonly exactRevision?: string;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<readonly DiscoveredSkillCandidate[]>>;
  uninstall(
    request: { readonly source: string; readonly paths: readonly string[] },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
  rebind(
    request: {
      readonly source: string;
      readonly path: string;
      readonly owner: string;
      readonly ownerPath?: string;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
  checkUpdate(
    request: { readonly source: string },
    options?: OperationOptions,
  ): Promise<OperationResult<UpdateObservation>>;
  update(
    request: {
      readonly source: string;
      readonly paths: readonly string[];
      readonly remove?: readonly string[];
      readonly exactRevision?: string;
    },
    options?: OperationOptions,
  ): Promise<OperationResult<void>>;
}
export interface CatalogCapability {
  browse(
    request: BrowseCatalogRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<AgentBrowseProjection>>;
  search(
    request: SearchSkillsRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<SearchSkillsResult>>;
}
export interface ContentCapability {
  loadInstalled(
    request: { readonly address: { readonly source: string; readonly path: string } },
    options?: OperationOptions,
  ): Promise<
    OperationResult<{
      readonly address: { readonly source: string; readonly path: string };
      readonly name: string;
      readonly description: string;
      readonly rawText: string;
      readonly markdownText: string;
    }>
  >;
  listInstalledResources(
    request: { readonly address: { readonly source: string; readonly path: string } },
    options?: OperationOptions,
  ): Promise<OperationResult<readonly ResourceDescriptor[]>>;
  readInstalled(
    request: {
      readonly address: { readonly source: string; readonly path: string };
      readonly path: string;
    },
    options?: OperationOptions,
  ): Promise<
    OperationResult<
      | {
          readonly kind: "text";
          readonly path: string;
          readonly text: string;
          readonly format: "markdown" | "text";
        }
      | {
          readonly kind: "not-text";
          readonly path: string;
          readonly reason: "binary" | "too-large" | "unsupported";
          readonly metadata: ResourceDescriptor;
        }
    >
  >;
  load(
    request: LoadSkillRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<LoadedSkill>>;
  listResources(
    request: ListResourcesRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<readonly ResourceDescriptor[]>>;
  read(
    request: ReadResourceRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<ReadResourceResult>>;
  download(
    request: DownloadResourceRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<DownloadResourceResult>>;
  run(
    request: RunSkillRequest,
    options?: OperationOptions,
  ): Promise<OperationResult<RunSkillResult>>;
}
export interface SkillCliCore {
  readonly workspace: WorkspaceCapability;
  readonly configuration: ConfigurationCapability;
  readonly management: ManagementCapability;
  readonly catalog: CatalogCapability;
  readonly content: ContentCapability;
}
