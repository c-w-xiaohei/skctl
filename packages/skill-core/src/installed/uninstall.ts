import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../shared";
import { validateSkillPaths } from "../source/service";
import { StateCoordinator } from "../storage/state";
import { migrateLegacyInstalled, readWorkspaceUnlocked } from "../workspace/capture";
import type { InstalledSelection, UninstallImpact } from "./types";
import type { WorkspaceView } from "../workspace/types";

function impact(workspace: WorkspaceView, request: InstalledSelection): UninstallImpact {
  if (workspace.effective.status !== "complete")
    throw new SkctlError("CONFIG_INVALID", "Configuration is incomplete");
  validateSkillPaths(request.paths);
  const selected = workspace.installedSkills.filter(
    (item) => item.address.source === request.source && request.paths.includes(item.address.path),
  );
  if (!request.paths.length || selected.length !== request.paths.length)
    throw new SkctlError("SKILL_NOT_FOUND", "Installed Skill not found");
  const directMemberships = selected.flatMap((item) =>
    item.collections.flatMap(({ paths }) =>
      paths.flatMap((path) => (path.kind === "direct" && path.owner ? [path.owner] : [])),
    ),
  );
  return {
    kind: "uninstall",
    installed: selected.map((item) => item.address),
    directMemberships,
    disappearingSelectors: selected.flatMap((item) =>
      item.collections
        .filter((collection) => item.selectors.includes(`${collection.id}:${collection.entry}`))
        .map((collection) => ({
          selector: `${collection.id}:${collection.entry}`,
          address: item.address,
          paths: collection.paths,
        })),
    ),
    retainedSelectors: [],
    blockers: directMemberships.map((owner) => ({ reason: "membership", owner })),
    allowed: !directMemberships.length,
  };
}

export async function previewUninstall(
  options: CoreOptions,
  request: InstalledSelection,
  operation?: OperationOptions,
): Promise<OperationResult<UninstallImpact>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    if (operation?.signal?.aborted)
      throw new SkctlError("CANCELLED", "Uninstall preview cancelled");
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    return { value: impact(workspace.value, request), diagnostics: workspace.diagnostics };
  });
}

export async function uninstallSkills(
  options: CoreOptions,
  request: InstalledSelection,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(async () => {
    const workspace = await readWorkspaceUnlocked(
      { ...options, signal: operation?.signal },
      coordinator,
    );
    if (!impact(workspace.value, request).allowed)
      throw new SkctlError("CONFIG_CONFLICT", "Installed Skill has direct Membership dependencies");
    const state = await coordinator.read(),
      installed = await migrateLegacyInstalled(options, coordinator, state);
    if (operation?.signal?.aborted) throw new SkctlError("CANCELLED", "Uninstall cancelled");
    await coordinator.write(
      {
        installed: installed.filter(
          (item) => item.source !== request.source || !request.paths.includes(item.path),
        ),
        configs: state.configs,
      },
      state.generation,
    );
    return { value: undefined, diagnostics: workspace.diagnostics };
  });
}
