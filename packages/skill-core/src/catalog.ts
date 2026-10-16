import type {
  AgentBrowseProjection,
  AgentCatalogItem,
  CatalogCapability,
  CollectionView,
  CoreFactoryOptions,
  OperationResult,
  SearchSkillsResult,
} from "./api";
import { SkillCliError } from "./api";
import { skillAddressKey } from "./collections";
import { readWorkspace } from "./internal/config";

type SkillEntry = Omit<Extract<AgentCatalogItem, { readonly kind: "skill" }>, "kind">;

function skillsFor(
  collection: CollectionView,
  installed: ReadonlyMap<string, { readonly name: string; readonly description: string }>,
): SkillEntry[] {
  return collection.members.flatMap((member) => {
    const skill = installed.get(skillAddressKey(member.address));
    return skill
      ? [
          {
            selector: `${collection.id}:${member.name}`,
            name: skill.name,
            description: skill.description,
          },
        ]
      : [];
  });
}

async function records(factory: CoreFactoryOptions) {
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
  const reachable = new Set<string>();
  const pending = [...rootCollections];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const collection = collections.get(id);
    for (const reference of collection?.references ?? []) pending.push(reference.collection);
  }
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
export function createCatalog(factory: CoreFactoryOptions): CatalogCapability {
  return {
    async browse(request): Promise<OperationResult<AgentBrowseProjection>> {
      const value = await records(factory);
      if (value.unavailable)
        return {
          value: { status: "unavailable", reason: value.unavailable },
          diagnostics: value.workspace.diagnostics,
        };
      if (value.workspace.value.effective.status !== "complete")
        throw new SkillCliError("INTERNAL", "Catalog is unavailable");
      const requested = request.collection;
      if (requested && !value.reachable.has(requested))
        throw new SkillCliError("SKILL_NOT_FOUND", "Collection is not exposed");
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
      if (!collection) throw new SkillCliError("SKILL_NOT_FOUND", "Collection is not exposed");
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
    },
    async search(request): Promise<OperationResult<SearchSkillsResult>> {
      if (!request.query.trim())
        throw new SkillCliError("INVALID_ARGUMENT", "Invalid search request");
      const value = await records(factory);
      if (value.unavailable) throw new SkillCliError("CONFIG_INVALID", value.unavailable);
      const query = request.query.toLowerCase();
      if (request.collection && !value.reachable.has(request.collection))
        throw new SkillCliError("SKILL_NOT_FOUND", "Collection is not exposed");
      const collectionIds = request.collection ? [request.collection] : value.rootCollections;
      const entries =
        value.workspace.value.effective.status === "complete"
          ? collectionIds.flatMap((id) => {
              const collection = value.collections.get(id);
              return collection ? skillsFor(collection, value.installed) : [];
            })
          : value.entries;
      const results = entries
        .filter((item) =>
          `${item.selector} ${item.name} ${item.description}`.toLowerCase().includes(query),
        )
        .slice(0, request.limit)
        .map((item, index) => ({
          kind: "skill" as const,
          rank: index + 1,
          selector: item.selector,
          name: item.name,
          description: item.description,
        }));
      return { value: { query: request.query, results }, diagnostics: value.workspace.diagnostics };
    },
  };
}
