import type { CoreFactoryOptions } from "../shared";

import type { SourceBindingView } from "./types";
import { SkillCliError } from "../shared";

import {
  discoverSnapshotSkills,
  openSource,
  type SourceSnapshot,
  type RemoteSnapshot,
} from "./snapshot";
import { type SourceOperation } from "./network";

export async function snapshotCandidates(
  snapshot: SourceSnapshot,
  revision: string,
  signal?: AbortSignal,
) {
  const result = await discoverSnapshotSkills(snapshot, signal);
  return result.skills.map((skill) => ({
    ...skill,
    path: skill.root,
    revision,
  }));
}

export async function openRemote(
  binding: SourceBindingView,
  options: CoreFactoryOptions,
  revision: string,
  operation: SourceOperation,
): Promise<RemoteSnapshot> {
  const snapshot = await openSource(
    binding.id,
    {
      origin: "git",
      kind: binding.kind === "github" ? "github" : "git",
      url: binding.origin,
      commit: revision,
      path: binding.root,
    },
    {
      source: binding.id,
      origin: "git",
      declaration: binding.provenance,
      stability: "immutable",
      revision,
    },
    operation.signal,
    options.sourceTransport,
    options.githubApiBaseUrl,
    operation,
  );
  if (snapshot.kind !== "remote") {
    await snapshot.close();
    throw new SkillCliError("INTERNAL", "Expected Remote acquisition");
  }
  return snapshot;
}
