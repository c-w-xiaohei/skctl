import * as v from "valibot";
import { isAbsolute } from "node:path";

const path = v.pipe(v.string(), v.check(isAbsolute, "Expected an absolute path"));
export const targetSchema = v.object({
  environment: v.object({
    harness: v.picklist(["codex", "opencode"]),
    configDirectory: v.optional(path),
    executable: v.optional(path),
  }),
  scope: v.variant("kind", [
    v.object({ kind: v.literal("global") }),
    v.object({ kind: v.literal("project"), directory: path }),
  ]),
  workingDirectory: v.optional(path),
});
export type IntegrationTarget = v.InferOutput<typeof targetSchema>;
export const mechanismSchema = v.picklist(["codex-hooks", "opencode-v2", "default"]);
export type Mechanism = v.InferOutput<typeof mechanismSchema>;
export const entrySchema = v.object({
  mechanism: mechanismSchema,
  file: path,
  status: v.picklist(["current", "outdated", "modified", "conflict", "missing-artifact"]),
  inherited: v.boolean(),
  selected: v.picklist(["selected", "shadowed", "unknown"]),
  artifact: v.optional(path),
});
export type IntegrationEntry = v.InferOutput<typeof entrySchema>;
export const diagnosticSchema = v.object({
  code: v.string(),
  message: v.string(),
  file: v.optional(v.string()),
});
export type IntegrationDiagnostic = v.InferOutput<typeof diagnosticSchema>;
export const inspectionSchema = v.object({
  target: targetSchema,
  recommended: v.nullable(mechanismSchema),
  selectionReason: v.string(),
  entries: v.array(entrySchema),
  candidates: v.array(path),
  revision: v.string(),
  cli: v.nullable(v.string()),
  diagnostics: v.array(diagnosticSchema),
  nextSteps: v.array(v.string()),
});
export type IntegrationInspection = v.InferOutput<typeof inspectionSchema>;
export const requestSchema = v.object({
  target: targetSchema,
  entry: v.optional(v.object({ mechanism: mechanismSchema, file: path })),
  expected: v.optional(v.string()),
  acknowledgeFileImpact: v.optional(v.boolean(), false),
});
export type MutationRequest = v.InferInput<typeof requestSchema>;

export interface OperationOptions {
  readonly signal?: AbortSignal;
}

export const changeSchema = v.object({
  outcome: v.picklist(["unchanged", "blocked", "cancelled", "applied", "indeterminate"]),
  action: v.picklist(["connect", "disconnect"]),
  mechanism: v.nullable(mechanismSchema),
  file: v.optional(path),
  backup: v.optional(path),
  diagnostics: v.array(diagnosticSchema),
  inspection: v.optional(inspectionSchema),
  durability: v.optional(v.picklist(["synced", "unconfirmed"])),
});
export type IntegrationChange = v.InferOutput<typeof changeSchema>;

export class IntegrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly file?: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export function diagnostic(error: unknown): IntegrationDiagnostic {
  if (error instanceof IntegrationError)
    return { code: error.code, message: error.message, file: error.file };
  return {
    code: "INTEGRATION_IO",
    message: error instanceof Error ? error.message : "Integration operation failed",
  };
}

export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new IntegrationError("CANCELLED", "Operation cancelled before committing the entry");
}
