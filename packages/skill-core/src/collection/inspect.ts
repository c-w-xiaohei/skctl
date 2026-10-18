import { SkillCliError, type OperationOptions, type OperationResult } from "../shared";
import { type ConfigLevel } from "../config/types";
import { type CollectionInspection } from "./types";
import { type CoreOptions } from "../shared";
import { reachableCollections, skillAddressKey } from "./graph";
import { readWorkspace } from "../workspace/capture";

export async function inspectCollection(
  options: CoreOptions,
  request: { readonly collection: string; readonly level?: ConfigLevel },
  operation?: OperationOptions,
): Promise<OperationResult<CollectionInspection>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const effective = workspace.value.effective;
  if (effective.status !== "complete")
    throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${request.collection}`);
  const view = effective.collectionsView.find((item) => item.id === request.collection);
  if (!view)
    throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${request.collection}`);
  const reachable = reachableCollections(effective.collectionsView, effective.use);
  const installed = new Set(
    workspace.value.installedSkills
      .filter((skill) => skill.owner.health === "healthy")
      .map((skill) => skillAddressKey(skill.address)),
  );
  const healthy = view.members.filter((member) => installed.has(skillAddressKey(member.address)));
  const declared = request.level
    ? view.declared.filter((owner) => owner.level === request.level)
    : view.declared;
  const references = request.level
    ? view.references.filter((reference) => reference.owner.level === request.level)
    : view.references;
  const links = request.level
    ? view.links.filter((link) => link.owner.level === request.level)
    : view.links;
  const useRoot = effective.use.includes(view.id);
  return {
    value: {
      id: view.id,
      declared,
      members: view.members,
      references,
      links,
      catalogPreview: {
        skills: healthy.length,
        linkedSkills: healthy.filter(
          (member) =>
            !member.paths.some((path) => path.kind === "direct") &&
            member.paths.some((path) => path.kind === "via-link"),
        ).length,
        collections: references.length,
      },
      disclosure: {
        available: effective.agent.status === "available",
        useRoot,
        referenceReachable: reachable.has(view.id) && !useRoot,
      },
    },
    diagnostics: workspace.diagnostics,
  };
}
