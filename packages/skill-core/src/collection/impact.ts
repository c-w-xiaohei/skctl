import { assertDeclarationOwner } from "../config/write";

import { parse } from "jsonc-parser";

import type { LinkChangeImpact, MembershipAffected } from "./types";
import type { OperationOptions, OperationResult } from "../shared";
import type { WorkspaceView } from "../workspace/types";
import type { SetLinkRequest } from "./types";
import { CollectionResolutionError, type MemberOriginPath } from "./graph";
import { type SkillAddress } from "../source/schema";
import { SkctlError } from "../shared";

import { parseQualifiedName } from "./names";
import { StateCoordinator } from "../storage/state";
import type { PrivateState } from "../storage/schema";
import { document, edit } from "../config/document";
import { type ConfigDocument } from "../config/schema";
import { configFile, type ReadWorkspaceOptions } from "../config/inputs";

import { readWorkspaceUnlocked } from "../workspace/capture";
import { resolveEffectiveCollections } from "./resolve";

export async function membershipBatchAffected(
  options: ReadWorkspaceOptions,
  workspace: WorkspaceView,
  state: PrivateState,
  coordinator: StateCoordinator,
  proposed: { readonly file: string; readonly value: ConfigDocument },
): Promise<readonly MembershipAffected[]> {
  const current = await resolveEffectiveCollections(options, workspace, state, coordinator);
  const next = await resolveEffectiveCollections(options, workspace, state, coordinator, proposed);
  const affected: MembershipAffected[] = [];
  const collections = new Set([...current.members.keys(), ...next.members.keys()]);
  for (const collection of [...collections].sort()) {
    const names = new Set([
      ...(current.members.get(collection)?.keys() ?? []),
      ...(next.members.get(collection)?.keys() ?? []),
    ]);
    for (const name of [...names].sort()) {
      const before = current.members.get(collection)?.get(name);
      const after = next.members.get(collection)?.get(name);
      const beforePaths = current.origins.get(collection)?.get(name) ?? [];
      const afterPaths = next.origins.get(collection)?.get(name) ?? [];
      if (
        (!before && after) ||
        (before && !after) ||
        (before && after && (before.source !== after.source || before.path !== after.path)) ||
        JSON.stringify(beforePaths) !== JSON.stringify(afterPaths)
      )
        affected.push({
          selector: `${collection}:${name}`,
          address: after ?? before!,
          paths: after ? afterPaths : beforePaths,
        });
    }
  }
  return affected;
}

export function sameMembershipAffected(
  left: readonly MembershipAffected[],
  right: readonly MembershipAffected[],
): boolean {
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).sort().join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`
        : JSON.stringify(value);
  return canonical(left) === canonical(right);
}

export function changedLinks(
  current: readonly string[],
  target: string,
  linked: boolean,
): string[] {
  parseQualifiedName(target);
  const existing = current.indexOf(target);
  if ((linked && existing >= 0) || (!linked && existing < 0))
    throw new SkctlError("INVALID_ARGUMENT", linked ? "Link already exists" : "Link not found");
  const links = [...current];
  if (linked) links.push(target);
  else links.splice(existing, 1);
  return links;
}

export async function previewLinkChangeImpact(
  options: ReadWorkspaceOptions,
  request: SetLinkRequest,
  operation?: OperationOptions,
): Promise<OperationResult<LinkChangeImpact>> {
  parseQualifiedName(request.collection);
  parseQualifiedName(request.target);
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    if (workspace.value.effective.status !== "complete")
      throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
    const file = configFile(options, request.level, workspace.value.project.root);
    const host = await document(file, request.level);
    const declaration = host.collections?.[request.collection];
    if (declaration)
      assertDeclarationOwner(
        { level: request.level, file, pointer: `/collections/${request.collection}` },
        request.expectedOwner,
      );
    if (!declaration) {
      const view = workspace.value.effective.collectionsView.find(
        (item) => item.id === request.collection,
      );
      return {
        value: {
          kind: "link-change",
          collection: request.collection,
          target: request.target,
          linked: request.linked,
          members: [],
          disappearingSelectors: [],
          retainedSelectors: [],
          blockers: [{ reason: "link", owner: view?.declared.find((owner) => owner.contribution) }],
          allowed: false,
        },
        diagnostics: workspace.diagnostics,
      };
    }
    const existingIndex = (declaration.links ?? []).indexOf(request.target);
    const owner = {
      level: request.level,
      file,
      pointer: `/collections/${request.collection}/links/${
        request.linked
          ? (declaration.links ?? []).filter((link) => link !== request.target).length
          : existingIndex
      }`,
    } as const;
    if ((request.linked && existingIndex >= 0) || (!request.linked && existingIndex < 0))
      return {
        value: {
          kind: "link-change",
          collection: request.collection,
          target: request.target,
          owner,
          linked: request.linked,
          members: [],
          disappearingSelectors: [],
          retainedSelectors: [],
          blockers: [{ reason: "link", owner }],
          allowed: false,
        },
        diagnostics: workspace.diagnostics,
      };
    const state = await coordinator.read();
    const current = await resolveEffectiveCollections(options, workspace.value, state, coordinator);
    const links = changedLinks(declaration.links ?? [], request.target, request.linked);
    const proposedHost = parse(
      edit(JSON.stringify(host), ["collections", request.collection, "links"], links),
      [],
      { allowTrailingComma: true },
    ) as ConfigDocument;
    try {
      const proposed = await resolveEffectiveCollections(
        options,
        workspace.value,
        state,
        coordinator,
        { file, value: proposedHost },
      );
      const currentMembers = current.members.get(request.collection) ?? new Map();
      const proposedMembers = proposed.members.get(request.collection) ?? new Map();
      const members = [...proposedMembers.entries()].map(([name, address]) => ({
        name,
        address,
        paths: proposed.origins.get(request.collection)?.get(name) ?? [],
      }));
      const selector = (
        name: string,
        address: SkillAddress,
        paths: readonly MemberOriginPath[],
      ) => ({
        selector: `${request.collection}:${name}`,
        address,
        paths,
      });
      const disappearingSelectors = request.linked
        ? []
        : [...currentMembers.entries()]
            .filter(([name]) => !proposedMembers.has(name))
            .map(([name, address]) =>
              selector(name, address, current.origins.get(request.collection)?.get(name) ?? []),
            );
      const retainedSelectors = request.linked
        ? []
        : [...currentMembers.entries()]
            .filter(([name]) => proposedMembers.has(name))
            .map(([name, address]) =>
              selector(name, address, proposed.origins.get(request.collection)?.get(name) ?? []),
            );
      return {
        value: {
          kind: "link-change",
          collection: request.collection,
          target: request.target,
          owner,
          linked: request.linked,
          members,
          disappearingSelectors,
          retainedSelectors,
          blockers: [],
          allowed: true,
        },
        diagnostics: workspace.diagnostics,
      };
    } catch (error) {
      if (!(error instanceof CollectionResolutionError)) throw error;
      const blocker =
        error.details.kind === "cycle"
          ? { reason: "cycle" as const, collections: error.details.collections }
          : {
              reason: "conflict" as const,
              name: error.details.name,
              existing: error.details.existing,
              proposed: error.details.proposed,
            };
      return {
        value: {
          kind: "link-change",
          collection: request.collection,
          target: request.target,
          owner,
          linked: request.linked,
          members: [],
          disappearingSelectors: [],
          retainedSelectors: [],
          blockers: [blocker],
          allowed: false,
        },
        diagnostics: workspace.diagnostics,
      };
    }
  });
}
