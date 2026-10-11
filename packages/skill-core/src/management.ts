import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

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
  migrateLegacyInstalled,
  readWorkspaceUnlocked,
  removeDirectSource,
  readWorkspace,
  validateConfigBytes,
} from "./internal/config";
import { StateCoordinator, type InstalledMaterialization } from "./internal/state";
import { discoverSnapshotSkills, openSource, type SourceSnapshot } from "./internal/sources";
import { resolveGitRef } from "./internal/source-git";

type Candidate = {
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly root: string;
  readonly revision?: string;
};
type InternalSourceBinding = SourceBindingView & { readonly bindingDigest: string };

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

let publicationHook: (() => void | Promise<void>) | undefined;
/** Test-only acquisition/publication seam; it is not part of the public Core API. */
export function setManagementPublicationHookForTest(next?: () => void | Promise<void>) {
  publicationHook = next;
}

async function sourceFor(
  options: CoreFactoryOptions,
  source: string,
  signal?: AbortSignal,
): Promise<InternalSourceBinding> {
  const workspace = await readWorkspace({ ...options, signal });
  if (workspace.value.effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  const binding = capturedWorkspace(workspace.value)?.sources.get(source);
  if (!binding) {
    const coordinator = new StateCoordinator();
    const state = await coordinator.withLock(() => coordinator.read());
    if (state.installed.some((item) => item.source === source))
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skill owner has disappeared from declarations",
      );
    throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${source}`);
  }
  return binding;
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

async function candidates(
  binding: SourceBindingView,
  options: CoreFactoryOptions,
  signal?: AbortSignal,
  exactRevision?: string,
): Promise<Candidate[]> {
  if (binding.kind === "local") {
    const result = await discoverLocalSkills(join(binding.origin, binding.root));
    return result.skills.map((skill) => ({
      path: skill.relativeRoot,
      name: skill.name,
      description: skill.description,
      root: skill.root,
    }));
  }
  const revision =
    exactRevision ??
    (await resolveGitRef(binding.origin, binding.ref!, signal, options.sourceTransport));
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
    signal,
    options.sourceTransport,
    options.githubApiBaseUrl,
  );
  try {
    return await snapshotCandidates(snapshot, revision, signal);
  } finally {
    await snapshot.close();
  }
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
    const relative = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
    if (!relative || relative.startsWith("../")) continue;
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
      roots.push({ ...candidate, root });
    }
    return { stage, roots };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function remoteRoots(
  binding: SourceBindingView,
  selected: readonly Candidate[],
  options: CoreFactoryOptions,
  signal?: AbortSignal,
) {
  const revision = selected[0]?.revision;
  if (!revision) throw new SkillCliError("INTERNAL", "Remote revision is unavailable");
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
    signal,
    options.sourceTransport,
    options.githubApiBaseUrl,
  );
  try {
    return await materializeRemoteRoots(snapshot, selected, signal);
  } finally {
    await snapshot.close();
  }
}

function assertOwner(
  state: Awaited<ReturnType<StateCoordinator["read"]>>,
  binding: InternalSourceBinding,
) {
  if (
    state.installed.some(
      (item) => item.source === binding.id && item.bindingDigest !== binding.bindingDigest,
    )
  )
    throw new SkillCliError("CONFIG_CONFLICT", "Installed Skill owner binding has drifted");
}
function identity(binding: InternalSourceBinding, path: string) {
  return `${binding.origin}\0${[binding.root, path].filter(Boolean).join("/")}`;
}
function repository(binding: SourceBindingView) {
  if (binding.kind === "local") return undefined;
  try {
    const url = new URL(binding.origin);
    const parts = url.pathname
      .replace(/^\//u, "")
      .replace(/\.git$/u, "")
      .split("/");
    return url.hostname === "github.com" && parts.length === 2 && parts.every(Boolean)
      ? `${parts[0]!}/${parts[1]!}`
      : undefined;
  } catch {
    return undefined;
  }
}
async function installedForMutation(
  options: CoreFactoryOptions,
  coordinator: StateCoordinator,
  state: Awaited<ReturnType<StateCoordinator["read"]>>,
) {
  return state.version === 1
    ? migrateLegacyInstalled(options, coordinator, state)
    : state.installed;
}

export function createManagement(options: CoreFactoryOptions): ManagementCapability {
  const coordinator = new StateCoordinator();
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
      const snapshot = await openSource(
        id,
        {
          origin: "git",
          kind: declared.binding.kind === "github" ? "github" : "git",
          url: declared.binding.origin,
          commit: exactRevision,
          path: declared.binding.root,
        },
        {
          source: id,
          origin: "git",
          declaration: { level: declared.level, file: declared.file },
          stability: "immutable",
          revision: exactRevision,
        },
        signal,
        options.sourceTransport,
        options.githubApiBaseUrl,
      );
      try {
        proposedReusable = validateConfigBytes((await snapshot.read("config.jsonc", signal)).bytes);
        proposed = contributionImpact(
          id,
          declared.binding,
          declared,
          proposedReusable,
          exactRevision,
        );
      } finally {
        await snapshot.close();
      }
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
      const proof = !owner
        ? "unprovable"
        : previous
          ? previous.bindingDigest === item.bindingDigest &&
            previous.origin === owner.origin &&
            [previous.root, item.path].filter(Boolean).join("/") === root
            ? "proven"
            : "distinct"
          : item.identityEvidence?.status === "known" &&
              item.identityEvidence.canonicalOrigin === owner.origin &&
              item.identityEvidence.originRelativeSkillRoot === root
            ? "proven"
            : item.identityEvidence?.status === "unavailable"
              ? "unprovable"
              : "distinct";
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
      const snapshot = await openSource(
        request.id,
        {
          origin: "git",
          kind: declared.binding.kind === "github" ? "github" : "git",
          url: declared.binding.origin,
          commit: revision,
          path: declared.binding.root,
        },
        {
          source: request.id,
          origin: "git",
          declaration: { level: declared.level, file: declared.file },
          stability: "immutable",
          revision,
        },
        operation?.signal,
        options.sourceTransport,
        options.githubApiBaseUrl,
      );
      try {
        const bytes = (await snapshot.read("config.jsonc", operation?.signal)).bytes;
        const reusable = validateConfigBytes(bytes);
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
        await publicationHook?.();
        if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
        await coordinator.withLock(async () => {
          const current = await declaredConfigSource(options, request.id).catch((error) => {
            if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
              return undefined;
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
          await coordinator.publishRemoteConfig(request.id, revision, bytes, installed);
        });
      } finally {
        await snapshot.close();
      }
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
      const exactRevision = await resolveGitRef(
        declared.binding.origin,
        declared.binding.ref,
        operation?.signal,
        options.sourceTransport,
      );
      const snapshot = await openSource(
        request.id,
        {
          origin: "git",
          kind: declared.binding.kind === "github" ? "github" : "git",
          url: declared.binding.origin,
          commit: exactRevision,
          path: declared.binding.root,
        },
        {
          source: request.id,
          origin: "git",
          declaration: { level: declared.level, file: declared.file },
          stability: "immutable",
          revision: exactRevision,
        },
        operation?.signal,
        options.sourceTransport,
        options.githubApiBaseUrl,
      );
      try {
        const config = validateConfigBytes(
          (await snapshot.read("config.jsonc", operation?.signal)).bytes,
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
      } finally {
        await snapshot.close();
      }
    },
    async removeConfig(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      // The configuration owner performs the atomic JSONC/state publication; management owns this lifecycle entry point.
      const { removeConfigSource } = await import("./internal/config");
      const declared = await declaredConfigSource(options, request.id, request.level);
      const expected = { file: declared.file, bytes: await readFile(declared.file) };
      await publicationHook?.();
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
      const binding = await sourceFor(options, request.source, operation?.signal);
      await coordinator.withLock(async () => assertOwner(await coordinator.read(), binding));
      const exactRevision =
        binding.kind === "local"
          ? undefined
          : await resolveGitRef(
              binding.origin,
              binding.ref!,
              operation?.signal,
              options.sourceTransport,
            );
      const available = await candidates(binding, options, operation?.signal, exactRevision);
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
      const binding = await sourceFor(options, request.source, operation?.signal);
      if (binding.kind === "local" && request.exactRevision)
        throw new SkillCliError("INVALID_ARGUMENT", "Local Source does not accept a revision");
      if (
        binding.kind !== "local" &&
        (!request.exactRevision || !/^[a-f0-9]{40}$/u.test(request.exactRevision))
      )
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires an exact revision");
      const snapshot =
        binding.kind === "local"
          ? undefined
          : await openSource(
              binding.id,
              {
                origin: "git",
                kind: binding.kind === "github" ? "github" : "git",
                url: binding.origin,
                commit: request.exactRevision!,
                path: binding.root,
              },
              {
                source: binding.id,
                origin: "git",
                declaration: binding.provenance,
                stability: "immutable",
                revision: request.exactRevision!,
              },
              operation?.signal,
              options.sourceTransport,
              options.githubApiBaseUrl,
            );
      let materialized: Candidate[];
      let remote: Awaited<ReturnType<typeof materializeRemoteRoots>> | undefined;
      try {
        const available = snapshot
          ? await snapshotCandidates(snapshot, request.exactRevision!, operation?.signal)
          : await candidates(binding, options, operation?.signal, request.exactRevision);
        const selected = request.paths.map((path) =>
          available.find((candidate) => candidate.path === path),
        );
        if (!request.paths.length || selected.some((candidate) => !candidate))
          throw new SkillCliError("SKILL_NOT_FOUND", "Selected Skill Root was not discovered");
        if (new Set(request.paths).size !== request.paths.length)
          throw new SkillCliError("INVALID_ARGUMENT", "Selected Skill Roots must be unique");
        materialized = selected as Candidate[];
        remote = snapshot
          ? await materializeRemoteRoots(snapshot, materialized, operation?.signal)
          : undefined;
        if (remote) materialized = remote.roots;
      } finally {
        await snapshot?.close();
      }
      const digests = await Promise.all(
        materialized.map(
          async (candidate) =>
            [candidate.path, await coordinator.snapshotDigest(candidate.root)] as const,
        ),
      );
      const digestByPath = new Map(digests);
      try {
        await publicationHook?.();
        if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
        await coordinator.withLock(async () => {
          let currentBinding: InternalSourceBinding;
          try {
            currentBinding = await sourceFor(options, request.source, operation?.signal);
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
          const additionsIdentity = new Set(
            materialized.map((candidate) => identity(binding, candidate.path)),
          );
          for (const item of installed) {
            const workspace = (await readWorkspace({ ...options, signal: operation?.signal }))
              .value;
            if (workspace.effective.status !== "complete")
              throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
            const owner = capturedWorkspace(workspace)?.sources.get(item.source);
            if (!owner || !additionsIdentity.has(identity(owner, item.path))) continue;
            if (item.source !== binding.id)
              throw new SkillCliError(
                "CONFIG_CONFLICT",
                "Installed Skill identity already belongs to another Source",
              );
          }
          const derived = repository(binding);
          if (derived) {
            const names = new Set<string>();
            for (const candidate of materialized) {
              if (names.has(candidate.name))
                throw new SkillCliError("DUPLICATE_SKILL_NAME", "Duplicate repository Skill name");
              names.add(candidate.name);
            }
            for (const item of installed) {
              const workspace = (await readWorkspace({ ...options, signal: operation?.signal }))
                .value;
              if (workspace.effective.status !== "complete")
                throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
              const owner = capturedWorkspace(workspace)?.sources.get(item.source);
              if (
                owner &&
                repository(owner) === derived &&
                item.source !== binding.id &&
                names.has(item.name)
              )
                throw new SkillCliError(
                  "DUPLICATE_SKILL_NAME",
                  "Repository Skill name already exists",
                );
            }
          }
          const retained = installed.filter(
            (item) =>
              !materialized.some(
                (candidate) => item.source === binding.id && item.path === candidate.path,
              ),
          );
          const additions: InstalledMaterialization[] = materialized.map((candidate) =>
            binding.kind === "local"
              ? {
                  source: binding.id,
                  path: candidate.path,
                  root: resolve(candidate.root),
                  name: candidate.name,
                  description: candidate.description,
                  kind: "local",
                  digest: digestByPath.get(candidate.path)!,
                  bindingDigest: binding.bindingDigest,
                  identityEvidence: {
                    status: "known",
                    canonicalOrigin: binding.origin,
                    originRelativeSkillRoot: [binding.root, candidate.path]
                      .filter(Boolean)
                      .join("/"),
                  },
                }
              : {
                  source: binding.id,
                  path: candidate.path,
                  name: candidate.name,
                  description: candidate.description,
                  kind: "remote",
                  digest: digestByPath.get(candidate.path)!,
                  bindingDigest: binding.bindingDigest,
                  adoptedRevision: candidate.revision!,
                  identityEvidence: {
                    status: "known",
                    canonicalOrigin: binding.origin,
                    originRelativeSkillRoot: [binding.root, candidate.path]
                      .filter(Boolean)
                      .join("/"),
                  },
                },
          );
          const next: InstalledMaterialization[] = [...retained, ...additions];
          if (remote)
            for (const candidate of materialized)
              await coordinator.publishSnapshot(digestByPath.get(candidate.path)!, candidate.root);
          await coordinator.write({ installed: next, configs: state.configs }, state.generation);
        });
      } finally {
        if (remote) await rm(remote.stage, { recursive: true, force: true });
      }
      return { value: materialized, diagnostics: [] };
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
      const owner = await sourceFor(options, request.owner);
      await publicationHook?.();
      await coordinator.withLock(async () => {
        const currentOwner = await sourceFor(options, request.owner).catch((error) => {
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
        const currentPrevious = await sourceFor(options, request.source).catch((error) => {
          if (
            error instanceof SkillCliError &&
            (error.code === "SOURCE_NOT_FOUND" || error.code === "CONFIG_CONFLICT")
          )
            return undefined;
          throw error;
        });
        const newRoot = [currentOwner.root, ownerPath].filter(Boolean).join("/");
        if (!currentPrevious && item.identityEvidence?.status === "unavailable")
          throw new SkillCliError(
            "REBIND_UNPROVABLE",
            "Rebind cannot prove an Installed Skill identity",
          );
        const proven = currentPrevious
          ? currentPrevious.bindingDigest === item.bindingDigest &&
            currentPrevious.origin === currentOwner.origin &&
            [currentPrevious.root, item.path].filter(Boolean).join("/") === newRoot
          : item.identityEvidence?.status === "known" &&
            item.identityEvidence.canonicalOrigin === currentOwner.origin &&
            item.identityEvidence.originRelativeSkillRoot === newRoot;
        if (!proven)
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
    async checkUpdate(request, operation) {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const binding = await sourceFor(options, request.source, operation?.signal);
      const exactRevision =
        binding.kind === "local"
          ? undefined
          : await resolveGitRef(
              binding.origin,
              binding.ref!,
              operation?.signal,
              options.sourceTransport,
            );
      const available = await candidates(binding, options, operation?.signal, exactRevision);
      const state = await coordinator.withLock(() => coordinator.read());
      assertOwner(state, binding);
      const current = state.installed.filter((item) => item.source === binding.id);
      const byPath = new Map(available.map((candidate) => [candidate.path, candidate]));
      const changed: string[] = [];
      const remote =
        binding.kind === "local"
          ? undefined
          : await remoteRoots(binding, available, options, operation?.signal);
      const roots = remote?.roots ?? available;
      try {
        const rootsByPath = new Map(roots.map((candidate) => [candidate.path, candidate]));
        for (const item of current) {
          const candidate = rootsByPath.get(item.path);
          if (candidate && (await coordinator.snapshotDigest(candidate.root)) !== item.digest)
            changed.push(item.path);
        }
      } finally {
        if (remote) await rm(remote.stage, { recursive: true, force: true });
      }
      return {
        value: {
          source: binding.id,
          kind: binding.kind,
          ...(exactRevision ? { exactRevision } : {}),
          changed: available
            .filter((candidate) => changed.includes(candidate.path))
            .map(({ path, name, description }) => ({ path, name, description })),
          added: available
            .filter((candidate) => !current.some((item) => item.path === candidate.path))
            .map(({ path, name, description }) => ({ path, name, description })),
          removed: current
            .filter((item) => !byPath.has(item.path))
            .map(({ path, name, description }) => ({ path, name, description }))
            .sort((left, right) => left.path.localeCompare(right.path)),
          unchanged: current
            .filter((item) => byPath.has(item.path) && !changed.includes(item.path))
            .map((item) => {
              const candidate = byPath.get(item.path)!;
              return {
                path: candidate.path,
                name: candidate.name,
                description: candidate.description,
              };
            })
            .sort((left, right) => left.path.localeCompare(right.path)),
        },
        diagnostics: [],
      };
    },
    async update(request, operation): Promise<OperationResult<void>> {
      if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
      const binding = await sourceFor(options, request.source, operation?.signal);
      if (binding.kind === "local" && request.exactRevision)
        throw new SkillCliError("INVALID_ARGUMENT", "Local Source does not accept a revision");
      if (
        binding.kind !== "local" &&
        (!request.exactRevision || !/^[a-f0-9]{40}$/u.test(request.exactRevision))
      )
        throw new SkillCliError("INVALID_ARGUMENT", "Remote Source requires an exact revision");
      const available = await candidates(
        binding,
        options,
        operation?.signal,
        request.exactRevision,
      );
      const byPath = new Map(available.map((candidate) => [candidate.path, candidate]));
      const state = await coordinator.withLock(() => coordinator.read());
      assertOwner(state, binding);
      const installed = state.installed.filter((item) => item.source === binding.id);
      const remote =
        binding.kind === "local"
          ? undefined
          : await remoteRoots(binding, available, options, operation?.signal);
      const roots = remote?.roots ?? available;
      const rootsByPath = new Map(roots.map((candidate) => [candidate.path, candidate]));
      const changed = new Map<string, string>();
      try {
        for (const item of installed) {
          const candidate = rootsByPath.get(item.path);
          if (candidate) {
            const digest = await coordinator.snapshotDigest(candidate.root);
            if (digest !== item.digest) changed.set(item.path, digest);
          }
        }
        const remove = request.remove ?? [];
        const removed = installed.filter((item) => !byPath.has(item.path)).map((item) => item.path);
        if (
          (!request.paths.length && !remove.length) ||
          new Set(request.paths).size !== request.paths.length ||
          new Set(remove).size !== remove.length ||
          request.paths.some((path) => !changed.has(path)) ||
          remove.some((path) => !removed.includes(path))
        )
          throw new SkillCliError(
            "INVALID_ARGUMENT",
            "Updates must explicitly select changed Installed Skills",
          );
        await publicationHook?.();
        if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
        await coordinator.withLock(async () => {
          const currentBinding = await sourceFor(options, request.source, operation?.signal).catch(
            (error) => {
              if (error instanceof SkillCliError && error.code === "SOURCE_NOT_FOUND")
                throw new SkillCliError(
                  "CONFIG_CONFLICT",
                  "Source binding disappeared during update",
                );
              throw error;
            },
          );
          if (currentBinding.bindingDigest !== binding.bindingDigest)
            throw new SkillCliError("CONFIG_CONFLICT", "Source binding changed during update");
          const current = await coordinator.read();
          const installed = await installedForMutation(options, coordinator, current);
          assertOwner(current, currentBinding);
          if (remote)
            for (const path of request.paths) {
              await coordinator.publishSnapshot(changed.get(path)!, rootsByPath.get(path)!.root);
            }
          await coordinator.write(
            {
              installed: installed
                .filter((item) => item.source !== binding.id || !remove.includes(item.path))
                .map((item) =>
                  item.source === binding.id &&
                  changed.has(item.path) &&
                  request.paths.includes(item.path)
                    ? {
                        ...item,
                        name: rootsByPath.get(item.path)!.name,
                        description: rootsByPath.get(item.path)!.description,
                        digest: changed.get(item.path)!,
                        ...(item.kind === "remote"
                          ? { adoptedRevision: rootsByPath.get(item.path)!.revision! }
                          : {}),
                      }
                    : item,
                ),
              configs: current.configs,
            },
            current.generation,
          );
        });
      } catch (error) {
        if (remote)
          for (const path of request.paths) {
            const digest = changed.get(path);
            if (digest) await coordinator.discardUnreferencedSnapshot(digest);
          }
        throw error;
      } finally {
        if (remote) await rm(remote.stage, { recursive: true, force: true });
      }
      return { value: undefined, diagnostics: [] };
    },
  };
}
