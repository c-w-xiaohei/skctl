import type {
  ConfigDeclarationOwner,
  ConfigSourceContributionRef,
  ManagementProjection,
} from "../core/api";
import { filterSkills } from "./skills-filter";
import type { Destination } from "./types";
import type { WorkspaceSnapshot } from "./workspace/state";
import type { CollectionsSnapshot } from "./collections/state";
import type { ConfigSnapshot } from "./config/state";

export interface PageActionFacts {
  readonly workspace: WorkspaceSnapshot;
  readonly collections: CollectionsSnapshot;
  readonly config: (destination: Exclude<Destination, "workspace">) => ConfigSnapshot;
}

export const actionIds = [
  "open-actions",
  "open-palette",
  "add-skills",
  "check-updates",
  "view-installed-skills",
  "open-config",
  "open-config-source",
  "remove-source",
  "new-collection",
  "add-membership",
  "remove-membership",
  "import-collection",
  "add-reference",
  "remove-reference",
  "add-link",
  "remove-link",
  "set-collection-use",
  "remove-collection",
  "skill-add-to-collection",
  "skill-for-agents",
  "skill-open-source",
  "skill-check-updates",
  "skill-rebind",
  "skill-uninstall",
  "config-observe",
  "config-adopt",
  "config-forget",
  "config-remove",
  "enable-managed-opencode",
  "disable-managed-opencode",
  "add-source",
  "add-config-source",
] as const;
export type ActionId = (typeof actionIds)[number];

export interface ActionDescriptor {
  readonly id: ActionId;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

export type DirectSourceIntent = {
  readonly kind: "source-removal";
  readonly source: string;
  readonly owner: ConfigDeclarationOwner;
};

export type SourceOperationIntent =
  | { readonly kind: "source-discovery"; readonly source: string }
  | { readonly kind: "source-update"; readonly source: string; readonly selectedPath?: string };

export type SourceRouteIntent =
  | {
      readonly kind: "open-config";
      readonly owner: ConfigDeclarationOwner;
      readonly source: string;
    }
  | {
      readonly kind: "open-config-source";
      readonly contribution: ConfigSourceContributionRef;
      readonly source: string;
    };

export interface SourceActionContext {
  readonly source: string;
  readonly contribution?: ConfigSourceContributionRef;
  readonly directOwner?: ConfigDeclarationOwner;
  readonly destination: Destination;
}

export function installedSkillContext(
  destination: Destination,
  projection: ManagementProjection | undefined,
  pages: PageActionFacts,
): { readonly skill: ManagementProjection["installedSkills"][number] } | undefined {
  const workspace = pages.workspace;
  if (!projection || destination !== "workspace" || workspace.section !== "skills")
    return undefined;
  const selected = workspace.selectedSkill;
  const skill = filterSkills(projection.installedSkills, {
    query: workspace.query,
    filters: workspace.filters,
    source: workspace.sourceFilter,
    agentStatus: projection.effective.agent.status,
  }).find((item) => `${item.address.source}/${item.address.path}` === selected);
  return skill ? { skill } : undefined;
}

export function selectedSourceContext(
  destination: Destination,
  projection: ManagementProjection | undefined,
  pages: PageActionFacts,
): SourceActionContext | undefined {
  const section =
    destination === "workspace" ? pages.workspace.section : pages.config(destination).section;
  if (!projection || section !== "sources") return undefined;
  const selected =
    destination === "workspace"
      ? pages.workspace.selectedSource
      : pages.config(destination).selection.sources;
  const sources =
    destination === "workspace"
      ? projection.effective.sources
      : [
          ...(projection.configs.find((config) => config.level === destination)?.direct.sources ??
            []),
          ...(projection.configs.find((config) => config.level === destination)?.contributed
            .sources ?? []),
        ];
  const source = sources.find((item) => item.id === selected);
  if (!source) return undefined;
  if (destination === "workspace") {
    const direct = projection.configs
      .flatMap((config) => config.direct.sources)
      .find((item) => item.id === source.id);
    return {
      source: source.id,
      contribution: source.contribution,
      directOwner: direct?.ref.owner,
      destination,
    };
  }
  const config = projection.configs.find((item) => item.level === destination);
  const direct = config?.direct.sources.find((item) => item.id === source.id);
  return {
    source: source.id,
    contribution: source.contribution,
    directOwner: direct?.ref.owner,
    destination,
  };
}

export function directSourceOwner(
  projection: ManagementProjection,
  sourceId: string,
): ConfigDeclarationOwner | undefined {
  for (const config of projection.configs) {
    const direct = config.direct.sources.find((source) => source.id === sourceId);
    if (direct) return direct.ref.owner;
  }
  return undefined;
}

export function reachableActions(
  destination: Destination,
  projection: ManagementProjection | undefined,
  pages: PageActionFacts,
): readonly ActionDescriptor[] {
  const currentSection =
    destination === "workspace" ? pages.workspace.section : pages.config(destination).section;
  const context = selectedSourceContext(destination, projection, pages);
  if (
    projection &&
    destination === "workspace" &&
    pages.workspace.section === "collections" &&
    projection.effective.status === "complete"
  ) {
    const collection = projection.effective.collectionsView.find(
      (item) => item.id === pages.collections.selected,
    );
    const direct = collection?.declared.find((owner) => !owner.contribution);
    return [
      {
        id: "new-collection",
        title: "New Collection",
        description: "Create an empty Collection in Global, Project, or Local configuration",
        enabled: true,
      },
      ...(direct
        ? [
            {
              id: "add-membership" as const,
              title: "Add Membership",
              description: `Add an Installed Skill to ${collection!.id} (${direct.level})`,
              enabled: projection.installedSkills.length > 0,
              reason: projection.installedSkills.length
                ? undefined
                : "No Installed Skill is available",
            },
            {
              id: "import-collection" as const,
              title: "Import Collection",
              description: `Copy effective Memberships into ${collection!.id} (${direct.level})`,
              enabled: true,
            },
            {
              id: "add-reference" as const,
              title: "Add Reference",
              description: `Describe another Collection from ${collection!.id}`,
              enabled: true,
            },
            {
              id: "add-link" as const,
              title: "Add Link",
              description: `Expose a linked Collection through ${collection!.id}`,
              enabled: true,
            },
            {
              id: "remove-collection" as const,
              title: "Remove Collection",
              description: `Remove the direct ${collection!.id} declaration`,
              enabled: true,
            },
          ]
        : collection?.repository.derived
          ? [
              {
                id: "add-membership" as const,
                title: "Add Membership",
                description: `Create a direct contribution for ${collection.id} before adding a Membership`,
                enabled: true,
              },
            ]
          : []),
    ];
  }
  if (projection && destination !== "workspace") {
    const config = projection.configs.find((item) => item.level === destination);
    const collection = config?.direct.collections.find(
      (item) =>
        item.id ===
        pages.config(destination as Exclude<Destination, "workspace">).selection.collections,
    );
    if (pages.config(destination as Exclude<Destination, "workspace">).section === "for-agents")
      return [
        {
          id: "set-collection-use",
          title: "Set Collection Use",
          description: `Set the Collections disclosed by ${destination} configuration`,
          enabled: true,
        },
      ];
    if (pages.config(destination as Exclude<Destination, "workspace">).section === "integrations") {
      const managed = config?.direct.integrations.some((item) => item.kind === "opencode") ?? false;
      return [
        {
          id: managed ? "disable-managed-opencode" : "enable-managed-opencode",
          title: managed ? "Disable Managed OpenCode" : "Enable Managed OpenCode",
          description: managed
            ? "Remove this Config owner's managed OpenCode integration"
            : "Enable managed OpenCode in this Config owner",
          enabled: true,
        },
      ];
    }
    if (
      pages.config(destination as Exclude<Destination, "workspace">).section === "config-sources"
    ) {
      const selected = pages.config(destination as Exclude<Destination, "workspace">).selection[
        "config-sources"
      ];
      const source = config?.direct.configSources.find((item) => item.owner.pointer === selected);
      if (!source)
        return [
          {
            id: "add-config-source",
            title: "Add Config Source",
            description: `Register a Config Source in ${destination} configuration`,
            enabled: true,
          },
        ];
      const remote = source.binding.kind !== "local";
      return [
        ...(remote && source.adoption.status !== "adopted"
          ? [
              {
                id: "config-observe" as const,
                title: "Observe Remote Config",
                description: "Resolve and inspect the exact remote revision",
                enabled: true,
              },
            ]
          : []),
        ...(remote
          ? [
              {
                id: "config-adopt" as const,
                title: "Adopt Observed Config",
                description: "Adopt an observed exact remote revision",
                enabled: true,
              },
            ]
          : []),
        ...(remote && source.adoption.status === "adopted"
          ? [
              {
                id: "config-forget" as const,
                title: "Forget Adopted Config",
                description: "Remove adopted remote Config bytes",
                enabled: true,
              },
            ]
          : []),
        {
          id: "config-remove",
          title: "Remove Config Source",
          description: "Remove this exact direct Config Source declaration",
          enabled: true,
        },
        {
          id: "add-config-source",
          title: "Add Config Source",
          description: `Register another Config Source in ${destination} configuration`,
          enabled: true,
        },
      ];
    }
    if (pages.config(destination as Exclude<Destination, "workspace">).section === "collections")
      return [
        {
          id: "new-collection",
          title: "New Collection",
          description: `Create an empty Collection in ${destination} configuration`,
          enabled: true,
        },
        ...(collection
          ? [
              {
                id: "add-membership" as const,
                title: "Add Membership",
                description: `Add an Installed Skill to ${collection.id}`,
                enabled: projection.installedSkills.length > 0,
                reason: projection.installedSkills.length
                  ? undefined
                  : "No Installed Skill is available",
              },
              {
                id: "import-collection" as const,
                title: "Import Collection",
                description: `Copy effective Memberships into ${collection.id}`,
                enabled: true,
              },
              {
                id: "add-reference" as const,
                title: "Add Reference",
                description: `Describe another Collection from ${collection.id}`,
                enabled: true,
              },
              {
                id: "add-link" as const,
                title: "Add Link",
                description: `Expose a linked Collection through ${collection.id}`,
                enabled: true,
              },
              {
                id: "remove-collection" as const,
                title: "Remove Collection",
                description: `Remove the direct ${collection.id} declaration`,
                enabled: true,
              },
            ]
          : []),
      ];
  }
  if (!context)
    return projection && currentSection === "sources"
      ? [
          {
            id: "add-source",
            title: "Add Source",
            description: "Register a Source in Global, Project, or Local configuration",
            enabled: true,
          },
        ]
      : selectedSkillActions(destination, projection, pages);
  const common = [
    {
      id: "add-skills" as const,
      title: "Add Skills",
      description: "Discover and install Skill Roots from this Source",
      enabled: true,
    },
    {
      id: "check-updates" as const,
      title: "Check Updates",
      description: "Check installed Skills for updates",
      enabled: true,
    },
    {
      id: "view-installed-skills" as const,
      title: "View Installed Skills",
      description: "Show Installed Skills owned by this Source",
      enabled: true,
    },
  ];
  const addSource = {
    id: "add-source" as const,
    title: "Add Source",
    description: "Register another Source in Global, Project, or Local configuration",
    enabled: true,
  };
  const unavailableReason =
    projection?.effective.status === "unavailable"
      ? (projection.effective.reasons[0]?.message ??
        "The effective Workspace projection is unavailable")
      : undefined;
  if (context.contribution) {
    return [
      ...common,
      {
        id: "open-config-source",
        title: "Open Config Source",
        description: "Open the contributing Config Source",
        enabled: true,
      },
      addSource,
    ];
  }
  return context.directOwner
    ? [
        ...common,
        {
          id: "open-config",
          title: "Open Config",
          description: "Open the owning Config",
          enabled: true,
        },
        {
          id: "remove-source",
          title: "Remove Source",
          description: "Remove this direct Source declaration",
          enabled: !unavailableReason,
          reason: unavailableReason,
        },
        addSource,
      ]
    : [...common, addSource];
}

export function selectedSkillActions(
  destination: Destination,
  projection: ManagementProjection | undefined,
  pages: PageActionFacts,
): readonly ActionDescriptor[] {
  if (!projection || destination !== "workspace" || pages.workspace.section !== "skills") return [];
  const context = installedSkillContext(destination, projection, pages);
  if (!context) return [];
  const { skill } = context;
  const address = `${skill.address.source}/${skill.address.path}`;
  const source = skill.source;
  const healthy = skill.owner.health === "healthy";
  const sourceReason = source ? undefined : `Source ${skill.address.source} is not available`;
  const collectionReason =
    projection.effective.status === "complete" &&
    projection.effective.collectionsView.some((collection) =>
      collection.declared.some((owner) => !owner.contribution),
    )
      ? undefined
      : "No direct Collection is available for this Installed Skill";
  const handoff = (title: string, enabled: boolean, reason?: string): ActionDescriptor => ({
    id: `skill-${title.toLowerCase().replaceAll(" ", "-")}` as ActionId,
    title,
    description: `${address}; choose its exact owner`,
    enabled,
    reason,
  });
  return [
    handoff("Add to collection", !collectionReason, collectionReason),
    handoff(
      "For agents",
      skill.selectorViews.status === "complete",
      skill.selectorViews.status === "complete"
        ? undefined
        : "Agent selector paths are unavailable",
    ),
    {
      id: "skill-open-source",
      title: "Open source",
      description: source ? `Open ${source.origin} for ${address}` : `Open ${address} source`,
      enabled: !!source,
      reason: sourceReason,
    },
    {
      id: "skill-check-updates",
      title: "Check updates",
      description: `Check updates for Source ${skill.address.source}`,
      enabled: !!source && healthy,
      reason: sourceReason ?? (healthy ? undefined : `Owner is ${skill.owner.health}`),
    },
    handoff("Rebind", true),
    handoff("Uninstall", true),
  ];
}

export function skillSourceIntent(
  destination: Destination,
  projection: ManagementProjection,
  pages: PageActionFacts,
): {
  readonly kind: "source-update";
  readonly source: string;
  readonly path: string;
} {
  const context = installedSkillContext(destination, projection, pages);
  if (!context) throw new Error("No Installed Skill is selected");
  return {
    kind: "source-update",
    source: context.skill.owner.source,
    path: context.skill.address.path,
  };
}

export function sourceOperationIntent(
  id: "add-skills" | "check-updates",
  destination: Destination,
  projection: ManagementProjection,
  pages: PageActionFacts,
): SourceOperationIntent {
  const context = selectedSourceContext(destination, projection, pages);
  if (!context) throw new Error(`${id} is not reachable for this selection`);
  return {
    kind: id === "add-skills" ? "source-discovery" : "source-update",
    source: context.source,
  };
}

export function actionIntent(
  id: "remove-source",
  destination: Destination,
  projection: ManagementProjection,
  pages: PageActionFacts,
): DirectSourceIntent {
  const context = selectedSourceContext(destination, projection, pages);
  const source = context?.source;
  const owner = context?.directOwner;
  if (!source || !owner) throw new Error("Remove Source is not reachable for this selection");
  return { kind: "source-removal", source, owner };
}

export function sourceRouteIntent(
  id: "open-config",
  destination: Destination,
  projection: ManagementProjection,
  pages: PageActionFacts,
): Extract<SourceRouteIntent, { readonly kind: "open-config" }>;
export function sourceRouteIntent(
  id: "open-config-source",
  destination: Destination,
  projection: ManagementProjection,
  pages: PageActionFacts,
): Extract<SourceRouteIntent, { readonly kind: "open-config-source" }>;
export function sourceRouteIntent(
  id: "open-config" | "open-config-source",
  destination: Destination,
  projection: ManagementProjection,
  pages: PageActionFacts,
): SourceRouteIntent {
  const context = selectedSourceContext(destination, projection, pages);
  if (!context) throw new Error("No Source is selected");
  if (id === "open-config-source" && context.contribution)
    return {
      kind: "open-config-source",
      contribution: context.contribution,
      source: context.source,
    };
  const owner = id === "open-config" ? context.directOwner : undefined;
  if (!owner) throw new Error(`${id} is not reachable for this selection`);
  return { kind: "open-config", owner, source: context.source };
}
