import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "jsonc-parser";
import type {
  ConfigChange,
  ConfigDeclarationOwner,
  ConfigLevel,
  ConfigurationChangeResult,
  ImpactBlocker,
  LinkChangeImpact,
  MembershipAffected,
  OperationOptions,
  OperationResult,
  WorkspaceView,
} from "../api";
import {
  CollectionResolutionError,
  resolveCollectionUse,
  type MemberOriginPath,
  type SkillAddress,
} from "../collections";
import {
  SkillCliError,
  canonicalLocalOrigin,
  parseNameSegment,
  parseQualifiedName,
} from "./domain";
import { StateCoordinator, type PrivateState } from "./state";
import {
  decodeConfig,
  document,
  edit,
  parseDocument,
  validateDocumentBindings,
  validateDocumentNames,
  validateSourceRoot,
  validatorFor,
  type ConfigDocument,
} from "./config-document";
import {
  configFile,
  configInputs,
  resolveProjectRoot,
  type MutationOptions,
  type ReadWorkspaceOptions,
} from "./config-inputs";
import { cachedConfig } from "./config-bindings";
import {
  capturedWorkspace,
  migrateLegacyInstalled,
  readWorkspace,
  readWorkspaceUnlocked,
} from "./config-workspace";
import { resolveEffectiveCollections } from "./config-resolution";

export async function declaredConfigSource(
  options: ReadWorkspaceOptions,
  id: string,
  requestedLevel?: ConfigLevel,
) {
  parseQualifiedName(id);
  const project = await resolveProjectRoot(options.cwd, options.project, options.signal);
  let found:
    | {
        readonly binding: NonNullable<ConfigDocument["configSources"]>[string];
        readonly file: string;
        readonly level: ConfigLevel;
      }
    | undefined;
  for (const { level, file } of configInputs(options, project.root)) {
    if (requestedLevel && level !== requestedLevel) continue;
    const binding = (await document(file, level)).configSources?.[id];
    if (!binding) continue;
    if (found)
      throw new SkillCliError("CONFIG_CONFLICT", `Config Source is declared more than once: ${id}`);
    found = { binding, file, level };
  }
  if (!found) throw new SkillCliError("SOURCE_NOT_FOUND", `Config Source not found: ${id}`);
  return found;
}
export async function forgetConfigSource(options: MutationOptions, id: string): Promise<void> {
  const coordinator = new StateCoordinator();
  await coordinator.withLock(async () => {
    await declaredConfigSource(options, id);
    const state = await coordinator.read();
    const installed = await migrateLegacyInstalled(options, coordinator, state);
    if (!state.configs[id])
      throw new SkillCliError("SOURCE_NOT_FOUND", `Config Source is not adopted: ${id}`);
    if (state.installed.some((item) => item.source.startsWith(`${id}/`)))
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skills still belong to this Config Source",
      );
    const workspace = await readWorkspaceUnlocked(options, coordinator);
    const dependencies = configSourceDependencies(workspace.value, id);
    if (dependencies.length)
      throw new SkillCliError("CONFIG_CONFLICT", "Config Source has effective graph dependencies");
    const nextState = {
      version: 3,
      generation: state.generation + 1,
      installed,
      configs: Object.fromEntries(Object.entries(state.configs).filter(([name]) => name !== id)),
    };
    await coordinator.publish(
      [{ target: join(coordinator.root, "state.json"), bytes: `${JSON.stringify(nextState)}\n` }],
      state.generation,
    );
  });
}
export async function removeConfigSource(
  options: MutationOptions,
  id: string,
  expected?: { readonly file: string; readonly bytes: Uint8Array },
  level?: ConfigLevel,
): Promise<void> {
  const coordinator = new StateCoordinator();
  await coordinator.withLock(async () => {
    const declared = await declaredConfigSource(options, id, level);
    if (
      expected &&
      (declared.file !== expected.file ||
        !Buffer.from(await readFile(declared.file)).equals(expected.bytes))
    )
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Config Source declaration changed during removal",
      );
    const state = await coordinator.read();
    const installed = await migrateLegacyInstalled(options, coordinator, state);
    if (state.installed.some((item) => item.source.startsWith(`${id}/`)))
      throw new SkillCliError(
        "CONFIG_CONFLICT",
        "Installed Skills still belong to this Config Source",
      );
    const workspace = await readWorkspaceUnlocked(options, coordinator);
    const dependencies = configSourceDependencies(workspace.value, id);
    if (dependencies.length)
      throw new SkillCliError("CONFIG_CONFLICT", "Config Source has effective graph dependencies");
    const original = decodeConfig(await readFile(declared.file), declared.file);
    const next = edit(original, ["configSources", id], undefined);
    const proposed = parse(next, [], { allowTrailingComma: true });
    if (!validatorFor(declared.level)(proposed))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    await coordinator.publish(
      [
        { target: declared.file, bytes: next },
        {
          target: join(coordinator.root, "state.json"),
          bytes: `${JSON.stringify({
            version: 3,
            generation: state.generation + 1,
            installed,
            configs: Object.fromEntries(
              Object.entries(state.configs).filter(([name]) => name !== id),
            ),
          })}\n`,
        },
      ],
      state.generation,
    );
  });
}
export function configSourceDependencies(
  workspace: WorkspaceView,
  id: string,
  removed?: {
    readonly sources?: ReadonlySet<string>;
    readonly collections?: ReadonlySet<string>;
  },
): readonly ImpactBlocker[] {
  if (workspace.effective.status !== "complete") return [{ reason: "incomplete" }];
  const source = workspace.configs
    .flatMap((config) => config.direct.configSources)
    .find((item) => item.id === id);
  if (!source) return [];
  const sources = removed?.sources ?? new Set(source.contributed.sources.map((item) => item.id));
  const collections =
    removed?.collections ?? new Set(source.contributed.collections.map((item) => item.id));
  const owns = (owner: ConfigDeclarationOwner | undefined) =>
    owner?.contribution?.configSource.pointer === source.owner.pointer &&
    owner.contribution.configSource.file === source.owner.file;
  const blockers: ImpactBlocker[] = [];
  for (const collection of workspace.effective.collectionsView) {
    for (const member of collection.members)
      if (sources.has(member.address.source))
        for (const path of member.paths)
          if (path.kind === "direct" && path.owner && !owns(path.owner))
            blockers.push({ reason: "membership", owner: path.owner });
    for (const reference of collection.references)
      if (collections.has(reference.collection) && !owns(reference.owner))
        blockers.push({ reason: "reference", owner: reference.owner });
    for (const link of collection.links)
      if (collections.has(link.collection) && !owns(link.owner))
        blockers.push({ reason: "link", owner: link.owner });
  }
  for (const config of workspace.configs)
    for (const use of config.direct.collectionUse)
      if (collections.has(use.collection)) blockers.push({ reason: "use", owner: use.owner });
  return blockers;
}
export async function removeDirectSource(
  options: MutationOptions,
  id: string,
  level?: ConfigLevel,
): Promise<void> {
  const coordinator = new StateCoordinator();
  await coordinator.withLock(async () => {
    if (!level) {
      const workspace = await readWorkspaceUnlocked(options, coordinator);
      if (workspace.value.effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      const source = capturedWorkspace(workspace.value)?.sources.get(id);
      if (!source) throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${id}`);
      if (source.contribution)
        throw new SkillCliError("INVALID_ARGUMENT", "Config Source contributions are immutable");
      const state = await coordinator.read();
      if (state.installed.some((item) => item.source === id))
        throw new SkillCliError("CONFIG_CONFLICT", "Installed Skills still belong to this Source");
      const original = decodeConfig(
        await readFile(source.provenance.file!),
        source.provenance.file!,
      );
      const next = edit(original, ["sources", id], undefined);
      if (!validatorFor(source.provenance.level!)(parse(next, [], { allowTrailingComma: true })))
        throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
      await coordinator.publish([{ target: source.provenance.file!, bytes: next }]);
      return;
    }
    parseQualifiedName(id);
    const project = await resolveProjectRoot(options.cwd, options.project, options.signal);
    const file = configFile(options, level, project.root);
    const original = decodeConfig(await readFile(file), file);
    if (!parse(original, [], { allowTrailingComma: true }).sources?.[id])
      throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${id}`);
    const state = await coordinator.read();
    if (state.installed.some((item) => item.source === id))
      throw new SkillCliError("CONFIG_CONFLICT", "Installed Skills still belong to this Source");
    const next = edit(original, ["sources", id], undefined);
    if (!validatorFor(level)(parse(next, [], { allowTrailingComma: true })))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    await coordinator.publish([{ target: file, bytes: next }]);
  });
}
export async function membershipBatchAffected(
  options: ReadWorkspaceOptions,
  workspace: WorkspaceView,
  state: PrivateState,
  coordinator: StateCoordinator,
  proposed: { readonly file: string; readonly value: ConfigDocument },
): Promise<readonly MembershipAffected[]> {
  const current = await resolveEffectiveCollections(options, workspace, state, coordinator);
  const next = await resolveEffectiveCollections(options, workspace, state, coordinator, proposed);
  const affected: MembershipAffected[] = [];
  const collections = new Set([...current.members.keys(), ...next.members.keys()]);
  for (const collection of [...collections].sort()) {
    const names = new Set([
      ...(current.members.get(collection)?.keys() ?? []),
      ...(next.members.get(collection)?.keys() ?? []),
    ]);
    for (const name of [...names].sort()) {
      const before = current.members.get(collection)?.get(name);
      const after = next.members.get(collection)?.get(name);
      const beforePaths = current.origins.get(collection)?.get(name) ?? [];
      const afterPaths = next.origins.get(collection)?.get(name) ?? [];
      if (
        (!before && after) ||
        (before && !after) ||
        (before && after && (before.source !== after.source || before.path !== after.path)) ||
        JSON.stringify(beforePaths) !== JSON.stringify(afterPaths)
      )
        affected.push({
          selector: `${collection}:${name}`,
          address: after ?? before!,
          paths: after ? afterPaths : beforePaths,
        });
    }
  }
  return affected;
}
function sameMembershipAffected(
  left: readonly MembershipAffected[],
  right: readonly MembershipAffected[],
): boolean {
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).sort().join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`
        : JSON.stringify(value);
  return canonical(left) === canonical(right);
}
export async function previewLinkChangeImpact(
  options: MutationOptions,
  request: Extract<ConfigChange, { readonly type: "collection.link.set" }>,
  operation?: OperationOptions,
): Promise<OperationResult<LinkChangeImpact>> {
  const workspace = await readWorkspace({ ...options, signal: operation?.signal });
  if (workspace.value.effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  const project = await resolveProjectRoot(options.cwd, options.project, operation?.signal);
  const file = configFile(options, request.level, project.root);
  const host = await document(file, request.level);
  const declaration = host.collections?.[request.collection];
  if (!declaration) {
    const view = workspace.value.effective.collectionsView.find(
      (item) => item.id === request.collection,
    );
    return {
      value: {
        kind: "link-change",
        collection: request.collection,
        target: request.target,
        linked: request.linked,
        members: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [{ reason: "link", owner: view?.declared.find((owner) => owner.contribution) }],
        allowed: false,
      },
      diagnostics: workspace.diagnostics,
    };
  }
  const existingIndex = (declaration.links ?? []).indexOf(request.target);
  const owner = {
    level: request.level,
    file,
    pointer: `/collections/${request.collection}/links/${
      request.linked
        ? (declaration.links ?? []).filter((link) => link !== request.target).length
        : existingIndex
    }`,
  } as const;
  if ((request.linked && existingIndex >= 0) || (!request.linked && existingIndex < 0))
    return {
      value: {
        kind: "link-change",
        collection: request.collection,
        target: request.target,
        owner,
        linked: request.linked,
        members: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [{ reason: "link", owner }],
        allowed: false,
      },
      diagnostics: workspace.diagnostics,
    };
  const coordinator = new StateCoordinator();
  const state = await coordinator.read();
  const current = await resolveEffectiveCollections(options, workspace.value, state, coordinator);
  const links = [...(declaration.links ?? [])];
  if (!request.linked) links.splice(existingIndex, 1);
  const proposedHost = parse(
    edit(
      JSON.stringify(host),
      ["collections", request.collection, "links"],
      request.linked ? [...links, request.target] : links,
    ),
    [],
    { allowTrailingComma: true },
  ) as ConfigDocument;
  try {
    const proposed = await resolveEffectiveCollections(
      options,
      workspace.value,
      state,
      coordinator,
      { file, value: proposedHost },
    );
    const currentMembers = current.members.get(request.collection) ?? new Map();
    const proposedMembers = proposed.members.get(request.collection) ?? new Map();
    const members = [...proposedMembers.entries()].map(([name, address]) => ({
      name,
      address,
      paths: proposed.origins.get(request.collection)?.get(name) ?? [],
    }));
    const selector = (name: string, address: SkillAddress, paths: readonly MemberOriginPath[]) => ({
      selector: `${request.collection}:${name}`,
      address,
      paths,
    });
    const disappearingSelectors = request.linked
      ? []
      : [...currentMembers.entries()]
          .filter(([name]) => !proposedMembers.has(name))
          .map(([name, address]) =>
            selector(name, address, current.origins.get(request.collection)?.get(name) ?? []),
          );
    const retainedSelectors = request.linked
      ? []
      : [...currentMembers.entries()]
          .filter(([name]) => proposedMembers.has(name))
          .map(([name, address]) =>
            selector(name, address, proposed.origins.get(request.collection)?.get(name) ?? []),
          );
    return {
      value: {
        kind: "link-change",
        collection: request.collection,
        target: request.target,
        owner,
        linked: request.linked,
        members,
        disappearingSelectors,
        retainedSelectors,
        blockers: [],
        allowed: true,
      },
      diagnostics: workspace.diagnostics,
    };
  } catch (error) {
    if (!(error instanceof CollectionResolutionError)) throw error;
    const blocker =
      error.details.kind === "cycle"
        ? { reason: "cycle" as const, collections: error.details.collections }
        : {
            reason: "conflict" as const,
            name: error.details.name,
            existing: error.details.existing,
            proposed: error.details.proposed,
          };
    return {
      value: {
        kind: "link-change",
        collection: request.collection,
        target: request.target,
        owner,
        linked: request.linked,
        members: [],
        disappearingSelectors: [],
        retainedSelectors: [],
        blockers: [blocker],
        allowed: false,
      },
      diagnostics: workspace.diagnostics,
    };
  }
}
async function contributionIds(
  project: string | undefined,
  options: ReadWorkspaceOptions,
  state: PrivateState,
  coordinator: StateCoordinator,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const { file, level } of configInputs(options, project)) {
    const host = await document(file, level);
    for (const [configId, binding] of Object.entries(host.configSources ?? {})) {
      const reusable =
        binding.kind === "local"
          ? await document(
              join(canonicalLocalOrigin(binding.path, dirname(file)), binding.root, "config.jsonc"),
              "reusable",
            )
          : state.configs[configId]
            ? await cachedConfig(configId, state, coordinator)
            : undefined;
      if (!reusable) continue;
      for (const id of Object.keys(reusable.sources ?? {}))
        ids.add(`${configId}/${parseQualifiedName(id)}`);
    }
  }
  return ids;
}
export async function mutateConfiguration(
  options: MutationOptions,
  change: ConfigChange,
  operation?: OperationOptions,
): Promise<OperationResult<ConfigurationChangeResult>> {
  if (operation?.signal?.aborted) throw new SkillCliError("CANCELLED", "Operation cancelled");
  return new StateCoordinator().withLock(async () => {
    const project =
      change.level === "global" && !options.project
        ? { root: resolve(options.cwd), resolution: "global-only" as const }
        : await resolveProjectRoot(options.cwd, options.project, options.signal);
    const coordinator = new StateCoordinator();
    const immutableContributions = await contributionIds(
      change.level === "global" ? undefined : project.root,
      options,
      await coordinator.read(),
      coordinator,
    );
    const workspaceOptions =
      change.level === "global"
        ? { ...options, globalOnly: true }
        : { ...options, project: project.root };
    const file = configFile(options, change.level, project.root);
    const stat = await lstat(file).catch(() => undefined);
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new SkillCliError(
        "CONFIG_SYMLINK",
        `Configuration file is not an ordinary file: ${file}`,
      );
    const original = stat ? decodeConfig(await readFile(file), file) : "{}\n";
    const directlyDeclaredCollectionError = (collection: string) =>
      new SkillCliError(
        "INVALID_ARGUMENT",
        `Collection "${collection}" is not directly declared at ${change.level} scope in ${file}`,
      );
    let host: ConfigDocument | undefined;
    const directDocument = () => (host ??= parseDocument(original, file, change.level));
    const directCollection = (id: string) => {
      const collection = directDocument().collections?.[id];
      if (!collection) throw directlyDeclaredCollectionError(id);
      return collection;
    };
    let next = original;
    let useDelta: ConfigurationChangeResult["use"];
    if (change.type === "source.register" || change.type === "config-source.register") {
      parseQualifiedName(change.id);
      if (immutableContributions.has(change.id))
        throw new SkillCliError("INVALID_ARGUMENT", "Config Source contributions are immutable");
      const key = change.type === "source.register" ? "sources" : "configSources";
      const existing = directDocument()[key]?.[change.id];
      if (existing)
        throw new SkillCliError(
          "CONFIG_CONFLICT",
          "Source bindings are immutable; remove and register a new Source ID",
        );
      validateSourceRoot(change.binding.root ?? "");
      next = edit(next, [key, change.id], {
        ...change.binding,
        root: change.binding.root ?? "",
      });
    } else if (change.type === "collection.create") {
      parseQualifiedName(change.collection);
      if (directDocument().collections?.[change.collection])
        throw new SkillCliError("CONFIG_CONFLICT", "Collection already exists");
      next = edit(next, ["collections", change.collection], {});
    } else if (change.type === "collection.remove") {
      parseQualifiedName(change.collection);
      const workspace = await readWorkspaceUnlocked(workspaceOptions, coordinator);
      if (workspace.value.effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      const collection = workspace.value.effective.collectionsView.find(
        (item) => item.id === change.collection,
      );
      const direct = workspace.value.configs
        .find((item) => item.level === change.level)
        ?.direct.collections.find((item) => item.id === change.collection);
      if (!direct) throw directlyDeclaredCollectionError(change.collection);
      const outgoing = directDocument().collections?.[change.collection]?.links ?? [];
      const dependent =
        outgoing.length > 0 ||
        workspace.value.configs.some((item) =>
          item.direct.collectionUse.some((use) => use.collection === change.collection),
        ) ||
        workspace.value.effective.collectionsView.some(
          (item) =>
            item.references.some((reference) => reference.collection === change.collection) ||
            item.links.some((link) => link.collection === change.collection),
        );
      if (dependent || !collection)
        throw new SkillCliError("CONFIG_CONFLICT", "Collection has declaration dependencies");
      next = edit(next, ["collections", change.collection], undefined);
    } else if (change.type === "collection.member.set") {
      parseQualifiedName(change.collection);
      parseNameSegment(change.name);
      const collection = directCollection(change.collection);
      const current = collection.members?.[change.name];
      if (
        current &&
        (current.source !== change.address.source || current.path !== change.address.path)
      )
        throw new SkillCliError("CONFIG_CONFLICT", "Membership entry name is already in use");
      next = edit(next, ["collections", change.collection, "members", change.name], change.address);
    } else if (change.type === "collection.member.remove") {
      parseQualifiedName(change.collection);
      parseNameSegment(change.name);
      const collection = directCollection(change.collection);
      const member = collection.members?.[change.name];
      if (!member)
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          `Membership "${change.name}" is not directly declared in Collection "${change.collection}" at ${change.level} scope in ${file}`,
        );
      if (
        change.expectedAddress &&
        (member.source !== change.expectedAddress.source ||
          member.path !== change.expectedAddress.path)
      )
        throw new SkillCliError("CONFIG_CONFLICT", "Membership changed after preview");
      next = edit(next, ["collections", change.collection, "members", change.name], undefined);
    } else if (change.type === "collection.members.change") {
      parseQualifiedName(change.collection);
      const names = new Set<string>();
      const additions = change.additions.map((entry) => ({
        ...entry,
        name: parseNameSegment(entry.name),
      }));
      const removals = change.removals.map((entry) => ({
        ...entry,
        name: parseNameSegment(entry.name),
      }));
      for (const entry of [...additions, ...removals]) {
        if (names.has(entry.name))
          throw new SkillCliError(
            "INVALID_ARGUMENT",
            "Membership batch cannot contain duplicate entry names",
          );
        names.add(entry.name);
      }
      const collection = directCollection(change.collection);
      const members = { ...collection.members } as Record<string, SkillAddress>;
      for (const entry of removals) {
        const current = members[entry.name];
        if (!current)
          throw new SkillCliError(
            "INVALID_ARGUMENT",
            `Membership "${entry.name}" is not directly declared in Collection "${change.collection}" at ${change.level} scope in ${file}`,
          );
        if (
          current.source !== entry.expectedAddress.source ||
          current.path !== entry.expectedAddress.path
        )
          throw new SkillCliError("CONFIG_CONFLICT", "Membership changed after preview");
      }
      for (const entry of additions) {
        const current = members[entry.name];
        if (
          current &&
          (current.source !== entry.address.source || current.path !== entry.address.path)
        )
          throw new SkillCliError("CONFIG_CONFLICT", "Membership entry name is already in use");
      }
      for (const entry of removals) delete members[entry.name];
      for (const entry of additions) members[entry.name] = entry.address;
      const currentMembers = collection.members ?? {};
      if (
        Object.keys(currentMembers).length !== Object.keys(members).length ||
        Object.entries(currentMembers).some(
          ([name, address]) =>
            address.source !== members[name]?.source || address.path !== members[name]?.path,
        )
      )
        next = edit(next, ["collections", change.collection, "members"], members);
      const workspace = await readWorkspaceUnlocked(workspaceOptions, coordinator);
      const affected = await membershipBatchAffected(
        options,
        workspace.value,
        await coordinator.read(),
        coordinator,
        { file, value: parse(next, [], { allowTrailingComma: true }) as ConfigDocument },
      );
      if (!sameMembershipAffected(change.reviewedAffected, affected))
        throw new SkillCliError("CONFIG_CONFLICT", "Membership impact changed after review");
    } else if (change.type === "collection.import") {
      parseQualifiedName(change.from);
      parseQualifiedName(change.into);
      const workspace = await readWorkspaceUnlocked(workspaceOptions);
      const state = await coordinator.read();
      const resolved = await resolveEffectiveCollections(
        options,
        workspace.value,
        state,
        coordinator,
      );
      const source = resolved.members.get(change.from);
      if (!source)
        throw new SkillCliError("REFERENCE_NOT_FOUND", `Collection not found: ${change.from}`);
      const targetDeclaration = directCollection(change.into);
      const target = (targetDeclaration.members ?? {}) as Record<string, SkillAddress>;
      for (const [name, address] of source) {
        const current = target[name];
        if (current && (current.source !== address.source || current.path !== address.path))
          throw new SkillCliError("EXPOSURE_CONFLICT", `Collection member conflict: ${name}`);
      }
      for (const [name, address] of source)
        if (!target[name])
          next = edit(next, ["collections", change.into, "members", name], address);
    } else if (
      change.type === "use.set" ||
      change.type === "use.add" ||
      change.type === "use.remove"
    ) {
      const before = [...(directDocument().use ?? [])];
      let collections: string[];
      if (change.type === "use.set") collections = [...change.collections];
      else if (change.type === "use.add")
        collections = before.includes(change.collection) ? before : [...before, change.collection];
      else collections = before.filter((collection) => collection !== change.collection);
      if (new Set(collections).size !== collections.length)
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          "Collection Use cannot contain duplicate Collection IDs",
        );
      const workspace = await readWorkspaceUnlocked(workspaceOptions, coordinator);
      const effective = workspace.value.effective;
      if (effective.status !== "complete")
        throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
      if (
        collections.some(
          (id) => !effective.collectionsView.some((collection) => collection.id === id),
        )
      )
        throw new SkillCliError("CONFIG_CONFLICT", "Collection Use is incomplete");
      const proposedText = edit(next, ["use"], collections);
      const proposedResolved = await resolveEffectiveCollections(
        options,
        workspace.value,
        await coordinator.read(),
        coordinator,
        {
          file,
          value: parse(proposedText, [], { allowTrailingComma: true }) as ConfigDocument,
        },
      );
      if (collections.length && !resolveCollectionUse(proposedResolved, collections).complete)
        throw new SkillCliError("CONFIG_CONFLICT", "Collection Use is incomplete");
      next = proposedText;
      useDelta = { before, after: [...collections] };
    } else if (change.type === "collection.reference.set") {
      parseQualifiedName(change.collection);
      parseQualifiedName(change.target);
      parseNameSegment(change.name);
      const declaration = directCollection(change.collection);
      if (declaration.references?.[change.name])
        throw new SkillCliError("CONFIG_CONFLICT", "Reference name already exists");
      next = edit(next, ["collections", change.collection, "references", change.name], {
        collection: change.target,
        description: change.description,
      });
    } else if (change.type === "collection.reference.remove") {
      parseQualifiedName(change.collection);
      parseNameSegment(change.name);
      const reference = directCollection(change.collection).references?.[change.name];
      if (!reference) throw new SkillCliError("REFERENCE_NOT_FOUND", "Reference not found");
      if (
        change.expected &&
        (reference.collection !== change.expected.collection ||
          reference.description !== change.expected.description)
      )
        throw new SkillCliError("CONFIG_CONFLICT", "Reference changed after preview");
      next = edit(next, ["collections", change.collection, "references", change.name], undefined);
    } else if (change.type === "collection.link.set") {
      parseQualifiedName(change.collection);
      parseQualifiedName(change.target);
      const declaration = directCollection(change.collection);
      const existing = (declaration.links ?? []).indexOf(change.target);
      if ((change.linked && existing >= 0) || (!change.linked && existing < 0))
        throw new SkillCliError(
          "INVALID_ARGUMENT",
          change.linked ? "Link already exists" : "Link not found",
        );
      const links = [...(declaration.links ?? [])];
      if (!change.linked) links.splice(existing, 1);
      next = edit(
        next,
        ["collections", change.collection, "links"],
        change.linked ? [...links, change.target] : links,
      );
    } else if (change.type === "agent.managed.set")
      next = edit(next, ["agents"], change.managed ? { opencode: "managed" } : undefined);
    const proposed = parse(next, [], { allowTrailingComma: true });
    if (!validatorFor(change.level)(proposed))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    validateDocumentNames(proposed as ConfigDocument, file);
    validateDocumentBindings(proposed as ConfigDocument, file, false);
    await resolveEffectiveCollections(
      options,
      (await readWorkspaceUnlocked(workspaceOptions)).value,
      await coordinator.read(),
      coordinator,
      { file, value: proposed as ConfigDocument },
    );
    if (next !== original) await new StateCoordinator().publish([{ target: file, bytes: next }]);
    const workspace = await readWorkspaceUnlocked(workspaceOptions);
    return {
      value: {
        level: change.level,
        file,
        changed: next !== original,
        ...(useDelta ? { use: useDelta } : {}),
      },
      diagnostics: workspace.diagnostics,
    };
  });
}
