import type {
  AgentBrowseProjection,
  AgentCatalogItem,
  CatalogCapability,
  CoreFactoryOptions,
  OperationResult,
  SearchSkillsResult,
} from "./api";
import { SkillCliError } from "./api";
import { readWorkspace } from "./internal/config";

async function records(factory: CoreFactoryOptions) {
  const workspace = await readWorkspace(factory);
  const agent = workspace.value.effective.agent;
  const effective = workspace.value.effective;
  const rootCollections = effective.status === "complete" ? effective.use : [];
  const reachable = new Set<string>();
  const pending = [...rootCollections];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const collection =
      effective.status === "complete"
        ? effective.collectionsView.find((candidate) => candidate.id === id)
        : undefined;
    for (const reference of collection?.references ?? []) pending.push(reference.collection);
  }
  return {
    workspace,
    entries: agent.catalog,
    rootCollections,
    reachable,
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
      const effective = value.workspace.value.effective;
      if (effective.status !== "complete")
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
              const collection = effective.collectionsView.find((candidate) => candidate.id === id);
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
      const collection = effective.collectionsView.find(
        (collection) => collection.id === requested,
      );
      if (!collection) throw new SkillCliError("SKILL_NOT_FOUND", "Collection is not exposed");
      const items: AgentCatalogItem[] = collection.members.flatMap((member) => {
        const installed = value.workspace.value.installedSkills.find(
          (skill) =>
            skill.address.source === member.address.source &&
            skill.address.path === member.address.path &&
            skill.owner.health === "healthy",
        );
        return installed
          ? [
              {
                kind: "skill" as const,
                selector: `${collection.id}:${member.name}`,
                name: installed.name,
                description: installed.description,
              },
            ]
          : [];
      });
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
      const effective = value.workspace.value.effective;
      const collectionIds = request.collection ? [request.collection] : value.rootCollections;
      const entries =
        effective.status === "complete"
          ? collectionIds.flatMap((id) => {
              const collection = effective.collectionsView.find((candidate) => candidate.id === id);
              return (
                collection?.members.flatMap((member) => {
                  const installed = value.workspace.value.installedSkills.find(
                    (skill) =>
                      skill.address.source === member.address.source &&
                      skill.address.path === member.address.path &&
                      skill.owner.health === "healthy",
                  );
                  return installed
                    ? [
                        {
                          selector: `${collection.id}:${member.name}`,
                          name: installed.name,
                          description: installed.description,
                        },
                      ]
                    : [];
                }) ?? []
              );
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
