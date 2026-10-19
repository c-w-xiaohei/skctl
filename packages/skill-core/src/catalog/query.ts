import type { SearchSkillsRequest } from "./types";
import type { BrowseCatalogRequest } from "./types";

import type {
  AgentBrowseProjection,
  AgentCatalogItem,
  SearchSkillsResult,
  CatalogSkill,
} from "./types";
import type { SkillMetadata } from "../content/text";
import type { CollectionView } from "../collection/types";
import type { OperationResult } from "../shared";

import type { CoreOptions } from "../shared";
import { SkctlError } from "../shared";
import { reachableCollections, skillAddressKey } from "../collection/graph";
import { readWorkspace } from "../workspace/capture";

function skillsFor(
  collection: CollectionView,
  installed: ReadonlyMap<string, SkillMetadata>,
): CatalogSkill[] {
  const entries: CatalogSkill[] = [];
  for (const member of collection.members) {
    const skill = installed.get(skillAddressKey(member.address));
    if (!skill) continue;
    entries.push({
      selector: `${collection.id}:${member.name}`,
      name: skill.name,
      description: skill.description,
    });
  }
  return entries;
}

async function records(factory: CoreOptions) {
  const workspace = await readWorkspace(factory);
  const agent = workspace.value.effective.agent;
  const effective = workspace.value.effective;
  const rootCollections = effective.status === "complete" ? effective.use : [];
  const collections = new Map(
    effective.status === "complete"
      ? effective.collectionsView.map((collection) => [collection.id, collection] as const)
      : [],
  );
  const installed = new Map<string, { readonly name: string; readonly description: string }>();
  for (const skill of workspace.value.installedSkills)
    if (skill.owner.health === "healthy" && !installed.has(skillAddressKey(skill.address)))
      installed.set(skillAddressKey(skill.address), skill);
  const reachable = reachableCollections([...collections.values()], rootCollections);
  return {
    workspace,
    entries: agent.catalog,
    rootCollections,
    reachable,
    collections,
    installed,
    unavailable:
      agent.status === "unavailable"
        ? (agent.reasons[0]?.message ?? "Catalog unavailable")
        : undefined,
  };
}
export async function browseCatalog(
  factory: CoreOptions,
  request: BrowseCatalogRequest,
): Promise<OperationResult<AgentBrowseProjection>> {
  const value = await records(factory);
  if (value.unavailable)
    return {
      value: { status: "unavailable", reason: value.unavailable },
      diagnostics: value.workspace.diagnostics,
    };
  if (value.workspace.value.effective.status !== "complete")
    throw new SkctlError("INTERNAL", "Catalog is unavailable");
  const requested = request.collection;
  if (requested && !value.reachable.has(requested))
    throw new SkctlError("SKILL_NOT_FOUND", "Collection is not exposed");
  if (!requested)
    return {
      value: {
        status: "available",
        scope: { kind: "root" },
        items: value.rootCollections.map((id) => {
          const collection = value.collections.get(id);
          return {
            kind: "collection" as const,
            id,
            name: id,
            ...(collection?.description ? { description: collection.description } : {}),
          };
        }),
      },
      diagnostics: value.workspace.diagnostics,
    };
  const collection = value.collections.get(requested);
  if (!collection) throw new SkctlError("SKILL_NOT_FOUND", "Collection is not exposed");
  const items: AgentCatalogItem[] = skillsFor(collection, value.installed).map((skill) => ({
    kind: "skill",
    ...skill,
  }));
  items.push(
    ...collection.references.map(({ name, description, collection: target }) => ({
      kind: "collection" as const,
      id: target,
      name,
      description,
    })),
  );
  return {
    value: { status: "available", scope: { kind: "collection", id: requested }, items },
    diagnostics: value.workspace.diagnostics,
  };
}

export async function searchSkills(
  factory: CoreOptions,
  request: SearchSkillsRequest,
): Promise<OperationResult<SearchSkillsResult>> {
  if (!request.query.trim()) throw new SkctlError("INVALID_ARGUMENT", "Invalid search request");
  if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 0))
    throw new SkctlError("INVALID_ARGUMENT", "Search limit must be a non-negative integer");
  const value = await records(factory);
  if (value.unavailable) throw new SkctlError("CONFIG_INVALID", value.unavailable);
  const query = request.query.toLowerCase();
  if (request.collection && !value.reachable.has(request.collection))
    throw new SkctlError("SKILL_NOT_FOUND", "Collection is not exposed");
  const collectionIds = request.collection ? [request.collection] : value.rootCollections;
  const entries =
    value.workspace.value.effective.status === "complete"
      ? collectionIds.flatMap((id) => {
          const collection = value.collections.get(id);
          return collection ? skillsFor(collection, value.installed) : [];
        })
      : value.entries;
  const matched = entries.filter((item) =>
    `${item.selector} ${item.name} ${item.description}`.toLowerCase().includes(query),
  );
  const results = matched.slice(0, request.limit).map((item) => ({
    selector: item.selector,
    name: item.name,
    description: item.description,
  }));
  return {
    value: { results, truncated: results.length < matched.length },
    diagnostics: value.workspace.diagnostics,
  };
}
