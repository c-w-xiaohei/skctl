import { digestDirectory } from "../content/directory";
import { parseSkillMetadata, decodeStrictText } from "../content/text";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../shared";
import { withPreparedSkills } from "../source/service";
import type { DiscoveredSkillCandidate } from "../source/types";
import { StateCoordinator } from "../storage/state";
import {
  captureInstalled,
  preparedMaterializations,
  revalidateInstalled,
  validateInstallation,
} from "./context";
import type { InstallRequest } from "./types";

export async function installSkills(
  options: CoreOptions,
  request: InstallRequest,
  operation?: OperationOptions,
): Promise<OperationResult<readonly DiscoveredSkillCandidate[]>> {
  const coordinator = new StateCoordinator();
  const captured = await captureInstalled(options, request.source, operation, coordinator);
  return withPreparedSkills(
    {
      binding: captured.binding,
      ...captured.network,
      transport: options.sourceTransport,
      githubApiBaseUrl: options.githubApiBaseUrl,
      signal: operation?.signal,
    },
    request.paths,
    request.exactRevision,
    async (prepared) => {
      await coordinator.withLock(async () => {
        const current = await revalidateInstalled(options, captured, operation, coordinator);
        const additions = preparedMaterializations(current, prepared);
        const installed = await validateInstallation(options, current, additions, coordinator);
        for (const skill of prepared) {
          if (current.binding.kind === "local") {
            const metadata = parseSkillMetadata(
              decodeStrictText(await readFile(join(skill.directory, "SKILL.md"))),
            );
            if (
              (await digestDirectory(skill.directory)) !== skill.digest ||
              metadata.name !== skill.name ||
              metadata.description !== skill.description
            )
              throw new SkctlError(
                "TRANSACTION_CONFLICT",
                "Local content changed during installation",
              );
          } else await coordinator.publishSnapshot(skill.digest, skill.directory);
        }
        if (operation?.signal?.aborted)
          throw new SkctlError("CANCELLED", "Installation cancelled before publication");
        await coordinator.write(
          { installed, configs: current.state.configs },
          current.state.generation,
        );
      });
      return {
        value: prepared.map(({ path, name, description }) => ({ path, name, description })),
        diagnostics: captured.diagnostics,
      };
    },
  );
}
