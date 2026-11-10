import type { Diagnostic, WorkspaceView } from "@skctl/core";

/** Presentation derived from Core facts, never a second onboarding state machine. */
export function skillsStatus(
  workspace: WorkspaceView | undefined,
  failure?: Diagnostic,
  agentAccess = true,
) {
  // The inventory remains browseable when only configuration/refresh failed.
  if (!agentAccess && workspace?.installedSkills.length) return undefined;
  if (failure)
    return {
      title: "Could not read your workspace",
      message: failure.message,
      action: "retry" as const,
    };
  if (!workspace)
    return {
      title: "Loading your Skills",
      message: "Reading configuration and installed records.",
    };
  const { effective, installedSkills, configs } = workspace;
  if (effective.status !== "complete") {
    const problem = configs.find(
      (config) => config.file.status === "invalid" || config.file.status === "unreadable",
    );
    return {
      title: "Could not read your configuration",
      message: [problem?.file.file, effective.reasons[0]?.message ?? "Configuration is incomplete."]
        .filter(Boolean)
        .join("\n"),
      action: "problems" as const,
    };
  }
  if (installedSkills.length && !effective.sources.length)
    return {
      title: "Your installed Skills are still here",
      message: `${installedSkills.length} Skills installed. No Sources configured. Restore your Source declarations to manage these installations.`,
      action: "configuration" as const,
    };
  const previous = workspace.diagnostics.find((item) => item.code === "PREVIOUS_DATA_FOUND");
  if (previous)
    return {
      title: "Previous skctl data found",
      message: previous.message,
      action: "configuration" as const,
    };
  if (agentAccess && effective.agent.status === "available" && effective.use.length)
    return undefined;
  if (!installedSkills.length && !effective.sources.length)
    return {
      title: "Add your first Source",
      message:
        "No Sources or installed Skills yet. Add a Git repository or local folder to get started.",
      action: "add-source" as const,
    };
  if (!installedSkills.length && effective.sources.length)
    return {
      title: "Choose Skills to install",
      message: `${effective.sources.length} Sources registered. No Skills installed. Discover the Skills available from your Sources.`,
      action: "browse-sources" as const,
    };
  if (!agentAccess) return undefined;
  if (!effective.collections.length)
    return {
      title: "Organize Skills into a Collection",
      message: "Create a Collection and add the Skills you want agents to discover.",
      action: "create-collection" as const,
    };
  if (
    !effective.use.length &&
    effective.collectionsView.every(
      (collection) => !collection.members.length && !collection.references.length,
    )
  )
    return {
      title: "Add Skills to a Collection",
      message:
        "Your Skills are installed. Open a Collection to choose its members; catalog settings can be added when ready.",
      action: "organize-collection" as const,
      collection: effective.collectionsView[0]?.id,
    };
  if (!effective.use.length)
    return {
      title: "Choose Collections for agents",
      message:
        "Choose which Collections appear in the catalog. Configure host entries separately in Integrations.",
      action: "choose-collections" as const,
    };
  if (effective.agent.status !== "available")
    return {
      title: "Agent catalog needs attention",
      message:
        effective.agent.reasons.map((reason) => reason.message).join("\n") ||
        "Review the selected Collections and their declarations.",
      action: "problems" as const,
    };
  return undefined;
}
