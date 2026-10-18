import type { ConfigDeclarationOwner } from "../config/types";
import type { Diagnostic } from "../shared";
import type { SkillMetadata } from "../content/text";

export interface CatalogSkill extends SkillMetadata {
  readonly selector: string;
}

export interface ManagedAgentView {
  readonly status: "available" | "unavailable";
  readonly integration: readonly ConfigDeclarationOwner[];
  readonly use: readonly ConfigDeclarationOwner[];
  readonly reasons: readonly Diagnostic[];
  readonly catalog: readonly (CatalogSkill & {
    readonly aliases: readonly string[];
  })[];
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
  | (CatalogSkill & {
      readonly kind: "skill";
    });

export type AgentBrowseProjection =
  | {
      readonly status: "available";
      readonly scope:
        | { readonly kind: "root" }
        | { readonly kind: "collection"; readonly id: string };
      readonly items: readonly AgentCatalogItem[];
    }
  | { readonly status: "unavailable"; readonly reason: string };

export interface SearchSkillsRequest extends BrowseCatalogRequest {
  readonly query: string;
  readonly limit?: number;
}

export interface SearchSkillsResult {
  readonly truncated: boolean;
  readonly results: readonly CatalogSkill[];
}
