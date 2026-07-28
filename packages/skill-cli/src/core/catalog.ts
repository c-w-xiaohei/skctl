import type {
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
    async list(request): Promise<OperationResult<import("./api").AgentProjection>> {
      const value = await records(factory);
      if (value.unavailable)
        return {
          value: { status: "unavailable", reason: value.unavailable, catalog: [] },
          diagnostics: value.workspace.diagnostics,
        };
      const effective = value.workspace.value.effective;
      if (effective.status !== "complete")
        throw new SkillCliError("INTERNAL", "Catalog is unavailable");
      const requested = request.collection;
      if (requested && !value.reachable.has(requested))
        throw new SkillCliError("SKILL_NOT_FOUND", "Collection is not exposed");
      const collections = requested ? [requested] : value.rootCollections;
      const collectionViews = collections.map((id) =>
        effective.collectionsView.find((collection) => collection.id === id),
      );
      if (collectionViews.some((collection) => !collection))
        throw new SkillCliError("SKILL_NOT_FOUND", "Collection is not exposed");
      const catalog = collectionViews.flatMap((collection) =>
        collection!.members.flatMap((member) => {
          const installed = value.workspace.value.installedSkills.find(
            (skill) =>
              skill.address.source === member.address.source &&
              skill.address.path === member.address.path &&
              skill.owner.health === "healthy",
          );
          return installed
            ? [
                {
                  selector: `${collection!.id}:${member.name}`,
                  name: installed.name,
                  description: installed.description,
                  aliases: [],
                },
              ]
            : [];
        }),
      );
      const references = collectionViews.flatMap((collection) =>
        collection!.references.map(({ name, description, collection: target }) => ({
          name,
          description,
          collection: target,
        })),
      );
      return {
        value: { status: "available", mode: "managed", catalog, references },
        diagnostics: value.workspace.diagnostics,
      };
    },
    async search(request): Promise<OperationResult<SearchSkillsResult>> {
      if (!request.query.trim())
        throw new SkillCliError("INVALID_ARGUMENT", "Invalid search request");
      const value = await records(factory);
      if (value.unavailable) throw new SkillCliError("CONFIG_INVALID", value.unavailable);
      const query = request.query.toLowerCase();
      const results = value.entries
        .filter((item) =>
          `${item.selector} ${item.name} ${item.description}`.toLowerCase().includes(query),
        )
        .slice(0, request.limit)
        .map((item, index) => ({
          rank: index + 1,
          selector: item.selector,
          name: item.name,
          description: item.description,
        }));
      return { value: { query: request.query, results }, diagnostics: value.workspace.diagnostics };
    },
  };
}
