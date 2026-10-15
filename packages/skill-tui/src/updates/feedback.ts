import type { UpdateAddress } from "./scope";
import type { UpdateGroup, UpdateIssue, UpdateRun } from "./state";

export interface UpdateFeedback {
  readonly source: string;
  readonly address?: UpdateAddress;
  readonly title: string;
  readonly body: string;
  readonly recovery: "inspect-skill" | "inspect-source" | "recheck";
  readonly detail: string;
}

/** One issue per Source; raw diagnostics stay in the opt-in detail view. */
export function updateFeedback(
  addresses: readonly UpdateAddress[],
  groups: readonly UpdateGroup[],
  run?: UpdateRun,
): readonly UpdateFeedback[] {
  const allowed = new Set(addresses.map((address) => `${address.source}\0${address.path}`));
  const sources = new Map<string, UpdateFeedback>();
  const explain = (
    source: string,
    detail: string,
    issue?: UpdateIssue,
    unknown = false,
  ): UpdateFeedback => {
    if (unknown)
      return {
        source,
        title: "Result not confirmed",
        body: "Inspect installed content before retrying.",
        recovery: "inspect-source",
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
    if (!result.message || !allowed.has(`${result.address.source}\0${result.address.path}`))
      continue;
    const current = sources.get(result.address.source);
    if (!current || result.status === "unknown") {
      sources.set(
        result.address.source,
        explain(result.address.source, result.message, result.issue, result.status === "unknown"),
      );
    } else if (!current.detail.includes(result.message)) {
      sources.set(result.address.source, {
        ...current,
        detail: `${current.detail}\n\n${result.message}`,
      });
    }
  }
  for (const group of groups) {
    if (
      !group.error ||
      sources.has(group.source) ||
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
  return [...sources.values()];
}
