import { InputRenderable, Renderable } from "@opentui/core";
import type { FocusRegistry } from "./focus";
import type { FocusOwner } from "./types";

const titles: Record<string, string> = {
  "shell-context-panel": "Context",
  "section-nav": "Pages",
  "skills-local-views": "Skill views",
  "skills-list-pane": "Skills",
  "skill-inspector": "Skill details",
  "sources-list-pane": "Sources",
  "source-details-pane": "Source details",
  "reader-pane": "Reader",
  "collections-list-pane": "Collections",
  "collection-detail-pane": "Collection details",
  "collection-preview-pane": "Collection overview",
  "config-work-area": "Config",
  "config-metadata-pane": "Declaration details",
  "updates-page": "Updates",
  "source-updates-page": "Updates",
  "updates-actions-pane": "Update actions",
  "source-updates-actions-pane": "Update actions",
  "updates-data-pane": "Sources",
  "source-updates-data-pane": "Skills",
  "updates-query-pane": "Search Sources",
  "source-updates-query-pane": "Search Skills",
  "updates-feedback-pane": "Update feedback",
  "source-updates-feedback-pane": "Update feedback",
};

export const isMounted = (target: unknown): target is Renderable =>
  target instanceof Renderable && !target.isDestroyed && target.parent != null;

/** Physical panels only; semantic routes and desired focus remain App-owned. */
export function createPanelNavigation(
  root: Renderable,
  registry: FocusRegistry,
  enabled: (owner: FocusOwner) => boolean,
) {
  const remembered = new WeakMap<Renderable, FocusOwner>();
  const paneOf = (target: Renderable | null): Renderable | undefined => {
    for (let node = target; node; node = node.parent as Renderable | null)
      if (node.id in titles || node.id.endsWith("-pane")) return node;
    return undefined;
  };
  const ownerOf = (target: Renderable): FocusOwner | undefined => {
    for (let node: Renderable | null = target; node; node = node.parent as Renderable | null) {
      const owner = registry.ownerOf(node);
      if (owner) return owner;
    }
    return target instanceof InputRenderable ? "input" : undefined;
  };
  const order = (rootId = "route-shell"): readonly FocusOwner[] => {
    const panes = new Map<Renderable, FocusOwner[]>();
    const visit = (node: Renderable) => {
      if (!node.visible || node.isDestroyed) return;
      if (node.focusable && node.height > 0) {
        const owner = ownerOf(node),
          pane = paneOf(node);
        if (pane && owner && enabled(owner)) {
          const candidates = panes.get(pane) ?? [];
          if (!candidates.includes(owner)) candidates.push(owner);
          panes.set(pane, candidates);
        }
      }
      for (const child of node.getChildren()) visit(child as Renderable);
    };
    const surface = root.findDescendantById(rootId);
    if (surface) visit(surface);
    return [...panes].map(
      ([pane, candidates]) =>
        candidates.find(
          (owner) =>
            owner === remembered.get(pane) &&
            isMounted(registry.target(owner)) &&
            paneOf(registry.target(owner) as Renderable) === pane,
        ) ??
        candidates.find(
          (owner) => pane.id === "skill-inspector" && owner === "command:skill.open-skill-md",
        ) ??
        candidates.find((owner) => owner === "browser") ??
        candidates.find((owner) => owner === "agent-preview" || owner === "collection-tree") ??
        candidates.find((owner) => ["top-nav", "local-nav", "skills-views"].includes(owner)) ??
        candidates.find((owner) => owner.startsWith("command:")) ??
        candidates[0]!,
    );
  };
  return {
    order,
    title: (target: Renderable | null) => {
      const pane = paneOf(target);
      return pane && titles[pane.id];
    },
    observe(target: Renderable | null, owner: FocusOwner | undefined) {
      const pane = paneOf(target);
      if (pane && owner) remembered.set(pane, owner);
    },
    next(target: Renderable | null, reverse: boolean) {
      const panels = order(),
        pane = paneOf(target);
      const index = panels.findIndex((owner) => {
        const control = registry.target(owner);
        return control instanceof Renderable && paneOf(control) === pane;
      });
      return panels.length
        ? panels[
            index < 0
              ? reverse
                ? panels.length - 1
                : 0
              : (index + (reverse ? -1 : 1) + panels.length) % panels.length
          ]
        : undefined;
    },
  };
}
