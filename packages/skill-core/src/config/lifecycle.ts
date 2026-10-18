import { readFile } from "node:fs/promises";

import { dirname, join } from "node:path";

import type { CoreFactoryOptions } from "../shared";

import type { ConfigSourcesCapability } from "./types";

import type {
  ConfigSourceContributionImpact,
  ConfigSourceImpact,
  ConfigSourceObservation,
  ConfigDeclarationOwner,
} from "./types";
import type { SourceBinding } from "../source/schema";
import type { ReusableConfigDocument } from "./schema";
import type { OperationResult } from "../shared";

import { SkillCliError } from "../shared";

import { bindingDigest, canonicalLocalOrigin, canonicalRemoteOrigin } from "../source/identity";
import {
  declaredConfigSource,
  configSourceDependencies,
  forgetConfigSource,
  type DeclaredConfigSource,
} from "./adoption";
import { contributedSourceBindings } from "./bindings";
import {
  capturedWorkspace,
  readWorkspaceUnlocked,
  readWorkspace,
  readUserNetwork,
} from "../workspace/capture";
import { validateConfigBytes } from "./document";
import { StateCoordinator } from "../storage/state";
import { resolveGitRef } from "../source/git";

import { openSource, type SourceSnapshot } from "../source/snapshot";
import { createSourceOperation, type SourceNetwork } from "../source/network";
import { installedForMutation, invokePublicationHook } from "../installed/update";

function contributionImpact(
  id: string,
  binding: SourceBinding,
  owner: Pick<ConfigDeclarationOwner, "level" | "file">,
  reusable: ReusableConfigDocument,
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

function sameObservation(
  observation: ConfigSourceObservation,
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

function configBindingFingerprint(declared: DeclaredConfigSource) {
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

export function createConfigSources(options: CoreFactoryOptions) {
  const coordinator = new StateCoordinator();
  const acquireConfig = async (
    id: string,
    declared: DeclaredConfigSource,
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
    let currentReusable: ReusableConfigDocument | undefined;
    let proposedReusable: ReusableConfigDocument | undefined;
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
          owner: item.provenance as ConfigDeclarationOwner,
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
    let delta: ConfigSourceImpact["delta"];
    if (kind === "config-source-adopt") {
      const currentSources = new Map(contributions.sources.map((source) => [source.id, source]));
      const nextSourceIds = new Set(active.sources.map((source) => source.id));
      const currentCollectionIds = new Set(
        contributions.collections.map((collection) => collection.id),
      );
      const nextCollectionIds = new Set(active.collections.map((collection) => collection.id));
      const addedSources = active.sources.filter((candidate) => !currentSources.has(candidate.id));
      const changedSources = active.sources.filter((candidate) => {
        const current = currentSources.get(candidate.id);
        return current && JSON.stringify(current.binding) !== JSON.stringify(candidate.binding);
      });
      const removedSources = contributions.sources.filter(
        (current) => !nextSourceIds.has(current.id),
      );
      const addedCollections = active.collections.filter(
        (candidate) => !currentCollectionIds.has(candidate.id),
      );
      const removedCollections = contributions.collections.filter(
        (current) => !nextCollectionIds.has(current.id),
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
        addedSources,
        changedSources,
        removedSources,
        addedCollections,
        changedCollections,
        removedCollections,
      };
    } else {
      delta = {
        addedSources: [],
        changedSources: [],
        removedSources: contributions.sources,
        addedCollections: [],
        changedCollections: [],
        removedCollections: contributions.collections,
      };
    }
    const changedOwners = new Set([
      ...delta.changedSources.map((item) => item.id),
      ...delta.removedSources.map((item) => item.id),
    ]);
    const affectedInstalledItems = workspace.value.installedSkills.filter(
      (item) =>
        item.address.source.startsWith(`${id}/`) &&
        (kind !== "config-source-adopt" || changedOwners.has(item.address.source)),
    );
    const affectedInstalled = affectedInstalledItems.map((item) => item.address);
    const blockers = [
      ...affectedInstalled.map((address) => ({ reason: "installed" as const, address })),
      ...(kind === "config-source-adopt"
        ? configSourceDependencies(workspace.value, id, {
            sources: new Set(delta.removedSources.map((item) => item.id)),
            collections: new Set(delta.removedCollections.map((item) => item.id)),
          })
        : configSourceDependencies(workspace.value, id)),
    ];
    if (kind === "config-source-adopt" && proposedReusable && exactRevision) {
      const override = { id, commit: exactRevision, value: proposedReusable };
      const complete = await coordinator.withLock(async () => {
        try {
          const proposedWorkspace = await readWorkspaceUnlocked(options, coordinator, override);
          return proposedWorkspace.value.effective.status === "complete";
        } catch {
          return false;
        }
      });
      if (!complete) blockers.push({ reason: "incomplete" });
    }
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
        disappearingSelectors: affectedInstalledItems.flatMap((item) => item.selectors),
        blockers,
        allowed: !blockers.length,
      },
      diagnostics: workspace.diagnostics,
    };
  };
  const previewAdoption: ConfigSourcesCapability["previewAdoption"] = async (
    request,
    operation,
  ) => {
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
  };
  const previewForget: ConfigSourcesCapability["previewForget"] = async (request, operation) => {
    return previewConfigImpact("config-source-forget", request.id, undefined, operation?.signal);
  };
  const previewRemoval: ConfigSourcesCapability["previewRemoval"] = async (request, operation) => {
    return previewConfigImpact("config-source-removal", request.id, undefined, operation?.signal);
  };
  const forget: ConfigSourcesCapability["forget"] = async (request, operation) => {
    if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    await forgetConfigSource(options, request.id);
    return { value: undefined, diagnostics: [] };
  };
  const adopt: ConfigSourcesCapability["adopt"] = async (request, operation) => {
    if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    const declared = await declaredConfigSource(options, request.id);
    if (declared.binding.kind === "local")
      throw new SkillCliError("INVALID_ARGUMENT", "Local Config Sources do not accept a revision");
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
  };
  const observe: ConfigSourcesCapability["observe"] = async (request, operation) => {
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
  };
  const remove: ConfigSourcesCapability["remove"] = async (request, operation) => {
    if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
    // The configuration owner performs the atomic JSONC/state publication; management owns this lifecycle entry point.
    const { removeConfigSource } = await import("./adoption");
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
  };

  return { observe, adopt, previewAdoption, forget, previewForget, remove, previewRemoval };
}
