import {
  AddToCollectionImpact,
  CollectionEditDecision,
  CollectionRemovalImpact,
  CollectionUseImpact,
  ConfigChange,
  ConfigurationChangeResult,
  ImpactBlocker,
  ImportImpact,
  LinkChangeImpact,
  MembershipRemovalImpact,
  MembershipBatchImpact,
  OperationOptions,
  OperationResult,
  ReferenceImpact,
  SkillCliError,
  type ConfigurationCapability,
} from "./api";
import {
  mutateConfiguration,
  membershipBatchAffected,
  previewLinkChangeImpact,
  readWorkspace,
  type ConfigDocument,
  type MutationOptions,
} from "./internal/config";
import { sameSkillAddress, skillAddressKey } from "./collections";
import { CollectionResolutionError } from "./collections";
import { parseNameSegment } from "./internal/domain";
import { StateCoordinator } from "./internal/state";
import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";

export type ConfigurationOptions = MutationOptions;

export function changeConfiguration(
  options: ConfigurationOptions,
  change: ConfigChange,
  operation?: OperationOptions,
): Promise<OperationResult<ConfigurationChangeResult>> {
  return mutateConfiguration(options, change, operation);
}

function editDecision(
  workspace: Awaited<ReturnType<typeof readWorkspace>>["value"],
  level: "global" | "project" | "local" | undefined,
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
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewAddToCollection"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<AddToCollectionImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const view =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView.find((item) => item.id === request.collection)
      : undefined;
  const decision = editDecision(workspace.value, request.level, request.collection);
  const stableEntryName = request.name.trim();
  parseNameSegment(stableEntryName);
  const existing =
    view?.members
      .filter((member) => sameSkillAddress(member.address, request.address))
      .map(({ name, address, paths }) => ({ name, address, paths })) ?? [];
  const requestedConflict = stableEntryName
    ? view?.members.find(
        (member) =>
          member.name === stableEntryName && !sameSkillAddress(member.address, request.address),
      )
    : undefined;
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
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewMembershipRemoval"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<MembershipRemovalImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const member =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView
          .find((item) => item.id === request.collection)
          ?.members.find((item) => item.name === request.name)
      : undefined;
  const direct = member?.paths.find(
    (path) => path.kind === "direct" && path.collection === request.collection,
  );
  const decision: CollectionEditDecision =
    direct?.kind === "direct" && direct.owner
      ? direct.owner.contribution
        ? { kind: "contributed", owner: direct.owner }
        : { kind: "direct", owner: direct.owner }
      : member?.paths.some((path) => path.kind === "repository-derived")
        ? {
            kind: "repository-derived",
            producers: member.paths
              .filter((path) => path.kind === "repository-derived")
              .map((path) => ({ source: path.source, path: path.path })),
          }
        : member?.paths.some((path) => path.kind === "via-link")
          ? { kind: "via-link", paths: member.paths.filter((path) => path.kind === "via-link") }
          : editDecision(workspace.value, request.level, request.collection);
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
  const directAllowed = decision.kind === "direct";
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
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewMembershipBatch"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<MembershipBatchImpact>> {
  const names = new Set<string>();
  const additions = request.additions.map((entry) => ({
    ...entry,
    name: parseNameSegment(entry.name),
  }));
  const removals = request.removals.map((entry) => ({
    ...entry,
    name: parseNameSegment(entry.name),
  }));
  for (const entry of [...additions, ...removals]) {
    if (names.has(entry.name))
      throw new SkillCliError(
        "INVALID_ARGUMENT",
        "Membership batch cannot contain duplicate entry names",
      );
    names.add(entry.name);
  }
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspace({ ...options, signal: operation?.signal });
    const decision = editDecision(workspace.value, request.level, request.collection);
    const view =
      workspace.value.effective.status === "complete"
        ? workspace.value.effective.collectionsView.find((item) => item.id === request.collection)
        : undefined;
    const blockers: ImpactBlocker[] = [];
    if (decision.kind === "direct") {
      for (const entry of additions) {
        const existing = view?.members.find((member) => member.name === entry.name);
        if (existing && !sameSkillAddress(existing.address, entry.address))
          blockers.push({
            reason: "conflict",
            name: entry.name,
            existing: { address: existing.address, paths: existing.paths },
            proposed: { address: entry.address, paths: [] },
          });
      }
      for (const entry of removals) {
        const member = view?.members.find((candidate) => candidate.name === entry.name);
        const direct = member?.paths.find(
          (path) =>
            path.kind === "direct" &&
            path.owner?.level === decision.owner.level &&
            path.owner.file === decision.owner.file &&
            path.owner.pointer === `${decision.owner.pointer}/members/${entry.name}`,
        );
        if (!member || !direct || !sameSkillAddress(member.address, entry.expectedAddress))
          blockers.push({ reason: "membership", owner: decision.owner });
      }
    } else if (decision.kind === "contributed")
      blockers.push({ reason: "membership", owner: decision.owner });
    if (workspace.value.effective.status !== "complete") blockers.push({ reason: "incomplete" });
    let affected: readonly import("./api").MembershipAffected[] = [];
    let effectful = false;
    if (decision.kind === "direct" && !blockers.length) {
      const current = view!.members.filter((member) =>
        member.paths.some(
          (path) =>
            path.kind === "direct" &&
            path.owner?.level === decision.owner.level &&
            path.owner.file === decision.owner.file &&
            path.owner.pointer === `${decision.owner.pointer}/members/${member.name}`,
        ),
      );
      const members = Object.fromEntries(current.map((member) => [member.name, member.address]));
      for (const entry of removals) delete members[entry.name];
      for (const entry of additions) members[entry.name] = entry.address;
      effectful =
        current.length !== Object.keys(members).length ||
        current.some((member) => !sameSkillAddress(member.address, members[member.name]!));
      if (effectful) {
        const state = await coordinator.read();
        const host = parse(await readFile(decision.owner.file, "utf8"), [], {
          allowTrailingComma: true,
        }) as ConfigDocument;
        const proposed = {
          ...host,
          collections: {
            ...host.collections,
            [request.collection]: { ...host.collections?.[request.collection], members },
          },
        };
        try {
          affected = await membershipBatchAffected(options, workspace.value, state, coordinator, {
            file: decision.owner.file,
            value: proposed,
          });
        } catch (error) {
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
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewImport"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<ImportImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const source =
    workspace.value.effective.status === "complete"
      ? workspace.value.effective.collectionsView.find((item) => item.id === request.from)
      : undefined;
  const target = workspace.value.configs
    .find((item) => item.level === request.level)
    ?.direct.collections.find((item) => item.id === request.into)?.owner;
  const targetMembers =
    workspace.value.effective.status === "complete"
      ? (workspace.value.effective.collectionsView.find((item) => item.id === request.into)
          ?.members ?? [])
      : [];
  const additions: { name: string; address: { source: string; path: string } }[] = [];
  const skipped: { name: string; address: { source: string; path: string } }[] = [];
  const conflicts: ImpactBlocker[] = [];
  for (const member of source?.members ?? []) {
    const current = targetMembers.find((candidate) => candidate.name === member.name);
    if (!current) additions.push({ name: member.name, address: member.address });
    else if (sameSkillAddress(current.address, member.address))
      skipped.push({ name: member.name, address: member.address });
    else
      conflicts.push({
        reason: "conflict",
        name: member.name,
        existing: { address: current.address, paths: current.paths },
        proposed: { address: member.address, paths: member.paths },
      });
  }
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
}

export async function previewReference(
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewReference"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<ReferenceImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const decision = editDecision(workspace.value, request.level, request.collection);
  const targetExists =
    workspace.value.effective.status === "complete" &&
    workspace.value.effective.collectionsView.some((item) => item.id === request.target);
  let existing: { collection: string; description: string } | undefined;
  if (decision.kind === "direct") {
    const bytes = await readFile(decision.owner.file).catch(() => undefined);
    if (bytes) {
      const document = parse(new TextDecoder().decode(bytes), [], {
        allowTrailingComma: true,
      }) as {
        collections?: Record<
          string,
          { references?: Record<string, { collection: string; description: string }> }
        >;
      };
      existing = document.collections?.[request.collection]?.references?.[request.name];
    }
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
      exposure: [],
      allowed:
        decision.kind === "direct" &&
        (request.remove
          ? existing?.collection === request.target && existing.description === request.description
          : targetExists && !existing),
    },
    diagnostics: workspace.diagnostics,
  };
}

export async function previewLinkChange(
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewLinkChange"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<LinkChangeImpact>> {
  return previewLinkChangeImpact(options, { type: "collection.link.set", ...request }, operation);
}

export async function previewCollectionUse(
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewCollectionUse"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<CollectionUseImpact>> {
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
  const blockers: ImpactBlocker[] = proposed.complete
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
  options: ConfigurationOptions,
  request: Parameters<ConfigurationCapability["previewCollectionRemoval"]>[0],
  operation?: OperationOptions,
): Promise<OperationResult<CollectionRemovalImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const direct = workspace.value.configs
    .find((item) => item.level === request.level)
    ?.direct.collections.find((item) => item.id === request.collection);
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
