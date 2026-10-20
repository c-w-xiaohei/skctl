import * as v from "valibot";
import { configDeclarationOwnerSchema } from "./config/schema";
import { skillAddressSchema } from "./source/schema";

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

export const diagnosticSchema = v.object({
  code: v.string(),
  severity: v.picklist(["info", "warning"]),
  message: v.string(),
  location: v.optional(v.object({ file: v.string(), pointer: v.optional(v.string()) })),
  related: v.optional(
    v.pipe(
      v.array(
        v.object({
          message: v.string(),
          file: v.optional(v.string()),
          pointer: v.optional(v.string()),
        }),
      ),
      v.readonly(),
    ),
  ),
  suggestion: v.optional(v.string()),
  subject: v.optional(
    v.variant("kind", [
      v.object({ kind: v.literal("config"), owner: configDeclarationOwnerSchema }),
      v.object({ kind: v.literal("installed-skill"), address: skillAddressSchema }),
    ]),
  ),
});
export type Diagnostic = Readonly<v.InferOutput<typeof diagnosticSchema>>;

export type SkctlErrorCode =
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

export class SkctlError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(
    readonly code: SkctlErrorCode,
    message: string,
    diagnostics: readonly Diagnostic[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkctlError";
    this.diagnostics = diagnostics;
  }
}
