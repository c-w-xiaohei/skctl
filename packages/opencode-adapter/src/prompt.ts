import type { CatalogEntry, CatalogReference } from "./process.ts";

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

export function renderCatalog(
  entries: readonly CatalogEntry[],
  references: readonly CatalogReference[],
): string {
  const records = entries.map((entry) => {
    if (!validSelector(entry.selector) || !entry.name || !entry.description)
      throw new Error("RENDER_INVALID");
    return JSON.stringify({
      selector: entry.selector,
      name: entry.name,
      description: entry.description,
    });
  });
  const referenceRecords = references.map((reference) => {
    if (!reference.name || !reference.description || !reference.collection)
      throw new Error("RENDER_INVALID");
    return JSON.stringify(reference);
  });
  const catalog =
    records.length || referenceRecords.length
      ? [...records, ...referenceRecords].join("\n")
      : "No managed Skills are currently selected.";
  const prompt = [
    "Managed Skill catalog metadata follows. Do not invent managed Skills. Skill records are direct members; reference records are category navigation targets. Load a Skill before relying on its instructions.",
    catalog,
    "Use exact commands:",
    "skill-cli agent list <collection>",
    "skill-cli agent load <selector>",
    "skill-cli agent read <selector> <root-relative-path>",
    "skill-cli agent download <selector> <root-relative-path> --output <host-path>",
    "skill-cli agent run <selector> -- <command> [args...]",
  ].join("\n");
  if (new TextEncoder().encode(prompt).byteLength > maximumPromptBytes)
    throw new Error("RENDER_TOO_LARGE");
  return prompt;
}
