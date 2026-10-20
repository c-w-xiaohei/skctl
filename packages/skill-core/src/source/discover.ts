import type { CoreOptions, OperationOptions, OperationResult } from "../shared";
import { SkctlError } from "../shared";
import { captureInstalled, revalidateInstalled } from "../installed/context";
import { discoverSource } from "./service";
import type { DiscoveryObservation } from "./types";

export async function discoverSkills(
  options: CoreOptions,
  request: { readonly source: string },
  operation?: OperationOptions,
): Promise<OperationResult<DiscoveryObservation>> {
  const captured = await captureInstalled(options, request.source, operation);
  const result = await discoverSource({
    binding: captured.binding,
    ...captured.network,
    transport: options.sourceTransport,
    githubApiBaseUrl: options.githubApiBaseUrl,
    signal: operation?.signal,
  });
  await revalidateInstalled(options, captured, operation);
  if (result.version?.refreshError)
    throw new SkctlError("PROVIDER_UNAVAILABLE", result.version.refreshError);
  return {
    value: {
      source: request.source,
      kind: captured.binding.kind,
      exactRevision: result.version?.commit,
      candidates: result.candidates,
    },
    diagnostics: [...captured.diagnostics, ...result.diagnostics],
  };
}
