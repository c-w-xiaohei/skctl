import type { AgentCatalogItem } from "@skill-cli/core";

const maximumPromptBytes = 64 * 1024;

export const unavailableCatalogPrompt =
  "skill-cli managed catalog is unavailable for this request. Do not invent managed Skills; continue without it or report the unavailable catalog.";

export function renderAgentCatalog(
  scope: { readonly kind: "root" } | { readonly kind: "collection"; readonly id: string },
  items: readonly AgentCatalogItem[],
): string {
  const records = items.map((item) =>
    item.kind === "skill"
      ? `<skill><selector>${item.selector}</selector><name>${item.name}</name><description>${item.description}</description></skill>`
      : `<collection><id>${item.id}</id><name>${item.name}</name>${item.description ? `<description>${item.description}</description>` : ""}</collection>`,
  );
  const scopeAttributes =
    scope.kind === "root" ? 'scope="root"' : `scope="collection" id="${scope.id}"`;
  const catalog = `<managed_skill_catalog ${scopeAttributes}>${records.join("") || "No managed Skills are currently selected."}</managed_skill_catalog>`;
  const output =
    scope.kind === "collection"
      ? catalog
      : [
          "Managed Skills are progressively disclosed. Collection descriptions route discovery; only loaded Skills contain task instructions.",
          "Before planning or answering, follow any potentially relevant item:",
          "- Collection: `skill-cli agent browse <collection-id>`",
          "- Skill: `skill-cli agent load <selector>`; load it before planning or answering.",
          "Use only exact displayed IDs and selectors; never infer addresses.",
          "After loading, follow the Skill and use its resources without reading CLI help:",
          "- Read text: `skill-cli agent read <selector> <root-relative-path>`",
          "- Copy a resource: `skill-cli agent download <selector> <root-relative-path> --output <host-path>`",
          "- Run in the Skill Root: `skill-cli agent run <selector> -- <command> [args...]`",
          catalog,
        ].join("\n");
  if (new TextEncoder().encode(output).byteLength > maximumPromptBytes)
    throw new Error("Catalog prompt is too large");
  return `${output}\n`;
}
