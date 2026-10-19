import type { UpdateAddress } from "./scope";
import type { UpdateGroup, UpdateIssue, UpdateRun } from "./state";

export interface UpdateFeedback {
  readonly source: string;
  readonly address?: UpdateAddress;
  readonly title: string;
  readonly body: string;
  readonly recovery: "inspect-skill" | "inspect-source" | "recheck";
  readonly uncertain?: true;
  readonly detail: string;
}

/** Known batch failures share a Source notice; uncertain outcomes retain each Skill. */
export function updateFeedback(
  addresses: readonly UpdateAddress[],
  groups: readonly UpdateGroup[],
  run?: UpdateRun,
): readonly UpdateFeedback[] {
  const allowed = new Set(addresses.map((address) => `${address.source}\0${address.path}`));
  const sources = new Map<string, UpdateFeedback>();
  const uncertain = new Map<string, UpdateFeedback>();
  const uncertainSources = new Set<string>();
  const messages = new Map<string, Set<string>>();
  const collect = (notices: Map<string, UpdateFeedback>, key: string, notice: UpdateFeedback) => {
    const diagnostics = messages.get(key) ?? new Set<string>();
    diagnostics.add(notice.detail);
    messages.set(key, diagnostics);
    notices.set(key, { ...(notices.get(key) ?? notice), detail: [...diagnostics].join("\n\n") });
  };
  const explain = (
    source: string,
    detail: string,
    issue?: UpdateIssue,
    unknownAddress?: UpdateAddress,
  ): UpdateFeedback => {
    if (unknownAddress)
      return {
        source,
        address: unknownAddress,
        title: "Result not confirmed",
        body: "Inspect installed content before retrying.",
        recovery: "inspect-skill",
        uncertain: true,
        detail,
      };
    const common = { source, address: issue?.address, detail };
    switch (issue?.kind) {
      case "ownership":
        return {
          ...common,
          title: "Update blocked",
          body: "Ownership needs attention. Installed content kept.",
          recovery: "inspect-skill",
        };
      case "metadata":
        return {
          ...common,
          title: "Update blocked",
          body: "Fix SKILL.md in the Source. Installed content kept.",
          recovery: "inspect-source",
        };
      case "scope":
        return {
          ...common,
          title: "Update blocked",
          body: "The Source or installation changed. Recheck before updating.",
          recovery: "recheck",
        };
      case "removed":
        return {
          ...common,
          title: "No longer in Source",
          body: "The installed Skill was kept. Inspect the Source before removing it.",
          recovery: "inspect-source",
        };
      default:
        return {
          ...common,
          title: "Check failed",
          body: "Could not check this Source. Completed updates are retained.",
          recovery: "recheck",
        };
    }
  };
  for (const result of run?.results ?? []) {
    const key = `${result.address.source}\0${result.address.path}`;
    if (!allowed.has(key)) continue;
    if (result.status === "unknown") {
      uncertainSources.add(result.address.source);
      collect(
        uncertain,
        key,
        explain(
          result.address.source,
          result.message ||
            groups.find((group) => group.source === result.address.source)?.error ||
            "No diagnostic was returned. The update result is not confirmed.",
          result.issue,
          result.address,
        ),
      );
    } else if (result.message)
      collect(
        sources,
        result.address.source,
        explain(result.address.source, result.message, result.issue),
      );
  }
  for (const group of groups) {
    if (
      !group.error ||
      sources.has(group.source) ||
      uncertainSources.has(group.source) ||
      !addresses.some((address) => address.source === group.source)
    )
      continue;
    sources.set(group.source, {
      ...explain(group.source, group.error),
      ...(group.status === "cancelled"
        ? { title: "Check stopped", body: "The check was cancelled. Installed content kept." }
        : group.committed && group.status === "succeeded"
          ? {
              title: "Updated; status unavailable",
              body: "Completed updates were kept. Recheck this Source.",
            }
          : {}),
    });
  }
  return [...uncertain.values(), ...sources.values()];
}
