import type { CoreFactoryOptions } from "../shared";
import type { OperationOptions, OperationResult } from "../shared";
import type { WorkspaceView } from "./types";
import { readWorkspace } from "./capture";
import { SkillCliError } from "../shared";
export async function getWorkspace(
  factory: CoreFactoryOptions,
  options?: OperationOptions,
): Promise<OperationResult<WorkspaceView>> {
  if (options?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  return readWorkspace({ ...factory, signal: options?.signal });
}
