import type { ConfigDeclarationOwner } from "./config/types";
import type { SkillAddress } from "./source/schema";

export interface CoreOptions {
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
        readonly address: SkillAddress;
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
  | "PROVIDER_TIMEOUT"
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
