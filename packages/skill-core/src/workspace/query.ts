import type { CoreOptions } from "../shared";
import type { OperationOptions, OperationResult } from "../shared";
import type { WorkspaceView } from "./types";
import { readWorkspace } from "./capture";
import { SkctlError } from "../shared";
export async function getWorkspace(
  factory: CoreOptions,
  options?: OperationOptions,
): Promise<OperationResult<WorkspaceView>> {
  if (options?.signal?.aborted) throw new SkctlError("CANCELLED", "Operation cancelled");
  return readWorkspace({ ...factory, signal: options?.signal });
}
