import type { CatalogItem, CatalogScope } from "./process.ts";

export const UNAVAILABLE_NOTICE =
  "skill-cli managed catalog is unavailable for this request. Do not invent managed Skills; continue without it or report the unavailable catalog.";

const maximumPromptBytes = 64 * 1024;

function validSelector(value: string): boolean {
  if ((value.match(/:/g) ?? []).length !== 1) return false;
  const [collection, name] = value.split(":");
  return [collection, name].every(
    (part) =>
      !!part &&
      part
        .split("/")
        .every(
          (segment) =>
            !!segment &&
            segment !== "." &&
            segment !== ".." &&
            ![...segment].some((character) => /\s/u.test(character) || ":\\/#".includes(character)),
        ),
  );
}

export function renderCatalog(scope: CatalogScope, items: readonly CatalogItem[]): string {
  const records = items.flatMap((item) => {
    if (item.kind === "skill" && (!validSelector(item.selector) || !item.name || !item.description))
      throw new Error("RENDER_INVALID");
    if (item.kind === "collection" && (!item.id || !item.name)) throw new Error("RENDER_INVALID");
    return item.kind === "skill"
      ? [
          "  <skill>",
          `    <selector>${item.selector}</selector>`,
          `    <name>${item.name}</name>`,
          `    <description>${item.description}</description>`,
          "  </skill>",
        ]
      : [
          "  <collection>",
          `    <id>${item.id}</id>`,
          `    <name>${item.name}</name>`,
          ...(item.description ? [`    <description>${item.description}</description>`] : []),
          "  </collection>",
        ];
  });
  const catalog = records.length ? records : ["  No managed Skills are currently selected."];
  const scopeAttributes =
    scope.kind === "root" ? 'scope="root"' : `scope="collection" id="${scope.id}"`;
  const prompt = [
    "Managed Skills are progressively disclosed. Collection descriptions route discovery; only loaded Skills contain task instructions.",
    "Before planning or answering, follow any potentially relevant item:",
    "- Collection: `skill-cli agent browse <collection-id>`",
    "- Skill: `skill-cli agent load <selector>`; load it before planning or answering.",
    "Use only exact displayed IDs and selectors; never infer addresses.",
    "After loading, follow the Skill and use its resources without reading CLI help:",
    "- Read text: `skill-cli agent read <selector> <root-relative-path>`",
    "- Copy a resource: `skill-cli agent download <selector> <root-relative-path> --output <host-path>`",
    "- Run in the Skill Root: `skill-cli agent run <selector> -- <command> [args...]`",
    `<managed_skill_catalog ${scopeAttributes}>`,
    ...catalog,
    "</managed_skill_catalog>",
  ].join("\n");
  if (new TextEncoder().encode(prompt).byteLength > maximumPromptBytes)
    throw new Error("RENDER_TOO_LARGE");
  return prompt;
}
