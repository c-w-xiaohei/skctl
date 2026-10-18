import type { OperationOptions, OperationResult } from "../shared";

import { SkillCliError } from "../shared";

import { StateCoordinator } from "./state";

export async function gc(operation?: OperationOptions): Promise<OperationResult<void>> {
  if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  await new StateCoordinator().gc();
  return { value: undefined, diagnostics: [] };
}
