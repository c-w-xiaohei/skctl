import {
  SkctlError,
  type CoreOptions,
  type OperationOptions,
  type OperationResult,
} from "../shared";
import type { SkillAddress } from "../source/schema";
import type { DiscoveredSkillCandidate } from "../source/types";
import {
  compareSource,
  previewSource,
  withPreparedSkills,
  assertRemovedSkills,
  validateSkillPaths,
  type SourceContext,
  type PreparedSkill,
} from "../source/service";
import { StateCoordinator } from "../storage/state";
import {
  captureInstalled,
  preparedMaterializations,
  revalidateInstalled,
  validateInstallation,
  type InstalledContext,
} from "./context";
import type { UpdateObservation, UpdatePreview, UpdateRequest } from "./types";

const candidate = ({
  path,
  name,
  description,
}: DiscoveredSkillCandidate): DiscoveredSkillCandidate => ({ path, name, description });
function context(
  options: CoreOptions,
  captured: InstalledContext,
  operation?: OperationOptions,
): SourceContext {
  return {
    binding: captured.binding,
    ...captured.network,
    transport: options.sourceTransport,
    githubApiBaseUrl: options.githubApiBaseUrl,
    signal: operation?.signal,
  };
}
const evidence = (captured: InstalledContext) =>
  captured.installed.map((item) => ({
    path: item.path,
    digest: item.digest,
    ...(item.kind === "remote"
      ? {
          tree: item.identityEvidence?.status === "known" ? item.treeIdentity : undefined,
          revision: item.adoptedRevision,
        }
      : {}),
  }));

export function checkUpdate(
  options: CoreOptions,
  request: { readonly source: string; readonly observation: "retained" },
  operation?: OperationOptions,
): Promise<OperationResult<UpdateObservation | undefined>>;
export function checkUpdate(
  options: CoreOptions,
  request: { readonly source: string; readonly observation?: "current" },
  operation?: OperationOptions,
): Promise<OperationResult<UpdateObservation>>;
export async function checkUpdate(
  options: CoreOptions,
  request: { readonly source: string; readonly observation?: "current" | "retained" },
  operation?: OperationOptions,
): Promise<OperationResult<UpdateObservation | undefined>> {
  const captured = await captureInstalled(options, request.source, operation);
  const target =
    request.observation === "retained" ? { retained: true as const } : { current: true as const };
  const result = await compareSource(
    context(options, captured, operation),
    evidence(captured),
    target,
  );
  await revalidateInstalled(options, captured, operation);
  if (!result) return { value: undefined, diagnostics: captured.diagnostics };
  const selected = (paths: readonly string[]) =>
    captured.installed
      .filter((item) => paths.includes(item.path))
      .map((item) => ({ ...candidate(item), ...result.metadata.get(item.path) }));
  return {
    value: {
      source: request.source,
      kind: captured.binding.kind,
      baseline: captured.baseline,
      exactRevision: result.version?.commit,
      observedAt: result.version?.observedAt,
      refreshError: result.version?.refreshError,
      changed: selected(result.changed),
      removed: selected(result.removed),
      unchanged: selected(result.unchanged),
      added: [],
    },
    diagnostics: captured.diagnostics,
  };
}

export async function getUpdateBaseline(
  options: CoreOptions,
  request: { readonly source: string },
  operation?: OperationOptions,
): Promise<OperationResult<string>> {
  const captured = await captureInstalled(options, request.source, operation);
  return { value: captured.baseline, diagnostics: captured.diagnostics };
}

export async function previewUpdate(
  options: CoreOptions,
  request: SkillAddress & { readonly exactRevision?: string; readonly expectedBaseline: string },
  operation?: OperationOptions,
): Promise<OperationResult<UpdatePreview>> {
  validateSkillPaths([request.path]);
  const coordinator = new StateCoordinator(),
    captured = await captureInstalled(options, request.source, operation, coordinator);
  if (!request.expectedBaseline || request.expectedBaseline !== captured.baseline)
    throw new SkctlError(
      "TRANSACTION_CONFLICT",
      "Installed comparison changed; check updates again",
    );
  const item = captured.installed.find((item) => item.path === request.path);
  if (!item) throw new SkctlError("SKILL_NOT_FOUND", "Installed Skill not found");
  const address = { source: request.source, path: request.path };
  if (item.kind === "local")
    return {
      value: { address, status: "unavailable", reason: "local-live-content" },
      diagnostics: captured.diagnostics,
    };
  if (!request.exactRevision)
    throw new SkctlError("INVALID_ARGUMENT", "Remote preview requires an exact revision");
  const revision = request.exactRevision;
  return coordinator.withInstalledRoot(address, async (found) => {
    if (found.item.digest !== item.digest)
      throw new SkctlError("TRANSACTION_CONFLICT", "Installed content changed before preview");
    const result = await previewSource(
      context(options, captured, operation),
      item.path,
      revision,
      found.root,
    );
    await revalidateInstalled(options, captured, operation, coordinator);
    return {
      value: {
        address,
        status: "ready",
        installedRevision: item.adoptedRevision,
        targetRevision: revision,
        ...result,
      },
      diagnostics: captured.diagnostics,
    };
  });
}

export async function updateSkills(
  options: CoreOptions,
  request: UpdateRequest,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  validateSkillPaths([...request.paths, ...(request.remove ?? [])]);
  if (!request.paths.length && !request.remove?.length)
    throw new SkctlError("INVALID_ARGUMENT", "Select updates or removals");
  const coordinator = new StateCoordinator(),
    captured = await captureInstalled(options, request.source, operation, coordinator);
  if (request.expectedBaseline !== undefined && request.expectedBaseline !== captured.baseline)
    throw new SkctlError(
      "TRANSACTION_CONFLICT",
      "Installed comparison changed; check updates again",
    );
  const selected = [...request.paths, ...(request.remove ?? [])];
  if (selected.some((path) => !captured.installed.some((item) => item.path === path)))
    throw new SkctlError("SKILL_NOT_FOUND", "Updates require installed Skill Roots");
  const source = context(options, captured, operation);
  if (captured.binding.kind !== "local" && !request.exactRevision)
    throw new SkctlError("INVALID_ARGUMENT", "Remote update requires an exact revision");
  if (captured.binding.kind === "local" && request.exactRevision)
    throw new SkctlError("INVALID_ARGUMENT", "Local Source has no revision");
  await assertRemovedSkills(source, request.remove ?? [], request.exactRevision);
  const publish = async (prepared: readonly PreparedSkill[]) => {
    for (const skill of prepared) {
      const previous = captured.installed.find((item) => item.path === skill.path)!;
      if (previous.kind === "remote" && !previous.treeIdentity)
        await coordinator.withRemoteUse(previous.digest, async () => {});
      const unchanged =
        previous.kind === "remote" && skill.kind === "remote" && previous.treeIdentity
          ? previous.treeIdentity.objectId === skill.tree.objectId
          : previous.digest === skill.digest;
      if (unchanged)
        throw new SkctlError("INVALID_ARGUMENT", "Select only changed Installed Skills");
    }
    return coordinator.withLock(async () => {
      const current = await revalidateInstalled(options, captured, operation, coordinator);
      const additions = preparedMaterializations(current, prepared);
      const installed = await validateInstallation(
        options,
        current,
        additions,
        coordinator,
        request.remove,
      );
      for (const skill of prepared)
        if (current.binding.kind !== "local")
          await coordinator.publishSnapshot(skill.digest, skill.directory);
      // Local baseline includes complete current directory evidence, and is checked again after preparation/publication.
      await revalidateInstalled(options, captured, operation, coordinator);
      if (operation?.signal?.aborted)
        throw new SkctlError("CANCELLED", "Update cancelled before publication");
      await coordinator.write(
        { installed, configs: current.state.configs },
        current.state.generation,
      );
    });
  };
  try {
    if (request.paths.length)
      await withPreparedSkills(source, request.paths, request.exactRevision, publish);
    else await publish([]);
  } catch (error) {
    if (!(error instanceof SkctlError)) throw error;
    const rejected = error.diagnostics.find((item) => item.code === "SOURCE_METADATA_REJECTED");
    if (!rejected) throw error;
    const path = request.paths.find(
      (path) => rejected.location?.file === [path, "SKILL.md"].filter(Boolean).join("/"),
    );
    throw new SkctlError("CONFIG_INVALID", error.message, [
      {
        ...rejected,
        code: "UPDATE_NOT_APPLIED",
        message: "Installed content was kept; update metadata was rejected.",
        suggestion: "Fix the target metadata and recheck updates.",
        ...(path !== undefined
          ? {
              subject: {
                kind: "installed-skill",
                address: { source: request.source, path },
              } as const,
            }
          : {}),
      },
    ]);
  }
  return { value: undefined, diagnostics: captured.diagnostics };
}
