import { SkillCliError, type OperationOptions } from "../shared";
import { type ConfigLevel } from "../config/types";
import { type CoreFactoryOptions } from "../shared";
import type { SetUseRequest, UseCollectionRequest } from "./types";
import { resolveCollectionUse } from "./graph";
import { writeConfig } from "../config/write";
import { readWorkspaceUnlocked } from "../workspace/capture";
import { resolveEffectiveCollections } from "./resolve";

function editUse(
  options: CoreFactoryOptions,
  level: ConfigLevel,
  transform: (before: readonly string[]) => readonly string[],
  operation?: OperationOptions,
) {
  return writeConfig(
    options,
    level,
    async (edit) => {
      const before = [...(edit.document().use ?? [])];
      const after = [...transform(before)];
      if (new Set(after).size !== after.length)
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Collection Use cannot contain duplicate Collection IDs",
        );
      const workspace = await readWorkspaceUnlocked(edit.workspaceOptions, edit.coordinator);
      const effective = workspace.value.effective;
      if (effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      if (after.some((id) => !effective.collectionsView.some((collection) => collection.id === id)))
        throw new SkillCliError("CONFIG_CONFLICT", "Collection Use is incomplete");
      edit.set(["use"], after);
      const resolved = await resolveEffectiveCollections(
        options,
        workspace.value,
        await edit.coordinator.read(),
        edit.coordinator,
        { file: edit.file, value: edit.proposed() },
      );
      if (after.length && !resolveCollectionUse(resolved, after).complete)
        throw new SkillCliError("CONFIG_CONFLICT", "Collection Use is incomplete");
      return { use: { before, after } };
    },
    operation,
  );
}
export function setUse(
  options: CoreFactoryOptions,
  request: SetUseRequest,
  operation?: OperationOptions,
) {
  return editUse(options, request.level, () => request.collections, operation);
}
export function addUse(
  options: CoreFactoryOptions,
  request: UseCollectionRequest,
  operation?: OperationOptions,
) {
  return editUse(
    options,
    request.level,
    (before) => (before.includes(request.collection) ? before : [...before, request.collection]),
    operation,
  );
}
export function removeUse(
  options: CoreFactoryOptions,
  request: UseCollectionRequest,
  operation?: OperationOptions,
) {
  return editUse(
    options,
    request.level,
    (before) => before.filter((collection) => collection !== request.collection),
    operation,
  );
}
