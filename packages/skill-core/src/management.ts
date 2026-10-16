import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type {
  CoreFactoryOptions,
  ConfigSourceContributionImpact,
  ConfigSourceImpact,
  ManagementCapability,
  OperationResult,
  SourceBindingView,
} from "./api";
import { SkillCliError } from "./api";
import { skillAddressKey } from "./collections";
import { discoverLocalSkills } from "./internal/domain";
import { bindingDigest, canonicalLocalOrigin, canonicalRemoteOrigin } from "./internal/domain";
import {
  declaredConfigSource,
  configSourceDependencies,
  contributedSourceBindings,
  capturedWorkspace,
  forgetConfigSource,
  readWorkspaceUnlocked,
  removeDirectSource,
  readWorkspace,
  readUserNetwork,
  resolveEffectiveCollections,
  validateConfigBytes,
} from "./internal/config";
import { StateCoordinator, type InstalledMaterialization } from "./internal/state";
import { resolveGitRef } from "./internal/source-git";
import { parseResourcePath, type GitTreeIdentity } from "./internal/domain";
import {
  discoverSnapshotSkills,
  openSource,
  type SourceSnapshot,
  type RemoteSnapshot,
} from "./internal/sources";
import {
  createSourceOperation,
  type SourceOperation,
  type SourceNetwork,
} from "./internal/source-network";
import {
  assertOwner,
  installedForMutation,
  invokePublicationHook,
  localRoot,
  metadata,
  sourceFor,
  validPaths,
  type Candidate,
  type InternalSourceBinding,
} from "./updates";
export {
  setManagementPublicationHookForTest,
  setManagementUpdateCheckHookForTest,
} from "./updates";

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

function contributionImpact(
  id: string,
  binding: Awaited<ReturnType<typeof declaredConfigSource>>["binding"],
  owner: Pick<Awaited<ReturnType<typeof declaredConfigSource>>, "level" | "file">,
  reusable: ReturnType<typeof validateConfigBytes>,
  commit?: string,
): ConfigSourceContributionImpact {
  const sources = contributedSourceBindings(id, binding, owner.file, reusable, owner.level, commit);
  return {
    sources: [...sources.values()]
      .map((source) => ({
        id: source.id,
        owner: {
          level: owner.level,
          file: owner.file,
          pointer: `/sources/${source.id.slice(id.length + 1)}`,
          ...(commit ? { namespace: `${id}@${commit}` } : { namespace: id }),
        },
        binding: {
          kind: source.kind,
          origin: source.origin,
          root: source.root,
          ...(source.ref ? { ref: source.ref } : {}),
        },
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    collections: Object.keys(reusable.collections ?? {})
      .sort()
      .map((name) => ({
        id: `${id}/${name}`,
        owner: {
          level: owner.level,
          file: owner.file,
          pointer: `/collections/${name}`,
          namespace: commit ? `${id}@${commit}` : id,
        },
      })),
  };
}

function emptyDelta(): ConfigSourceImpact["delta"] {
  return {
    addedSources: [],
    changedSources: [],
    removedSources: [],
    addedCollections: [],
    changedCollections: [],
    removedCollections: [],
  };
}
function sameObservation(
  observation: import("./api").ConfigSourceObservation,
  id: string,
  revision: string,
  contributions: ConfigSourceContributionImpact,
) {
  return (
    observation.id === id &&
    observation.exactRevision === revision &&
    JSON.stringify(observation.contributions) === JSON.stringify(contributions)
  );
}

function configBindingFingerprint(declared: Awaited<ReturnType<typeof declaredConfigSource>>) {
  const binding = declared.binding;
  const origin =
    binding.kind === "local"
      ? canonicalLocalOrigin(binding.path, dirname(declared.file))
      : canonicalRemoteOrigin(binding.origin);
  return bindingDigest({
    kind: binding.kind,
    origin,
    root: binding.root,
    ...(binding.kind === "local" ? { path: origin } : { ref: binding.ref }),
  });
}

async function snapshotCandidates(
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

async function openRemote(
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

/**
 * Serialisation is deliberately private to management. Consumers only compare
 * this digest for exact equality and return it to update as an optimistic guard.
 */
export function createManagement(
  options: CoreFactoryOptions,
): Omit<ManagementCapability, "checkUpdate" | "getUpdateBaseline" | "previewUpdate" | "update"> {
  const coordinator = new StateCoordinator();
  const acquireConfig = async (
    id: string,
    declared: Awaited<ReturnType<typeof declaredConfigSource>>,
    exactRevision?: string,
    signal?: AbortSignal,
    policy?: SourceNetwork,
  ) => {
    if (declared.binding.kind === "local")
      throw new SkillCliError("INVALID_ARGUMENT", "Expected Remote Config Source");
    const network = createSourceOperation({
      ...(policy ?? (await readUserNetwork(options, coordinator))),
      source: id,
      signal,
    });
    let snapshot: SourceSnapshot | undefined;
    try {
      const revision =
        exactRevision ??
        (await resolveGitRef(
          declared.binding.origin,
          declared.binding.ref,
          network.signal,
          options.sourceTransport,
          network,
        ));
      snapshot = await openSource(
        id,
        {
          origin: "git",
          kind: declared.binding.kind,
          url: declared.binding.origin,
          commit: revision,
          path: declared.binding.root,
        },
        {
          source: id,
          origin: "git",
          declaration: { level: declared.level, file: declared.file },
          stability: "immutable",
          revision,
        },
        network.signal,
        options.sourceTransport,
        options.githubApiBaseUrl,
        network,
      );
      const bytes = (await snapshot.read("config.jsonc", network.signal)).bytes;
      const reusable = validateConfigBytes(bytes);
      network.throwIfAborted("Config content");
      return { revision, bytes, reusable };
    } finally {
      try {
        await snapshot?.close();
      } finally {
        network.dispose();
      }
    }
  };
  const previewConfigImpact = async (
    kind: ConfigSourceImpact["kind"],
    id: string,
    exactRevision: string | undefined,
    signal?: AbortSignal,
  ): Promise<OperationResult<ConfigSourceImpact>> => {
    const declared = await declaredConfigSource({ ...options, signal }, id);
    const workspace = await readWorkspace({ ...options, signal });
    const source = workspace.value.configs
      .flatMap((config) => config.direct.configSources)
      .find((item) => item.id === id);
    if (!source) throw new SkillCliError("SOURCE_NOT_FOUND", `Config Source not found: ${id}`);
    const state = capturedWorkspace(workspace.value)?.state;
    const currentAppliedCommit = state?.configs[id]?.commit;
    let contributions: ConfigSourceContributionImpact = { sources: [], collections: [] };
    let proposed: ConfigSourceContributionImpact | undefined;
    let currentReusable: ReturnType<typeof validateConfigBytes> | undefined;
    let proposedReusable: ReturnType<typeof validateConfigBytes> | undefined;
    if (state?.configs[id])
      currentReusable = validateConfigBytes(
        await readFile(join(coordinator.root, "configs", state.configs[id].digest, "config.jsonc")),
      );
    if (kind === "config-source-adopt") {
      if (declared.binding.kind === "local")
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Local Config Sources do not accept a revision",
        );
      if (!exactRevision || !/^[a-f0-9]{40}$/u.test(exactRevision))
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Remote Config Source requires an exact revision",
        );
      proposedReusable = (
        await acquireConfig(
          id,
          declared,
          exactRevision,
          signal,
          capturedWorkspace(workspace.value)?.network,
        )
      ).reusable;
      proposed = contributionImpact(
        id,
        declared.binding,
        declared,
        proposedReusable,
        exactRevision,
      );
    }
    if (source.adoption.status !== "not-adopted") {
      contributions = {
        sources: source.contributed.sources.map((item) => ({
          id: item.id,
          owner: item.provenance as import("./api").ConfigDeclarationOwner,
          binding: {
            kind: item.kind,
            origin: item.origin,
            root: item.root,
            ...(item.ref ? { ref: item.ref } : {}),
          },
        })),
        collections: source.contributed.collections,
      };
    }
    const active = proposed ?? contributions;
    let delta = emptyDelta();
    if (kind === "config-source-adopt") {
      const addedSources = active.sources.filter(
        (candidate) => !contributions.sources.some((current) => current.id === candidate.id),
      );
      const changedSources = active.sources.filter((candidate) => {
        const current = contributions.sources.find((item) => item.id === candidate.id);
        return current && JSON.stringify(current.binding) !== JSON.stringify(candidate.binding);
      });
      const removedSources = contributions.sources.filter(
        (current) => !active.sources.some((candidate) => candidate.id === current.id),
      );
      const addedCollections = active.collections.filter(
        (candidate) => !contributions.collections.some((current) => current.id === candidate.id),
      );
      const removedCollections = contributions.collections.filter(
        (current) => !active.collections.some((candidate) => candidate.id === current.id),
      );
      const changedCollections = active.collections.filter((candidate) => {
        const name = candidate.id.slice(id.length + 1);
        return (
          !!currentReusable?.collections?.[name] &&
          !!proposedReusable?.collections?.[name] &&
          JSON.stringify(currentReusable.collections[name]) !==
            JSON.stringify(proposedReusable.collections[name])
        );
      });
      delta = {
        ...delta,
        addedSources,
        changedSources,
        removedSources,
        addedCollections,
        changedCollections,
        removedCollections,
      };
    } else {
      delta = {
        ...delta,
        removedSources: contributions.sources,
        removedCollections: contributions.collections,
      };
    }
    const changedOwners = new Set([
      ...delta.changedSources.map((item) => item.id),
      ...delta.removedSources.map((item) => item.id),
    ]);
    const affectedInstalled = workspace.value.installedSkills
      .filter(
        (item) =>
          item.address.source.startsWith(`${id}/`) &&
          (kind !== "config-source-adopt" || changedOwners.has(item.address.source)),
      )
      .map((item) => item.address);
    const semanticBlockers =
      kind === "config-source-adopt" && proposedReusable && exactRevision
        ? await coordinator.withLock(async () => {
            try {
              const proposedWorkspace = await readWorkspaceUnlocked(options, coordinator, {
                id,
                commit: exactRevision,
                value: proposedReusable!,
              });
              return proposedWorkspace.value.effective.status === "complete"
                ? []
                : [{ reason: "incomplete" as const }];
            } catch {
              return [{ reason: "incomplete" as const }];
            }
          })
        : [];
    const blockers = [
      ...affectedInstalled.map((address) => ({ reason: "installed" as const, address })),
      ...(kind === "config-source-adopt"
        ? configSourceDependencies(workspace.value, id, {
            sources: new Set(delta.removedSources.map((item) => item.id)),
            collections: new Set(delta.removedCollections.map((item) => item.id)),
          })
        : configSourceDependencies(workspace.value, id)),
      ...semanticBlockers,
    ];
    return {
      value: {
        kind,
        id,
        owner: source.owner,
        binding: source.binding,
        ...(currentAppliedCommit ? { currentAppliedCommit } : {}),
        ...(exactRevision ? { exactRevision } : {}),
        declarationRetained: kind !== "config-source-removal",
        contributions: active,
        delta,
        affectedInstalled,
        disappearingSelectors: workspace.value.installedSkills
          .filter((item) =>
            affectedInstalled.some(
              (address) =>
                address.source === item.address.source && address.path === item.address.path,
            ),
          )
          .flatMap((item) => item.selectors),
        blockers,
        allowed: !blockers.length,
      },
      diagnostics: workspace.diagnostics,
    };
  };
  return {
    async previewSourceRemoval(request, operation) {
      const workspace = await readWorkspace({ ...options, signal: operation?.signal });
      if (workspace.value.effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      const binding = capturedWorkspace(workspace.value)?.sources.get(request.source);
      if (!binding)
        throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${request.source}`);
      if (binding.contribution)
        throw new SkillCliError("INVALID_ARGUMENT", "Config Source contributions are immutable");
      const installed = workspace.value.installedSkills
        .filter((item) => item.address.source === request.source)
        .map((item) => item.address);
      return {
        value: {
          kind: "source-removal",
          source: request.source,
          owner: binding.provenance as import("./api").ConfigDeclarationOwner,
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
    },
    async removeSource(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      await removeDirectSource(options, request.source, request.level);
      return { value: undefined, diagnostics: [] };
    },
    async previewUninstall(request, operation) {
      const workspace = await readWorkspace({ ...options, signal: operation?.signal });
      const selected = workspace.value.installedSkills.filter(
        (item) =>
          item.address.source === request.source && request.paths.includes(item.address.path),
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
    },
    async previewRebind(request, operation) {
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
    },
    async previewAdoptConfig(request, operation) {
      const result = await previewConfigImpact(
        "config-source-adopt",
        request.id,
        request.exactRevision,
        operation?.signal,
      );
      if (
        request.observation &&
        !sameObservation(
          request.observation,
          request.id,
          request.exactRevision,
          result.value.contributions,
        )
      )
        throw new SkillCliError(
          "CONFIG_CONFLICT",
          "Config Source observation does not match exact revision",
        );
      return result;
    },
    async previewForgetConfig(request, operation) {
      return previewConfigImpact("config-source-forget", request.id, undefined, operation?.signal);
    },
    async previewRemoveConfig(request, operation) {
      return previewConfigImpact("config-source-removal", request.id, undefined, operation?.signal);
    },
    async gc(operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      await coordinator.gc();
      return { value: undefined, diagnostics: [] };
    },
    async forgetConfig(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      await forgetConfigSource(options, request.id);
      return { value: undefined, diagnostics: [] };
    },
    async adoptConfig(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const declared = await declaredConfigSource(options, request.id);
      if (declared.binding.kind === "local")
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Local Config Sources do not accept a revision",
        );
      if (!request.exactRevision || !/^[a-f0-9]{40}$/u.test(request.exactRevision))
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Remote Config Source requires an exact revision",
        );
      const revision = request.exactRevision;
      const { bytes, reusable } = await acquireConfig(
        request.id,
        declared,
        revision,
        operation?.signal,
      );
      if (
        request.observation &&
        !sameObservation(
          request.observation,
          request.id,
          revision,
          contributionImpact(request.id, declared.binding, declared, reusable, revision),
        )
      )
        throw new SkillCliError(
          "CONFIG_CONFLICT",
          "Config Source observation does not match exact revision",
        );
      await invokePublicationHook();
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      await coordinator.withLock(async () => {
        const current = await declaredConfigSource(options, request.id).catch((error) => {
          if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND") return undefined;
          throw error;
        });
        if (!current || current.file !== declared.file || current.binding.kind === "local")
          throw new SkillCliError("CONFIG_CONFLICT", "Config Source changed during adoption");
        if (configBindingFingerprint(current) !== configBindingFingerprint(declared))
          throw new SkillCliError("CONFIG_CONFLICT", "Config Source changed during adoption");
        const state = await coordinator.read();
        const installed = await installedForMutation(options, coordinator, state);
        const proposed = contributedSourceBindings(
          request.id,
          current.binding,
          current.file,
          reusable,
          current.level,
          revision,
        );
        const currentWorkspace = await readWorkspaceUnlocked(options, coordinator);
        const currentSource = currentWorkspace.value.configs
          .flatMap((config) => config.direct.configSources)
          .find((item) => item.id === request.id);
        const proposedCollections = new Set(
          Object.keys(reusable.collections ?? {}).map((id) => `${request.id}/${id}`),
        );
        const removedSources = new Set(
          (currentSource?.contributed.sources ?? [])
            .map((item) => item.id)
            .filter((id) => !proposed.has(id)),
        );
        const removedCollections = new Set(
          (currentSource?.contributed.collections ?? [])
            .map((item) => item.id)
            .filter((id) => !proposedCollections.has(id)),
        );
        if (
          configSourceDependencies(currentWorkspace.value, request.id, {
            sources: removedSources,
            collections: removedCollections,
          }).length
        )
          throw new SkillCliError(
            "CONFIG_CONFLICT",
            "Config adoption would orphan effective graph dependencies",
          );
        const proposedWorkspace = await readWorkspaceUnlocked(options, coordinator, {
          id: request.id,
          commit: revision,
          value: reusable,
        });
        if (proposedWorkspace.value.effective.status !== "complete")
          throw new SkillCliError("CONFIG_CONFLICT", "Config adoption is incomplete");
        for (const item of installed.filter((item) => item.source.startsWith(`${request.id}/`))) {
          const next = proposed.get(item.source);
          if (!next || next.bindingDigest !== item.bindingDigest)
            throw new SkillCliError(
              "CONFIG_CONFLICT",
              "Config adoption would change an Installed Skill owner",
            );
        }
        if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
        await coordinator.publishRemoteConfig(request.id, revision, bytes, installed);
      });
      return { value: undefined, diagnostics: [] };
    },
    async observeConfig(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const declared = await declaredConfigSource(options, request.id);
      if (declared.binding.kind === "local")
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Local Config Sources do not have an exact revision",
        );
      const { revision: exactRevision, reusable: config } = await acquireConfig(
        request.id,
        declared,
        undefined,
        operation?.signal,
      );
      return {
        value: {
          id: request.id,
          kind: declared.binding.kind,
          exactRevision,
          contributions: contributionImpact(
            request.id,
            declared.binding,
            declared,
            config,
            exactRevision,
          ),
        },
        diagnostics: [],
      };
    },
    async removeConfig(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      // The configuration owner performs the atomic JSONC/state publication; management owns this lifecycle entry point.
      const { removeConfigSource } = await import("./internal/config");
      const declared = await declaredConfigSource(options, request.id, request.level);
      const expected = { file: declared.file, bytes: await readFile(declared.file) };
      await invokePublicationHook();
      try {
        await removeConfigSource(options, request.id, expected, request.level);
      } catch (error) {
        if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
          throw new SkillCliError("CONFIG_CONFLICT", "Config Source changed during removal");
        throw error;
      }
      return { value: undefined, diagnostics: [] };
    },
    async discover(request, operation) {
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
    },
    async install(request, operation): Promise<OperationResult<readonly Candidate[]>> {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const { binding, network: policy } = await sourceFor(
        options,
        request.source,
        operation?.signal,
      );
      if (binding.kind === "local" && request.exactRevision)
        throw new SkillCliError("INVALID_ARGUMENT", "Local Source does not accept a revision");
      if (
        binding.kind !== "local" &&
        (!request.exactRevision || !/^[a-f0-9]{40}$/u.test(request.exactRevision))
      )
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires an exact revision");
      validPaths(request.paths);
      if (!request.paths.length)
        throw new SkillCliError("SKILL_NOT_FOUND", "No selected Skill Roots");
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
            ({ binding: currentBinding } = await sourceFor(
              options,
              request.source,
              operation?.signal,
            ));
          } catch (error) {
            if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
              throw new SkillCliError(
                "CONFIG_CONFLICT",
                "Source binding disappeared during install",
              );
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
                throw new SkillCliError(
                  "TRANSACTION_CONFLICT",
                  "Local Root changed during install",
                );
            }
          if (operation?.signal?.aborted)
            throw new SkillCliError("CANCELLED", "Operation cancelled");
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
    },
    async uninstall(request, operation): Promise<OperationResult<void>> {
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
    },
    async rebind(request, operation): Promise<OperationResult<void>> {
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
    },
  };
}
