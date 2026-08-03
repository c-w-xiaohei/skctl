import { Type, type Static } from "@sinclair/typebox";
import Ajv2020 from "ajv/dist/2020";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";

import type {
  ConfigChange,
  ConfigLevel,
  ConfigurationChangeResult,
  OperationOptions,
  OperationResult,
  WorkspaceView,
  SourceBindingView,
  ConfigDeclarationOwner,
  ManagedAgentView,
  LinkChangeImpact,
  ImpactBlocker,
} from "../api";
import {
  SkillCliError,
  canonicalLocalOrigin,
  canonicalRemoteOrigin,
  bindingDigest,
  parseNameSegment,
  parseQualifiedName,
  textLimit,
} from "./domain";
import { StateCoordinator, type InstalledMaterialization, type PrivateState } from "./state";
import { runProviderChild } from "./source-git";
import {
  resolveCollections,
  CollectionResolutionError,
  resolveCollectionUse,
  type CollectionContribution,
  type MemberOriginPath,
  type SkillAddress,
} from "../collections";

export const schemaId = "https://skill-cli.dev/schema.json";
let configReadHook: ((path: string) => void) | undefined;
/** Test-only observation of concrete Config bytes captured for one workspace projection. */
export function setConfigReadHookForTest(next?: (path: string) => void) {
  configReadHook = next;
}
const binding = Type.Union([
  Type.Object(
    { kind: Type.Literal("local"), path: Type.String(), root: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("git"), origin: Type.String(), root: Type.String(), ref: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("github"),
      owner: Type.Optional(Type.String()),
      repository: Type.Optional(Type.String()),
      origin: Type.String(),
      root: Type.String(),
      ref: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
const configSource = Type.Union([
  Type.Object(
    { kind: Type.Literal("local"), path: Type.String(), root: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("git"), origin: Type.String(), root: Type.String(), ref: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("github"),
      owner: Type.Optional(Type.String()),
      repository: Type.Optional(Type.String()),
      origin: Type.String(),
      root: Type.String(),
      ref: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
const address = Type.Object(
  { source: Type.String(), path: Type.String() },
  { additionalProperties: false },
);
const reference = Type.Object(
  { collection: Type.String(), description: Type.String() },
  { additionalProperties: false },
);
const collection = Type.Object(
  {
    members: Type.Optional(Type.Record(Type.String(), address)),
    links: Type.Optional(Type.Array(Type.String())),
    references: Type.Optional(Type.Record(Type.String(), reference)),
  },
  { additionalProperties: false },
);
const host = Type.Object(
  {
    $schema: Type.Optional(Type.Literal(schemaId)),
    agents: Type.Optional(
      Type.Object({ opencode: Type.Literal("managed") }, { additionalProperties: false }),
    ),
    configSources: Type.Optional(Type.Record(Type.String(), configSource)),
    sources: Type.Optional(Type.Record(Type.String(), binding)),
    collections: Type.Optional(Type.Record(Type.String(), collection)),
    use: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);
const reusable = Type.Object(
  {
    sources: Type.Optional(Type.Record(Type.String(), binding)),
    collections: Type.Optional(Type.Record(Type.String(), collection)),
  },
  { additionalProperties: false },
);
export const userProjectConfigSchema = host;
export const localConfigSchema = host;
export const configModuleSchema = reusable;
export const persistedConfigSchema = Type.Union([host, reusable], {
  $id: schemaId,
  $schema: "https://json-schema.org/draft/2020-12/schema",
});
export type ConfigDocument = Static<typeof host>;
type ReusableConfigDocument = Static<typeof reusable>;
const ajv = new Ajv2020({ allErrors: true, strict: true });
export const userProjectConfigValidator = ajv.compile(host);
export const localConfigValidator = userProjectConfigValidator;
export const configModuleValidator = ajv.compile(reusable);
const sort = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sort(v)]),
        )
      : value;
export const schemaJson = `${JSON.stringify(sort(persistedConfigSchema), null, 2).replace(
  /\[\n\s*((?:"[^"]+",?\n\s*)+)\]/gu,
  (_, values: string) => `[${values.replace(/\s+/gu, " ").trim().replace(/,$/u, "")}]`,
)}\n`;
export interface ReadWorkspaceOptions {
  readonly cwd: string;
  readonly project?: string;
  readonly userConfigPath?: string;
  readonly signal?: AbortSignal;
}
export interface MutationOptions extends ReadWorkspaceOptions {}
interface WorkspaceCapture {
  readonly state: PrivateState;
  readonly resolved: ReturnType<typeof resolveCollections>;
  readonly sources: ReadonlyMap<string, InternalSourceBinding>;
}
type InternalSourceBinding = SourceBindingView & { readonly bindingDigest: string };
const captures = new WeakMap<WorkspaceView, WorkspaceCapture>();
export function capturedWorkspace(workspace: WorkspaceView): WorkspaceCapture | undefined {
  return captures.get(workspace);
}
export async function resolveProjectRoot(
  cwd: string,
  explicit?: string,
  signal?: AbortSignal,
): Promise<{ root: string; resolution: "explicit" | "nearest-config" | "git-root" }> {
  if (explicit) {
    const root = resolve(cwd, explicit);
    if ((await lstat(root).catch(() => undefined))?.isDirectory())
      return { root, resolution: "explicit" };
    throw new SkillCliError("PROJECT_NOT_FOUND", "Project directory must exist");
  }
  let current = resolve(cwd);
  while (true) {
    const config = await lstat(join(current, "skill-cli.jsonc")).catch(() => undefined);
    if (config?.isFile() && !config.isSymbolicLink())
      return { root: current, resolution: "nearest-config" };
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    const result = await runProviderChild(
      { cmd: ["git", "rev-parse", "--show-toplevel"], cwd, stdout: "pipe", stderr: "pipe" },
      signal,
    );
    const output = new TextDecoder().decode(result.stdout).trim();
    if (result.status === 0 && output) return { root: output, resolution: "git-root" };
  } catch (error) {
    if (error instanceof SkillCliError && error.code === "CANCELLED") throw error;
  }
  throw new SkillCliError("PROJECT_NOT_FOUND", "Project not found");
}
async function document(path: string, reusable = false): Promise<ConfigDocument> {
  const stat = await lstat(path).catch(() => undefined);
  if (!stat) return {};
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new SkillCliError(
      "CONFIG_SYMLINK",
      `Configuration file is not an ordinary file: ${path}`,
    );
  const bytes = await readFile(path);
  configReadHook?.(path);
  if (bytes.byteLength > textLimit)
    throw new SkillCliError("TEXT_TOO_LARGE", "Configuration exceeds text limit");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkillCliError("INVALID_UTF8", "Configuration is not UTF-8");
  }
  const errors: Parameters<typeof parse>[1] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (
    errors.length ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !(reusable ? configModuleValidator(value) : userProjectConfigValidator(value))
  )
    throw new SkillCliError("CONFIG_INVALID", `Invalid configuration: ${path}`);
  return value as ConfigDocument;
}
function sourceView(
  id: string,
  value: NonNullable<ConfigDocument["sources"]>[string],
  file: string,
  level: "global" | "project" | "local",
  inherited?: { readonly origin: string; readonly ref: string; readonly root: string },
  contribution?: import("../api").ConfigSourceContributionRef,
): InternalSourceBinding {
  parseQualifiedName(id);
  if (
    isAbsolute(value.root) ||
    value.root.includes("\\") ||
    value.root
      .split("/")
      .some((part) => part === "." || part === ".." || (part === "" && value.root !== ""))
  )
    throw new SkillCliError("CONFIG_INVALID", "Source Root must be a relative normalized path");
  const githubOrigin =
    value.kind === "github"
      ? value.owner && value.repository
        ? `https://github.com/${value.owner}/${value.repository}`
        : value.origin?.match(/^[^/]+\/[^/]+$/u)
          ? `https://github.com/${value.origin}`
          : value.origin
      : undefined;
  const remoteValue = value.kind === "local" ? value.path : (githubOrigin ?? value.origin);
  const remoteRelative =
    inherited &&
    (value.kind === "local" || (!remoteValue?.includes("://") && !remoteValue?.startsWith("/")));
  const remoteParts = [inherited?.root, remoteValue, value.root]
    .filter(Boolean)
    .flatMap((part) => part!.split("/").filter((segment) => segment && segment !== "."));
  const inheritedRoot = remoteRelative ? remoteParts.join("/") : undefined;
  if (remoteParts.some((part) => part === ".."))
    throw new SkillCliError("CONFIG_INVALID", "Remote Config Source escapes its repository");
  const kind = remoteRelative ? "git" : value.kind;
  const origin = remoteRelative
    ? inherited.origin
    : value.kind === "local"
      ? canonicalLocalOrigin(value.path ?? "", dirname(file))
      : canonicalRemoteOrigin(githubOrigin ?? value.origin ?? "");
  const source: SourceBindingView = {
    id,
    kind,
    origin,
    root: inheritedRoot ?? value.root,
    ...(kind === "local"
      ? {}
      : { ref: remoteRelative ? inherited.ref : value.kind === "local" ? undefined : value.ref }),
    selectors: [],
    provenance: contribution?.declaration ?? { level, file, pointer: `/sources/${id}` },
    ...(contribution ? { contribution } : {}),
  } as const;
  return {
    ...source,
    bindingDigest: bindingDigest({
      kind,
      origin,
      root: inheritedRoot ?? value.root,
      ...(kind === "local"
        ? { path: origin }
        : { ref: remoteRelative ? inherited.ref : value.kind === "local" ? undefined : value.ref }),
    }),
  };
}
export function validateConfigBytes(bytes: Uint8Array): ReusableConfigDocument {
  const text = decodeConfig(bytes, "Remote Config");
  const errors: Parameters<typeof parse>[1] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (
    errors.length ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !configModuleValidator(value)
  )
    throw new SkillCliError("CONFIG_INVALID", "Invalid Remote Config");
  return value as ReusableConfigDocument;
}
export async function declaredConfigSource(
  options: ReadWorkspaceOptions,
  id: string,
  requestedLevel?: ConfigLevel,
) {
  parseQualifiedName(id);
  const project = await resolveProjectRoot(options.cwd, options.project, options.signal);
  const user =
    options.userConfigPath ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
      "skill-cli",
      "config.jsonc",
    );
  let found:
    | {
        readonly binding: NonNullable<ConfigDocument["configSources"]>[string];
        readonly file: string;
        readonly level: ConfigLevel;
      }
    | undefined;
  for (const { level, file } of [
    { level: "global" as const, file: user },
    { level: "project" as const, file: join(project.root, "skill-cli.jsonc") },
    { level: "local" as const, file: join(project.root, "skill-cli.local.jsonc") },
  ]) {
    if (requestedLevel && level !== requestedLevel) continue;
    const binding = (await document(file)).configSources?.[id];
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
      version: 2,
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
    if (!userProjectConfigValidator(proposed))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    await coordinator.publish(
      [
        { target: declared.file, bytes: next },
        {
          target: join(coordinator.root, "state.json"),
          bytes: `${JSON.stringify({
            version: 2,
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
      if (!userProjectConfigValidator(parse(next, [], { allowTrailingComma: true })))
        throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
      await coordinator.publish([{ target: source.provenance.file!, bytes: next }]);
      return;
    }
    parseQualifiedName(id);
    const project = await resolveProjectRoot(options.cwd, options.project, options.signal);
    const file =
      level === "global"
        ? (options.userConfigPath ??
          join(
            process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
            "skill-cli",
            "config.jsonc",
          ))
        : join(project.root, level === "project" ? "skill-cli.jsonc" : "skill-cli.local.jsonc");
    const original = decodeConfig(await readFile(file), file);
    if (!parse(original, [], { allowTrailingComma: true }).sources?.[id])
      throw new SkillCliError("SOURCE_NOT_FOUND", `Source not found: ${id}`);
    const state = await coordinator.read();
    if (state.installed.some((item) => item.source === id))
      throw new SkillCliError("CONFIG_CONFLICT", "Installed Skills still belong to this Source");
    const next = edit(original, ["sources", id], undefined);
    if (!userProjectConfigValidator(parse(next, [], { allowTrailingComma: true })))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
    await coordinator.publish([{ target: file, bytes: next }]);
  });
}
export function contributedSourceBindings(
  configId: string,
  binding: NonNullable<ConfigDocument["configSources"]>[string],
  file: string,
  reusable: ReusableConfigDocument,
  level: ConfigLevel,
  commit?: string,
) {
  const namespace = (id: string) => `${configId}/${parseQualifiedName(id)}`;
  return new Map(
    Object.entries(reusable.sources ?? {}).map(([id, item]) => {
      const inherited =
        binding.kind === "local"
          ? undefined
          : {
              origin: canonicalRemoteOrigin(
                binding.kind === "github"
                  ? `https://github.com/${binding.owner}/${binding.repository}`
                  : binding.origin,
              ),
              ref: commit ?? binding.ref,
              root: binding.root,
            };
      const source = sourceView(namespace(id), item, file, level, inherited);
      return [source.id, source] as const;
    }),
  );
}
function contributedCollection(
  configId: string,
  declaration: NonNullable<ReusableConfigDocument["collections"]>[string],
) {
  const namespace = (id: string) => `${configId}/${parseQualifiedName(id)}`;
  return {
    ...(declaration.members
      ? {
          members: Object.fromEntries(
            Object.entries(declaration.members).map(([name, address]) => [
              name,
              { source: namespace(address.source), path: address.path },
            ]),
          ),
        }
      : {}),
    ...(declaration.links ? { links: declaration.links.map(namespace) } : {}),
    ...(declaration.references
      ? {
          references: Object.fromEntries(
            Object.entries(declaration.references).map(([name, reference]) => [
              name,
              { ...reference, collection: namespace(reference.collection) },
            ]),
          ),
        }
      : {}),
  };
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
  const user =
    options.userConfigPath ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
      "skill-cli",
      "config.jsonc",
    );
  const inputs = [
    { level: "global" as const, file: user },
    ...(project.resolution === "global-only"
      ? []
      : [
          { level: "project" as const, file: join(project.root, "skill-cli.jsonc") },
          { level: "local" as const, file: join(project.root, "skill-cli.local.jsonc") },
        ]),
  ];
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
  const diagnostics: import("../api").Diagnostic[] = [];
  let incomplete = false;
  for (const input of inputs) {
    let value: ConfigDocument | undefined;
    let file: WorkspaceView["configs"][number]["file"];
    try {
      const stat = await lstat(input.file).catch(() => undefined);
      value = await document(input.file);
      file = stat ? { status: "valid", file: input.file } : { status: "missing", file: input.file };
    } catch (error) {
      incomplete = true;
      const problem =
        error instanceof SkillCliError
          ? {
              code: error.code,
              severity: "warning" as const,
              message: error.message,
              location: { file: input.file },
              subject: {
                kind: "config" as const,
                owner: { level: input.level, file: input.file, pointer: "" },
              },
            }
          : {
              code: "CONFIG_INVALID",
              severity: "warning" as const,
              message: "Configuration cannot be read",
              location: { file: input.file },
              subject: {
                kind: "config" as const,
                owner: { level: input.level, file: input.file, pointer: "" },
              },
            };
      diagnostics.push(problem);
      configs.push({
        level: input.level,
        file: {
          status:
            error instanceof SkillCliError && error.code === "CONFIG_SYMLINK"
              ? "unreadable"
              : "invalid",
          file: input.file,
          problem,
        },
        direct: {
          sources: [],
          configSources: [],
          collections: [],
          collectionUse: [],
          integrations: [],
        },
        contributed: { sources: [], collections: [] },
      });
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
      integrationOwners.push({
        level: input.level,
        file: input.file,
        pointer: "/agents/opencode",
      });
    const contributedSources: SourceBindingView[] = [];
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
      const reusable =
        binding.kind === "local"
          ? await document(
              join(
                canonicalLocalOrigin(binding.path, dirname(input.file)),
                binding.root,
                "config.jsonc",
              ),
              true,
            )
          : override
            ? override.value
            : state.configs[configId]
              ? await cachedConfig(configId, state, coordinator)
              : undefined;
      // A declared Remote Config Source is valid before adoption and contributes no bytes yet.
      if (!reusable) continue;
      const appliedCommit = override?.commit ?? state.configs[configId]?.commit;
      const namespace = (id: string) => `${configId}/${parseQualifiedName(id)}`;
      const hostOwner: ConfigDeclarationOwner = {
        level: input.level,
        file: input.file,
        pointer: `/configSources/${configId}`,
      };
      for (const [id, item] of Object.entries(reusable.sources ?? {})) {
        const remote = binding.kind !== "local";
        const contribution = {
          configSource: hostOwner,
          declaration: {
            level: input.level,
            ...(remote
              ? {}
              : {
                  file: join(
                    canonicalLocalOrigin(binding.path, dirname(input.file)),
                    binding.root,
                    "config.jsonc",
                  ),
                }),
            pointer: `/sources/${id}`,
            namespace: remote ? `${configId}@${appliedCommit!}` : configId,
          },
        } as const;
        const source = sourceView(
          namespace(id),
          item,
          binding.kind === "local"
            ? join(
                canonicalLocalOrigin(binding.path, dirname(input.file)),
                binding.root,
                "config.jsonc",
              )
            : input.file,
          input.level,
          binding.kind === "local"
            ? undefined
            : {
                origin: canonicalRemoteOrigin(
                  binding.kind === "github"
                    ? `https://github.com/${binding.owner}/${binding.repository}`
                    : binding.origin,
                ),
                ref: appliedCommit!,
                root: binding.root,
              },
          contribution,
        );
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
          ...(binding.kind === "local"
            ? { namespace: configId }
            : { namespace: `${configId}@${appliedCommit!}` }),
          contribution: {
            configSource: hostOwner,
            declaration: {
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
              pointer: `/collections/${id}`,
              namespace: binding.kind === "local" ? configId : `${configId}@${appliedCommit!}`,
            },
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
    : resolveCollections(
        collectionContributions,
        state.installed.map((item) => ({
          source: item.source,
          path: item.path,
          name: item.name,
          ...(repository(sources.get(item.source))
            ? { repository: repository(sources.get(item.source)) }
            : {}),
        })),
      );
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
            .filter((entry) => selected.members.has(entry.id))
            .map((entry) => `${entry.id}:${entry.entry}`)
            .sort()
        : [];
      const selectorViews = selected?.complete
        ? {
            status: "complete" as const,
            values: collectionEntries
              .filter((entry) => selected.members.has(entry.id))
              .map((entry) => ({
                selector: `${entry.id}:${entry.entry}`,
                collection: entry.id,
                entry: entry.entry,
                paths: entry.paths,
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
  captures.set(value, { state, resolved: resolved ?? resolveCollections({}, new Set()), sources });
  return {
    value,
    diagnostics,
  };
}

function publicSource(source: InternalSourceBinding): SourceBindingView {
  const { bindingDigest: _bindingDigest, ...view } = source;
  return view;
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
    if (!owner || owner.bindingDigest !== item.bindingDigest)
      return {
        ...item,
        ...(item.kind === "remote" && !item.adoptedRevision
          ? { revisionStatus: "unresolved" as const }
          : {}),
        identityEvidence: { status: "unavailable" as const },
      };
    return {
      ...item,
      ...(item.kind === "remote" && !item.adoptedRevision
        ? { revisionStatus: "unresolved" as const }
        : {}),
      identityEvidence: {
        status: "known" as const,
        canonicalOrigin: owner.origin,
        originRelativeSkillRoot: [owner.root, item.path].filter(Boolean).join("/"),
      },
    };
  });
}
export async function resolveInstalledSelector(
  options: ReadWorkspaceOptions,
  selector: string,
  coordinator = new StateCoordinator(),
): Promise<{
  readonly address: SkillAddress;
  readonly item: Awaited<ReturnType<StateCoordinator["read"]>>["installed"][number];
}> {
  const [collection, name, extra] = selector.split(":");
  if (!collection || !name || extra)
    throw new SkillCliError("INVALID_ARGUMENT", "Invalid Skill Selector");
  const workspace = await readWorkspaceUnlocked(options);
  const effective = workspace.value.effective;
  if (effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  if (!effective.managed)
    throw new SkillCliError("CONFIG_INVALID", "agents.opencode must be managed");
  if (effective.agent.status !== "available")
    throw new SkillCliError(
      "CONFIG_INVALID",
      effective.agent.reasons[0]?.message ?? "Catalog unavailable",
    );
  const state = await coordinator.read();
  const resolved = await resolveEffectiveCollections(options, workspace.value, state, coordinator);
  const reachable = new Set<string>();
  const pending = [...effective.use];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const reference of Object.values(resolved.references.get(id) ?? {}))
      pending.push(reference.collection);
  }
  if (!reachable.has(collection))
    throw new SkillCliError("SKILL_NOT_FOUND", `Skill Selector is not exposed: ${selector}`);
  const address = resolved.members.get(collection)?.get(name);
  if (!address)
    throw new SkillCliError("SKILL_NOT_FOUND", `Installed Skill not found: ${selector}`);
  const item = state.installed.find(
    (candidate) => candidate.source === address.source && candidate.path === address.path,
  );
  if (!item) throw new SkillCliError("SKILL_NOT_FOUND", `Installed Skill not found: ${selector}`);
  const owner = capturedWorkspace(workspace.value)?.sources.get(item.source);
  if (!owner || owner.bindingDigest !== item.bindingDigest)
    throw new SkillCliError("CONFIG_CONFLICT", "Installed Skill owner is not healthy");
  return { address, item };
}
export async function resolveEffectiveCollections(
  options: ReadWorkspaceOptions,
  workspace: WorkspaceView,
  state: Awaited<ReturnType<StateCoordinator["read"]>>,
  coordinator: StateCoordinator,
  override?: { readonly file: string; readonly value: ConfigDocument },
) {
  const user =
    options.userConfigPath ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
      "skill-cli",
      "config.jsonc",
    );
  const declarations: CollectionContribution[] = [];
  const files = [
    { level: "global" as const, file: user },
    ...(workspace.project.resolution === "global-only"
      ? []
      : [
          { level: "project" as const, file: join(workspace.project.root, "skill-cli.jsonc") },
          { level: "local" as const, file: join(workspace.project.root, "skill-cli.local.jsonc") },
        ]),
  ];
  for (const { level, file } of files) {
    const host = override?.file === file ? override.value : await document(file);
    for (const [id, declaration] of Object.entries(host.collections ?? {})) {
      declarations.push({
        kind: "declared",
        id,
        declaration,
        owner: { level, file, pointer: `/collections/${id}` },
      });
    }
    for (const [configId, binding] of Object.entries(host.configSources ?? {})) {
      const reusable =
        binding.kind === "local"
          ? await document(
              join(canonicalLocalOrigin(binding.path, dirname(file)), binding.root, "config.jsonc"),
              true,
            )
          : state.configs[configId]
            ? await cachedConfig(configId, state, coordinator)
            : undefined;
      if (!reusable) continue;
      for (const [id, value] of Object.entries(reusable.collections ?? {})) {
        const namespaced = `${configId}/${parseQualifiedName(id)}`;
        declarations.push({
          kind: "declared",
          id: namespaced,
          declaration: contributedCollection(configId, value),
          owner: { level, file, pointer: `/configSources/${configId}/collections/${id}` },
        });
      }
    }
  }
  if (workspace.effective.status !== "complete")
    throw new SkillCliError("CONFIG_INVALID", "Configuration is incomplete");
  const sources = capturedWorkspace(workspace)?.sources ?? new Map<string, InternalSourceBinding>();
  return resolveCollections(
    declarations,
    state.installed.map((item) => ({
      source: item.source,
      path: item.path,
      name: item.name,
      ...(repository(sources.get(item.source))
        ? { repository: repository(sources.get(item.source)) }
        : {}),
    })),
  );
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
  const file =
    request.level === "global"
      ? (options.userConfigPath ??
        join(
          process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
          "skill-cli",
          "config.jsonc",
        ))
      : join(
          project.root,
          request.level === "project" ? "skill-cli.jsonc" : "skill-cli.local.jsonc",
        );
  const host = await document(file);
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
      {
        file,
        value: proposedHost,
      },
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
    if (!(error instanceof SkillCliError)) throw error;
    const blocker =
      error instanceof CollectionResolutionError
        ? error.details.kind === "cycle"
          ? { reason: "cycle" as const, collections: error.details.collections }
          : {
              reason: "conflict" as const,
              name: error.details.name,
              existing: error.details.existing,
              proposed: error.details.proposed,
            }
        : { reason: "cycle" as const, collections: [] };
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
function repository(source: Pick<SourceBindingView, "kind" | "origin"> | undefined) {
  if (!source || source.kind === "local") return undefined;
  try {
    const url = new URL(source.origin);
    if (url.hostname !== "github.com") return undefined;
    const path = url.pathname
      .replace(/^\//u, "")
      .replace(/\.git$/u, "")
      .split("/");
    return path.length === 2 && path.every(Boolean) ? `${path[0]!}/${path[1]!}` : undefined;
  } catch {
    return undefined;
  }
}
async function cachedConfig(
  id: string,
  state: Awaited<ReturnType<StateCoordinator["read"]>>,
  coordinator: StateCoordinator,
): Promise<ReusableConfigDocument> {
  const applied = state.configs[id];
  if (!applied)
    throw new SkillCliError("CONFIG_INVALID", `Remote Config Source is not adopted: ${id}`);
  return document(
    join(coordinator.root, "configs", applied.digest, "config.jsonc"),
    true,
  ) as Promise<ReusableConfigDocument>;
}
async function contributionIds(
  project: string | undefined,
  options: ReadWorkspaceOptions,
  state: Awaited<ReturnType<StateCoordinator["read"]>>,
  coordinator: StateCoordinator,
): Promise<Set<string>> {
  const user =
    options.userConfigPath ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
      "skill-cli",
      "config.jsonc",
    );
  const inputs = [
    user,
    ...(project ? [join(project, "skill-cli.jsonc"), join(project, "skill-cli.local.jsonc")] : []),
  ];
  const ids = new Set<string>();
  for (const file of inputs) {
    const host = await document(file);
    for (const [configId, binding] of Object.entries(host.configSources ?? {})) {
      const reusable =
        binding.kind === "local"
          ? await document(
              join(canonicalLocalOrigin(binding.path, dirname(file)), binding.root, "config.jsonc"),
              true,
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
function edit(text: string, path: (string | number)[], value: unknown) {
  return applyEdits(
    text,
    modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  );
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
    const file =
      change.level === "global"
        ? (options.userConfigPath ??
          join(
            process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"),
            "skill-cli",
            "config.jsonc",
          ))
        : join(
            project.root,
            change.level === "project" ? "skill-cli.jsonc" : "skill-cli.local.jsonc",
          );
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
    let next = original;
    let useDelta: ConfigurationChangeResult["use"];
    if (change.type === "source.register" || change.type === "config-source.register") {
      parseQualifiedName(change.id);
      if (immutableContributions.has(change.id))
        throw new SkillCliError("INVALID_ARGUMENT", "Config Source contributions are immutable");
      const key = change.type === "source.register" ? "sources" : "configSources";
      const existing = (await document(file))[key]?.[change.id];
      if (existing)
        throw new SkillCliError(
          "CONFIG_CONFLICT",
          "Source bindings are immutable; remove and register a new Source ID",
        );
      next = edit(next, [key, change.id], {
        ...change.binding,
        root: change.binding.root ?? "",
      });
    } else if (change.type === "collection.create") {
      parseQualifiedName(change.collection);
      if ((await document(file)).collections?.[change.collection])
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
      const outgoing = (await document(file)).collections?.[change.collection]?.links ?? [];
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
      const collection = (await document(file)).collections?.[change.collection];
      if (!collection) throw directlyDeclaredCollectionError(change.collection);
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
      const collection = (await document(file)).collections?.[change.collection];
      if (!collection) throw directlyDeclaredCollectionError(change.collection);
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
      const targetDeclaration = (await document(file)).collections?.[change.into];
      if (!targetDeclaration) throw directlyDeclaredCollectionError(change.into);
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
      const before = [...((await document(file)).use ?? [])];
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
          value: parse(proposedText, [], {
            allowTrailingComma: true,
          }) as ConfigDocument,
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
      const declaration = (await document(file)).collections?.[change.collection];
      if (!declaration) throw directlyDeclaredCollectionError(change.collection);
      if (declaration.references?.[change.name])
        throw new SkillCliError("CONFIG_CONFLICT", "Reference name already exists");
      next = edit(next, ["collections", change.collection, "references", change.name], {
        collection: change.target,
        description: change.description,
      });
    } else if (change.type === "collection.reference.remove") {
      parseQualifiedName(change.collection);
      parseNameSegment(change.name);
      if (!(await document(file)).collections?.[change.collection])
        throw directlyDeclaredCollectionError(change.collection);
      const reference = (await document(file)).collections?.[change.collection]?.references?.[
        change.name
      ];
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
      const declaration = (await document(file)).collections?.[change.collection];
      if (!declaration) throw directlyDeclaredCollectionError(change.collection);
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
    if (!userProjectConfigValidator(proposed))
      throw new SkillCliError("CONFIG_INVALID", "Invalid declaration edit");
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
function decodeConfig(bytes: Uint8Array, path: string) {
  if (bytes.byteLength > textLimit)
    throw new SkillCliError("TEXT_TOO_LARGE", "Configuration exceeds text limit");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkillCliError("INVALID_UTF8", `Configuration is not UTF-8: ${path}`);
  }
}
