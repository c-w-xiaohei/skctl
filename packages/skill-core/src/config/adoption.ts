import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import type { ConfigDeclarationOwner, ConfigLevel } from "./types";
import type { ImpactBlocker } from "../collection/types";

import type { WorkspaceView } from "../workspace/types";

import { SkillCliError } from "../shared";

import { parseQualifiedName } from "../collection/names";
import { StateCoordinator } from "../storage/state";
import { decodeConfig, document, edit, validatorFor } from "./document";
import type { SourceBinding } from "../source/schema";
import { configInputs, resolveProjectRoot, type ReadWorkspaceOptions } from "./inputs";

import { migrateLegacyInstalled, readWorkspaceUnlocked } from "../workspace/capture";

export interface DeclaredConfigSource extends Pick<ConfigDeclarationOwner, "file" | "level"> {
  readonly binding: SourceBinding;
}

export async function declaredConfigSource(
  options: ReadWorkspaceOptions,
  id: string,
  requestedLevel?: ConfigLevel,
) {
  parseQualifiedName(id);
  const project = await resolveProjectRoot(options.cwd, options.project, options.signal);
  let found: DeclaredConfigSource | undefined;
  for (const { level, file } of configInputs(options, project.root)) {
    if (requestedLevel && level !== requestedLevel) continue;
    const binding = (await document(file, level)).configSources?.[id];
    if (!binding) continue;
    if (found)
      throw new SkillCliError("CONFIG_CONFLICT", `Config Source is declared more than once: ${id}`);
    found = { binding, file, level };
  }
  if (!found) throw new SkillCliError("SOURCE_NOT_FOUND", `Config Source not found: ${id}`);
  return found;
}

export async function forgetConfigSource(options: ReadWorkspaceOptions, id: string): Promise<void> {
  const coordinator = new StateCoordinator();
  await coordinator.withLock(async () => {
    await declaredConfigSource(options, id);
    const state = await coordinator.read();
    const installed = await migrateLegacyInstalled(options, coordinator, state);
    if (!state.configs[id])
      throw new SkillCliError("SOURCE_NOT_FOUND", `Config Source is not adopted: ${id}`);
    if (state.installed.some((item) => item.source.startsWith(`${id}/`)))
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skills still belong to this Config Source",
      );
    const workspace = await readWorkspaceUnlocked(options, coordinator);
    const dependencies = configSourceDependencies(workspace.value, id);
    if (dependencies.length)
      throw new SkillCliError("CONFIG_CONFLICT", "Config Source has effective graph dependencies");
    const nextState = {
      version: 3,
      generation: state.generation + 1,
      installed,
      configs: Object.fromEntries(Object.entries(state.configs).filter(([name]) => name !== id)),
    };
    await coordinator.publish(
      [{ target: join(coordinator.root, "state.json"), bytes: `${JSON.stringify(nextState)}\n` }],
      state.generation,
    );
  });
}

export async function removeConfigSource(
  options: ReadWorkspaceOptions,
  id: string,
  expected?: { readonly file: string; readonly bytes: Uint8Array },
  level?: ConfigLevel,
): Promise<void> {
  const coordinator = new StateCoordinator();
  await coordinator.withLock(async () => {
    const declared = await declaredConfigSource(options, id, level);
    if (
      expected &&
      (declared.file !== expected.file ||
        !Buffer.from(await readFile(declared.file)).equals(expected.bytes))
    )
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Config Source declaration changed during removal",
      );
    const state = await coordinator.read();
    const installed = await migrateLegacyInstalled(options, coordinator, state);
    if (state.installed.some((item) => item.source.startsWith(`${id}/`)))
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skills still belong to this Config Source",
      );
    const workspace = await readWorkspaceUnlocked(options, coordinator);
    const dependencies = configSourceDependencies(workspace.value, id);
    if (dependencies.length)
      throw new SkillCliError("CONFIG_CONFLICT", "Config Source has effective graph dependencies");
    const original = decodeConfig(await readFile(declared.file), declared.file);
    const next = edit(original, ["configSources", id], undefined);
    const proposed = parse(next, [], { allowTrailingComma: true });
    if (!validatorFor(declared.level)(proposed))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    await coordinator.publish(
      [
        { target: declared.file, bytes: next },
        {
          target: join(coordinator.root, "state.json"),
          bytes: `${JSON.stringify({
            version: 3,
            generation: state.generation + 1,
            installed,
            configs: Object.fromEntries(
              Object.entries(state.configs).filter(([name]) => name !== id),
            ),
          })}\n`,
        },
      ],
      state.generation,
    );
  });
}

export function configSourceDependencies(
  workspace: WorkspaceView,
  id: string,
  removed?: {
    readonly sources?: ReadonlySet<string>;
    readonly collections?: ReadonlySet<string>;
  },
): readonly ImpactBlocker[] {
  if (workspace.effective.status !== "complete") return [{ reason: "incomplete" }];
  const source = workspace.configs
    .flatMap((config) => config.direct.configSources)
    .find((item) => item.id === id);
  if (!source) return [];
  const sources = removed?.sources ?? new Set(source.contributed.sources.map((item) => item.id));
  const collections =
    removed?.collections ?? new Set(source.contributed.collections.map((item) => item.id));
  const owns = (owner: ConfigDeclarationOwner | undefined) =>
    owner?.contribution?.configSource.pointer === source.owner.pointer &&
    owner.contribution.configSource.file === source.owner.file;
  const blockers: ImpactBlocker[] = [];
  for (const collection of workspace.effective.collectionsView) {
    for (const member of collection.members)
      if (sources.has(member.address.source))
        for (const path of member.paths)
          if (path.kind === "direct" && path.owner && !owns(path.owner))
            blockers.push({ reason: "membership", owner: path.owner });
    for (const reference of collection.references)
      if (collections.has(reference.collection) && !owns(reference.owner))
        blockers.push({ reason: "reference", owner: reference.owner });
    for (const link of collection.links)
      if (collections.has(link.collection) && !owns(link.owner))
        blockers.push({ reason: "link", owner: link.owner });
  }
  for (const config of workspace.configs)
    for (const use of config.direct.collectionUse)
      if (collections.has(use.collection)) blockers.push({ reason: "use", owner: use.owner });
  return blockers;
}
