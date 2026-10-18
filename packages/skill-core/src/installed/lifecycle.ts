import type { DiscoveredSkillCandidate } from "../source/types";
import type { InstallRequest } from "./types";
import type { RebindImpact } from "./types";
import type { RebindRequest } from "./types";
import type { UninstallImpact } from "./types";
import type { InstalledSelection } from "./types";
import type { OperationResult } from "../shared";
import type { OperationOptions } from "../shared";
import { openRemote } from "../source/acquisition";
import { sourceFor, validPaths, localRoot } from "../source/roots";
import { assertOwner, installedForMutation, invokePublicationHook } from "./update";
import { resolveEffectiveCollections } from "../collection/resolve";
import { readWorkspaceUnlocked } from "../workspace/capture";
import { createSourceOperation } from "../source/network";
import { skillAddressKey } from "../collection/graph";

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { CoreOptions } from "../shared";

import { SkillCliError } from "../shared";

import { capturedWorkspace, readWorkspace } from "../workspace/capture";
import { StateCoordinator } from "../storage/state";
import type { InstalledMaterialization } from "../storage/schema";

import { parseResourcePath } from "../content/path";
import { type GitTreeIdentity } from "../source/schema";
import { type SourceSnapshot, type RemoteSnapshot } from "../source/snapshot";

import { metadata, type Candidate } from "../source/roots";
import type { InternalSourceBinding } from "../source/identity";

async function remoteCandidate(
  snapshot: RemoteSnapshot,
  path: string,
  tree: GitTreeIdentity,
  signal?: AbortSignal,
): Promise<Candidate | undefined> {
  const content = await snapshot.read([path, "SKILL.md"].filter(Boolean).join("/"), signal);
  const parsed = metadata(content.bytes);
  return parsed && { path, ...parsed, root: "", revision: snapshot.commit, tree };
}

async function copyRemoteRoot(
  snapshot: SourceSnapshot,
  prefix: string,
  destination: string,
  signal?: AbortSignal,
) {
  const entries = await Array.fromAsync(snapshot.list(prefix, signal));
  const contents = snapshot.readMany
    ? new Map(
        (
          await snapshot.readMany(
            entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
            signal,
          )
        ).map((item) => [item.entry.path, item]),
      )
    : undefined;
  for (const entry of entries) {
    if (entry.kind === "directory") continue;
    if (entry.kind !== "file")
      throw new SkillCliError(
        "PROVIDER_INTEGRITY_FAILED",
        "Remote Skill Root contains an unsafe entry",
      );
    if (prefix && !entry.path.startsWith(`${prefix}/`))
      throw new SkillCliError("PROVIDER_INTEGRITY_FAILED", "Remote entry escapes selected Root");
    const relative = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
    parseResourcePath(relative);
    const target = join(destination, ...relative.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    const content = contents?.get(entry.path) ?? (await snapshot.read(entry.path, signal));
    await writeFile(target, content.bytes, { mode: entry.executable ? 0o700 : 0o600 });
    if (entry.executable) await chmod(target, 0o700);
  }
}

async function materializeRemoteRoots(
  snapshot: SourceSnapshot,
  selected: readonly Candidate[],
  signal?: AbortSignal,
) {
  const stage = await mkdtemp(join(tmpdir(), "skill-cli-install-"));
  try {
    const roots: Candidate[] = [];
    for (const candidate of selected) {
      const root = join(stage, candidate.path || "root");
      await mkdir(root, { recursive: true });
      await copyRemoteRoot(snapshot, candidate.path, root, signal);
      const parsed = metadata(await readFile(join(root, "SKILL.md")));
      if (!parsed || parsed.name !== candidate.name || parsed.description !== candidate.description)
        throw new SkillCliError(
          "PROVIDER_INTEGRITY_FAILED",
          "Materialized metadata differs from selected Root",
        );
      roots.push({ ...candidate, root });
    }
    return { stage, roots };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

function identity(binding: InternalSourceBinding, path: string) {
  return `${binding.origin}\0${[binding.root, path].filter(Boolean).join("/")}`;
}

/** Pure proof only: callers retain their independent read/lock scopes. */
function rebindProof(
  item: InstalledMaterialization,
  previous: InternalSourceBinding | undefined,
  owner: InternalSourceBinding | undefined,
  root: string,
) {
  if (!owner || (!previous && item.identityEvidence?.status === "unavailable")) return "unprovable";
  const proven = previous
    ? previous.bindingDigest === item.bindingDigest &&
      previous.origin === owner.origin &&
      [previous.root, item.path].filter(Boolean).join("/") === root
    : item.identityEvidence?.status === "known" &&
      item.identityEvidence.canonicalOrigin === owner.origin &&
      item.identityEvidence.originRelativeSkillRoot === root;
  return proven ? "proven" : "distinct";
}

export async function previewUninstall(
  options: CoreOptions,
  request: InstalledSelection,
  operation?: OperationOptions,
): Promise<OperationResult<UninstallImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const selected = workspace.value.installedSkills.filter(
    (item) => item.address.source === request.source && request.paths.includes(item.address.path),
  );
  if (
    selected.length !== request.paths.length ||
    new Set(request.paths).size !== request.paths.length
  )
    throw new SkillCliError("SKILL_NOT_FOUND", "Installed Skill was not found");
  const directMemberships = selected.flatMap((item) =>
    item.collections.flatMap(({ paths }) =>
      paths.flatMap((path) => (path.kind === "direct" && path.owner ? [path.owner] : [])),
    ),
  );
  const disappearingSelectors = selected.flatMap((item) =>
    item.collections
      .filter((collection) => item.selectors.includes(`${collection.id}:${collection.entry}`))
      .map((collection) => ({
        selector: `${collection.id}:${collection.entry}`,
        address: item.address,
        paths: collection.paths,
      })),
  );
  return {
    value: {
      kind: "uninstall",
      installed: selected.map((item) => item.address),
      directMemberships,
      disappearingSelectors,
      retainedSelectors: [],
      blockers: directMemberships.map((owner) => ({ reason: "membership" as const, owner })),
      allowed: !directMemberships.length,
    },
    diagnostics: workspace.diagnostics,
  };
}

export async function previewRebind(
  options: CoreOptions,
  request: RebindRequest,
  operation?: OperationOptions,
): Promise<OperationResult<RebindImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  const state = capturedWorkspace(workspace.value)?.state;
  const item = state?.installed.find(
    (candidate) => candidate.source === request.source && candidate.path === request.path,
  );
  if (!item) throw new SkillCliError("SKILL_NOT_FOUND", "Installed Skill was not found");
  const owner = capturedWorkspace(workspace.value)?.sources.get(request.owner);
  const previous = capturedWorkspace(workspace.value)?.sources.get(request.source);
  const ownerPath = request.ownerPath ?? item.path;
  const root = owner ? [owner.root, ownerPath].filter(Boolean).join("/") : "";
  const proof = rebindProof(item, previous, owner, root);
  return {
    value: {
      kind: "rebind",
      address: { source: request.source, path: request.path },
      owner: request.owner,
      ownerPath,
      proof,
      allowed: proof === "proven",
    },
    diagnostics: workspace.diagnostics,
  };
}

export async function installSkills(
  options: CoreOptions,
  request: InstallRequest,
  operation?: OperationOptions,
): Promise<OperationResult<readonly DiscoveredSkillCandidate[]>> {
  const coordinator = new StateCoordinator();

  if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  const { binding, network: policy } = await sourceFor(options, request.source, operation?.signal);
  if (binding.kind === "local" && request.exactRevision)
    throw new SkillCliError("INVALID_ARGUMENT", "Local Source does not accept a revision");
  if (
    binding.kind !== "local" &&
    (!request.exactRevision || !/^[a-f0-9]{40}$/u.test(request.exactRevision))
  )
    throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires an exact revision");
  validPaths(request.paths);
  if (!request.paths.length) throw new SkillCliError("SKILL_NOT_FOUND", "No selected Skill Roots");
  let materialized: Candidate[];
  let remote: Awaited<ReturnType<typeof materializeRemoteRoots>> | undefined;
  const digestByPath = new Map<string, string>();
  try {
    const selected: Candidate[] = [];
    if (binding.kind === "local") {
      for (const path of request.paths) {
        const root = await localRoot(binding, path, coordinator);
        if (root.status !== "present")
          throw new SkillCliError("SKILL_NOT_FOUND", "Selected Skill Root is unavailable");
        selected.push(root.candidate);
        digestByPath.set(path, root.digest);
      }
      materialized = selected;
    } else {
      const network = createSourceOperation({
        ...policy,
        source: binding.id,
        signal: operation?.signal,
      });
      let snapshot: RemoteSnapshot | undefined;
      try {
        snapshot = await openRemote(binding, options, request.exactRevision!, network);
        for (const result of await snapshot.inspectRoots(request.paths, network.signal)) {
          const candidate =
            result.status === "present" && result.tree
              ? await remoteCandidate(snapshot, result.path, result.tree, network.signal)
              : undefined;
          if (!candidate)
            throw new SkillCliError("SKILL_NOT_FOUND", "Selected Skill Root is unavailable");
          selected.push(candidate);
        }
        remote = await materializeRemoteRoots(snapshot, selected, network.signal);
        materialized = remote.roots;
        network.throwIfAborted("install preparation");
      } finally {
        try {
          await snapshot?.close();
        } finally {
          network.dispose();
        }
      }
    }
    for (const candidate of materialized) {
      const digest = await coordinator.snapshotDigest(candidate.root);
      if (binding.kind === "local" && digest !== digestByPath.get(candidate.path))
        throw new SkillCliError(
          "TRANSACTION_CONFLICT",
          "Local Root changed during install preparation",
        );
      if (binding.kind !== "local") digestByPath.set(candidate.path, digest);
    }
    await invokePublicationHook();
    if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    await coordinator.withLock(async () => {
      let currentBinding: InternalSourceBinding;
      try {
        ({ binding: currentBinding } = await sourceFor(options, request.source, operation?.signal));
      } catch (error) {
        if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
          throw new SkillCliError("CONFIG_CONFLICT", "Source binding disappeared during install");
        throw error;
      }
      if (currentBinding.bindingDigest !== binding.bindingDigest)
        throw new SkillCliError("CONFIG_CONFLICT", "Source binding changed during install");
      const state = await coordinator.read();
      const installed = await installedForMutation(options, coordinator, state);
      assertOwner(state, currentBinding);
      const workspace = await readWorkspaceUnlocked(options, coordinator);
      if (workspace.value.effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      const additionsIdentity = new Set(
        materialized.map((candidate) => identity(binding, candidate.path)),
      );
      for (const item of installed) {
        const owner = capturedWorkspace(workspace.value)?.sources.get(item.source);
        if (!owner || !additionsIdentity.has(identity(owner, item.path))) continue;
        if (item.source !== binding.id)
          throw new SkillCliError(
            "CONFIG_CONFLICT",
            "Installed Skill identity already belongs to another Source",
          );
      }
      const retained = installed.filter(
        (item) =>
          !materialized.some(
            (candidate) => item.source === binding.id && item.path === candidate.path,
          ),
      );
      const additions = materialized.map(
        (candidate): InstalledMaterialization => ({
          source: binding.id,
          path: candidate.path,
          name: candidate.name,
          description: candidate.description,
          digest: digestByPath.get(candidate.path)!,
          bindingDigest: binding.bindingDigest,
          identityEvidence: {
            status: "known",
            canonicalOrigin: binding.origin,
            originRelativeSkillRoot: [binding.root, candidate.path].filter(Boolean).join("/"),
          },
          ...(binding.kind === "local"
            ? { kind: "local", root: resolve(candidate.root) }
            : {
                kind: "remote",
                name:
                  installed.find(
                    (item) => item.source === binding.id && item.path === candidate.path,
                  )?.name ?? candidate.name,
                adoptedRevision: candidate.revision!,
                treeIdentity: candidate.tree!,
              }),
        }),
      );
      const next: InstalledMaterialization[] = [...retained, ...additions];
      await resolveEffectiveCollections(
        options,
        workspace.value,
        { ...state, installed: next },
        coordinator,
      );
      if (binding.kind === "local")
        for (const candidate of materialized) {
          const root = await localRoot(currentBinding, candidate.path, coordinator);
          if (
            root.status !== "present" ||
            root.digest !== digestByPath.get(candidate.path) ||
            root.candidate.name !== candidate.name ||
            root.candidate.description !== candidate.description
          )
            throw new SkillCliError("TRANSACTION_CONFLICT", "Local Root changed during install");
        }
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      if (remote)
        for (const candidate of materialized)
          await coordinator.publishSnapshot(digestByPath.get(candidate.path)!, candidate.root);
      await coordinator.write({ installed: next, configs: state.configs }, state.generation);
    });
  } finally {
    if (remote) await rm(remote.stage, { recursive: true, force: true });
  }
  return {
    value: materialized.map(({ tree: _tree, ...candidate }) => candidate),
    diagnostics: [],
  };
}

export async function uninstallSkills(
  options: CoreOptions,
  request: InstalledSelection,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();

  if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  await coordinator.withLock(async () => {
    const state = await coordinator.read();
    const installed = await installedForMutation(options, coordinator, state);
    const selected = installed.filter(
      (item) => item.source === request.source && request.paths.includes(item.path),
    );
    if (
      selected.length !== request.paths.length ||
      new Set(request.paths).size !== request.paths.length
    )
      throw new SkillCliError("SKILL_NOT_FOUND", "Installed Skill was not found");
    const workspace = await readWorkspaceUnlocked(options, coordinator);
    const selectedAddresses = new Set(selected.map((item) => skillAddressKey(item)));
    const blockers = workspace.value.installedSkills.flatMap((item) =>
      selectedAddresses.has(skillAddressKey(item.address))
        ? item.collections.flatMap(({ paths }) =>
            paths.flatMap((path) => (path.kind === "direct" && path.owner ? [path.owner] : [])),
          )
        : [],
    );
    if (blockers.length)
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skill has direct Membership dependencies",
      );
    await coordinator.write(
      {
        installed: installed.filter((item) => !selected.includes(item)),
        configs: state.configs,
      },
      state.generation,
    );
  });
  return { value: undefined, diagnostics: [] };
}

export async function rebindSkill(
  options: CoreOptions,
  request: RebindRequest,
  operation?: OperationOptions,
): Promise<OperationResult<void>> {
  const coordinator = new StateCoordinator();

  if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  const { binding: owner } = await sourceFor(options, request.owner);
  await invokePublicationHook();
  await coordinator.withLock(async () => {
    const { binding: currentOwner } = await sourceFor(options, request.owner).catch((error) => {
      if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
        throw new SkillCliError("CONFIG_CONFLICT", "Source binding disappeared during rebind");
      throw error;
    });
    if (currentOwner.bindingDigest !== owner.bindingDigest)
      throw new SkillCliError("CONFIG_CONFLICT", "Source binding changed during rebind");
    const state = await coordinator.read();
    const installed = await installedForMutation(options, coordinator, state);
    const item = installed.find(
      (candidate) => candidate.source === request.source && candidate.path === request.path,
    );
    if (!item) throw new SkillCliError("SKILL_NOT_FOUND", "Installed Skill was not found");
    const ownerPath = request.ownerPath ?? item.path;
    const previousInput = await sourceFor(options, request.source).catch((error) => {
      if (
        error instanceof SkillCliError &&
        (error.code === "SOURCE_NOT_FOUND" || error.code === "CONFIG_CONFLICT")
      )
        return undefined;
      throw error;
    });
    const currentPrevious = previousInput?.binding;
    const newRoot = [currentOwner.root, ownerPath].filter(Boolean).join("/");
    const proof = rebindProof(item, currentPrevious, currentOwner, newRoot);
    if (proof === "unprovable")
      throw new SkillCliError(
        "REBIND_UNPROVABLE",
        "Rebind cannot prove an Installed Skill identity",
      );
    if (proof !== "proven")
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Rebind does not preserve Installed Skill identity",
      );
    await coordinator.write(
      {
        installed: installed.map((candidate) =>
          candidate === item
            ? {
                ...candidate,
                source: currentOwner.id,
                path: ownerPath,
                bindingDigest: currentOwner.bindingDigest,
                identityEvidence: {
                  status: "known",
                  canonicalOrigin: currentOwner.origin,
                  originRelativeSkillRoot: newRoot,
                },
              }
            : candidate,
        ),
        configs: state.configs,
      },
      state.generation,
    );
  });
  return { value: undefined, diagnostics: [] };
}
