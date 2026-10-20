import { resolve } from "node:path";
import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../shared";
import { validateSkillPaths } from "../source/service";
import { StateCoordinator } from "../storage/state";
import {
  capturedWorkspace,
  migrateLegacyInstalled,
  readWorkspaceUnlocked,
} from "../workspace/capture";
import { resolveEffectiveCollections } from "../collection/resolve";
import type { RebindImpact, RebindRequest } from "./types";

async function capture(
  options: CoreOptions,
  request: RebindRequest,
  coordinator: StateCoordinator,
  operation?: OperationOptions,
) {
  if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Rebind cancelled");
  const path = request.ownerPath ?? request.path;
  validateSkillPaths([path]);
  const workspace = await readWorkspaceUnlocked(
    { ...options, signal: operation?.signal },
    coordinator,
  );
  if (workspace.value.effective.status !== "complete")
    throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
  const captured = capturedWorkspace(workspace.value)!;
  const installed = await migrateLegacyInstalled(options, coordinator, captured.state);
  const item = installed.find(
    (item) => item.source === request.source && item.path === request.path,
  );
  if (!item) throw new SkctlError("SKILL_NOT_FOUND", "Installed Skill not found");
  const owner = captured.sources.get(request.owner),
    previous = captured.sources.get(request.source);
  const identity =
    item.identityEvidence?.status === "known"
      ? item.identityEvidence
      : previous?.bindingDigest === item.bindingDigest
        ? {
            canonicalOrigin: previous.origin,
            originRelativeSkillRoot: [previous.root, item.path].filter(Boolean).join("/"),
          }
        : undefined;
  const root = owner && [owner.root, path].filter(Boolean).join("/");
  let proof: RebindImpact["proof"] = "unprovable";
  if (identity && owner)
    proof =
      identity.canonicalOrigin === owner.origin &&
      identity.originRelativeSkillRoot === root &&
      (item.kind === "local") === (owner.kind === "local") &&
      (item.kind !== "local" || item.root === resolve(owner.origin, owner.root, path))
        ? "proven"
        : "distinct";
  return {
    workspace,
    captured,
    installed,
    item,
    owner,
    path,
    root,
    impact: {
      kind: "rebind" as const,
      address: { source: request.source, path: request.path },
      owner: request.owner,
      ownerPath: path,
      proof,
      allowed: proof === "proven",
    },
  };
}

export async function previewRebind(
  options: CoreOptions,
  request: RebindRequest,
  operation?: OperationOptions,
): Promise<OperationResult<RebindImpact>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const value = await capture(options, request, coordinator, operation);
    return { value: value.impact, diagnostics: value.workspace.diagnostics };
  });
}

export async function rebindSkill(
  options: CoreOptions,
  request: RebindRequest,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const current = await capture(options, request, coordinator, operation);
    if (current.impact.proof === "unprovable")
      throw new SkctlError("REBIND_UNPROVABLE", "Cannot prove the Installed Skill identity");
    if (!current.impact.allowed)
      throw new SkctlError("CONFIG_CONFLICT", "Rebind changes the Installed Skill identity");
    const owner = current.owner!;
    if (
      current.installed.some(
        (item) => item !== current.item && item.source === owner.id && item.path === current.path,
      )
    )
      throw new SkctlError("CONFIG_CONFLICT", "Rebind destination is already installed");
    const installed = current.installed.map((item) =>
      item === current.item
        ? {
            ...item,
            source: owner.id,
            path: current.path,
            bindingDigest: owner.bindingDigest,
            identityEvidence: {
              status: "known" as const,
              canonicalOrigin: owner.origin,
              originRelativeSkillRoot: current.root!,
            },
          }
        : item,
    );
    await resolveEffectiveCollections(
      options,
      current.workspace.value,
      { installed, configs: current.captured.state.configs },
      coordinator,
    );
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Rebind cancelled");
    await coordinator.write(
      { installed, configs: current.captured.state.configs },
      current.captured.state.generation,
    );
    return { value: undefined, diagnostics: current.workspace.diagnostics };
  });
}
