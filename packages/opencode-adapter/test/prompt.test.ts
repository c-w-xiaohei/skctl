import { describe, expect, test } from "bun:test";
import { UNAVAILABLE_NOTICE, renderCatalog } from "../src/prompt.ts";

const entry = {
  selector: 'alpha:deploy"x',
  aliases: ["team:release", "zeta:deploy"],
  name: "deploy\nnow",
  description: "Use \\ safely",
  loadingOwner: "skill-cli" as const,
  provenance: {
    source: "team",
    origin: "local" as const,
    declaration: { layer: "project" },
    stability: "mutable-local" as const,
  },
};

describe("catalog prompt", () => {
  test("renders metadata records with JSON escaping and exact commands", () => {
    const output = renderCatalog([entry]);
    expect(output).toContain(
      JSON.stringify({
        selector: entry.selector,
        aliases: entry.aliases,
        name: entry.name,
        description: entry.description,
      }),
    );
    for (const command of [
      "skill-cli agent load <selector> --json --protocol 1",
      "skill-cli agent read <selector> <root-relative-path> --json --protocol 1",
      "skill-cli agent download <selector> <root-relative-path> --output <host-path> --json --protocol 1",
      "skill-cli agent run <selector> --json --protocol 1 -- <command> [args...]",
    ])
      expect(output).toContain(command);
    expect(output).not.toContain("provenance");
  });

  test("renders concise empty state and rejects malformed or oversized records", () => {
    expect(renderCatalog([])).toContain("No managed Skills are currently selected.");
    expect(() => renderCatalog([{ ...entry, selector: "" }])).toThrow("RENDER_INVALID");
    expect(() => renderCatalog([{ ...entry, aliases: [entry.selector] }])).toThrow(
      "RENDER_INVALID",
    );
    expect(() => renderCatalog([{ ...entry, aliases: ["team:z", "team:a"] }])).toThrow(
      "RENDER_INVALID",
    );
    expect(() => renderCatalog(Array.from({ length: 5_000 }, () => entry))).toThrow(
      "RENDER_TOO_LARGE",
    );
  });

  test("exports the exact unavailable notice", () => {
    expect(UNAVAILABLE_NOTICE).toBe(
      "skill-cli managed catalog is unavailable for this request. Do not invent managed Skills; continue without it or report the unavailable catalog.",
    );
  });
});
