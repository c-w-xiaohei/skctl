import { SkctlError, type AgentCatalogItem } from "@skctl/core";

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
  scope: { readonly kind: "root" } | { readonly kind: "collection"; readonly id: string },
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
  const catalog = `<managed_skill_catalog ${scopeAttributes}>${records.join("") || emptyMessage}</managed_skill_catalog>`;
  const output =
    scope.kind === "collection"
      ? catalog
      : [
          "Managed Skills are progressively disclosed. Collection descriptions route discovery; only loaded Skills contain task instructions.",
          "Before planning or answering, use descriptions to browse task-relevant Collections and load matching Skills. Skip unrelated branches; stop a branch when nothing matches.",
          "- Collection: `skctl agent browse <collection-id>`",
          "- Skill: `skctl agent load <selector>`",
          "Use only exact displayed IDs and selectors; never infer addresses.",
          "Reuse applicable browse results and full Skill instructions still in context. Do not revisit a Collection solely because another reference points to it. Re-read needed content when missing (including after compaction) or stale.",
          "Follow loaded Skill instructions; read referenced resources only as needed for the current task and the Skill's conditions:",
          "- Read text: `skctl agent read <selector> <root-relative-path>`",
          "- Copy a resource: `skctl agent download <selector> <root-relative-path> --output <host-path>`",
          "- Run in a temporary copy of the Skill Root: `skctl agent run <selector> -- <command> [args...]`; write persistent outputs to absolute paths.",
          "Use subcommand --help when options are unclear.",
          catalog,
        ].join("\n");
  if (Buffer.byteLength(output) > maximumPromptBytes)
    throw new SkctlError("TEXT_TOO_LARGE", "Catalog prompt is too large");
  return `${output}\n`;
}
