import type {
  ConfigDeclarationOwner,
  ConfigSourceContributionRef,
  WorkspaceView,
  SkillAddress,
} from "@skctl/core";
import { filterSkills } from "./skills-filter";
import { deriveAgentAccessTree } from "./collections/agent-access-tree";
import { sameSkillAddress, type CommandRecord, type Destination } from "./types";
import {
  filterProblemRows,
  problemRowKey,
  problemRows,
  type WorkspaceSnapshot,
} from "./workspace/state";
import { unassignedSkills, type CollectionsSnapshot } from "./collections/state";
import { configDeclarationOwnerKey, type ConfigSnapshot } from "./config/state";
import { skillsStatus } from "./workspace/skills-status";

export interface PageActionFacts {
  readonly workspace: WorkspaceSnapshot;
  /** Semantic navigation owns this detail; an inline Reader or stale browser cursor must not set it. */
  readonly explicitSkillDetail?: boolean;
  readonly collections: CollectionsSnapshot;
  readonly config: (destination: Exclude<Destination, "workspace">) => ConfigSnapshot;
}

export const actionIds = [
  "open-palette",
  "add-skills",
  "check-updates",
  "collection-check-updates",
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
  "skill-add-selected-to-collection",
  "skill-open-collection-use",
  "skill-open-source",
  "skill-check-updates",
  "skill-rebind",
  "skill-uninstall",
  "config-observe",
  "config-forget",
  "config-remove",
  "enable-managed-opencode",
  "disable-managed-opencode",
  "open-config-integration",
  "add-source",
  "add-config-source",
] as const;
export type ActionId = (typeof actionIds)[number];

interface ActionIntent {
  readonly id: ActionId;
  readonly title: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

/** A generic action's visible command and its dispatch identifier are one record. */
export type ActionRecord = CommandRecord & {
  readonly id: ActionId;
  /** Exact current-object or checked-set scope for Collection chooser actions. */
  readonly description?: string;
};

export function selectedConfigIntegrationOwner(
  projection: WorkspaceView,
  destination: Exclude<Destination, "workspace">,
  config: ConfigSnapshot,
): ConfigDeclarationOwner | undefined {
  const selected = config.selection.integrations;
  if (!selected) return undefined;
  const current = projection.configs.find((item) => item.level === destination);
  const direct = current?.direct.integrations.find(
    (item) => configDeclarationOwnerKey(item.owner) === selected,
  );
  if (direct) return direct.owner;
  return projection.effective.agent.integration.find(
    (owner) => configDeclarationOwnerKey(owner) === selected,
  );
}

export type DirectSourceIntent = {
  readonly kind: "source-removal";
  readonly source: string;
  readonly owner: ConfigDeclarationOwner;
};

export type SourceOperationIntent = { readonly kind: "source-discovery"; readonly source: string };

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
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): { readonly skill: WorkspaceView["installedSkills"][number] } | undefined {
  const workspace = pages.workspace;
  if (!projection || destination !== "workspace" || workspace.section !== "skills")
    return undefined;
  const selected = workspace.selectedSkill;
  if (!selected) return undefined;
  let candidates = projection.installedSkills;
  if (!pages.explicitSkillDetail) {
    if (workspace.skillsView === "problems") {
      const problem = filterProblemRows(
        problemRows(projection),
        workspace.query,
        workspace.filters,
      ).find((row) => problemRowKey(row) === workspace.selectedProblem);
      if (
        problem?.intent?.kind !== "installed-skill" ||
        !sameSkillAddress(problem.intent.address, selected)
      )
        return undefined;
    } else if (workspace.skillsView === "current-exposure") {
      const row = deriveAgentAccessTree(projection, workspace.expandedExposurePaths).rows.find(
        (candidate) => candidate.key === workspace.selectedExposurePath,
      );
      if (
        row?.kind !== "skill" ||
        row.availability.status !== "available" ||
        !sameSkillAddress(row.address, selected)
      )
        return undefined;
    } else {
      candidates = filterSkills(
        workspace.skillsView === "unassigned" ? unassignedSkills(projection) : candidates,
        {
          query: workspace.query,
          filters: workspace.filters,
          source: workspace.sourceFilter,
          agentStatus: projection.effective.agent.status,
          collectionViews:
            projection.effective.status === "complete"
              ? projection.effective.collectionsView
              : undefined,
        },
      );
    }
  }
  const skill = candidates.find((item) => sameSkillAddress(item.address, selected));
  return skill ? { skill } : undefined;
}

/** Resolve an exact Collection chooser target set; never fall back between current and checked. */
export function skillCollectionTargets(
  id: "skill-add-to-collection" | "skill-add-selected-to-collection",
  destination: Destination,
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): { readonly addresses: readonly SkillAddress[]; readonly reason?: string } {
  if (!projection || destination !== "workspace" || pages.workspace.section !== "skills")
    return { addresses: [], reason: "Installed Skills are not available in this view" };
  let addresses: readonly SkillAddress[];
  if (id === "skill-add-to-collection") {
    const context = installedSkillContext(destination, projection, pages);
    if (!context)
      return { addresses: [], reason: "No current visible Installed Skill is selected" };
    addresses = [context.skill.address];
  } else {
    addresses = pages.workspace.selectedSkills;
    if (!addresses.length) return { addresses: [], reason: "No Installed Skills are checked" };
    const missing = addresses.filter(
      (address) =>
        !projection.installedSkills.some((skill) => sameSkillAddress(skill.address, address)),
    );
    if (missing.length)
      return {
        addresses: [],
        reason: `Checked Installed Skills are no longer installed: ${missing
          .map((address) => JSON.stringify(address))
          .join(", ")}; clear or reselect the checked set`,
      };
  }
  const available =
    projection.effective.status === "complete" &&
    projection.effective.collectionsView.some(
      (collection) =>
        collection.declared.some((owner) => !owner.contribution) || collection.repository.derived,
    );
  return available
    ? { addresses }
    : {
        addresses,
        reason: "No direct or repository-derived Collection is available for these targets",
      };
}

export function selectedSourceContext(
  destination: Destination,
  projection: WorkspaceView | undefined,
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

function reachableActionIntents(
  destination: Destination,
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): readonly ActionIntent[] {
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
        id: "collection-check-updates" as const,
        title: "Check Collection updates",
        description: `Check installed Skills reachable from ${collection?.id ?? "this Collection"}`,
        enabled: !!collection,
      },
      {
        id: "new-collection",
        title: "New Collection",
        enabled: true,
      },
      ...(direct
        ? collectionMutationIntents(projection.installedSkills.length)
        : collection?.repository.derived
          ? [
              {
                id: "add-membership" as const,
                title: "Add Membership",
                enabled: true,
              },
            ]
          : []),
    ];
  }
  if (projection && destination !== "workspace") {
    const config = projection.configs.find((item) => item.level === destination);
    // A missing Config can be created, but parsed failures have no editable declarations.
    if (config && config.file.status !== "valid" && config.file.status !== "missing") return [];
    const collection = config?.direct.collections.find(
      (item) =>
        item.id ===
        pages.config(destination as Exclude<Destination, "workspace">).selection.collections,
    );
    const collectionUse = config?.direct.collectionUse.find(
      (item) =>
        item.collection ===
        pages.config(destination as Exclude<Destination, "workspace">).selection.collections,
    );
    if (pages.config(destination as Exclude<Destination, "workspace">).section === "integrations") {
      const selectedOwner = selectedConfigIntegrationOwner(
        projection,
        destination as Exclude<Destination, "workspace">,
        pages.config(destination as Exclude<Destination, "workspace">),
      );
      const direct = config?.direct.integrations.find(
        (item) =>
          selectedOwner &&
          configDeclarationOwnerKey(item.owner) === configDeclarationOwnerKey(selectedOwner),
      );
      if (selectedOwner && !direct)
        return [
          {
            id: "open-config-integration",
            title: "Open owning Config",
            enabled: true,
          },
        ];
      if (!selectedOwner && projection.effective.agent.integration.length > 0) return [];
      const managed = direct?.kind === "opencode";
      if (selectedOwner && !managed) return [];
      return [
        {
          id: managed ? "disable-managed-opencode" : "enable-managed-opencode",
          title: managed ? "Disable Managed OpenCode" : "Enable Managed OpenCode",
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
            enabled: true,
          },
        ];
      const remote = source.binding.kind !== "local";
      return [
        ...(remote
          ? [
              {
                id: "config-observe" as const,
                title: "Check / review Config update…",
                enabled: true,
              },
            ]
          : []),
        ...(remote && source.adoption.status === "adopted"
          ? [
              {
                id: "config-forget" as const,
                title: "Forget Adopted Config",
                enabled: true,
              },
            ]
          : []),
        {
          id: "config-remove",
          title: "Remove Config Source",
          enabled: true,
        },
        {
          id: "add-config-source",
          title: "Add Config Source",
          enabled: true,
        },
      ];
    }
    if (pages.config(destination as Exclude<Destination, "workspace">).section === "collections")
      return [
        {
          id: "new-collection",
          title: "New Collection",
          enabled: true,
        },
        ...(collection || collectionUse
          ? [
              ...(collection ? collectionMutationIntents(projection.installedSkills.length) : []),
              {
                id: "set-collection-use" as const,
                title: "Set Collection Use",
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
            enabled: true,
          },
        ]
      : [
          ...(projection &&
          currentSection === "skills" &&
          skillsStatus(projection)?.action === "add-source"
            ? [{ id: "add-source" as const, title: "Add a Source", enabled: true }]
            : []),
          ...(projection &&
          currentSection === "skills" &&
          skillsStatus(projection)?.action === "create-collection"
            ? [{ id: "new-collection" as const, title: "Create a Collection", enabled: true }]
            : []),
          ...selectedSkillActionIntents(destination, projection, pages),
          ...checkedSkillActionIntents(destination, projection, pages),
        ];
  const common = [
    {
      id: "add-skills" as const,
      title: "Add Skills",
      enabled: true,
    },
    {
      id: "check-updates" as const,
      title: "Check Updates",
      enabled: true,
    },
    {
      id: "view-installed-skills" as const,
      title: "View Installed Skills",
      enabled: true,
    },
  ];
  const addSource = {
    id: "add-source" as const,
    title: "Add Source",
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
          enabled: true,
        },
        {
          id: "remove-source",
          title: "Remove Source",
          enabled: !unavailableReason,
          reason: unavailableReason,
        },
        addSource,
      ]
    : [...common, addSource];
}

function collectionMutationIntents(installedSkillCount: number): readonly ActionIntent[] {
  const hasSkills = installedSkillCount > 0;
  return [
    {
      id: "add-membership",
      title: "Add Membership",
      enabled: hasSkills,
      reason: hasSkills ? undefined : "No Installed Skill is available",
    },
    {
      id: "import-collection",
      title: "Import Collection",
      enabled: true,
    },
    {
      id: "add-reference",
      title: "Add Reference",
      enabled: true,
    },
    {
      id: "add-link",
      title: "Add Link",
      enabled: true,
    },
    {
      id: "remove-collection",
      title: "Remove Collection",
      enabled: true,
    },
  ];
}

function selectedSkillActionIntents(
  destination: Destination,
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): readonly ActionIntent[] {
  if (!projection || destination !== "workspace" || pages.workspace.section !== "skills") return [];
  const context = installedSkillContext(destination, projection, pages);
  if (!context) return [];
  const { skill } = context;
  const source = skill.source;
  const healthy = skill.owner.health === "healthy";
  const sourceReason = source ? undefined : `Source ${skill.address.source} is not available`;
  const collectionTargets = skillCollectionTargets(
    "skill-add-to-collection",
    destination,
    projection,
    pages,
  );
  const handoff = (title: string, enabled: boolean, reason?: string): ActionIntent => ({
    id: `skill-${title.toLowerCase().replaceAll(" ", "-")}` as ActionId,
    title,
    enabled,
    reason,
  });
  return [
    {
      id: "skill-add-to-collection",
      title: "Add to collection",
      description: `Add only the current Installed Skill ${JSON.stringify(skill.address)}; choose a destination Collection`,
      enabled: !collectionTargets.reason,
      reason: collectionTargets.reason,
    },
    {
      id: "skill-open-collection-use",
      title: "Collection Use",
      enabled: skill.selectorViews.status === "complete",
      reason:
        skill.selectorViews.status === "complete"
          ? undefined
          : "Collection Use relationship paths are unavailable",
    },
    {
      id: "skill-open-source",
      title: "Open source",
      enabled: !!source,
      reason: sourceReason,
    },
    {
      id: "skill-check-updates",
      title: "Update Skill",
      enabled: !!source && healthy,
      reason: sourceReason ?? (healthy ? undefined : `Owner is ${skill.owner.health}`),
    },
    handoff("Rebind", true),
    handoff("Uninstall", true),
  ];
}

function checkedSkillActionIntents(
  destination: Destination,
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): readonly ActionIntent[] {
  if (
    !projection ||
    destination !== "workspace" ||
    pages.workspace.section !== "skills" ||
    !pages.workspace.selectedSkills.length
  )
    return [];
  const targets = skillCollectionTargets(
    "skill-add-selected-to-collection",
    destination,
    projection,
    pages,
  );
  return [
    {
      id: "skill-add-selected-to-collection",
      title: `Add ${pages.workspace.selectedSkills.length} selected to Collection`,
      description: `Add exactly the checked Installed Skills, including targets hidden by this view: ${pages.workspace.selectedSkills
        .map((address) => JSON.stringify(address))
        .join(", ")}; choose a destination Collection`,
      enabled: !targets.reason,
      reason: targets.reason,
    },
  ];
}

const actionDestination = (id: ActionId): string => {
  switch (id) {
    case "open-config":
    case "open-config-integration":
      return "Config";
    case "open-config-source":
      return "Config Source";
    case "add-skills":
      return "Source selection";
    case "check-updates":
    case "skill-check-updates":
    case "collection-check-updates":
      return "Updates";
    case "view-installed-skills":
      return "Installed Skills";
    case "remove-source":
      return "Review Source removal";
    case "new-collection":
      return "Collection form";
    case "add-membership":
      return "Membership form";
    case "remove-membership":
      return "Review Membership removal";
    case "import-collection":
      return "Import form";
    case "add-reference":
    case "remove-reference":
    case "add-link":
    case "remove-link":
    case "remove-collection":
      return "Review form";
    case "set-collection-use":
      return "Collection Use form";
    case "skill-add-to-collection":
    case "skill-add-selected-to-collection":
      return "Collection chooser";
    case "skill-open-collection-use":
      return "Collection Use";
    case "skill-open-source":
      return "Source";
    case "skill-rebind":
      return "Rebind form";
    case "skill-uninstall":
      return "Uninstall review";
    case "config-observe":
      return "Remote Config review";
    case "config-forget":
    case "config-remove":
      return "Review Config removal";
    case "enable-managed-opencode":
    case "disable-managed-opencode":
      return "Managed OpenCode review";
    case "add-source":
      return "Source registration form";
    case "add-config-source":
      return "Config Source registration form";
    case "open-palette":
      return "Command palette";
  }
};

const dangerousAction = (id: ActionId) =>
  [
    "remove-source",
    "remove-membership",
    "remove-reference",
    "remove-link",
    "remove-collection",
    "skill-uninstall",
    "config-forget",
    "config-remove",
    "disable-managed-opencode",
  ].includes(id);

const commandRecord = (intent: ActionIntent): ActionRecord => ({
  id: intent.id,
  keys: ["enter"],
  verb: intent.title,
  destination: actionDestination(intent.id),
  scope: "page",
  ...(intent.description !== undefined ? { description: intent.description } : {}),
  enabled: intent.enabled,
  ...(intent.reason ? { disabledReason: intent.reason } : {}),
  danger: dangerousAction(intent.id),
});

export function reachableActions(
  destination: Destination,
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): readonly ActionRecord[] {
  const intents = [...reachableActionIntents(destination, projection, pages)];
  if (
    destination === "workspace" &&
    pages.workspace.section === "skills" &&
    pages.workspace.skillsView === "current-exposure" &&
    projection?.effective.status === "complete"
  ) {
    const row = deriveAgentAccessTree(projection, pages.workspace.expandedExposurePaths).rows.find(
      (candidate) => candidate.key === pages.workspace.selectedExposurePath,
    );
    if (row && row.kind !== "skill") {
      const collection = row.kind === "reference" ? row.target : row.collection;
      const available =
        !row.missingReason &&
        projection.effective.collectionsView.some((view) => view.id === collection);
      intents.push({
        id: "collection-check-updates",
        title: "Check Collection updates",
        description: `Check installed Skills reachable from ${collection}`,
        enabled: available,
        reason: available ? undefined : (row.missingReason ?? "Collection is unavailable"),
      });
    }
  }
  return intents.map(commandRecord);
}

export function selectedSkillActions(
  destination: Destination,
  projection: WorkspaceView | undefined,
  pages: PageActionFacts,
): readonly ActionRecord[] {
  return selectedSkillActionIntents(destination, projection, pages).map(commandRecord);
}

export function skillSourceIntent(
  destination: Destination,
  projection: WorkspaceView,
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
  id: "add-skills",
  destination: Destination,
  projection: WorkspaceView,
  pages: PageActionFacts,
): SourceOperationIntent {
  const context = selectedSourceContext(destination, projection, pages);
  if (!context) throw new Error(`${id} is not reachable for this selection`);
  return {
    kind: "source-discovery",
    source: context.source,
  };
}

export function actionIntent(
  id: "remove-source",
  destination: Destination,
  projection: WorkspaceView,
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
  projection: WorkspaceView,
  pages: PageActionFacts,
): Extract<SourceRouteIntent, { readonly kind: "open-config" }>;
export function sourceRouteIntent(
  id: "open-config-source",
  destination: Destination,
  projection: WorkspaceView,
  pages: PageActionFacts,
): Extract<SourceRouteIntent, { readonly kind: "open-config-source" }>;
export function sourceRouteIntent(
  id: "open-config" | "open-config-source",
  destination: Destination,
  projection: WorkspaceView,
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
