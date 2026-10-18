import { dirname, join } from "node:path";
import type { ConfigLevel, ConfigSourceContributionRef } from "./types";
import type { SourceBinding } from "../source/schema";
import type { SourceBindingView } from "../source/types";
import type { InternalSourceBinding } from "../source/identity";
import { SkillCliError } from "../shared";
import { bindingDigest, canonicalLocalOrigin, canonicalRemoteOrigin } from "../source/identity";
import { parseQualifiedName } from "../collection/names";
import { bindingProblemPointer, document, pointerSegment, validateSourceRoot } from "./document";
import type { ReusableConfigDocument } from "./schema";
import type { StateCoordinator } from "../storage/state";
import type { StateContents } from "../storage/schema";

export function sourceView(
  id: string,
  value: SourceBinding,
  file: string,
  level: ConfigLevel,
  inherited?: { readonly origin: string; readonly ref: string; readonly root: string },
  contribution?: ConfigSourceContributionRef,
): InternalSourceBinding {
  parseQualifiedName(id);
  validateSourceRoot(value.root);
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
export function contributedSourceBindings(
  configId: string,
  binding: SourceBinding,
  file: string,
  reusable: ReusableConfigDocument,
  level: ConfigLevel,
  commit?: string,
) {
  const namespace = (id: string) => `${configId}/${parseQualifiedName(id)}`;
  const declarationFile =
    binding.kind === "local"
      ? join(canonicalLocalOrigin(binding.path, dirname(file)), binding.root, "config.jsonc")
      : file;
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
      let source: InternalSourceBinding;
      try {
        source = sourceView(namespace(id), item, declarationFile, level, inherited);
      } catch (error) {
        if (!(error instanceof SkillCliError) || error.code !== "CONFIG_INVALID") throw error;
        throw new SkillCliError("CONFIG_INVALID", error.message, [
          {
            code: error.code,
            severity: "warning",
            message: error.message,
            location: {
              file: declarationFile,
              pointer: bindingProblemPointer(item, `/sources/${pointerSegment(id)}`),
            },
          },
        ]);
      }
      return [source.id, source] as const;
    }),
  );
}
export function contributedCollection(
  configId: string,
  declaration: NonNullable<ReusableConfigDocument["collections"]>[string],
) {
  const namespace = (id: string) => `${configId}/${parseQualifiedName(id)}`;
  return {
    ...(declaration.description ? { description: declaration.description } : {}),
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
export function publicSource(source: InternalSourceBinding): SourceBindingView {
  const { bindingDigest: _bindingDigest, ...view } = source;
  return view;
}
export function repository(source: Pick<SourceBindingView, "kind" | "origin"> | undefined) {
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
export function installedCollectionInputs(
  state: StateContents,
  sources: ReadonlyMap<string, InternalSourceBinding>,
) {
  return state.installed.map((item) => {
    const repositoryId = repository(sources.get(item.source));
    return {
      source: item.source,
      path: item.path,
      name: item.name,
      ...(repositoryId ? { repository: repositoryId } : {}),
    };
  });
}
export async function cachedConfig(
  id: string,
  state: Pick<StateContents, "configs">,
  coordinator: StateCoordinator,
): Promise<ReusableConfigDocument> {
  const applied = state.configs[id];
  if (!applied)
    throw new SkillCliError("CONFIG_INVALID", `Remote Config Source is not adopted: ${id}`);
  return document(join(coordinator.root, "configs", applied.digest, "config.jsonc"), "reusable");
}
