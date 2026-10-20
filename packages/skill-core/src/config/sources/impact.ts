import type { WorkspaceView } from "../../workspace/types";
import type { ImpactBlocker } from "../../collection/types";
import type {
  ConfigDeclarationOwner,
  ConfigSourceView,
  ConfigSourceContributionImpact,
  ConfigSourceImpact,
} from "../types";
import type { ReusableConfigDocument } from "../schema";
import { contributedSourceBindings } from "../bindings";

export function contributions(
  source: ConfigSourceView,
  value: ReusableConfigDocument,
  commit?: string,
): ConfigSourceContributionImpact {
  const bindings = contributedSourceBindings(
    source.id,
    source.binding,
    source.owner.file,
    value,
    source.owner.level,
    commit,
  );
  const namespace = commit ? `${source.id}@${commit}` : source.id;
  const owner = (pointer: string): ConfigDeclarationOwner => ({
    level: source.owner.level,
    file: source.owner.file,
    pointer,
    namespace,
  });
  return {
    sources: [...bindings.values()]
      .map((item) => ({
        id: item.id,
        owner: owner(`/sources/${item.id.slice(source.id.length + 1)}`),
        binding: {
          kind: item.kind,
          origin: item.origin,
          root: item.root,
          ...(item.ref ? { ref: item.ref } : {}),
        },
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    collections: Object.keys(value.collections ?? {})
      .sort()
      .map((id) => ({ id: `${source.id}/${id}`, owner: owner(`/collections/${id}`) })),
  };
}

export function configDependencies(
  workspace: WorkspaceView,
  source: ConfigSourceView,
  removedSources: ReadonlySet<string>,
  removedCollections: ReadonlySet<string>,
): ImpactBlocker[] {
  if (workspace.effective.status !== "complete") return [{ reason: "incomplete" }];
  const owns = (owner?: ConfigDeclarationOwner) =>
    owner?.contribution?.configSource.pointer === source.owner.pointer &&
    owner.contribution.configSource.file === source.owner.file;
  const blockers: ImpactBlocker[] = [];
  for (const collection of workspace.effective.collectionsView) {
    for (const member of collection.members) {
      if (!removedSources.has(member.address.source)) continue;
      for (const path of member.paths)
        if (path.kind === "direct" && path.owner && !owns(path.owner))
          blockers.push({ reason: "membership", owner: path.owner });
    }
    for (const reference of collection.references)
      if (removedCollections.has(reference.collection) && !owns(reference.owner))
        blockers.push({ reason: "reference", owner: reference.owner });
    for (const link of collection.links)
      if (removedCollections.has(link.collection) && !owns(link.owner))
        blockers.push({ reason: "link", owner: link.owner });
  }
  for (const host of workspace.configs)
    for (const use of host.direct.collectionUse)
      if (removedCollections.has(use.collection))
        blockers.push({ reason: "use", owner: use.owner });
  return blockers;
}

export function configImpact(
  workspace: WorkspaceView,
  source: ConfigSourceView,
  kind: ConfigSourceImpact["kind"],
  current: ReusableConfigDocument | undefined,
  proposed?: ReusableConfigDocument,
  revision?: string,
): ConfigSourceImpact {
  const before = current
    ? contributions(
        source,
        current,
        source.adoption.status === "adopted" ? source.adoption.commit : undefined,
      )
    : { sources: [], collections: [] };
  const after = proposed
    ? contributions(source, proposed, revision)
    : { sources: [], collections: [] };
  const delta: ConfigSourceImpact["delta"] = {
    addedSources: after.sources.filter((item) => !before.sources.some((old) => old.id === item.id)),
    changedSources: after.sources.filter((item) =>
      before.sources.some(
        (old) => old.id === item.id && JSON.stringify(old.binding) !== JSON.stringify(item.binding),
      ),
    ),
    removedSources: before.sources.filter(
      (item) => !after.sources.some((next) => next.id === item.id),
    ),
    addedCollections: after.collections.filter(
      (item) => !before.collections.some((old) => old.id === item.id),
    ),
    changedCollections: after.collections.filter((item) => {
      const name = item.id.slice(source.id.length + 1);
      return (
        current?.collections?.[name] &&
        JSON.stringify(current.collections[name]) !== JSON.stringify(proposed?.collections?.[name])
      );
    }),
    removedCollections: before.collections.filter(
      (item) => !after.collections.some((next) => next.id === item.id),
    ),
  };
  const owners = new Set([...delta.changedSources, ...delta.removedSources].map((item) => item.id));
  const affected = workspace.installedSkills.filter((item) => owners.has(item.address.source));
  const blockers: ImpactBlocker[] = [
    ...affected.map((item) => ({ reason: "installed" as const, address: item.address })),
    ...configDependencies(
      workspace,
      source,
      new Set(delta.removedSources.map((item) => item.id)),
      new Set(delta.removedCollections.map((item) => item.id)),
    ),
  ];
  return {
    kind,
    id: source.id,
    owner: source.owner,
    binding: source.binding,
    currentAppliedCommit: source.adoption.status === "adopted" ? source.adoption.commit : undefined,
    exactRevision: revision,
    declarationRetained: kind !== "config-source-removal",
    contributions: proposed ? after : before,
    delta,
    affectedInstalled: affected.map((item) => item.address),
    disappearingSelectors: affected.flatMap((item) => item.selectors),
    blockers,
    allowed: !blockers.length,
  };
}
