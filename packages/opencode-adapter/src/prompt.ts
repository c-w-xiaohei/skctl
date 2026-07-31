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
  const records = items.map((item) => {
    if (item.kind === "skill" && (!validSelector(item.selector) || !item.name || !item.description))
      throw new Error("RENDER_INVALID");
    if (item.kind === "collection" && (!item.id || !item.name)) throw new Error("RENDER_INVALID");
    return JSON.stringify(item);
  });
  const catalog = records.length ? records.join("\n") : "No managed Skills are currently selected.";
  const prompt = [
    `Managed Skill catalog metadata follows for ${scope.kind === "root" ? "Use roots" : `collection ${scope.id}`}. Do not invent managed Skills. Browse collection nodes before loading Skills.`,
    catalog,
    "Use exact commands:",
    "skill-cli agent browse <collection-id>",
    "skill-cli agent load <selector>",
    "skill-cli agent read <selector> <root-relative-path>",
    "skill-cli agent download <selector> <root-relative-path> --output <host-path>",
    "skill-cli agent run <selector> -- <command> [args...]",
  ].join("\n");
  if (new TextEncoder().encode(prompt).byteLength > maximumPromptBytes)
    throw new Error("RENDER_TOO_LARGE");
  return prompt;
}
