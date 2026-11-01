import { dirname, join } from "node:path";
import type { WorkspaceView } from "../workspace/types";
import type { DeclarationProvenance } from "../config/types";
import { resolveCollections, type CollectionContribution } from "./graph";
import { type SkillAddress } from "../source/schema";
import { SkctlError } from "../shared";
import { canonicalLocalOrigin } from "../source/identity";
import { parseQualifiedName } from "./names";
import { StateCoordinator } from "../storage/state";
import type { PrivateState, StateContents } from "../storage/schema";
import { document, invalidConfig } from "../config/document";
import { configSchemaFor, type ConfigDocument } from "../config/schema";
import * as v from "valibot";
import { configInputs, type ReadWorkspaceOptions } from "../config/inputs";
import { cachedConfig, contributedCollection, installedCollectionInputs } from "../config/bindings";
import { capturedWorkspace, readWorkspaceUnlocked } from "../workspace/capture";

export async function resolveInstalledSelector(
  options: ReadWorkspaceOptions,
  selector: string,
  coordinator = new StateCoordinator(),
): Promise<{
  readonly address: SkillAddress;
  readonly item: PrivateState["installed"][number];
  readonly declaration: DeclarationProvenance;
}> {
  const [collection, name, extra] = selector.split(":");
  if (!collection || !name || extra)
    throw new SkctlError("INVALID_ARGUMENT", "Invalid Skill Selector");
  const workspace = await readWorkspaceUnlocked(options, coordinator);
  const effective = workspace.value.effective;
  if (effective.status !== "complete")
    throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
  if (effective.agent.status !== "available")
    throw new SkctlError(
      "CONFIG_INVALID",
      effective.agent.reasons[0]?.message ?? "Catalog unavailable",
    );
  const capture = capturedWorkspace(workspace.value)!;
  const state = capture.state;
  const resolved = capture.resolved;
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
    throw new SkctlError("SKILL_NOT_FOUND", `Skill Selector is not exposed: ${selector}`);
  const address = resolved.members.get(collection)?.get(name);
  if (!address) throw new SkctlError("SKILL_NOT_FOUND", `Installed Skill not found: ${selector}`);
  const item = state.installed.find(
    (candidate) => candidate.source === address.source && candidate.path === address.path,
  );
  if (!item) throw new SkctlError("SKILL_NOT_FOUND", `Installed Skill not found: ${selector}`);
  const owner = capturedWorkspace(workspace.value)?.sources.get(item.source);
  if (!owner || owner.bindingDigest !== item.bindingDigest)
    throw new SkctlError("CONFIG_CONFLICT", "Installed Skill owner is not healthy");
  return { address, item, declaration: owner.provenance };
}
export async function resolveEffectiveCollections(
  options: ReadWorkspaceOptions,
  workspace: WorkspaceView,
  state: StateContents,
  coordinator: StateCoordinator,
  override?:
    | { readonly file: string; readonly value: ConfigDocument }
    | readonly { readonly file: string; readonly value: ConfigDocument }[],
) {
  const declarations: CollectionContribution[] = [];
  const files = configInputs(
    options,
    workspace.project.resolution === "global-only" ? undefined : workspace.project.root,
  );
  for (const { level, file } of files) {
    let host: ConfigDocument;
    const replacement = Array.isArray(override)
      ? override.find((item) => item.file === file)
      : (override as { readonly file: string; readonly value: ConfigDocument } | undefined);
    if (replacement?.file === file) {
      host = replacement.value;
      if (!v.is(configSchemaFor(level), host))
        throw invalidConfig(file, "Invalid declaration override");
    } else {
      host = await document(file, level);
    }
    for (const [id, declaration] of Object.entries(host.collections ?? {})) {
      declarations.push({
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
          id: namespaced,
          declaration: contributedCollection(configId, value),
          owner: { level, file, pointer: `/configSources/${configId}/collections/${id}` },
        });
      }
    }
  }
  if (workspace.effective.status !== "complete")
    throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
  return resolveCollections(
    declarations,
    installedCollectionInputs(state, capturedWorkspace(workspace)?.sources ?? new Map()),
  );
}
