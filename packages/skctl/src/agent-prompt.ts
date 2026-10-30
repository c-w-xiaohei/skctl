import { SkctlError, type AgentBrowseProjection, type AgentCatalogItem } from "@skctl/core";

const maximumPromptBytes = 64 * 1024;
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const unavailableCatalogPrompt =
  "skctl managed catalog is unavailable for this request. Do not invent managed Skills; continue without it or report the unavailable catalog.";

export function renderAgentCatalog(
  scope: Extract<AgentBrowseProjection, { status: "available" }>["scope"],
  items: readonly AgentCatalogItem[],
): string {
  const records = items.map((item) =>
    item.kind === "skill"
      ? `<skill><selector>${xml(item.selector)}</selector><name>${xml(item.name)}</name><description>${xml(item.description)}</description></skill>`
      : `<collection><id>${xml(item.id)}</id><name>${xml(item.name)}</name>${item.description ? `<description>${xml(item.description)}</description>` : ""}</collection>`,
  );
  const scopeAttributes =
    scope.kind === "root" ? 'scope="root"' : `scope="collection" id="${xml(scope.id)}"`;
  const emptyMessage =
    scope.kind === "root"
      ? "No managed Collections are currently exposed."
      : "No Skills or referenced Collections are available in this Collection.";
  const instructions =
    scope.kind === "collection" && scope.instructions
      ? `<instructions>${xml(scope.instructions)}</instructions>`
      : "";
  const catalog = `<managed_skill_catalog ${scopeAttributes}>${instructions}${records.join("") || emptyMessage}</managed_skill_catalog>`;
  const output =
    scope.kind === "collection"
      ? catalog
      : [
          "Collection as Skill: description → custom instructions + member descriptions → selected Skill instructions. Follow applicable instructions.",
          "Before planning or answering, browse relevant Collections and load matching Skills; skip unrelated branches. Use exact displayed addresses.",
          "Reuse content in context, including across References; reread only if missing (e.g. after compaction) or stale.",
          "- Enter: skctl agent browse <collection-id>",
          "- Load: skctl agent load <selector>",
          "Resources, as needed (paths relative to Skill Root):",
          "- List: skctl agent ls <selector> [directory]",
          "- Read: skctl agent read <selector> <root-relative-path>",
          "- Copy: skctl agent download <selector> <root-relative-path> --output <host-path>",
          "- Run: skctl agent run <selector> -- <command> [args...] (temporary Skill copy; use absolute paths for persistent outputs)",
          "See subcommand --help for options.",
          catalog,
        ].join("\n");
  if (Buffer.byteLength(output) > maximumPromptBytes)
    throw new SkctlError("TEXT_TOO_LARGE", "Catalog prompt is too large");
  return `${output}\n`;
}
