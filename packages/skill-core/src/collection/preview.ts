import {
  AddToCollectionImpact,
  CollectionEditDecision,
  CollectionRemovalImpact,
  CollectionUseImpact,
  ImpactBlocker,
  ImportImpact,
  LinkChangeImpact,
  MembershipRemovalImpact,
  MembershipBatchImpact,
  ReferenceImpact,
} from "./types";
import { OperationOptions, OperationResult, SkctlError } from "../shared";
import { type ConfigLevel } from "../config/types";
import { type WorkspaceView } from "../workspace/types";
import { membershipBatchAffected, previewLinkChangeImpact } from "./impact";
import { readWorkspace } from "../workspace/capture";
import { type ReadWorkspaceOptions } from "../config/inputs";
import { sameSkillAddress, skillAddressKey, CollectionResolutionError } from "./graph";
import { parseNameSegment, parseQualifiedName } from "./names";
import { StateCoordinator } from "../storage/state";
import { normalizeMemberEdit, editMembers, importMembers } from "./members";
import { document } from "../config/document";
import { readWorkspaceUnlocked } from "../workspace/capture";
import { assertDeclarationOwner } from "../config/write";
import type {
  AddMemberRequest,
  RemoveMemberRequest,
  MemberEditRequest,
  ImportMembersRequest,
  AddReferenceRequest,
  RemoveReferenceRequest,
  SetLinkRequest,
  SetUseRequest,
  CollectionRequest,
} from "./types";

function editDecision(
  workspace: WorkspaceView,
  level: ConfigLevel | undefined,
  collection: string,
): CollectionEditDecision {
  const direct = workspace.configs
    .flatMap((item) => item.direct.collections)
    .filter((item) => item.id === collection && (!level || item.owner.level === level));
  if (direct.length === 1) return { kind: "direct", owner: direct[0]!.owner };
  if (
    level &&
    workspace.configs.some((item) => item.direct.collections.some((item) => item.id === collection))
  )
    return { kind: "missing" };
  if (workspace.effective.status !== "complete") return { kind: "missing" };
  const view = workspace.effective.collectionsView.find((item) => item.id === collection);
  if (!view) return { kind: "missing" };
  const contributed = view.declared.find((owner) => owner.contribution);
  if (contributed) return { kind: "contributed", owner: contributed };
  if (view.repository.derived)
    return { kind: "repository-derived", producers: view.repository.producers };
  return { kind: "missing" };
}

export async function previewAddToCollection(
  options: ReadWorkspaceOptions,
  request: Omit<AddMemberRequest, "level"> & { readonly level?: ConfigLevel },
  operation?: OperationOptions,
): Promise<OperationResult<AddToCollectionImpact>> {
  parseQualifiedName(request.collection);
  parseNameSegment(request.name);
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const view =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView.find((item) => item.id === request.collection)
      : undefined;
  const decision = editDecision(workspace.value, request.level, request.collection);
  if (decision.kind === "direct") assertDeclarationOwner(decision.owner, request.expectedOwner);
  const stableEntryName = request.name;
  const existing =
    view?.members
      .filter((member) => sameSkillAddress(member.address, request.address))
      .map(({ name, address, paths }) => ({ name, address, paths })) ?? [];
  const requestedConflict = view?.members.find(
    (member) =>
      member.name === stableEntryName && !sameSkillAddress(member.address, request.address),
  );
  const blockers: ImpactBlocker[] = requestedConflict
    ? [
        {
          reason: "conflict",
          name: requestedConflict.name,
          existing: { address: requestedConflict.address, paths: requestedConflict.paths },
          proposed: { address: request.address, paths: [] },
        },
      ]
    : [];
  return {
    value: {
      kind: "add-to-collection",
      collection: request.collection,
      address: request.address,
      decision,
      ...(decision.kind === "direct"
        ? {
            intent: {
              owner: decision.owner,
              stableEntryName,
              address: request.address,
            },
          }
        : decision.kind === "repository-derived"
          ? {
              createDirectContribution: {
                collection: request.collection,
                eligibleLevels: ["global", "project", "local"],
              },
            }
          : {}),
      existing,
      blockers,
      allowed: decision.kind === "direct" && !blockers.length,
    },
    diagnostics: workspace.diagnostics,
  };
}

export async function previewMembershipRemoval(
  options: ReadWorkspaceOptions,
  request: Omit<RemoveMemberRequest, "level"> & { readonly level?: ConfigLevel },
  operation?: OperationOptions,
): Promise<OperationResult<MembershipRemovalImpact>> {
  parseQualifiedName(request.collection);
  parseNameSegment(request.name);
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const member =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView
          .find((item) => item.id === request.collection)
          ?.members.find((item) => item.name === request.name)
      : undefined;
  const direct = member?.paths.find(
    (path) =>
      path.kind === "direct" &&
      path.collection === request.collection &&
      (!request.level || path.owner?.level === request.level),
  );
  const producers = member?.paths.filter((path) => path.kind === "repository-derived") ?? [];
  const links = member?.paths.filter((path) => path.kind === "via-link") ?? [];
  let decision: CollectionEditDecision;
  if (direct?.kind === "direct" && direct.owner) {
    decision = {
      kind: direct.owner.contribution ? "contributed" : "direct",
      owner: direct.owner,
    };
  } else if (producers.length) {
    decision = {
      kind: "repository-derived",
      producers: producers.map(({ source, path }) => ({ source, path })),
    };
  } else if (links.length) {
    decision = { kind: "via-link", paths: links };
  } else {
    decision = editDecision(workspace.value, request.level, request.collection);
  }
  const affected = member
    ? [
        {
          selector: `${request.collection}:${member.name}`,
          address: member.address,
          paths: member.paths,
        },
      ]
    : [];
  const directPaths =
    member?.paths.filter(
      (path) => path.kind === "direct" && path.collection === request.collection,
    ) ?? [];
  const retainedPaths = member?.paths.filter((path) => !directPaths.includes(path)) ?? [];
  if (decision.kind === "direct") {
    const owner =
      request.expectedOwner?.pointer === `/collections/${request.collection}`
        ? { ...decision.owner, pointer: `/collections/${request.collection}` }
        : decision.owner;
    assertDeclarationOwner(owner, request.expectedOwner);
  }
  const directAllowed =
    decision.kind === "direct" &&
    !!member &&
    (!request.expectedAddress || sameSkillAddress(member.address, request.expectedAddress));
  return {
    value: {
      kind: "membership-removal",
      collection: request.collection,
      name: request.name,
      decision,
      affected,
      retained:
        directAllowed && member && retainedPaths.length
          ? [{ selector: `${request.collection}:${member.name}`, paths: retainedPaths }]
          : [],
      disappearing: directAllowed && member && !retainedPaths.length ? affected : [],
      linkActions:
        decision.kind === "via-link"
          ? decision.paths.map((path) => ({
              owner: path.kind === "via-link" ? path.links[0]?.owner : undefined,
              paths: [path],
            }))
          : [],
      allowed: directAllowed,
    },
    diagnostics: workspace.diagnostics,
  };
}

export async function previewMembershipBatch(
  options: ReadWorkspaceOptions,
  request: MemberEditRequest,
  operation?: OperationOptions,
): Promise<OperationResult<MembershipBatchImpact>> {
  const normalized = normalizeMemberEdit(request);
  const { additions, removals } = normalized;
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    const decision = editDecision(workspace.value, request.level, request.collection);
    const blockers: ImpactBlocker[] = [];
    if (decision.kind === "contributed")
      blockers.push({ reason: "membership", owner: decision.owner });
    if (workspace.value.effective.status !== "complete") blockers.push({ reason: "incomplete" });
    let affected: readonly import("./types").MembershipAffected[] = [];
    let effectful = false;
    if (decision.kind === "direct" && !blockers.length) {
      assertDeclarationOwner(decision.owner, request.expectedOwner);
      const host = await document(decision.owner.file, decision.owner.level);
      try {
        const { members, changed } = editMembers(
          host.collections?.[request.collection]?.members ?? {},
          normalized,
        );
        effectful = changed;
        const proposed = {
          ...host,
          collections: {
            ...host.collections,
            [request.collection]: { ...host.collections?.[request.collection], members },
          },
        };
        if (changed) {
          affected = await membershipBatchAffected(
            options,
            workspace.value,
            await coordinator.read(),
            coordinator,
            {
              file: decision.owner.file,
              value: proposed,
            },
          );
        }
      } catch (error) {
        if (
          error instanceof SkctlError &&
          (error.code === "INVALID_ARGUMENT" || error.code === "CONFIG_CONFLICT")
        ) {
          blockers.push({ reason: "membership", owner: decision.owner });
        } else {
          if (!(error instanceof CollectionResolutionError)) throw error;
          blockers.push(
            error.details.kind === "cycle"
              ? { reason: "cycle", collections: error.details.collections }
              : {
                  reason: "conflict",
                  name: error.details.name,
                  existing: error.details.existing,
                  proposed: error.details.proposed,
                },
          );
        }
      }
    }
    return {
      value: {
        kind: "membership-batch",
        collection: request.collection,
        decision,
        additions,
        removals,
        affected,
        blockers,
        effectful,
        allowed: decision.kind === "direct" && !blockers.length,
      },
      diagnostics: workspace.diagnostics,
    };
  });
}

export async function previewImport(
  options: ReadWorkspaceOptions,
  request: ImportMembersRequest,
  operation?: OperationOptions,
): Promise<OperationResult<ImportImpact>> {
  parseQualifiedName(request.from);
  parseQualifiedName(request.into);
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    const source =
      workspace.value.effective.status === "complete"
        ? workspace.value.effective.collectionsView.find((item) => item.id === request.from)
        : undefined;
    const target = workspace.value.configs
      .find((item) => item.level === request.level)
      ?.direct.collections.find((item) => item.id === request.into)?.owner;
    const targetMembers = target
      ? ((await document(target.file, target.level)).collections?.[request.into]?.members ?? {})
      : {};
    const delta = importMembers(
      targetMembers,
      (source?.members ?? []).map(({ name, address }) => ({ name, address })),
    );
    const { additions, skipped } = delta;
    const conflicts: ImpactBlocker[] = delta.conflicts.map((conflict) => ({
      reason: "conflict",
      name: conflict.name,
      existing: { address: conflict.existing, paths: [] },
      proposed: {
        address: conflict.proposed,
        paths: source?.members.find((member) => member.name === conflict.name)?.paths ?? [],
      },
    }));
    return {
      value: {
        kind: "collection-import",
        source: request.from,
        destination: request.into,
        ...(target ? { owner: target } : {}),
        additions,
        skipped,
        conflicts,
        allowed: !!source && !!target && !conflicts.length,
      },
      diagnostics: workspace.diagnostics,
    };
  });
}

export async function previewAddReference(
  options: ReadWorkspaceOptions,
  request: AddReferenceRequest,
  operation?: OperationOptions,
): Promise<OperationResult<ReferenceImpact>> {
  parseQualifiedName(request.collection);
  parseQualifiedName(request.target);
  parseNameSegment(request.name);
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    const decision = editDecision(workspace.value, request.level, request.collection);
    if (decision.kind === "direct") assertDeclarationOwner(decision.owner, request.expectedOwner);
    const targetExists =
      workspace.value.effective.status === "complete" &&
      workspace.value.effective.collectionsView.some((item) => item.id === request.target);
    let existing: { collection: string; description: string } | undefined;
    if (decision.kind === "direct") {
      const host = await document(decision.owner.file, decision.owner.level);
      existing = host.collections?.[request.collection]?.references?.[request.name];
    }
    return {
      value: {
        kind: "reference",
        collection: request.collection,
        name: request.name,
        referencedCollection: request.target,
        description: request.description,
        ...(decision.kind === "direct" ? { owner: decision.owner } : {}),
        decision,
        allowed: decision.kind === "direct" && targetExists && !existing,
      },
      diagnostics: workspace.diagnostics,
    };
  });
}

export async function previewLinkChange(
  options: ReadWorkspaceOptions,
  request: SetLinkRequest,
  operation?: OperationOptions,
): Promise<OperationResult<LinkChangeImpact>> {
  return previewLinkChangeImpact(options, request, operation);
}

export async function previewRemoveReference(
  options: ReadWorkspaceOptions,
  request: RemoveReferenceRequest,
  operation?: OperationOptions,
): Promise<OperationResult<ReferenceImpact>> {
  parseQualifiedName(request.collection);
  parseNameSegment(request.name);
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    const decision = editDecision(workspace.value, request.level, request.collection);
    const host =
      decision.kind === "direct"
        ? await document(decision.owner.file, decision.owner.level)
        : undefined;
    if (decision.kind === "direct") assertDeclarationOwner(decision.owner, request.expectedOwner);
    const existing = host?.collections?.[request.collection]?.references?.[request.name];
    return {
      value: {
        kind: "reference",
        collection: request.collection,
        name: request.name,
        referencedCollection: existing?.collection ?? request.expected?.collection ?? "",
        description: existing?.description ?? request.expected?.description ?? "",
        ...(decision.kind === "direct" ? { owner: decision.owner } : {}),
        decision,
        allowed:
          !!existing &&
          (!request.expected ||
            (request.expected.collection === existing.collection &&
              request.expected.description === existing.description)),
      },
      diagnostics: workspace.diagnostics,
    };
  });
}

export async function previewCollectionUse(
  options: ReadWorkspaceOptions,
  request: SetUseRequest,
  operation?: OperationOptions,
): Promise<OperationResult<CollectionUseImpact>> {
  if (new Set(request.collections).size !== request.collections.length)
    throw new SkctlError(
      "INVALID_ARGUMENT",
      "Collection Use cannot contain duplicate Collection IDs",
    );
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const config = workspace.value.configs.find((item) => item.level === request.level)!;
  const owner = { level: request.level, file: config.file.file, pointer: "/use" } as const;
  const available =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView
      : [];
  const selectors = (collections: readonly string[]) =>
    available
      .filter((collection) => collections.includes(collection.id))
      .flatMap((collection) =>
        collection.members.map((member) => ({
          selector: `${collection.id}:${member.name}`,
          address: member.address,
          paths: member.paths,
        })),
      );
  const oldCollections =
    workspace.value.configs
      .find((item) => item.level === request.level)
      ?.direct.collectionUse.map((item) => item.collection) ?? [];
  const installed = new Set(
    workspace.value.installedSkills.map((item) => skillAddressKey(item.address)),
  );
  const completeness = (collections: readonly string[]) => {
    const selected = selectors(collections);
    const missingCollections = collections.filter(
      (id) => !available.some((collection) => collection.id === id),
    );
    const missingInstalled = selected
      .filter((item) => !installed.has(skillAddressKey(item.address)))
      .map((item) => item.address);
    return {
      complete: !!collections.length && !missingCollections.length && !missingInstalled.length,
      missingCollections,
      missingInstalled,
      selected,
    };
  };
  const current = completeness(oldCollections);
  const proposed = completeness(request.collections);
  const affectedSelectors = proposed.selected;
  const oldSelectors = selectors(oldCollections);
  const newlyExposed = proposed.selected.filter(
    (candidate) => !oldSelectors.some((item) => item.selector === candidate.selector),
  );
  const removedAtOwner = oldSelectors.filter(
    (candidate) => !proposed.selected.some((item) => item.selector === candidate.selector),
  );
  const retained = removedAtOwner.flatMap((candidate) => {
    const alternateOwners = workspace.value.configs.flatMap((item) =>
      item.level === request.level
        ? []
        : item.direct.collectionUse
            .filter((use) =>
              selectors([use.collection]).some(
                (entry) =>
                  entry.address.source === candidate.address.source &&
                  entry.address.path === candidate.address.path,
              ),
            )
            .map((use) => use.owner),
    );
    return alternateOwners.length ? [{ ...candidate, alternateOwners }] : [];
  });
  const alternateOwners = retained.flatMap((item) => item.alternateOwners);
  const blockers: ImpactBlocker[] =
    (proposed.complete || request.collections.length === 0) &&
    workspace.value.effective.status === "complete"
      ? []
      : [
          {
            reason: "incomplete",
            owner,
            ...(proposed.missingCollections.length
              ? { collections: proposed.missingCollections }
              : {}),
            ...(proposed.missingInstalled.length ? { installed: proposed.missingInstalled } : {}),
          },
        ];
  return {
    value: {
      kind: "collection-use",
      owner,
      oldCollections,
      newCollections: [...request.collections],
      affectedSelectors,
      newlyExposed,
      removedAtOwner,
      retained,
      alternateOwners,
      currentComplete: current.complete,
      proposedComplete: proposed.complete,
      blockers,
      allowed: !blockers.length,
    },
    diagnostics: workspace.diagnostics,
  };
}

export async function previewCollectionRemoval(
  options: ReadWorkspaceOptions,
  request: CollectionRequest,
  operation?: OperationOptions,
): Promise<OperationResult<CollectionRemovalImpact>> {
  parseQualifiedName(request.collection);
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const direct = workspace.value.configs
    .find((item) => item.level === request.level)
    ?.direct.collections.find((item) => item.id === request.collection);
  if (direct) assertDeclarationOwner(direct.owner, request.expectedOwner);
  const blockers: ImpactBlocker[] = [
    ...workspace.value.configs.flatMap((config) =>
      config.direct.collectionUse
        .filter((use) => use.collection === request.collection)
        .map((use) => ({ reason: "use" as const, owner: use.owner })),
    ),
    ...(workspace.value.effective.status === "complete" ? [] : [{ reason: "incomplete" as const }]),
  ];
  if (workspace.value.effective.status === "complete")
    for (const collection of workspace.value.effective.collectionsView)
      blockers.push(
        ...collection.references
          .filter((reference) => reference.collection === request.collection)
          .map((reference) => ({ reason: "reference" as const, owner: reference.owner })),
        ...collection.links
          .filter((link) => link.collection === request.collection)
          .map((link) => ({ reason: "link" as const, owner: link.owner })),
      );
  const removalDecision = editDecision(workspace.value, request.level, request.collection);
  const view =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView.find((item) => item.id === request.collection)
      : undefined;
  if (direct && view)
    blockers.push(
      ...view.links
        .filter(
          (link) => link.owner.level === request.level && link.owner.file === direct.owner.file,
        )
        .map((link) => ({ reason: "link" as const, owner: link.owner })),
    );
  const directPath = (path: NonNullable<typeof view>["members"][number]["paths"][number]) =>
    path.kind === "direct" &&
    path.owner?.level === request.level &&
    path.owner.file === direct?.owner.file;
  const selector = (member: NonNullable<typeof view>["members"][number]) => ({
    selector: `${request.collection}:${member.name}`,
    address: member.address,
    paths: member.paths,
  });
  const disappearingSelectors =
    direct && view
      ? view.members
          .filter((member) => !member.paths.some((path) => !directPath(path)))
          .map(selector)
      : [];
  const retainedSelectors =
    direct && view
      ? view.members
          .filter((member) => member.paths.some((path) => !directPath(path)))
          .map(selector)
      : [];
  return {
    value: {
      kind: "collection-removal",
      owner: direct?.owner,
      decision: removalDecision.kind === "via-link" ? { kind: "missing" } : removalDecision,
      repository:
        workspace.value.effective.status === "complete"
          ? (view?.repository ?? { derived: false, producers: [] })
          : { derived: false, producers: [] },
      disappearingSelectors,
      retainedSelectors,
      blockers,
      allowed: !!direct && !blockers.length,
    },
    diagnostics: workspace.diagnostics,
  };
}
