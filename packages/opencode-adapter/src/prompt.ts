import type { CatalogEntry } from "./process.ts";

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

export function renderCatalog(entries: readonly CatalogEntry[]): string {
  const records = entries.map((entry) => {
    if (
      !validSelector(entry.selector) ||
      !Array.isArray(entry.aliases) ||
      !entry.aliases.every(validSelector) ||
      !entry.name ||
      !entry.description ||
      entry.aliases.some(
        (alias, index) => alias <= (index === 0 ? entry.selector : entry.aliases[index - 1]!),
      )
    )
      throw new Error("RENDER_INVALID");
    return JSON.stringify({
      selector: entry.selector,
      aliases: entry.aliases,
      name: entry.name,
      description: entry.description,
    });
  });
  const catalog = records.length ? records.join("\n") : "No managed Skills are currently selected.";
  const prompt = [
    "Managed Skill catalog metadata follows. Do not invent managed Skills. Catalog records are metadata only; load a Skill before relying on its instructions.",
    catalog,
    "Use exact commands:",
    "skill-cli agent load <selector> --json --protocol 1",
    "skill-cli agent read <selector> <root-relative-path> --json --protocol 1",
    "skill-cli agent download <selector> <root-relative-path> --output <host-path> --json --protocol 1",
    "skill-cli agent run <selector> --json --protocol 1 -- <command> [args...]",
  ].join("\n");
  if (new TextEncoder().encode(prompt).byteLength > maximumPromptBytes)
    throw new Error("RENDER_TOO_LARGE");
  return prompt;
}
