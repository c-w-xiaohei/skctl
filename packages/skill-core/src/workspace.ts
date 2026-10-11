import type { CoreFactoryOptions, OperationOptions, OperationResult, WorkspaceView } from "./api";
import { readWorkspace } from "./internal/config";
import { SkillCliError } from "./api";
export async function getWorkspace(
  factory: CoreFactoryOptions,
  options?: OperationOptions,
): Promise<OperationResult<WorkspaceView>> {
  if (options?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  return readWorkspace({ ...factory, signal: options?.signal });
}
