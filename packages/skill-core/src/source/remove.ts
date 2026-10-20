import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../shared";
import { assertDeclarationOwner } from "../config/write";
import { configFile, resolveProjectRoot } from "../config/inputs";
import { decodeConfig, edit, parseDocument } from "../config/document";
import { capturedWorkspace, readWorkspaceUnlocked } from "../workspace/capture";
import { StateCoordinator } from "../storage/state";
import type { SourceRemovalImpact, SourceRemovalRequest } from "./types";
import type { ConfigDeclarationOwner } from "../config/types";

async function capture(
  options: CoreOptions,
  request: SourceRemovalRequest,
  coordinator: StateCoordinator,
  operation?: OperationOptions,
) {
  if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Source removal cancelled");
  const workspace = await readWorkspaceUnlocked(
    { ...options, signal: operation?.signal },
    coordinator,
  );
  let owner: ConfigDeclarationOwner | undefined;
  if (request.level) {
    const project =
      request.level === "global" && !options.project
        ? { root: resolve(options.cwd) }
        : await resolveProjectRoot(options.cwd, options.project, operation?.signal);
    owner = {
      level: request.level,
      file: configFile(options, request.level, project.root),
      pointer: `/sources/${request.source}`,
    };
  } else {
    if (workspace.value.effective.status !== "complete")
      throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
    const source = capturedWorkspace(workspace.value)?.sources.get(request.source);
    if (!source) throw new SkctlError("SOURCE_NOT_FOUND", "Source not found");
    if (source.contribution)
      throw new SkctlError("INVALID_ARGUMENT", "Config Source contributions are immutable");
    if (source.provenance.file)
      owner = {
        ...source.provenance,
        file: source.provenance.file,
        pointer: source.provenance.pointer ?? `/sources/${request.source}`,
        contribution: source.contribution,
      };
  }
  if (!owner) throw new SkctlError("SOURCE_NOT_FOUND", "Source declaration not found");
  assertDeclarationOwner(owner, request.expectedOwner);
  const original = decodeConfig(await readFile(owner.file), owner.file);
  if (!parseDocument(original, owner.file, owner.level).sources?.[request.source])
    throw new SkctlError("SOURCE_NOT_FOUND", "Source declaration not found");
  const installed = (await coordinator.read()).installed
    .filter((item) => item.source === request.source)
    .map(({ source, path }) => ({ source, path }));
  const value: SourceRemovalImpact = {
    kind: "source-removal",
    source: request.source,
    owner,
    installed,
    repairs: installed.map((address) => ({ address, actions: ["rebind", "uninstall"] })),
    blockers: installed.map((address) => ({ reason: "installed" as const, address })),
    allowed: !installed.length,
  };
  return { value, original, owner, diagnostics: workspace.diagnostics };
}

export async function previewSourceRemoval(
  options: CoreOptions,
  request: SourceRemovalRequest,
  operation?: OperationOptions,
): Promise<OperationResult<SourceRemovalImpact>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const result = await capture(options, request, coordinator, operation);
    return { value: result.value, diagnostics: result.diagnostics };
  });
}

export async function removeSource(
  options: CoreOptions,
  request: SourceRemovalRequest,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const result = await capture(options, request, coordinator, operation);
    if (!result.value.allowed)
      throw new SkctlError(
        "CONFIG_CONFLICT",
        "Source has installed content or belongs to a Config Source",
      );
    const next = edit(result.original, ["sources", request.source], undefined);
    parseDocument(next, result.owner.file, result.owner.level);
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Source removal cancelled");
    await coordinator.publish([{ target: result.owner.file, bytes: next }]);
    return { value: undefined, diagnostics: result.diagnostics };
  });
}
