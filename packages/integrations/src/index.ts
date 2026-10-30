import * as v from "valibot";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { capability, configHome, createCapture, executable } from "./context";
import { scanCodex, editHooks } from "./codex";
import { scanOpenCode, editPlugin, preparePlugin } from "./opencode";
import { scanDefault, editInstructions } from "./default";
import { capture, commit, withDirectoryLock } from "./files";
import {
  checkCancellation,
  diagnostic,
  IntegrationError,
  requestSchema,
  targetSchema,
  type IntegrationChange,
  type IntegrationInspection,
  type IntegrationTarget,
  type MutationRequest,
  type OperationOptions,
} from "./schema";
export * from "./schema";

async function inspectDetails(target: IntegrationTarget, options?: OperationOptions) {
  checkCancellation(options?.signal);
  const reads = createCapture();
  const host =
    target.environment.harness === "codex"
      ? await scanCodex(target, reads)
      : await scanOpenCode(target, reads);
  const hostFailures = new Set(reads.failed);
  const fallback = await scanDefault(target, reads);
  const support = await capability(target, options?.signal);
  if (
    target.environment.harness === "codex" &&
    host.entries.length &&
    support.mechanism !== "codex-hooks"
  )
    reads.diagnostics.push({
      code: "CODEX_ADAPTER_INCOMPATIBLE",
      message: `${support.reason} Existing hooks were retained. Upgrade to a verified host, or explicitly disconnect the hooks before reconnecting.`,
    });
  const inspection: IntegrationInspection = {
    target,
    recommended: support.mechanism,
    selectionReason: support.reason,
    entries: [...host.entries, ...fallback.entries],
    candidates: [...host.candidates, ...fallback.candidates],
    revision: reads.revision(),
    cli: (await executable("skctl")) ?? null,
    diagnostics: reads.diagnostics,
    nextSteps:
      support.mechanism === "default"
        ? ["Start a new session so the host loads the instruction guidance."]
        : host.nextSteps,
  };
  return { reads, host, hostFailures, fallback, inspection };
}
export async function inspect(
  target: IntegrationTarget,
  options?: OperationOptions,
): Promise<IntegrationInspection> {
  return (await inspectDetails(v.parse(targetSchema, target), options)).inspection;
}
async function mutate(
  action: "connect" | "disconnect",
  input: MutationRequest,
  options?: OperationOptions,
): Promise<IntegrationChange> {
  const request = v.parse(requestSchema, input);
  const target = request.target;
  const base = { action, mechanism: null, diagnostics: [] } satisfies Partial<IntegrationChange>;
  try {
    return await withDirectoryLock(
      target.scope.kind === "project" ? target.scope.directory : configHome(target),
      async () => {
        const state = await inspectDetails(target, options);
        const { inspection, reads, host, hostFailures, fallback } = state;
        const blocked = (code: string, message: string): IntegrationChange => ({
          ...base,
          outcome: "blocked",
          inspection,
          diagnostics: [{ code, message }],
        });
        if (request.expected && request.expected !== inspection.revision)
          return blocked("REVISION_CONFLICT", "Configuration changed; inspect again");
        const local = inspection.entries.filter((e) => !e.inherited);
        const chosen = request.entry
          ? local.find(
              (e) => e.file === request.entry!.file && e.mechanism === request.entry!.mechanism,
            )
          : local.length === 1
            ? local[0]
            : undefined;
        const historicalDefault =
          action === "disconnect" &&
          request.entry?.mechanism === "default" &&
          dirname(request.entry.file) === fallback.root;
        if (request.entry && !chosen && local.length && !historicalDefault)
          return blocked(
            "ENTRY_NOT_FOUND",
            "Select the existing entry before changing its location or mechanism",
          );
        if (local.length > 1 && !chosen && !historicalDefault)
          return blocked(
            "MULTIPLE_ENTRIES",
            "Select the entry to maintain; multiple entry files exist",
          );
        const removeArtifactReference =
          action === "disconnect" && chosen?.mechanism === "opencode-v2" && !!chosen.artifact;
        if (
          chosen &&
          chosen.status !== "current" &&
          chosen.status !== "outdated" &&
          chosen.status !== "missing-artifact" &&
          !removeArtifactReference
        )
          return blocked("ENTRY_MODIFIED", "The selected entry is modified or ambiguous");
        if (!chosen && !request.entry && inspection.entries.some((e) => e.inherited))
          return {
            ...base,
            outcome: "unchanged",
            inspection,
            diagnostics: [
              {
                code: "INHERITED_ENTRY",
                message: "An entry is inherited; manage it at its owning scope",
              },
            ],
          };
        const mechanism = chosen?.mechanism ?? request.entry?.mechanism ?? inspection.recommended;
        if (!mechanism) return blocked("HOST_CAPABILITY_UNKNOWN", inspection.selectionReason);
        if (
          request.entry &&
          !chosen &&
          action === "connect" &&
          mechanism !== inspection.recommended
        )
          return blocked("ENTRY_NOT_FOUND", "The requested existing entry was not found");
        const file =
          chosen?.file ??
          request.entry?.file ??
          (mechanism === "default" ? fallback.selected : host.selected);
        if (
          request.entry &&
          !inspection.candidates.includes(file) &&
          !(action === "disconnect" && mechanism === "default" && dirname(file) === fallback.root)
        )
          return blocked(
            "INVALID_ENTRY_TARGET",
            "The selected file is outside this scope's entry candidates",
          );
        if (
          mechanism === "default" &&
          action === "connect" &&
          chosen?.selected === "shadowed" &&
          !request.entry
        )
          return blocked(
            "RELOCATION_REQUIRED",
            "The entry is shadowed; remove its explicit file before connecting at the active target",
          );
        const before = reads.files.get(file) ?? (await capture(file));
        if (action === "disconnect" && !chosen && !before.exists)
          return { ...base, mechanism, outcome: "unchanged", inspection };
        if (action === "connect") {
          if (mechanism === "codex-hooks" && inspection.recommended !== "codex-hooks")
            return blocked(
              "CODEX_ADAPTER_INCOMPATIBLE",
              `${inspection.selectionReason} Disconnect the existing hooks explicitly before changing mechanism.`,
            );
          if ((chosen && mechanism !== "default" ? hostFailures : reads.failed).size)
            return blocked(
              "INCOMPLETE_INSPECTION",
              "A required entry/configuration file could not be inspected",
            );
          if (
            reads.diagnostics.some((d) =>
              [
                "LEGACY_AUTODISCOVERED_PLUGIN",
                "LEGACY_PLUGIN_CONFIG",
                "MULTIPLE_HOOK_SOURCES",
              ].includes(d.code),
            )
          )
            return blocked(
              "EXISTING_ENTRY_CONFLICT",
              "Resolve the reported existing entry sources before connecting",
            );
          if (mechanism !== "default" && !chosen && inspection.recommended !== mechanism)
            return blocked("HOST_CAPABILITY_UNKNOWN", inspection.selectionReason);
        }
        let text: string;
        if (mechanism === "default") {
          text = editInstructions(before.text, action === "disconnect");
          const shared = target.scope.kind === "project" && file.endsWith("/AGENTS.md");
          const changesSelection = action === "disconnect" && !!before.text.trim() && !text.trim();
          if (
            text !== before.text &&
            action === "disconnect" &&
            (shared || changesSelection) &&
            !request.acknowledgeFileImpact
          )
            return blocked(
              "FILE_IMPACT_CONFIRMATION",
              "Removing this block affects all readers of this file and may reveal another instruction candidate. Confirm this file's impact.",
            );
        } else if (mechanism === "codex-hooks") text = editHooks(before, action === "disconnect");
        else {
          const directory = action === "connect" ? await preparePlugin(host.root) : undefined;
          if (
            directory &&
            chosen?.artifact &&
            reads.files.has(chosen.artifact) &&
            !reads.files.get(chosen.artifact)!.exists
          )
            reads.files.set(chosen.artifact, await capture(chosen.artifact));
          text = editPlugin(before, directory);
        }
        if (text === before.text)
          return { ...base, mechanism, file, outcome: "unchanged", inspection };
        await mkdir(dirname(file), { recursive: true });
        const evidence = [...reads.files.values(), ...(!reads.files.has(file) ? [before] : [])];
        const committed = await commit(before, text, evidence, options?.signal);
        const result: IntegrationChange = { action, mechanism, file, ...committed };
        if (options?.signal?.aborted)
          result.diagnostics.push({
            code: "POSTCHECK_CANCELLED",
            message: "Entry committed; subsequent inspection was cancelled",
          });
        else
          try {
            result.inspection = await inspect(target, options);
          } catch (error) {
            result.diagnostics.push({
              code: "POSTCHECK_FAILED",
              message: diagnostic(error).message,
            });
          }
        return result;
      },
      options?.signal,
    );
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "CANCELLED")
      return { ...base, outcome: "cancelled" };
    if (error instanceof IntegrationError)
      return { ...base, outcome: "blocked", diagnostics: [diagnostic(error)] };
    throw error;
  }
}
export const connect = (request: MutationRequest, options?: OperationOptions) =>
  mutate("connect", request, options);
export const disconnect = (request: MutationRequest, options?: OperationOptions) =>
  mutate("disconnect", request, options);
