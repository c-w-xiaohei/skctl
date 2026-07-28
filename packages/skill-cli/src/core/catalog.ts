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
  return {
    workspace,
    entries: agent.catalog,
    unavailable:
      agent.status === "unavailable"
        ? (agent.reasons[0]?.message ?? "Catalog unavailable")
        : undefined,
  };
}
export function createCatalog(factory: CoreFactoryOptions): CatalogCapability {
  return {
    async list(): Promise<OperationResult<import("./api").AgentProjection>> {
      const value = await records(factory);
      return {
        value: value.unavailable
          ? { status: "unavailable", reason: value.unavailable, catalog: [] }
          : { status: "available", mode: "managed", catalog: value.entries },
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
          `${item.selector} ${item.aliases.join(" ")} ${item.name} ${item.description}`
            .toLowerCase()
            .includes(query),
        )
        .slice(0, request.limit)
        .map((item, index) => ({
          rank: index + 1,
          selector: item.selector,
          name: item.name,
          description: item.description,
          provenance: item.provenance,
        }));
      return { value: { query: request.query, results }, diagnostics: value.workspace.diagnostics };
    },
  };
}
