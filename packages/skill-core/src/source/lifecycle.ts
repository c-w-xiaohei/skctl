import { openRemote, snapshotCandidates } from "./acquisition";

import { join } from "node:path";

import type { CoreFactoryOptions } from "../shared";
import type { SourcesCapability } from "./types";

import { SkillCliError } from "../shared";
import { assertDeclarationOwner } from "../config/write";

import { discoverLocalSkills } from "./discovery";

import { capturedWorkspace, readWorkspace } from "../workspace/capture";
import { removeDirectSource } from "./remove";
import { StateCoordinator } from "../storage/state";
import { resolveGitRef } from "./git";

import { type RemoteSnapshot } from "./snapshot";
import { createSourceOperation } from "./network";
import { assertOwner } from "../installed/update";
import { sourceFor, type Candidate } from "./roots";

export function createSources(options: CoreFactoryOptions) {
  const coordinator = new StateCoordinator();
  const previewSourceRemoval: SourcesCapability["previewRemoval"] = async (request, operation) => {
    const workspace = await readWorkspace({ ...options, signal: operation?.signal });
    if (workspace.value.effective.status !== "complete")
      throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
    const binding = capturedWorkspace(workspace.value)?.sources.get(request.source);
    if (!binding)
      throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${request.source}`);
    if (binding.contribution)
      throw new SkillCliError("INVALID_ARGUMENT", "Config Source contributions are immutable");
    if (request.level && binding.provenance.level !== request.level)
      throw new SkillCliError("SOURCE_NOT_FOUND", "Source is not declared at requested scope");
    assertDeclarationOwner(
      binding.provenance as import("../config/types").ConfigDeclarationOwner,
      request.expectedOwner,
    );
    const installed = workspace.value.installedSkills
      .filter((item) => item.address.source === request.source)
      .map((item) => item.address);
    return {
      value: {
        kind: "source-removal",
        source: request.source,
        owner: binding.provenance as import("../config/types").ConfigDeclarationOwner,
        installed,
        repairs: installed.map((address) => ({
          address,
          actions: ["rebind", "uninstall"] as const,
        })),
        blockers: installed.map((address) => ({ reason: "installed" as const, address })),
        allowed: !installed.length,
      },
      diagnostics: workspace.diagnostics,
    };
  };
  const removeSource: SourcesCapability["remove"] = async (request, operation) => {
    if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    await removeDirectSource(
      { ...options, signal: operation?.signal },
      request.source,
      request.level,
      request.expectedOwner,
    );
    return { value: undefined, diagnostics: [] };
  };
  const discover: SourcesCapability["discover"] = async (request, operation) => {
    if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    const { binding, network: policy } = await sourceFor(
      options,
      request.source,
      operation?.signal,
    );
    await coordinator.withLock(async () => assertOwner(await coordinator.read(), binding));
    let exactRevision: string | undefined;
    let available: Candidate[];
    if (binding.kind === "local") {
      const result = await discoverLocalSkills(join(binding.origin, binding.root));
      available = result.skills.map((skill) => ({
        path: skill.relativeRoot,
        name: skill.name,
        description: skill.description,
        root: skill.root,
      }));
    } else {
      const network = createSourceOperation({
        ...policy,
        source: binding.id,
        signal: operation?.signal,
      });
      let snapshot: RemoteSnapshot | undefined;
      try {
        exactRevision = await resolveGitRef(
          binding.origin,
          binding.ref!,
          network.signal,
          options.sourceTransport,
          network,
        );
        snapshot = await openRemote(binding, options, exactRevision, network);
        available = await snapshotCandidates(snapshot, exactRevision, network.signal);
        network.throwIfAborted("discovery completion");
      } finally {
        try {
          await snapshot?.close();
        } finally {
          network.dispose();
        }
      }
    }
    return {
      value: {
        source: binding.id,
        kind: binding.kind,
        ...(exactRevision ? { exactRevision } : {}),
        candidates: available.map(({ path, name, description }) => ({ path, name, description })),
      },
      diagnostics: [],
    };
  };

  return { discover, previewRemoval: previewSourceRemoval, remove: removeSource };
}
