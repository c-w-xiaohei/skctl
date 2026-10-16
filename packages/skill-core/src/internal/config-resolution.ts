import { dirname, join } from "node:path";
import type { WorkspaceView } from "../api";
import { resolveCollections, type CollectionContribution, type SkillAddress } from "../collections";
import { SkillCliError, canonicalLocalOrigin, parseQualifiedName } from "./domain";
import { StateCoordinator, type PrivateState } from "./state";
import { document, validatorFor, invalidConfig, type ConfigDocument } from "./config-document";
import { configInputs, type ReadWorkspaceOptions } from "./config-inputs";
import { cachedConfig, contributedCollection, installedCollectionInputs } from "./config-bindings";
import { capturedWorkspace, readWorkspaceUnlocked } from "./config-workspace";

export async function resolveInstalledSelector(
  options: ReadWorkspaceOptions,
  selector: string,
  coordinator = new StateCoordinator(),
): Promise<{
  readonly address: SkillAddress;
  readonly item: PrivateState["installed"][number];
}> {
  const [collection, name, extra] = selector.split(":");
  if (!collection || !name || extra)
    throw new SkillCliError("INVALID_ARGUMENT", "Invalid Skill Selector");
  const workspace = await readWorkspaceUnlocked(options);
  const effective = workspace.value.effective;
  if (effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  if (!effective.managed)
    throw new SkillCliError("CONFIG_INVALID", "agents.opencode must be managed");
  if (effective.agent.status !== "available")
    throw new SkillCliError(
      "CONFIG_INVALID",
      effective.agent.reasons[0]?.message ?? "Catalog unavailable",
    );
  const state = await coordinator.read();
  const resolved = await resolveEffectiveCollections(options, workspace.value, state, coordinator);
  const reachable = new Set<string>();
  const pending = [...effective.use];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const reference of Object.values(resolved.references.get(id) ?? {}))
      pending.push(reference.collection);
  }
  if (!reachable.has(collection))
    throw new SkillCliError("SKILL_NOT_FOUND", `Skill Selector is not exposed: ${selector}`);
  const address = resolved.members.get(collection)?.get(name);
  if (!address)
    throw new SkillCliError("SKILL_NOT_FOUND", `Installed Skill not found: ${selector}`);
  const item = state.installed.find(
    (candidate) => candidate.source === address.source && candidate.path === address.path,
  );
  if (!item) throw new SkillCliError("SKILL_NOT_FOUND", `Installed Skill not found: ${selector}`);
  const owner = capturedWorkspace(workspace.value)?.sources.get(item.source);
  if (!owner || owner.bindingDigest !== item.bindingDigest)
    throw new SkillCliError("CONFIG_CONFLICT", "Installed Skill owner is not healthy");
  return { address, item };
}
export async function resolveEffectiveCollections(
  options: ReadWorkspaceOptions,
  workspace: WorkspaceView,
  state: PrivateState,
  coordinator: StateCoordinator,
  override?: { readonly file: string; readonly value: ConfigDocument },
) {
  const declarations: CollectionContribution[] = [];
  const files = configInputs(
    options,
    workspace.project.resolution === "global-only" ? undefined : workspace.project.root,
  );
  for (const { level, file } of files) {
    let host: ConfigDocument;
    if (override?.file === file) {
      host = override.value;
      if (!validatorFor(level)(host)) throw invalidConfig(file, "Invalid declaration override");
    } else {
      host = await document(file, level);
    }
    for (const [id, declaration] of Object.entries(host.collections ?? {})) {
      declarations.push({
        kind: "declared",
        id,
        declaration,
        owner: { level, file, pointer: `/collections/${id}` },
      });
    }
    for (const [configId, binding] of Object.entries(host.configSources ?? {})) {
      const reusable =
        binding.kind === "local"
          ? await document(
              join(canonicalLocalOrigin(binding.path, dirname(file)), binding.root, "config.jsonc"),
              "reusable",
            )
          : state.configs[configId]
            ? await cachedConfig(configId, state, coordinator)
            : undefined;
      if (!reusable) continue;
      for (const [id, value] of Object.entries(reusable.collections ?? {})) {
        const namespaced = `${configId}/${parseQualifiedName(id)}`;
        declarations.push({
          kind: "declared",
          id: namespaced,
          declaration: contributedCollection(configId, value),
          owner: { level, file, pointer: `/configSources/${configId}/collections/${id}` },
        });
      }
    }
  }
  if (workspace.effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  return resolveCollections(
    declarations,
    installedCollectionInputs(state, capturedWorkspace(workspace)?.sources ?? new Map()),
  );
}
