import type { Diagnostic, SkillCliErrorCode } from "../core/api";

export type AgentOperation = "list" | "search" | "load" | "read" | "download" | "run";

export function jsonSuccess(operation: AgentOperation, result: unknown): string {
  return `${JSON.stringify({ protocolVersion: 1, ok: true, operation, result: protocolResult(result) })}\n`;
}

/** Protocol v1 predates semantic Config `level`; keep its exact wire carrier isolated here. */
function protocolResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(protocolResult);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const mapped = Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, protocolResult(item)]),
  );
  if (
    record.declaration &&
    typeof record.declaration === "object" &&
    !Array.isArray(record.declaration)
  ) {
    const declaration = record.declaration as Record<string, unknown>;
    if (typeof declaration.level === "string") {
      mapped.declaration = { layer: declaration.level };
    }
  }
  return mapped;
}

export function jsonUnavailable(operation: AgentOperation, reason: string): string {
  return `${JSON.stringify({ protocolVersion: 1, type: "unavailable", operation, unavailable: { reason } })}\n`;
}

function diagnostic(diagnostic: Diagnostic): Record<string, unknown> {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.location === undefined ? {} : { location: diagnostic.location }),
    ...(diagnostic.related === undefined ? {} : { related: diagnostic.related }),
    ...(diagnostic.suggestion === undefined ? {} : { suggestion: diagnostic.suggestion }),
  };
}

export function jsonDiagnostic(operation: AgentOperation, value: Diagnostic): string {
  return `${JSON.stringify({ protocolVersion: 1, type: "diagnostic", operation, diagnostic: diagnostic(value) })}\n`;
}

export function jsonError(
  operation: AgentOperation,
  code: SkillCliErrorCode,
  message: string,
  diagnostics: readonly Diagnostic[],
): string {
  return `${JSON.stringify({ protocolVersion: 1, type: "error", operation, error: { code, message, diagnostics: diagnostics.map(diagnostic) } })}\n`;
}

export function humanDiagnostic(value: Diagnostic): string {
  return `${value.code}: ${value.message}\n`;
}
