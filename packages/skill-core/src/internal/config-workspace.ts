import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  ConfigDeclarationOwner,
  DeclarationProvenance,
  Diagnostic,
  ManagedAgentView,
  OperationResult,
  WorkspaceView,
} from "../api";
import {
  resolveCollections,
  resolveCollectionUse,
  type CollectionContribution,
  type MemberOriginPath,
} from "../collections";
import {
  SkillCliError,
  canonicalLocalOrigin,
  canonicalRemoteOrigin,
  parseQualifiedName,
} from "./domain";
import { StateCoordinator, type InstalledMaterialization, type PrivateState } from "./state";
import type { SourceNetwork } from "./source-network";
import {
  configModuleValidator,
  document,
  invalidConfig,
  pointerSegment,
  type ConfigDocument,
  type ReusableConfigDocument,
} from "./config-document";
import {
  configInputs,
  resolveProjectRoot,
  userConfigFile,
  type ReadWorkspaceOptions,
} from "./config-inputs";
import {
  cachedConfig,
  contributedCollection,
  contributedSourceBindings,
  installedCollectionInputs,
  publicSource,
  sourceView,
  type InternalSourceBinding,
} from "./config-bindings";

interface WorkspaceCapture {
  readonly state: PrivateState;
  readonly resolved: ReturnType<typeof resolveCollections>;
  readonly sources: ReadonlyMap<string, InternalSourceBinding>;
  /** Frozen user policy, absent on an invalid user capture. Never projected publicly. */
  readonly network?: SourceNetwork;
}
const captures = new WeakMap<WorkspaceView, WorkspaceCapture>();
export function capturedWorkspace(workspace: WorkspaceView): WorkspaceCapture | undefined {
  return captures.get(workspace);
}
const networkFrom = (value: ConfigDocument): SourceNetwork => Object.freeze({ ...value.network });
/** One coherent user-document read per remote operation; never compose project policy. */
export async function readUserNetwork(
  options: ReadWorkspaceOptions,
  coordinator = new StateCoordinator(),
): Promise<SourceNetwork> {
  return coordinator.withLock(async () =>
    networkFrom(await document(userConfigFile(options), "global")),
  );
}
export async function readWorkspace(
  options: ReadWorkspaceOptions,
): Promise<OperationResult<WorkspaceView>> {
  const coordinator = new StateCoordinator();
  return coordinator.withLock(() => readWorkspaceUnlocked(options, coordinator));
}
export async function readWorkspaceUnlocked(
  options: ReadWorkspaceOptions & { readonly globalOnly?: boolean },
  coordinator = new StateCoordinator(),
  remoteConfigOverride?: {
    readonly id: string;
    readonly commit: string;
    readonly value: ReusableConfigDocument;
  },
): Promise<OperationResult<WorkspaceView>> {
  const state = await coordinator.read();
  const project = options.globalOnly
    ? { root: resolve(options.cwd), resolution: "global-only" as const }
    : await resolveProjectRoot(options.cwd, options.project, options.signal).catch((error) => {
        if (
          !options.project &&
          error instanceof SkillCliError &&
          error.code === "PROJECT_NOT_FOUND"
        )
          return { root: resolve(options.cwd), resolution: "global-only" as const };
        throw error;
      });
  const inputs = configInputs(
    options,
    project.resolution === "global-only" ? undefined : project.root,
  );
  const configs: WorkspaceView["configs"][number][] = [];
  const sources = new Map<string, InternalSourceBinding>();
  const collections = new Set<string>();
  const declaredCollections = new Set<string>();
  const collectionContributions: CollectionContribution[] = [];
  const configSources = new Set<string>();
  const use = new Set<string>();
  const useOwners: ConfigDeclarationOwner[] = [];
  const useDeclarations: { readonly collection: string; readonly owner: ConfigDeclarationOwner }[] =
    [];
  const integrationOwners: ConfigDeclarationOwner[] = [];
  let managed = false;
  const diagnostics: Diagnostic[] = [];
  let incomplete = false;
  let network: SourceNetwork | undefined;
  // Both unreadable hosts and declaration-invalid children invalidate the whole host.
  const rejectHost = (
    input: { level: ConfigDeclarationOwner["level"]; file: string },
    problem: Diagnostic,
    status: "invalid" | "unreadable",
  ) => {
    incomplete = true;
    diagnostics.push(problem);
    configs.push({
      level: input.level,
      file: { status, file: input.file, problem },
      direct: {
        sources: [],
        configSources: [],
        collections: [],
        collectionUse: [],
        integrations: [],
      },
      contributed: { sources: [], collections: [] },
    });
  };
  for (const input of inputs) {
    let value: ConfigDocument;
    let file: WorkspaceView["configs"][number]["file"];
    try {
      const stat = await lstat(input.file).catch(() => undefined);
      value = await document(input.file, input.level);
      if (input.level === "global") network = networkFrom(value);
      file = stat ? { status: "valid", file: input.file } : { status: "missing", file: input.file };
    } catch (error) {
      rejectHost(
        input,
        {
          code: error instanceof SkillCliError ? error.code : "CONFIG_INVALID",
          severity: "warning",
          message: error instanceof SkillCliError ? error.message : "Configuration cannot be read",
          location:
            error instanceof SkillCliError
              ? (error.diagnostics[0]?.location ?? { file: input.file })
              : { file: input.file },
          subject: { kind: "config", owner: { level: input.level, file: input.file, pointer: "" } },
        },
        error instanceof SkillCliError && error.code === "CONFIG_SYMLINK"
          ? "unreadable"
          : "invalid",
      );
      continue;
    }
    let bindingError: SkillCliError | undefined;
    const reusableConfigs = new Map<
      string,
      {
        readonly value: ReusableConfigDocument;
        readonly sources: Map<string, InternalSourceBinding>;
      }
    >();
    // Only declaration-invalid child bytes are contained here; graph errors still surface.
    for (const [id, binding] of Object.entries(value.configSources ?? {})) {
      try {
        const override = remoteConfigOverride?.id === id ? remoteConfigOverride : undefined;
        if (override && !configModuleValidator(override.value))
          throw invalidConfig(input.file, "Invalid reusable Config override");
        const reusable =
          binding.kind === "local"
            ? await document(
                join(
                  canonicalLocalOrigin(binding.path, dirname(input.file)),
                  binding.root,
                  "config.jsonc",
                ),
                "reusable",
              )
            : override
              ? override.value
              : state.configs[id]
                ? await cachedConfig(id, state, coordinator)
                : undefined;
        if (reusable)
          reusableConfigs.set(id, {
            value: reusable,
            sources: contributedSourceBindings(
              id,
              binding,
              input.file,
              reusable,
              input.level,
              override?.commit ?? state.configs[id]?.commit,
            ),
          });
      } catch (error) {
        if (!(error instanceof SkillCliError) || error.code !== "CONFIG_INVALID") throw error;
        bindingError = invalidConfig(
          input.file,
          error.message,
          `/configSources/${pointerSegment(id)}`,
          error.diagnostics.map((diagnostic) => ({
            message: diagnostic.message,
            ...(diagnostic.location?.file ? { file: diagnostic.location.file } : {}),
            ...(diagnostic.location?.pointer ? { pointer: diagnostic.location.pointer } : {}),
          })),
        );
        break;
      }
    }
    if (bindingError) {
      rejectHost(
        input,
        {
          code: bindingError.code,
          severity: "warning",
          message: bindingError.message,
          location: bindingError.diagnostics[0]?.location ?? { file: input.file },
          ...(bindingError.diagnostics[0]?.related
            ? { related: bindingError.diagnostics[0].related }
            : {}),
          subject: { kind: "config", owner: { level: input.level, file: input.file, pointer: "" } },
        },
        "invalid",
      );
      continue;
    }
    const directSources = Object.entries(value.sources ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, item]) => {
        const source = sourceView(id, item, input.file, input.level);
        if (sources.has(source.id))
          throw new SkillCliError(
            "CONFIG_CONFLICT",
            `Source is declared more than once: ${source.id}`,
          );
        sources.set(source.id, source);
        const { bindingDigest: _bindingDigest, ...view } = source;
        return {
          ...view,
          ...(source.ref ? { trackedRef: source.ref } : {}),
          ref: { id, owner: { level: input.level, file: input.file, pointer: `/sources/${id}` } },
        };
      });
    for (const id of Object.keys(value.collections ?? {})) {
      parseQualifiedName(id);
      if (declaredCollections.has(id))
        throw new SkillCliError("CONFIG_CONFLICT", `Collection is declared more than once: ${id}`);
      declaredCollections.add(id);
      collections.add(id);
      collectionContributions.push({
        kind: "declared",
        id,
        declaration: value.collections![id]!,
        owner: { level: input.level, file: input.file, pointer: `/collections/${id}` },
      });
    }
    for (const id of value.use ?? []) {
      parseQualifiedName(id);
      use.add(id);
      const owner = { level: input.level, file: input.file, pointer: "/use" } as const;
      useOwners.push(owner);
      useDeclarations.push({ collection: id, owner });
    }
    managed ||= value.agents?.opencode === "managed";
    if (value.agents?.opencode === "managed")
      integrationOwners.push({ level: input.level, file: input.file, pointer: "/agents/opencode" });
    const contributedSources: InternalSourceBinding[] = [];
    const contributedCollections: {
      readonly id: string;
      readonly owner: ConfigDeclarationOwner;
    }[] = [];
    for (const [configId, binding] of Object.entries(value.configSources ?? {})) {
      parseQualifiedName(configId);
      if (configSources.has(configId))
        throw new SkillCliError(
          "CONFIG_CONFLICT",
          `Config Source is declared more than once: ${configId}`,
        );
      configSources.add(configId);
      const override = remoteConfigOverride?.id === configId ? remoteConfigOverride : undefined;
      const prepared = reusableConfigs.get(configId);
      // A Remote Config Source is valid before adoption and contributes no bytes yet.
      if (!prepared) continue;
      const reusable = prepared.value;
      const appliedCommit = override?.commit ?? state.configs[configId]?.commit;
      const namespace = (id: string) => `${configId}/${parseQualifiedName(id)}`;
      const hostOwner: ConfigDeclarationOwner = {
        level: input.level,
        file: input.file,
        pointer: `/configSources/${configId}`,
      };
      const declarationOwner = (pointer: string): DeclarationProvenance => ({
        level: input.level,
        ...(binding.kind === "local"
          ? {
              file: join(
                canonicalLocalOrigin(binding.path, dirname(input.file)),
                binding.root,
                "config.jsonc",
              ),
            }
          : {}),
        pointer,
        namespace: binding.kind === "local" ? configId : `${configId}@${appliedCommit!}`,
      });
      for (const id of Object.keys(reusable.sources ?? {})) {
        const contribution = {
          configSource: hostOwner,
          declaration: declarationOwner(`/sources/${id}`),
        };
        const source = {
          ...prepared.sources.get(namespace(id))!,
          provenance: contribution.declaration,
          contribution,
        };
        if (sources.has(source.id))
          throw new SkillCliError(
            "CONFIG_CONFLICT",
            `Source is declared more than once: ${source.id}`,
          );
        sources.set(source.id, source);
        contributedSources.push(source);
      }
      for (const id of Object.keys(reusable.collections ?? {})) {
        const namespaced = namespace(id);
        if (declaredCollections.has(namespaced))
          throw new SkillCliError(
            "CONFIG_CONFLICT",
            `Collection is declared more than once: ${namespaced}`,
          );
        declaredCollections.add(namespaced);
        collections.add(namespaced);
        const owner: ConfigDeclarationOwner = {
          level: input.level,
          file: input.file,
          pointer: `/configSources/${configId}/collections/${id}`,
          namespace: binding.kind === "local" ? configId : `${configId}@${appliedCommit!}`,
          contribution: {
            configSource: hostOwner,
            declaration: declarationOwner(`/collections/${id}`),
          },
        };
        collectionContributions.push({
          kind: "declared",
          id: namespaced,
          declaration: contributedCollection(configId, reusable.collections![id]!),
          owner,
        });
        contributedCollections.push({ id: namespaced, owner });
      }
    }
    configs.push({
      level: input.level,
      file,
      direct: {
        sources: directSources,
        configSources: Object.entries(value.configSources ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, binding]) => {
            const applied =
              binding.kind === "local"
                ? undefined
                : remoteConfigOverride?.id === id
                  ? { commit: remoteConfigOverride.commit }
                  : state.configs[id];
            return {
              id,
              owner: { level: input.level, file: input.file, pointer: `/configSources/${id}` },
              binding:
                binding.kind === "local"
                  ? {
                      kind: "local" as const,
                      path: canonicalLocalOrigin(binding.path, dirname(input.file)),
                      root: binding.root,
                    }
                  : {
                      kind: binding.kind,
                      origin: canonicalRemoteOrigin(
                        binding.kind === "github"
                          ? `https://github.com/${binding.owner}/${binding.repository}`
                          : binding.origin,
                      ),
                      root: binding.root,
                      ref: binding.ref,
                    },
              adoption:
                binding.kind === "local"
                  ? { status: "live" as const }
                  : applied
                    ? { status: "adopted" as const, commit: applied.commit }
                    : { status: "not-adopted" as const },
              contributed: {
                sources: contributedSources
                  .filter((source) => source.id.startsWith(`${id}/`))
                  .sort((left, right) => left.id.localeCompare(right.id)),
                collections: contributedCollections.filter((collection) =>
                  collection.id.startsWith(`${id}/`),
                ),
              },
            };
          }),
        collections: Object.keys(value.collections ?? {})
          .sort()
          .map((id) => ({
            id,
            owner: { level: input.level, file: input.file, pointer: `/collections/${id}` },
          })),
        collectionUse: [...(value.use ?? [])].sort().map((collection) => ({
          collection,
          owner: { level: input.level, file: input.file, pointer: "/use" },
        })),
        integrations:
          value.agents?.opencode === "managed"
            ? [
                {
                  kind: "opencode" as const,
                  owner: { level: input.level, file: input.file, pointer: "/agents/opencode" },
                },
              ]
            : [],
      },
      contributed: {
        sources: contributedSources.sort((a, b) => a.id.localeCompare(b.id)),
        collections: contributedCollections
          .map((collection) => collection.id)
          .sort((left, right) => left.localeCompare(right)),
      },
    });
  }
  const resolved = incomplete
    ? undefined
    : resolveCollections(collectionContributions, installedCollectionInputs(state, sources));
  const collectionsView = resolved
    ? [...resolved.members.entries()]
        .map(([id, members]) => {
          const declaredContributions = collectionContributions.filter(
            (item) => item.id === id && item.owner,
          );
          const declarationOwner = declaredContributions[0]?.owner;
          const ownerFor = (pointer: string) => {
            if (!declarationOwner)
              throw new SkillCliError("INTERNAL", "Declared Collection owner is unavailable");
            return { ...declarationOwner, pointer: `${declarationOwner.pointer}/${pointer}` };
          };
          return {
            id,
            ...(declaredContributions[0]?.declaration.description
              ? { description: declaredContributions[0].declaration.description }
              : {}),
            declared: declaredContributions.map((item) => item.owner!),
            repository: {
              derived: [...(resolved.origins.get(id)?.values() ?? [])].some((paths) =>
                paths.some((path) => path.kind === "repository-derived"),
              ),
              producers: [...(resolved.origins.get(id)?.values() ?? [])]
                .flatMap((paths) => paths)
                .filter(
                  (path): path is Extract<MemberOriginPath, { kind: "repository-derived" }> =>
                    path.kind === "repository-derived",
                )
                .map((path) => ({ source: path.source, path: path.path }))
                .sort(
                  (left, right) =>
                    left.source.localeCompare(right.source) || left.path.localeCompare(right.path),
                ),
            },
            members: [...members.entries()].map(([name, address]) => ({
              name,
              address,
              paths: resolved.origins.get(id)?.get(name) ?? [],
            })),
            references: Object.entries(resolved.references.get(id) ?? {})
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([name, reference]) => ({
                name,
                ...reference,
                owner: ownerFor(`references/${name}`),
              })),
            links: (declaredContributions[0]?.declaration.links ?? []).map((collection, index) => ({
              collection,
              owner: ownerFor(`links/${index}`),
            })),
          };
        })
        .sort((left, right) => left.id.localeCompare(right.id))
    : [];
  const selected = resolved ? resolveCollectionUse(resolved, [...use].sort()) : undefined;
  const ownerKey = (owner: ConfigDeclarationOwner) =>
    JSON.stringify([owner.level, owner.file, owner.pointer, owner.namespace]);
  const exposurePathsFor = (collection: string) => {
    if (!resolved || !selected?.complete) return [];
    const paths: {
      readonly owner: ConfigDeclarationOwner;
      readonly segments: readonly {
        readonly collection: string;
        readonly reference?: { readonly name: string; readonly target: string };
      }[];
    }[] = [];
    for (const declaration of useDeclarations) {
      const visit = (
        current: string,
        segments: readonly {
          readonly collection: string;
          readonly reference?: { readonly name: string; readonly target: string };
        }[],
        ancestors: ReadonlySet<string>,
      ) => {
        if (current === collection) paths.push({ owner: declaration.owner, segments });
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(current);
        for (const [name, reference] of Object.entries(resolved.references.get(current) ?? {}).sort(
          ([left], [right]) => left.localeCompare(right),
        )) {
          if (nextAncestors.has(reference.collection)) continue;
          visit(
            reference.collection,
            [
              ...segments,
              {
                collection: reference.collection,
                reference: { name, target: reference.collection },
              },
            ],
            nextAncestors,
          );
        }
      };
      visit(declaration.collection, [{ collection: declaration.collection }], new Set());
    }
    return [
      ...new Map(
        paths.map((path) => [JSON.stringify([ownerKey(path.owner), path.segments]), path]),
      ).values(),
    ].sort((left, right) =>
      JSON.stringify([ownerKey(left.owner), left.segments]).localeCompare(
        JSON.stringify([ownerKey(right.owner), right.segments]),
      ),
    );
  };
  const managementCollections = new Set<string>();
  if (selected?.complete && resolved) {
    const pending = [...selected.members.keys()].sort().reverse();
    while (pending.length) {
      const id = pending.pop()!;
      if (managementCollections.has(id)) continue;
      managementCollections.add(id);
      for (const reference of Object.values(resolved.references.get(id) ?? {}).sort((left, right) =>
        left.collection.localeCompare(right.collection),
      ))
        pending.push(reference.collection);
    }
  }
  const installedSkills = state.installed
    .map((item) => {
      const owner = sources.get(item.source);
      const collectionEntries = resolved
        ? collectionsView.flatMap((collection) =>
            collection.members
              .filter(
                (member) =>
                  member.address.source === item.source && member.address.path === item.path,
              )
              .map((member) => ({ id: collection.id, entry: member.name, paths: member.paths })),
          )
        : [];
      const selectors = selected?.complete
        ? collectionEntries
            .filter((entry) => managementCollections.has(entry.id))
            .map((entry) => `${entry.id}:${entry.entry}`)
            .sort()
        : [];
      const selectorViews = selected?.complete
        ? {
            status: "complete" as const,
            values: collectionEntries
              .filter((entry) => managementCollections.has(entry.id))
              .map((entry) => ({
                selector: `${entry.id}:${entry.entry}`,
                collection: entry.id,
                entry: entry.entry,
                paths: entry.paths,
                exposurePaths: exposurePathsFor(entry.id),
                useOwners: useDeclarations
                  .filter((declaration) => declaration.collection === entry.id)
                  .map((declaration) => declaration.owner),
              }))
              .sort((left, right) => left.selector.localeCompare(right.selector)),
          }
        : { status: "unavailable" as const };
      const health = owner
        ? owner.bindingDigest === item.bindingDigest
          ? "healthy"
          : "drifted"
        : incomplete
          ? "unresolved-config"
          : "missing";
      return {
        address: { source: item.source, path: item.path },
        name: item.name,
        description: item.description,
        owner: {
          source: item.source,
          health,
          ...(item.kind === "local"
            ? { relevantLocalRoot: item.root }
            : item.adoptedRevision
              ? { relevantRemoteRevision: item.adoptedRevision }
              : {}),
        },
        ...(health === "healthy" && owner ? { source: publicSource(owner) } : {}),
        collections: collectionEntries,
        selectors,
        selectorViews,
        ...(selectors[0] ? { primary: selectors[0] } : {}),
        aliases: selectors.slice(1),
        problems:
          health === "healthy"
            ? []
            : [
                {
                  code: "CONFIG_INVALID",
                  severity: "warning" as const,
                  message: `Installed Skill owner is ${health}`,
                  subject: {
                    kind: "installed-skill" as const,
                    address: { source: item.source, path: item.path },
                  },
                },
              ],
      } as const;
    })
    .sort(
      (a, b) =>
        a.address.source.localeCompare(b.address.source) ||
        a.address.path.localeCompare(b.address.path),
    );
  const agentReasons = incomplete
    ? diagnostics
    : !managed
      ? [
          {
            code: "CONFIG_INVALID",
            severity: "warning" as const,
            message: "agents.opencode must be managed",
          },
        ]
      : !selected?.complete
        ? [
            {
              code: "CONFIG_INVALID",
              severity: "warning" as const,
              message: selected?.reason ?? "Collection Use is incomplete",
            },
          ]
        : [];
  const agent: ManagedAgentView = {
    status: agentReasons.length ? "unavailable" : "available",
    integration: integrationOwners,
    use: useOwners,
    reasons: agentReasons,
    catalog: agentReasons.length
      ? []
      : installedSkills
          .filter((item) => item.owner.health === "healthy" && item.primary && item.source)
          .map((item) => ({
            selector: item.primary!,
            name: item.name,
            description: item.description,
            aliases: item.aliases,
          }))
          .sort((left, right) => left.selector.localeCompare(right.selector)),
  };
  const value: WorkspaceView = {
    project,
    configs,
    effective: incomplete
      ? {
          status: "unavailable",
          reasons: diagnostics,
          sources: [...sources.values()].map(publicSource).sort((a, b) => a.id.localeCompare(b.id)),
          collections: [...collections].sort(),
          agent,
        }
      : {
          status: "complete",
          sources: [...sources.values()].map(publicSource).sort((a, b) => a.id.localeCompare(b.id)),
          collections: [...collections].sort(),
          use: [...use].sort(),
          managed,
          collectionsView,
          agent,
        },
    installedSkills,
    diagnostics,
  };
  captures.set(value, {
    state,
    resolved: resolved ?? resolveCollections({}, new Set()),
    sources,
    network,
  });
  return { value, diagnostics };
}

/** Derives v1 evidence from the current declaration capture; it never acquires a source. */
export async function migrateLegacyInstalled(
  options: ReadWorkspaceOptions,
  coordinator: StateCoordinator,
  state: PrivateState,
): Promise<readonly InstalledMaterialization[]> {
  if (state.version !== 1) return state.installed;
  let sources: ReadonlyMap<string, InternalSourceBinding> | undefined;
  try {
    const workspace = await readWorkspaceUnlocked(options, coordinator);
    sources = capturedWorkspace(workspace.value)?.sources;
  } catch {
    // An invalid capture cannot prove any legacy owner, but must not contact a provider.
  }
  return state.installed.map((item) => {
    const owner = sources?.get(item.source);
    return {
      ...item,
      ...(item.kind === "remote" && !item.adoptedRevision
        ? { revisionStatus: "unresolved" as const }
        : {}),
      identityEvidence:
        !owner || owner.bindingDigest !== item.bindingDigest
          ? { status: "unavailable" as const }
          : {
              status: "known" as const,
              canonicalOrigin: owner.origin,
              originRelativeSkillRoot: [owner.root, item.path].filter(Boolean).join("/"),
            },
    };
  });
}
