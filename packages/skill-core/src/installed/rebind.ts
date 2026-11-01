import { resolve } from "node:path";
import { join } from "node:path";
import * as v from "valibot";
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
import { edit, parseDocument } from "../config/document";
import { identityDocuments, identityLimitation, sameReview } from "../config/identity";
import { reviewedRebindRequestSchema } from "./domain.schema";
import type { RebindImpact, RebindRequest, ReviewedRebindRequest } from "./types";

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
  const { documents, baseline, readSet } = await identityDocuments(
    workspace.value,
    captured.state,
    coordinator.root,
  );
  const rechecked = await readWorkspaceUnlocked(
    { ...options, signal: operation?.signal },
    coordinator,
  );
  if (!sameReview(workspace.value, rechecked.value))
    throw new SkctlError("CONFIG_CONFLICT", "Workspace changed during capture");
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
  const directMemberships: RebindImpact["directMemberships"][number][] = [];
  for (const collection of workspace.value.effective.collectionsView)
    for (const member of collection.members)
      if (member.address.source === request.source && member.address.path === request.path)
        for (const origin of member.paths)
          if (origin.kind === "direct" && origin.owner && origin.collection === collection.id)
            directMemberships.push({
              collection: collection.id,
              name: origin.entryName,
              owner: origin.owner,
              before: { source: request.source, path: request.path },
              after: { source: request.owner, path },
            });
  const blockers: RebindImpact["blockers"][number][] = directMemberships
    .filter((item) => item.owner.contribution)
    .map((item) => ({ reason: "immutable", owner: item.owner }));
  if (
    installed.some(
      (candidate) =>
        candidate !== item && candidate.source === request.owner && candidate.path === path,
    )
  )
    blockers.push({ reason: "collision" });
  return {
    workspace,
    captured,
    installed,
    item,
    owner,
    path,
    root,
    documents,
    readSet,
    impact: {
      kind: "rebind" as const,
      scope: "captured-workspace" as const,
      limitation: identityLimitation,
      baseline,
      address: { source: request.source, path: request.path },
      owner: request.owner,
      ownerPath: path,
      proof,
      ...(identity
        ? {
            identity:
              item.kind === "local"
                ? {
                    kind: "local" as const,
                    canonicalOrigin: identity.canonicalOrigin,
                    originRelativeSkillRoot: identity.originRelativeSkillRoot,
                    localRoot: item.root,
                  }
                : {
                    kind: "remote" as const,
                    canonicalOrigin: identity.canonicalOrigin,
                    originRelativeSkillRoot: identity.originRelativeSkillRoot,
                  },
          }
        : {}),
      directMemberships,
      blockers,
      allowed: proof === "proven" && !blockers.length,
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
  request: ReviewedRebindRequest,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  if (!v.is(reviewedRebindRequestSchema, request))
    throw new SkctlError("INVALID_ARGUMENT", "Reviewed rebind impact is required");
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const current = await capture(options, request, coordinator, operation);
    if (!sameReview(request.reviewedImpact, current.impact))
      throw new SkctlError("CONFIG_CONFLICT", "Rebind impact changed after review");
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
    const targets = current.documents.map((doc) => {
      let next = doc.text;
      for (const membership of current.impact.directMemberships.filter(
        (item) => item.owner.file === doc.file,
      )) {
        next = edit(
          next,
          ["collections", membership.collection, "members", membership.name, "source"],
          request.owner,
        );
        next = edit(
          next,
          ["collections", membership.collection, "members", membership.name, "path"],
          current.path,
        );
      }
      return {
        target: doc.file,
        bytes: next,
        value: parseDocument(next, doc.file, doc.level),
        changed: next !== doc.text,
      };
    });
    await resolveEffectiveCollections(
      options,
      current.workspace.value,
      { installed, configs: current.captured.state.configs },
      coordinator,
      targets.map(({ target, value }) => ({ file: target, value })),
    );
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Rebind cancelled");
    const state = {
      version: 4,
      generation: current.captured.state.generation + 1,
      installed,
      configs: current.captured.state.configs,
    };
    await coordinator.publish(
      [
        ...targets.filter((item) => item.changed).map(({ target, bytes }) => ({ target, bytes })),
        { target: join(coordinator.root, "state.json"), bytes: `${JSON.stringify(state)}\n` },
      ],
      current.captured.state.generation,
      current.readSet,
    );
    return { value: undefined, diagnostics: current.workspace.diagnostics };
  });
}
