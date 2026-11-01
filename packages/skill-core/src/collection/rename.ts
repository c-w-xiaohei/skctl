import { findNodeAtLocation, parseTree } from "jsonc-parser";
import * as v from "valibot";
import { edit, parseDocument } from "../config/document";
import { identityDocuments, identityLimitation, sameReview } from "../config/identity";
import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../shared";
import { StateCoordinator } from "../storage/state";
import { capturedWorkspace, readWorkspaceUnlocked } from "../workspace/capture";
import {
  collectionRenameImpactSchema,
  reviewedCollectionRenameRequestSchema,
} from "./domain.schema";
import { parseQualifiedName } from "./names";
import { resolveEffectiveCollections } from "./resolve";
import type {
  CollectionRenameImpact,
  CollectionRenameRequest,
  ReviewedCollectionRenameRequest,
} from "./types";

async function capture(
  options: CoreOptions,
  request: CollectionRenameRequest,
  coordinator: StateCoordinator,
  operation?: OperationOptions,
) {
  if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Rename cancelled");
  parseQualifiedName(request.collection);
  parseQualifiedName(request.target);
  const workspace = await readWorkspaceUnlocked(
    { ...options, signal: operation?.signal },
    coordinator,
  );
  const state = capturedWorkspace(workspace.value)!.state;
  const effective = workspace.value.effective;
  const { documents, baseline, readSet } =
    effective.status === "complete"
      ? await identityDocuments(workspace.value, state, coordinator.root)
      : { documents: [], baseline: "incomplete", readSet: [] };
  if (effective.status === "complete") {
    const rechecked = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    if (!sameReview(workspace.value, rechecked.value))
      throw new SkctlError("CONFIG_CONFLICT", "Workspace changed during capture");
  }
  const old =
    effective.status === "complete"
      ? effective.collectionsView.find((item) => item.id === request.collection)
      : undefined;
  const declarations = old?.declared ?? [];
  const references: CollectionRenameImpact["references"][number][] = [];
  for (const config of workspace.value.configs)
    for (const use of config.direct.collectionUse)
      if (use.collection === request.collection) references.push({ kind: "use", owner: use.owner });
  if (effective.status === "complete")
    for (const item of effective.collectionsView) {
      for (const ref of item.references)
        if (ref.collection === request.collection)
          references.push({ kind: "reference", owner: ref.owner });
      for (const link of item.links)
        if (link.collection === request.collection)
          references.push({ kind: "link", owner: link.owner });
    }
  const blockers: CollectionRenameImpact["blockers"][number][] = [];
  if (
    effective.status !== "complete" ||
    capturedWorkspace(workspace.value)!.resolved.missing.size > 0 ||
    (effective.use.length > 0 && effective.agent.status !== "available")
  )
    blockers.push({ reason: "incomplete" });
  else {
    if (!old || !declarations.length) blockers.push({ reason: "missing" });
    if (effective.collectionsView.some((item) => item.id === request.target))
      blockers.push({ reason: "collision" });
    if (old?.repository.derived) blockers.push({ reason: "repository-derived" });
    for (const owner of declarations)
      if (owner.contribution) blockers.push({ reason: "immutable", owner });
    for (const reference of references)
      if (reference.owner.contribution)
        blockers.push({ reason: "immutable", owner: reference.owner });
  }
  const addresses = old
    ? [
        { before: request.collection, after: request.target },
        ...old.members.map((member) => ({
          before: `${request.collection}:${member.name}`,
          after: `${request.target}:${member.name}`,
        })),
      ]
    : [];
  const impact: CollectionRenameImpact = {
    kind: "collection-rename",
    collection: request.collection,
    target: request.target,
    scope: "captured-workspace",
    limitation: identityLimitation,
    baseline,
    declarations,
    references,
    addresses,
    blockers,
    allowed: !blockers.length,
  };
  return { workspace, state, documents, readSet, impact };
}

export async function previewCollectionRename(
  options: CoreOptions,
  request: CollectionRenameRequest,
  operation?: OperationOptions,
): Promise<OperationResult<CollectionRenameImpact>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const current = await capture(options, request, coordinator, operation);
    return { value: current.impact, diagnostics: current.workspace.diagnostics };
  });
}

export async function renameCollection(
  options: CoreOptions,
  request: ReviewedCollectionRenameRequest,
  operation?: OperationOptions,
): Promise<OperationResult<CollectionRenameImpact>> {
  if (
    !v.is(reviewedCollectionRenameRequestSchema, request) ||
    !v.is(collectionRenameImpactSchema, request.reviewedImpact)
  )
    throw new SkctlError("INVALID_ARGUMENT", "Reviewed rename impact is required");
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const current = await capture(options, request, coordinator, operation);
    if (!sameReview(request.reviewedImpact, current.impact))
      throw new SkctlError("CONFIG_CONFLICT", "Rename impact changed after review");
    if (!current.impact.allowed)
      throw new SkctlError("CONFIG_CONFLICT", "Collection rename is blocked");
    const targets = current.documents.map((doc) => {
      let next = doc.text;
      for (const [id, declaration] of Object.entries(doc.value.collections ?? {})) {
        for (const [index, link] of (declaration.links ?? []).entries())
          if (link === request.collection)
            next = edit(next, ["collections", id, "links", index], request.target);
        for (const [name, reference] of Object.entries(declaration.references ?? {}))
          if (reference.collection === request.collection)
            next = edit(
              next,
              ["collections", id, "references", name, "collection"],
              request.target,
            );
      }
      for (const [index, id] of (doc.value.use ?? []).entries())
        if (id === request.collection) next = edit(next, ["use", index], request.target);
      if (doc.value.collections?.[request.collection]) {
        const node = findNodeAtLocation(parseTree(next)!, ["collections", request.collection]);
        const key = node?.parent?.children?.[0];
        if (!key) throw new SkctlError("CONFIG_INVALID", "Collection declaration key unavailable");
        next =
          next.slice(0, key.offset) +
          JSON.stringify(request.target) +
          next.slice(key.offset + key.length);
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
      current.state,
      coordinator,
      targets.map(({ target, value }) => ({ file: target, value })),
    );
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Rename cancelled");
    await coordinator.publish(
      targets.filter((item) => item.changed).map(({ target, bytes }) => ({ target, bytes })),
      undefined,
      current.readSet,
    );
    return { value: current.impact, diagnostics: current.workspace.diagnostics };
  });
}
