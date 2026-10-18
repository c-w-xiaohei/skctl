import type { WorkspaceView } from "@skill-cli/core";
import { skillAddressKey } from "@skill-cli/core";
import type { ExposurePath, ExposurePathSegment } from "./state";

export type AgentAccessTreeNodeId =
  | { readonly kind: "collection"; readonly path: ExposurePath }
  | {
      readonly kind: "reference";
      readonly path: ExposurePath;
      readonly name: string;
      readonly target: string;
    }
  | {
      readonly kind: "skill";
      readonly path: ExposurePath;
      readonly entry: string;
      readonly address: { readonly source: string; readonly path: string };
    };

interface TreeRowBase {
  readonly key: string;
  readonly nodeId: AgentAccessTreeNodeId;
  readonly depth: number;
  readonly description?: string;
  readonly missingReason?: string;
}

type SkillHealth = WorkspaceView["installedSkills"][number]["owner"]["health"];

export type AgentAccessTreeRow =
  | (TreeRowBase & {
      readonly kind: "collection";
      readonly name: string;
      readonly collection: string;
      readonly expandable: boolean;
      readonly cycle?: false;
    })
  | (TreeRowBase & {
      readonly kind: "reference";
      readonly name: string;
      readonly target: string;
      readonly expandable: boolean;
      readonly cycle: boolean;
    })
  | (TreeRowBase & {
      readonly kind: "skill";
      readonly name: string;
      readonly entry: string;
      readonly address: { readonly source: string; readonly path: string };
      readonly expandable: false;
      readonly availability:
        | { readonly status: "available" }
        | { readonly status: "unavailable"; readonly health?: SkillHealth };
    });

export type AgentAccessTree =
  | { readonly status: "unavailable"; readonly reason: string; readonly rows: readonly [] }
  | { readonly status: "available"; readonly rows: readonly AgentAccessTreeRow[] };

/** JSON tuple encoding keeps identities structural and collision-safe across paths and names. */
export const exposureTreePathKey = (path: ExposurePath): string =>
  JSON.stringify(path.segments.map((segment) => [segment.collection, segment.reference]));

/** Validates one durable expanded branch without materialising unrelated graph paths. */
export const isAgentAccessPathValid = (projection: WorkspaceView, path: ExposurePath): boolean => {
  if (projection.effective.status !== "complete" || !path.segments.length) return false;
  const views = new Map(projection.effective.collectionsView.map((view) => [view.id, view]));
  let current = path.segments[0]!.collection;
  if (!projection.effective.use.includes(current) || !views.has(current)) return false;
  for (const segment of path.segments.slice(1)) {
    const reference = segment.reference;
    if (
      !reference ||
      segment.collection !== reference.target ||
      !views
        .get(current)
        ?.references.some(
          (candidate) =>
            candidate.name === reference.name && candidate.collection === reference.target,
        )
    )
      return false;
    current = segment.collection;
    if (!views.has(current)) return false;
  }
  return true;
};

const unavailable = (reason: string): AgentAccessTree => ({
  status: "unavailable",
  reason,
  rows: [],
});

/**
 * Projects only currently visible rows from canonical management facts. Root Use rows are always
 * collapsed; each expanded branch adds one immediate layer. No content reads or management calls.
 */
export function deriveAgentAccessTree(
  projection: WorkspaceView | undefined,
  expanded: Readonly<Record<string, boolean>> = {},
): AgentAccessTree {
  if (!projection) return unavailable("Workspace projection is not available");
  if (projection.effective.status !== "complete")
    return unavailable("Agent access is unavailable until the workspace projection is complete");
  if (!projection.effective.managed)
    return unavailable("Managed OpenCode Agent access is unavailable for this workspace");
  if (projection.effective.agent.status !== "available")
    return unavailable("Managed OpenCode Agent access is unavailable for this workspace");

  const views = new Map(projection.effective.collectionsView.map((view) => [view.id, view]));
  const skills = new Map(
    projection.installedSkills.map((skill) => [skillAddressKey(skill.address), skill]),
  );
  const rows: AgentAccessTreeRow[] = [];

  const appendCollection = (
    collectionId: string,
    path: ExposurePath,
    depth: number,
    ancestors: ReadonlySet<string>,
    includeCollectionRow = true,
  ) => {
    const key = exposureTreePathKey(path);
    const view = views.get(collectionId);
    if (!view) {
      if (includeCollectionRow)
        rows.push({
          kind: "collection",
          name: collectionId,
          collection: collectionId,
          key,
          nodeId: { kind: "collection", path },
          depth,
          expandable: false,
          missingReason: `Collection '${collectionId}' is unavailable`,
        });
      return;
    }

    const expandable = view.references.length > 0 || view.members.length > 0;
    if (includeCollectionRow)
      rows.push({
        kind: "collection",
        name: collectionId,
        collection: collectionId,
        key,
        nodeId: { kind: "collection", path },
        depth,
        description: view.description,
        expandable,
      });
    if (!expanded[key]) return;

    const references = [...view.references].sort(
      (a, b) => a.name.localeCompare(b.name) || a.collection.localeCompare(b.collection),
    );
    const members = [...view.members].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.address.source.localeCompare(b.address.source) ||
        a.address.path.localeCompare(b.address.path),
    );

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(collectionId);
    for (const reference of references) {
      const segment: ExposurePathSegment = {
        collection: reference.collection,
        reference: { name: reference.name, target: reference.collection },
      };
      const childPath: ExposurePath = { segments: [...path.segments, segment] };
      const cycle = nextAncestors.has(reference.collection);
      const targetExists = views.has(reference.collection);
      const childKey = exposureTreePathKey(childPath);
      rows.push({
        kind: "reference",
        name: reference.name,
        target: reference.collection,
        key: childKey,
        nodeId: {
          kind: "reference",
          path: childPath,
          name: reference.name,
          target: reference.collection,
        },
        depth: depth + 1,
        description: reference.description,
        expandable:
          !cycle &&
          targetExists &&
          (views.get(reference.collection)!.members.length > 0 ||
            views.get(reference.collection)!.references.length > 0),
        cycle,
        missingReason: targetExists
          ? undefined
          : `Referenced Collection '${reference.collection}' is unavailable`,
      });
      if (!cycle && targetExists && expanded[childKey])
        appendCollection(reference.collection, childPath, depth + 1, nextAncestors, false);
    }
    for (const member of members) {
      const address = member.address;
      const skill = skills.get(skillAddressKey(address));
      const memberPath: ExposurePath = { segments: [...path.segments] };
      const memberKey = JSON.stringify([
        exposureTreePathKey(memberPath),
        "skill",
        member.name,
        address.source,
        address.path,
      ]);
      rows.push({
        kind: "skill",
        name: member.name,
        entry: member.name,
        address,
        key: memberKey,
        nodeId: { kind: "skill", path: memberPath, entry: member.name, address },
        depth: depth + 1,
        description: skill?.description,
        expandable: false,
        availability:
          skill?.owner.health === "healthy"
            ? { status: "available" }
            : { status: "unavailable", health: skill?.owner.health },
        missingReason:
          skill?.owner.health === "healthy"
            ? undefined
            : skill
              ? `Installed Skill is unhealthy (${skill.owner.health}) and unavailable to Agent access`
              : `Installed Skill '${address.source}/${address.path}' is unavailable`,
      });
    }
  };

  // A Use root is shown even if stale/missing, to explain the projection rather than hiding it.
  for (const root of [...projection.effective.use].sort((a, b) => a.localeCompare(b)))
    appendCollection(root, { segments: [{ collection: root }] }, 0, new Set());
  return { status: "available", rows };
}
