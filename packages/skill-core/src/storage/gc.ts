import type { OperationOptions, OperationResult } from "../shared";

import { SkctlError } from "../shared";

import { StateCoordinator } from "./state";

export async function gc(operation?: OperationOptions): Promise<OperationResult<void>> {
  if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Operation cancelled");
  await new StateCoordinator().gc();
  return { value: undefined, diagnostics: [] };
}
