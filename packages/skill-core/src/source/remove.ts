import { assertDeclarationOwner } from "../config/write";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import type { ConfigDeclarationOwner, ConfigLevel } from "../config/types";

import { SkillCliError } from "../shared";

import { parseQualifiedName } from "../collection/names";
import { StateCoordinator } from "../storage/state";
import { decodeConfig, edit, validatorFor } from "../config/document";

import { configFile, resolveProjectRoot, type ReadWorkspaceOptions } from "../config/inputs";

import { capturedWorkspace, readWorkspaceUnlocked } from "../workspace/capture";

export async function removeDirectSource(
  options: ReadWorkspaceOptions,
  id: string,
  level?: ConfigLevel,
  expectedOwner?: ConfigDeclarationOwner,
): Promise<void> {
  const coordinator = new StateCoordinator();
  await coordinator.withLock(async () => {
    let owner: ConfigDeclarationOwner;
    let original: string;
    if (!level) {
      const workspace = await readWorkspaceUnlocked(options, coordinator);
      if (workspace.value.effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      const source = capturedWorkspace(workspace.value)?.sources.get(id);
      if (!source) throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${id}`);
      if (source.contribution)
        throw new SkillCliError("INVALID_ARGUMENT", "Config Source contributions are immutable");
      owner = source.provenance as ConfigDeclarationOwner;
      assertDeclarationOwner(owner, expectedOwner);
      const state = await coordinator.read();
      if (state.installed.some((item) => item.source === id))
        throw new SkillCliError("CONFIG_CONFLICT", "Installed Skills still belong to this Source");
      original = decodeConfig(await readFile(owner.file), owner.file);
    } else {
      parseQualifiedName(id);
      const project =
        level === "global" && !options.project
          ? { root: resolve(options.cwd) }
          : await resolveProjectRoot(options.cwd, options.project, options.signal);
      const file = configFile(options, level, project.root);
      owner = { level, file, pointer: `/sources/${id}` };
      assertDeclarationOwner(owner, expectedOwner);
      original = decodeConfig(await readFile(file), file);
      if (!parse(original, [], { allowTrailingComma: true }).sources?.[id])
        throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${id}`);
      const state = await coordinator.read();
      if (state.installed.some((item) => item.source === id))
        throw new SkillCliError("CONFIG_CONFLICT", "Installed Skills still belong to this Source");
    }
    const next = edit(original, ["sources", id], undefined);
    if (!validatorFor(owner.level)(parse(next, [], { allowTrailingComma: true })))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    await coordinator.publish([{ target: owner.file, bytes: next }]);
  });
}
